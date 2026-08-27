import { resolve } from "node:path";
import { ApplicationError } from "@cangshu/application";
import ipaddr from "ipaddr.js";

export interface ServerRuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly remoteMode: boolean;
  readonly databaseUrl: string;
  readonly dataDirectory: string;
  readonly sharedPassword?: string;
}

export function parseServerRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
  workingDirectory = process.cwd(),
): ServerRuntimeConfig {
  const host = environment.CANGSHU_HOST?.trim() || "127.0.0.1";
  const port = parsePort(environment.CANGSHU_PORT);
  const databaseUrl =
    environment.DATABASE_URL?.trim() || "postgres://cangshu:cangshu@localhost:5432/cangshu";
  validateDatabaseUrl(databaseUrl);
  const configuredDataDirectory = environment.CANGSHU_DATA_DIR?.trim() || "./data";
  const dataDirectory = resolve(workingDirectory, configuredDataDirectory);
  const remoteMode = !isLoopbackHost(host);
  const sharedPassword = environment.CANGSHU_SHARED_PASSWORD;
  if (remoteMode && (!sharedPassword || sharedPassword.length < 12)) {
    throw new ApplicationError({
      code: "REMOTE_ACCESS_REQUIRES_PASSWORD",
      message: "A shared password of at least 12 characters is required for remote binding.",
      status: 500,
    });
  }
  return {
    host,
    port,
    remoteMode,
    databaseUrl,
    dataDirectory,
    ...(remoteMode && sharedPassword ? { sharedPassword } : {}),
  };
}

export function isLoopbackHost(host: string): boolean {
  if (host.toLowerCase() === "localhost") {
    return true;
  }
  try {
    if (ipaddr.IPv4.isValid(host)) {
      return ipaddr.IPv4.parse(host).range() === "loopback";
    }
    if (ipaddr.IPv6.isValid(host)) {
      const address = ipaddr.IPv6.parse(host);
      return address.isIPv4MappedAddress()
        ? address.toIPv4Address().range() === "loopback"
        : address.range() === "loopback";
    }
  } catch {
    return false;
  }
  return false;
}

function parsePort(value: string | undefined): number {
  const normalized = value?.trim() || "4100";
  if (!/^\d+$/u.test(normalized)) {
    throw validation("CANGSHU_PORT must be an integer from 1 through 65535.");
  }
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw validation("CANGSHU_PORT must be an integer from 1 through 65535.");
  }
  return port;
}

function validateDatabaseUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw validation("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}

function validation(message: string): ApplicationError {
  return new ApplicationError({ code: "VALIDATION_ERROR", message, status: 400 });
}
