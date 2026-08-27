import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, parseSseChunks } from "../src/api.js";

describe("typed API client", () => {
  it("unwraps success envelopes and exposes redacted stable errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { id: "notebook-1" }, requestId: "request-1" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "VALIDATION_ERROR", message: "Invalid", issues: [{ path: ["name"] }] },
            requestId: "request-2",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );
    const client = new ApiClient(fetcher);

    await expect(client.get<{ id: string }>("/api/notebooks/1")).resolves.toEqual({
      id: "notebook-1",
    });
    const error = await client.post("/api/notebooks", { name: "" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "VALIDATION_ERROR", requestId: "request-2", status: 400 });
  });

  it("parses named SSE events across arbitrary network chunk boundaries", async () => {
    const chunks = [
      "event: answer.star",
      'ted\ndata: {"type":"answer.started","messageId":"m1"}\n\nevent: answer.delta\n',
      'data: {"type":"answer.delta","delta":"证据"}\n\n',
    ];

    await expect(parseSseChunks(chunks)).resolves.toEqual([
      { event: "answer.started", data: { type: "answer.started", messageId: "m1" } },
      { event: "answer.delta", data: { type: "answer.delta", delta: "证据" } },
    ]);
  });

  it("delivers SSE events before the response stream closes", async () => {
    const encoder = new TextEncoder();
    let closeStream: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: answer.started\ndata: {"type":"answer.started","messageId":"m1"}\n\n',
          ),
        );
        closeStream = () => controller.close();
      },
    });
    const client = new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(body)));
    const received: string[] = [];
    let streamClosed = false;

    const request = client.streamAnswer("/api/conversations/c1/answer", "问题", (event) => {
      if (!streamClosed) received.push(event.type);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    streamClosed = true;
    closeStream?.();
    await request;

    expect(received).toEqual(["answer.started"]);
  });
});
