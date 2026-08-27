import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCompositionError,
  ApplicationStopError,
  type Capability,
  defineCapability,
  definePlugin,
  noConfig,
  PluginStartError,
  startApplication,
} from "../src/index.js";

interface Value {
  value: string;
}

function plugin(input: {
  id: string;
  provides: Capability<Value>;
  requires?: Readonly<Record<string, Capability<Value>>>;
  events?: string[];
  setup?: (context: {
    dependencies: Readonly<Record<string, Value>>;
    defer(cleanup: () => void | Promise<void>): void;
  }) => Value | Promise<Value>;
}) {
  return definePlugin({
    id: input.id,
    provides: input.provides,
    requires: input.requires ?? {},
    config: noConfig,
    async setup({ dependencies, lifetime }) {
      input.events?.push(`${input.id}:start`);
      if (input.setup) {
        return input.setup({ dependencies, defer: lifetime.defer });
      }
      lifetime.defer(() => {
        input.events?.push(`${input.id}:stop`);
      });
      return { value: input.id };
    },
  });
}

describe("plugin kernel", () => {
  it("prevalidates every config before starting any plugin", async () => {
    const events: string[] = [];
    const First = defineCapability<Value>("test.first");
    const Second = defineCapability<Value>("test.second");
    const first = plugin({ id: "first", provides: First, events });
    const second = definePlugin({
      id: "second",
      provides: Second,
      requires: {},
      config: {
        parse: () => {
          throw new Error("model is required");
        },
      },
      setup: () => {
        events.push("second:start");
        return { value: "second" };
      },
    });

    await expect(startApplication({ plugins: [first, second] })).rejects.toMatchObject({
      name: "ApplicationCompositionError",
      issues: [{ code: "invalid-config", pluginId: "second" }],
    });
    expect(events).toEqual([]);
  });

  it("does not expose configuration decoder details in composition issues", async () => {
    const Configured = defineCapability<Value>("test.configured");
    const secret = "SENTINEL_PRIVATE_CONFIG_VALUE";
    const configured = definePlugin({
      id: "configured",
      provides: Configured,
      requires: {},
      config: {
        parse() {
          throw new Error(`invalid key: ${secret}`);
        },
      },
      setup: () => ({ value: "configured" }),
    });

    const error = await startApplication({ plugins: [configured] }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApplicationCompositionError);
    expect(JSON.stringify((error as ApplicationCompositionError).issues)).not.toContain(secret);
  });

  it("reports every structural and configuration issue before setup", async () => {
    const events: string[] = [];
    const A = defineCapability<Value>("test.a");
    const Missing = defineCapability<Value>("test.missing");
    const plugins = [
      definePlugin({
        id: "alpha",
        provides: A,
        requires: { missing: Missing },
        config: {
          parse() {
            throw new Error("endpoint is required");
          },
        },
        setup() {
          events.push("alpha:start");
          return { value: "alpha" };
        },
      }),
      plugin({ id: "duplicate", provides: A }),
    ];

    const error = await startApplication({
      plugins,
      config: { typo: {} },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApplicationCompositionError);
    expect((error as ApplicationCompositionError).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate-provider",
        "missing-provider",
        "unknown-config",
        "invalid-config",
      ]),
    );
    expect(events).toEqual([]);
  });

  it("rejects configuration for an unknown plugin before setup", async () => {
    const events: string[] = [];
    const Known = defineCapability<Value>("test.known");

    await expect(
      startApplication({
        plugins: [plugin({ id: "known", provides: Known, events })],
        config: { typo: {} },
      }),
    ).rejects.toMatchObject({
      name: "ApplicationCompositionError",
      issues: [{ code: "unknown-config", pluginId: "typo" }],
    });
    expect(events).toEqual([]);
  });

  it("rejects self-dependency and duplicate requirement aliases", async () => {
    const Self = defineCapability<Value>("test.self");
    const Dependency = defineCapability<Value>("test.dependency");
    const Consumer = defineCapability<Value>("test.consumer");
    const plugins = [
      plugin({ id: "self", provides: Self, requires: { self: Self } }),
      plugin({ id: "dependency", provides: Dependency }),
      plugin({
        id: "consumer",
        provides: Consumer,
        requires: { primary: Dependency, duplicate: Dependency },
      }),
    ];

    const error = await startApplication({ plugins }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApplicationCompositionError);
    expect((error as ApplicationCompositionError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "self-dependency", pluginId: "self" }),
        expect.objectContaining({ code: "duplicate-requirement", pluginId: "consumer" }),
      ]),
    );
  });

  it("rejects invalid plugin and capability identifiers", async () => {
    const Invalid = defineCapability<Value>("Test_Invalid");
    const error = await startApplication({
      plugins: [plugin({ id: "Invalid Plugin", provides: Invalid })],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApplicationCompositionError);
    expect((error as ApplicationCompositionError).issues.map((issue) => issue.code)).toEqual([
      "invalid-plugin-id",
      "invalid-capability-id",
    ]);
  });

  it("rejects dependency cycles before setup", async () => {
    const events: string[] = [];
    const A = defineCapability<Value>("test.cycle-a");
    const B = defineCapability<Value>("test.cycle-b");

    await expect(
      startApplication({
        plugins: [
          plugin({ id: "cycle-a", provides: A, requires: { b: B }, events }),
          plugin({ id: "cycle-b", provides: B, requires: { a: A }, events }),
        ],
      }),
    ).rejects.toMatchObject({
      name: "ApplicationCompositionError",
      issues: [{ code: "dependency-cycle" }],
    });
    expect(events).toEqual([]);
  });

  it("rejects cleanup registration after setup has completed", async () => {
    const Late = defineCapability<Value>("test.late-cleanup");
    let registerLateCleanup: (() => void) | undefined;
    const cleanup = vi.fn();
    const application = await startApplication({
      plugins: [
        definePlugin({
          id: "late-cleanup",
          provides: Late,
          requires: {},
          config: noConfig,
          setup({ lifetime }) {
            registerLateCleanup = () => lifetime.defer(cleanup);
            return { value: "ready" };
          },
        }),
      ],
    });

    expect(registerLateCleanup).toBeDefined();
    expect(() => registerLateCleanup?.()).toThrow(/after setup completed/);
    await application.stop();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("aggregates every rollback cleanup failure", async () => {
    const Owner = defineCapability<Value>("test.rollback-owner");
    const Failing = defineCapability<Value>("test.rollback-failing");
    const owner = plugin({
      id: "rollback-owner",
      provides: Owner,
      setup: ({ defer }) => {
        defer(() => {
          throw new Error("owner cleanup failed");
        });
        return { value: "owner" };
      },
    });
    const failing = plugin({
      id: "rollback-failing",
      provides: Failing,
      requires: { owner: Owner },
      setup: ({ defer }) => {
        defer(() => {
          throw new Error("failing cleanup failed");
        });
        throw new Error("setup failed");
      },
    });

    const error = await startApplication({ plugins: [owner, failing] }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PluginStartError);
    expect((error as PluginStartError).rollbackErrors).toEqual([
      expect.objectContaining({ pluginId: "rollback-failing" }),
      expect.objectContaining({ pluginId: "rollback-owner" }),
    ]);
  });

  it("uses stable topological startup and exact reverse shutdown order", async () => {
    const events: string[] = [];
    const Store = defineCapability<Value>("test.store");
    const Notes = defineCapability<Value>("test.notes");
    const Host = defineCapability<Value>("test.host");
    const Metrics = defineCapability<Value>("test.metrics");
    const plugins = [
      plugin({ id: "host", provides: Host, requires: { notes: Notes }, events }),
      plugin({ id: "metrics", provides: Metrics, events }),
      plugin({ id: "store", provides: Store, events }),
      plugin({ id: "notes", provides: Notes, requires: { store: Store }, events }),
    ];

    const application = await startApplication({ plugins });
    expect(events).toEqual(["metrics:start", "store:start", "notes:start", "host:start"]);
    expect(application.snapshot().plannedOrder).toEqual(["metrics", "store", "notes", "host"]);

    await application.stop();
    expect(events).toEqual([
      "metrics:start",
      "store:start",
      "notes:start",
      "host:start",
      "host:stop",
      "notes:stop",
      "store:stop",
      "metrics:stop",
    ]);
  });

  it("rolls back the failing plugin before previously started plugins", async () => {
    const events: string[] = [];
    const Owner = defineCapability<Value>("test.owner");
    const Failing = defineCapability<Value>("test.failing");
    const owner = plugin({ id: "owner", provides: Owner, events });
    const failing = plugin({
      id: "failing",
      provides: Failing,
      requires: { owner: Owner },
      events,
      setup: ({ defer }) => {
        defer(() => {
          events.push("failing:cleanup-1");
        });
        defer(() => {
          events.push("failing:cleanup-2");
        });
        throw new Error("cannot bind port");
      },
    });

    const error = await startApplication({ plugins: [owner, failing] }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PluginStartError);
    expect(events).toEqual([
      "owner:start",
      "failing:start",
      "failing:cleanup-2",
      "failing:cleanup-1",
      "owner:stop",
    ]);
    expect((error as PluginStartError).kernelSnapshot.state).toBe("failed");
  });

  it("does not expose setup error details in the kernel snapshot", async () => {
    const Failing = defineCapability<Value>("test.private-setup-error");
    const secret = "SENTINEL_PRIVATE_SETUP_VALUE";
    const failing = plugin({
      id: "private-setup-error",
      provides: Failing,
      setup: () => {
        throw new Error(`provider response: ${secret}`);
      },
    });

    const error = await startApplication({ plugins: [failing] }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PluginStartError);
    expect(JSON.stringify((error as PluginStartError).kernelSnapshot)).not.toContain(secret);
  });

  it("makes concurrent stop idempotent and shares the same result", async () => {
    const Capability = defineCapability<Value>("test.concurrent");
    const cleanup = vi.fn(async () => undefined);
    const application = await startApplication({
      plugins: [
        plugin({
          id: "concurrent",
          provides: Capability,
          setup: ({ defer }) => {
            defer(cleanup);
            return { value: "ready" };
          },
        }),
      ],
    });

    const first = application.stop();
    const second = application.stop();
    expect(first).toBe(second);
    await first;
    await application.stop();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("attempts every cleanup and reports only safe diagnostics", async () => {
    const events: string[] = [];
    const Capability = defineCapability<Value>("test.cleanup");
    const application = await startApplication({
      plugins: [
        plugin({
          id: "cleanup",
          provides: Capability,
          setup: ({ defer }) => {
            defer(() => {
              events.push("first");
            });
            defer(() => {
              events.push("second");
              throw new Error("cleanup leaked SENTINEL_PRIVATE_CLEANUP_VALUE");
            });
            return { value: "top-secret-capability-value" };
          },
        }),
      ],
    });

    const serializedBefore = JSON.stringify(application.snapshot());
    expect(serializedBefore).not.toContain("top-secret-capability-value");
    const error = await application.stop().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApplicationStopError);
    expect(JSON.stringify((error as ApplicationStopError).cleanupErrors)).not.toContain(
      "SENTINEL_PRIVATE_CLEANUP_VALUE",
    );
    expect(events).toEqual(["second", "first"]);
  });
});
