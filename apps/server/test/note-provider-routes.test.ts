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
const noteId = "55555555-5555-4555-8555-555555555555";
const messageId = "44444444-4444-4444-8444-444444444444";
const note = {
  id: noteId,
  notebookId,
  title: "Note",
  content: "Markdown",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("Note and Provider routes", () => {
  it("keeps every Note operation scoped by Notebook", async () => {
    const notes = {
      list: vi.fn(async () => [note]),
      get: vi.fn(async () => note),
      create: vi.fn(async () => note),
      saveAnswer: vi.fn(async () => note),
      update: vi.fn(async () => note),
      delete: vi.fn(async () => undefined),
    } satisfies NoteManagement;
    const app = await createHttpApp(services(notes, providers()));

    await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/notes`,
      payload: { title: "Note", content: "Markdown" },
    });
    expect(notes.create).toHaveBeenCalledWith({ notebookId, title: "Note", content: "Markdown" });
    await app.inject({
      method: "PATCH",
      url: `/api/notebooks/${notebookId}/notes/${noteId}`,
      payload: { content: "Edited" },
    });
    expect(notes.update).toHaveBeenCalledWith(notebookId, noteId, { content: "Edited" });
    await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/messages/${messageId}/note`,
      payload: { title: "Saved answer" },
    });
    expect(notes.saveAnswer).toHaveBeenCalledWith({
      notebookId,
      messageId,
      title: "Saved answer",
    });
    await app.inject({ method: "DELETE", url: `/api/notebooks/${notebookId}/notes/${noteId}` });
    expect(notes.delete).toHaveBeenCalledWith(notebookId, noteId);
    await app.close();
  });

  it("never projects submitted Provider secrets from save or test", async () => {
    const providerService = providers();
    const app = await createHttpApp(services({} as NoteManagement, providerService));
    const payload = {
      baseUrl: "https://models.example/v1",
      model: "chat-model",
      apiKey: "private-provider-key",
    };

    const saved = await app.inject({
      method: "PUT",
      url: "/api/providers/chat",
      payload,
    });
    const tested = await app.inject({
      method: "POST",
      url: "/api/providers/chat/test",
      payload,
    });

    expect(providerService.save).toHaveBeenCalledWith({ kind: "chat", ...payload });
    expect(providerService.test).toHaveBeenCalledWith({ kind: "chat", ...payload });
    expect(JSON.stringify(saved.json())).not.toContain("private-provider-key");
    expect(JSON.stringify(tested.json())).not.toContain("private-provider-key");
    expect(tested.json()).toMatchObject({ ok: true, data: { tested: true } });
    await app.close();
  });
});

function providers() {
  return {
    list: vi.fn(async () => [
      {
        kind: "chat" as const,
        baseUrl: "https://models.example/v1",
        model: "chat-model",
        hasApiKey: true,
        source: "database" as const,
      },
    ]),
    save: vi.fn(async (input) => ({
      kind: input.kind,
      baseUrl: input.baseUrl,
      model: input.model,
      hasApiKey: Boolean(input.apiKey),
      source: "database" as const,
    })),
    test: vi.fn(async () => undefined),
  } satisfies ProviderSettingsManagement;
}

function services(
  notes: NoteManagement,
  providerService: ProviderSettingsManagement,
): HttpServices {
  return {
    notes,
    providers: providerService,
    notebooks: {} as NotebookManagement,
    sources: {} as SourceIngestion,
    research: {} as ResearchAnswering,
  };
}
