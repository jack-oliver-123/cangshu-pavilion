import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { connectDatabase } from "../src/database/client.js";

describe("database client", () => {
  it("handles idle pool errors without logging connection details", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = connectDatabase("postgres://user:secret@127.0.0.1:5432/not-opened");

    connection.pool.emit("error", new Error("postgres://user:secret@private-host/database"));
    const client = new EventEmitter();
    connection.pool.emit("connect", client as never);
    client.emit("error", new Error("Authorization: private-database-token"));

    expect(errorLog).toHaveBeenCalledWith('{"event":"database.idle-client-error"}');
    expect(errorLog).toHaveBeenCalledWith('{"event":"database.active-client-error"}');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret");
    await connection.close();
    errorLog.mockRestore();
  });
});
