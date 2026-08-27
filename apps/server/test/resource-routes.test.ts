import type {
  NotebookManagement,
  NoteManagement,
  ProviderSettingsManagement,
  ResearchAnswering,
  SourceIngestion,
} from "@cangshu/application";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp, type HttpServices } from "../src/http/http-host-plugin.js";

const notebookId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const notebook = {
  id: notebookId,
  name: "Research",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};
const source = {
  id: sourceId,
  notebookId,
  title: "Evidence",
  kind: "text" as const,
  status: "queued" as const,
  mimeType: "text/plain",
  passageCount: 0,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("Notebook and Source routes", () => {
  it("maps validated JSON CRUD commands to scoped Capabilities", async () => {
    const harness = services();
    const app = await createHttpApp(harness.value);

    const created = await app.inject({
      method: "POST",
      url: "/api/notebooks",
      payload: { name: "New notebook" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ ok: true, data: notebook });
    expect(harness.notebooks.create).toHaveBeenCalledWith("New notebook");

    const invalid = await app.inject({
      method: "POST",
      url: "/api/notebooks",
      payload: { name: "" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", issues: [{ path: ["name"] }] },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/notebooks/${notebookId}`,
      payload: { name: "Renamed" },
    });
    expect(harness.notebooks.rename).toHaveBeenCalledWith(notebookId, "Renamed");
    await app.inject({ method: "DELETE", url: `/api/notebooks/${notebookId}` });
    expect(harness.notebooks.delete).toHaveBeenCalledWith(notebookId);

    await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/sources/text`,
      payload: { title: "Paste", text: "Evidence", kind: "markdown" },
    });
    expect(harness.sources.importText).toHaveBeenCalledWith({
      notebookId,
      title: "Paste",
      text: "Evidence",
      kind: "markdown",
    });
    await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/sources/url`,
      payload: { url: "https://example.com/article" },
    });
    expect(harness.sources.importUrl).toHaveBeenCalledWith({
      notebookId,
      url: "https://example.com/article",
    });
    await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/sources/${sourceId}/retry`,
    });
    expect(harness.sources.retry).toHaveBeenCalledWith(notebookId, sourceId);
    await app.inject({
      method: "DELETE",
      url: `/api/notebooks/${notebookId}/sources/${sourceId}`,
    });
    expect(harness.sources.delete).toHaveBeenCalledWith(notebookId, sourceId);
    await app.close();
  });

  it("streams a bounded multipart upload without logging or JSON-encoding file bytes", async () => {
    const harness = services();
    const app = await createHttpApp(harness.value, { multipartFileLimit: 1_024 });
    const body = multipart(
      "upload-boundary",
      "PDF evidence",
      "paper.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.7 fixture"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/sources/upload`,
      headers: { "content-type": "multipart/form-data; boundary=upload-boundary" },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ ok: true, data: source });
    expect(harness.sources.importBytes).toHaveBeenCalledWith({
      notebookId,
      title: "PDF evidence",
      kind: "pdf",
      mimeType: "application/pdf",
      bytes: expect.any(Uint8Array),
    });
    expect(JSON.stringify(response.json())).not.toContain("%PDF-1.7 fixture");
    await app.close();
  });

  it("rejects multipart files over the streaming limit", async () => {
    const harness = services();
    const app = await createHttpApp(harness.value, { multipartFileLimit: 8 });
    const body = multipart(
      "small-boundary",
      "Large",
      "large.pdf",
      "application/pdf",
      Buffer.from("%PDF-too-large"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/sources/upload`,
      headers: { "content-type": "multipart/form-data; boundary=small-boundary" },
      payload: body,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: { code: "SOURCE_TOO_LARGE" } });
    expect(harness.sources.importBytes).not.toHaveBeenCalled();
    await app.close();
  });
});

function services() {
  const notebooks = {
    list: vi.fn(async () => [notebook]),
    get: vi.fn(async () => notebook),
    create: vi.fn(async () => notebook),
    rename: vi.fn(async () => notebook),
    delete: vi.fn(async () => undefined),
  } satisfies NotebookManagement;
  const sources = {
    list: vi.fn(async () => [source]),
    get: vi.fn(async () => source),
    importBytes: vi.fn(async () => source),
    importText: vi.fn(async () => source),
    importUrl: vi.fn(async () => source),
    retry: vi.fn(async () => source),
    reconcileStale: vi.fn(async () => 0),
    reindexReady: vi.fn(async () => 0),
    delete: vi.fn(async () => undefined),
    process: vi.fn(async () => undefined),
  } satisfies SourceIngestion;
  return {
    notebooks,
    sources,
    value: {
      notebooks,
      sources,
      research: {} as ResearchAnswering,
      notes: {} as NoteManagement,
      providers: {} as ProviderSettingsManagement,
    } satisfies HttpServices,
  };
}

function multipart(
  boundary: string,
  title: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}
