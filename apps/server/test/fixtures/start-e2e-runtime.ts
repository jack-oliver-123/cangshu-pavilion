import { tmpdir } from "node:os";
import { join } from "node:path";

const role = process.argv[2];
if (role !== "server" && role !== "worker") {
  throw new Error("Expected a runtime role of server or worker.");
}

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required for the E2E runtime fixture.");
}

const fixtureBaseUrl = process.env.CANGSHU_FIXTURE_BASE_URL?.trim() || "http://127.0.0.1:4199/v1";
process.env.CANGSHU_DATA_DIR ??= join(tmpdir(), "cangshu-mvp-e2e");
process.env.CANGSHU_CHAT_BASE_URL ??= fixtureBaseUrl;
process.env.CANGSHU_CHAT_MODEL ??= "fixture-chat";
process.env.CANGSHU_EMBEDDING_BASE_URL ??= fixtureBaseUrl;
process.env.CANGSHU_EMBEDDING_MODEL ??= "fixture-embedding";

if (role === "server") {
  process.env.CANGSHU_HOST ??= "127.0.0.1";
  process.env.CANGSHU_PORT ??= "4100";
  await import("../../src/main.js");
} else {
  await import("../../../worker/src/main.js");
}
