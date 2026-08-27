import { describe, expect, it, vi } from "vitest";
import {
  type ChatApiClient,
  type ChatApiRequest,
  OpenAiCompatibleChatAdapter,
} from "../src/providers/openai-compatible-chat.js";

class CapturingChatClient implements ChatApiClient {
  request?: ChatApiRequest;

  constructor(
    private readonly handler: (
      input: ChatApiRequest,
    ) => Promise<AsyncIterable<string>> | AsyncIterable<string>,
  ) {}

  async stream(input: ChatApiRequest): Promise<AsyncIterable<string>> {
    this.request = input;
    return this.handler(input);
  }
}

async function collect(adapter: OpenAiCompatibleChatAdapter) {
  const events = [];
  for await (const event of adapter.stream({
    question: "What is supported?",
    history: [
      { role: "researcher", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer [P1]" },
    ],
    passages: [
      {
        label: "P1",
        passageId: "passage-1",
        sourceTitle: "Source A",
        locator: "page 2",
        content: "Evidence A",
      },
      {
        label: "P2",
        passageId: "passage-2",
        sourceTitle: "Source B",
        locator: "paragraph 4",
        content: "Evidence B",
      },
    ],
  })) {
    events.push(event);
  }
  return events;
}

describe("OpenAI-compatible Chat Adapter", () => {
  it("streams deltas, builds an evidence-only prompt, and reports every cited label", async () => {
    const client = new CapturingChatClient(async function* () {
      yield "Supported by A [P1]";
      yield " and an unknown claim [P9].";
    });
    const adapter = new OpenAiCompatibleChatAdapter({
      baseUrl: "https://models.example/v1",
      model: "chat-v1",
      apiKey: "private-key",
      client,
    });

    await expect(collect(adapter)).resolves.toEqual([
      { type: "delta", delta: "Supported by A [P1]" },
      { type: "delta", delta: " and an unknown claim [P9]." },
      {
        type: "completed",
        content: "Supported by A [P1] and an unknown claim [P9].",
        citedLabels: ["P1", "P9"],
      },
    ]);
    expect(client.request?.messages[0]).toMatchObject({ role: "system" });
    expect(client.request?.messages[0]?.content).toContain("only the supplied evidence");
    expect(client.request?.messages.at(-1)?.content).toContain('"label":"P1"');
    expect(client.request?.messages.at(-1)?.content).toContain("Evidence B");
    expect(JSON.stringify(client.request)).not.toContain("private-key");
  });

  it("bounds the entire stream and redacts SDK failures", async () => {
    vi.useFakeTimers();
    try {
      const client = new CapturingChatClient(async (input) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((_resolve, reject) => {
            input.signal.addEventListener("abort", () =>
              reject(new Error("Authorization: Bearer private-key; response=secret-body")),
            );
          });
        },
      }));
      const adapter = new OpenAiCompatibleChatAdapter({
        baseUrl: "https://models.example/v1",
        model: "chat-v1",
        apiKey: "private-key",
        client,
        timeoutMs: 500,
      });

      const result = collect(adapter).catch((error) => error);
      await vi.advanceTimersByTimeAsync(500);
      const error = await result;
      expect(error).toMatchObject({ code: "PROVIDER_ERROR" });
      expect(JSON.stringify(error)).not.toContain("private-key");
      expect(JSON.stringify(error)).not.toContain("secret-body");
    } finally {
      vi.useRealTimers();
    }
  });
});
