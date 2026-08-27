const capabilityValue: unique symbol = Symbol("capabilityValue");

export type Capability<T extends object> = Readonly<{
  id: string;
  [capabilityValue]?: T;
}>;

export function defineCapability<T extends object>(id: string): Capability<T> {
  return Object.freeze({ id });
}

export interface ConfigDecoder<C> {
  parse(raw: unknown): C;
}

export const noConfig: ConfigDecoder<undefined> = Object.freeze({
  parse(raw: unknown): undefined {
    if (raw !== undefined) {
      throw new Error("This plugin does not accept configuration.");
    }
    return undefined;
  },
});

type RequirementMap = Readonly<Record<string, Capability<object>>>;

type ResolvedRequirements<R extends RequirementMap> = {
  readonly [Key in keyof R]: R[Key] extends Capability<infer Value> ? Value : never;
};

export type Cleanup = () => void | Promise<void>;

export interface Lifetime {
  defer(cleanup: Cleanup): void;
  own<T>(value: T, cleanup: (value: T) => void | Promise<void>): T;
}

export interface Plugin<C, R extends RequirementMap, P extends object> {
  readonly id: string;
  readonly provides: Capability<P>;
  readonly requires: R;
  readonly config: ConfigDecoder<C>;
  setup(context: {
    readonly config: C;
    readonly dependencies: ResolvedRequirements<R>;
    readonly lifetime: Lifetime;
  }): P | Promise<P>;
}

export function definePlugin<C, R extends RequirementMap, P extends object>(
  specification: Plugin<C, R, P>,
): Plugin<C, R, P> {
  return Object.freeze({
    ...specification,
    requires: Object.freeze({ ...specification.requires }),
  });
}

type AnyPlugin = Plugin<unknown, RequirementMap, object>;

export interface ApplicationPlan {
  readonly plugins: readonly AnyPlugin[];
  readonly config?: Readonly<Record<string, unknown>>;
}

export type ApplicationState = "running" | "stopping" | "stopped" | "failed";
export type PluginState = "planned" | "starting" | "running" | "stopping" | "stopped" | "failed";

export interface KernelSnapshot {
  readonly state: ApplicationState;
  readonly plannedOrder: readonly string[];
  readonly plugins: readonly Readonly<{
    id: string;
    state: PluginState;
    requires: readonly string[];
    provides: string;
    cleanupCount: number;
    failure?: Readonly<{ name: string; message: string }>;
  }>[];
}

export interface RunningApplication {
  snapshot(): KernelSnapshot;
  stop(): Promise<KernelSnapshot>;
}

export interface CompositionIssue {
  readonly code:
    | "invalid-plugin-id"
    | "invalid-capability-id"
    | "duplicate-plugin"
    | "duplicate-provider"
    | "duplicate-requirement"
    | "missing-provider"
    | "self-dependency"
    | "dependency-cycle"
    | "unknown-config"
    | "invalid-config";
  readonly pluginId?: string;
  readonly capabilityId?: string;
  readonly message: string;
}

export class ApplicationCompositionError extends Error {
  readonly issues: readonly CompositionIssue[];

  constructor(issues: readonly CompositionIssue[]) {
    super(`Application composition failed with ${issues.length} issue(s).`);
    this.name = "ApplicationCompositionError";
    this.issues = issues;
  }
}

export interface CleanupFailure {
  readonly pluginId: string;
  readonly cleanupIndex: number;
  readonly error: Readonly<{ name: string; message: string }>;
}

export class PluginStartError extends Error {
  readonly pluginId: string;
  readonly cause: unknown;
  readonly rollbackErrors: readonly CleanupFailure[];
  readonly kernelSnapshot: KernelSnapshot;

  constructor(input: {
    pluginId: string;
    cause: unknown;
    rollbackErrors: readonly CleanupFailure[];
    snapshot: KernelSnapshot;
  }) {
    super(`Plugin "${input.pluginId}" failed to start.`);
    this.name = "PluginStartError";
    this.pluginId = input.pluginId;
    this.cause = input.cause;
    this.rollbackErrors = input.rollbackErrors;
    this.kernelSnapshot = input.snapshot;
  }
}

export class ApplicationStopError extends Error {
  readonly cleanupErrors: readonly CleanupFailure[];
  readonly kernelSnapshot: KernelSnapshot;

  constructor(cleanupErrors: readonly CleanupFailure[], snapshot: KernelSnapshot) {
    super(`Application stopped with ${cleanupErrors.length} cleanup error(s).`);
    this.name = "ApplicationStopError";
    this.cleanupErrors = cleanupErrors;
    this.kernelSnapshot = snapshot;
  }
}

interface PluginRecord {
  readonly plugin: AnyPlugin;
  readonly declarationIndex: number;
  readonly requirementEntries: readonly [string, Capability<object>][];
  readonly cleanups: Cleanup[];
  state: PluginState;
  parsedConfig?: unknown;
  failure?: Readonly<{ name: string; message: string }>;
}

const identifierPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export async function startApplication(plan: ApplicationPlan): Promise<RunningApplication> {
  const compiled = compilePlan(plan);
  const capabilityValues = new Map<string, object>();
  const started: PluginRecord[] = [];
  let applicationState: ApplicationState = "running";

  const snapshot = (): KernelSnapshot =>
    Object.freeze({
      state: applicationState,
      plannedOrder: Object.freeze(compiled.order.map((record) => record.plugin.id)),
      plugins: Object.freeze(
        compiled.records.map((record) =>
          Object.freeze({
            id: record.plugin.id,
            state: record.state,
            requires: Object.freeze(
              record.requirementEntries.map(([, capability]) => capability.id),
            ),
            provides: record.plugin.provides.id,
            cleanupCount: record.cleanups.length,
            ...(record.failure ? { failure: record.failure } : {}),
          }),
        ),
      ),
    });

  for (const record of compiled.order) {
    record.state = "starting";
    let acceptingCleanups = true;
    const lifetime: Lifetime = Object.freeze({
      defer(cleanup: Cleanup): void {
        if (!acceptingCleanups) {
          throw new Error(`Plugin "${record.plugin.id}" registered cleanup after setup completed.`);
        }
        record.cleanups.push(cleanup);
      },
      own<T>(value: T, cleanup: (owned: T) => void | Promise<void>): T {
        if (!acceptingCleanups) {
          throw new Error(
            `Plugin "${record.plugin.id}" acquired a resource after setup completed.`,
          );
        }
        record.cleanups.push(() => cleanup(value));
        return value;
      },
    });

    const dependencies = Object.fromEntries(
      record.requirementEntries.map(([alias, capability]) => [
        alias,
        capabilityValues.get(capability.id),
      ]),
    ) as ResolvedRequirements<RequirementMap>;

    try {
      const provided = await record.plugin.setup({
        config: record.parsedConfig,
        dependencies,
        lifetime,
      });
      acceptingCleanups = false;
      if (typeof provided !== "object" || provided === null) {
        throw new TypeError(`Plugin "${record.plugin.id}" did not provide an object capability.`);
      }
      capabilityValues.set(record.plugin.provides.id, provided);
      record.state = "running";
      started.push(record);
    } catch (cause) {
      acceptingCleanups = false;
      record.state = "failed";
      record.failure = safeDiagnostic("Plugin setup failed.");
      applicationState = "failed";
      const rollbackErrors = await cleanupRecords([record, ...started.reverse()]);
      throw new PluginStartError({
        pluginId: record.plugin.id,
        cause,
        rollbackErrors,
        snapshot: snapshot(),
      });
    }
  }

  let stopPromise: Promise<KernelSnapshot> | undefined;

  const stop = (): Promise<KernelSnapshot> => {
    if (stopPromise) {
      return stopPromise;
    }

    stopPromise = (async () => {
      applicationState = "stopping";
      const cleanupErrors = await cleanupRecords([...started].reverse());
      applicationState = cleanupErrors.length > 0 ? "failed" : "stopped";
      const finalSnapshot = snapshot();
      if (cleanupErrors.length > 0) {
        throw new ApplicationStopError(cleanupErrors, finalSnapshot);
      }
      return finalSnapshot;
    })();

    return stopPromise;
  };

  return Object.freeze({ snapshot, stop });
}

function compilePlan(plan: ApplicationPlan): {
  readonly records: readonly PluginRecord[];
  readonly order: readonly PluginRecord[];
} {
  const issues: CompositionIssue[] = [];
  const records: PluginRecord[] = plan.plugins.map((plugin, declarationIndex) => ({
    plugin,
    declarationIndex,
    requirementEntries: Object.entries(plugin.requires),
    cleanups: [],
    state: "planned",
  }));
  const pluginIds = new Set<string>();
  const providers = new Map<string, PluginRecord>();

  for (const record of records) {
    const { plugin } = record;
    if (!identifierPattern.test(plugin.id)) {
      issues.push({
        code: "invalid-plugin-id",
        pluginId: plugin.id,
        message: `Plugin id "${plugin.id}" is not a stable identifier.`,
      });
    }
    if (pluginIds.has(plugin.id)) {
      issues.push({
        code: "duplicate-plugin",
        pluginId: plugin.id,
        message: `Plugin id "${plugin.id}" is registered more than once.`,
      });
    }
    pluginIds.add(plugin.id);

    const capabilityId = plugin.provides.id;
    if (!identifierPattern.test(capabilityId)) {
      issues.push({
        code: "invalid-capability-id",
        pluginId: plugin.id,
        capabilityId,
        message: `Capability id "${capabilityId}" is not a stable identifier.`,
      });
    }
    const existingProvider = providers.get(capabilityId);
    if (existingProvider) {
      issues.push({
        code: "duplicate-provider",
        pluginId: plugin.id,
        capabilityId,
        message: `Capability "${capabilityId}" is provided by both "${existingProvider.plugin.id}" and "${plugin.id}".`,
      });
    } else {
      providers.set(capabilityId, record);
    }

    const requiredIds = new Set<string>();
    for (const [, required] of record.requirementEntries) {
      if (requiredIds.has(required.id)) {
        issues.push({
          code: "duplicate-requirement",
          pluginId: plugin.id,
          capabilityId: required.id,
          message: `Plugin "${plugin.id}" requires capability "${required.id}" more than once.`,
        });
      }
      requiredIds.add(required.id);
    }
  }

  const configuredIds = new Set(Object.keys(plan.config ?? {}));
  for (const configuredId of configuredIds) {
    if (!pluginIds.has(configuredId)) {
      issues.push({
        code: "unknown-config",
        pluginId: configuredId,
        message: `Configuration was supplied for unknown plugin "${configuredId}".`,
      });
    }
  }

  for (const record of records) {
    for (const [, required] of record.requirementEntries) {
      const provider = providers.get(required.id);
      if (!provider) {
        issues.push({
          code: "missing-provider",
          pluginId: record.plugin.id,
          capabilityId: required.id,
          message: `Plugin "${record.plugin.id}" requires missing capability "${required.id}".`,
        });
      } else if (provider === record) {
        issues.push({
          code: "self-dependency",
          pluginId: record.plugin.id,
          capabilityId: required.id,
          message: `Plugin "${record.plugin.id}" depends on its own capability "${required.id}".`,
        });
      }
    }
  }

  for (const record of records) {
    try {
      record.parsedConfig = record.plugin.config.parse(plan.config?.[record.plugin.id]);
    } catch {
      issues.push({
        code: "invalid-config",
        pluginId: record.plugin.id,
        message: `Configuration for plugin "${record.plugin.id}" is invalid.`,
      });
    }
  }
  if (issues.length > 0) {
    throw new ApplicationCompositionError(issues);
  }

  const order = stableTopologicalOrder(records, providers);
  if (!order) {
    throw new ApplicationCompositionError([
      {
        code: "dependency-cycle",
        message: "The plugin capability graph contains a dependency cycle.",
      },
    ]);
  }

  return { records, order };
}

function stableTopologicalOrder(
  records: readonly PluginRecord[],
  providers: ReadonlyMap<string, PluginRecord>,
): PluginRecord[] | undefined {
  const indegree = new Map(records.map((record) => [record, 0]));
  const dependents = new Map(records.map((record) => [record, [] as PluginRecord[]]));

  for (const record of records) {
    for (const [, required] of record.requirementEntries) {
      const provider = providers.get(required.id);
      if (!provider || provider === record) {
        continue;
      }
      indegree.set(record, (indegree.get(record) ?? 0) + 1);
      dependents.get(provider)?.push(record);
    }
  }

  const ready = records.filter((record) => indegree.get(record) === 0);
  const order: PluginRecord[] = [];

  while (ready.length > 0) {
    ready.sort((left, right) => left.declarationIndex - right.declarationIndex);
    const next = ready.shift();
    if (!next) {
      break;
    }
    order.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
      }
    }
  }

  return order.length === records.length ? order : undefined;
}

async function cleanupRecords(records: readonly PluginRecord[]): Promise<CleanupFailure[]> {
  const failures: CleanupFailure[] = [];
  for (const record of records) {
    record.state = "stopping";
    for (let index = record.cleanups.length - 1; index >= 0; index -= 1) {
      const cleanup = record.cleanups[index];
      if (!cleanup) {
        continue;
      }
      try {
        await cleanup();
      } catch {
        failures.push({
          pluginId: record.plugin.id,
          cleanupIndex: index,
          error: safeDiagnostic("Plugin cleanup failed."),
        });
      }
    }
    record.cleanups.length = 0;
    record.state = failures.some((failure) => failure.pluginId === record.plugin.id)
      ? "failed"
      : "stopped";
  }
  return failures;
}

function safeDiagnostic(message: string): Readonly<{ name: string; message: string }> {
  return Object.freeze({ name: "Error", message });
}
