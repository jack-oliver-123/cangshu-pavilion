import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.CANGSHU_FIXTURE_PORT ?? "4199");

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "POST") return sendJson(response, 404, { error: "not found" });
    if (request.url === "/v1/embeddings") {
      const body = (await readJson(request)) as { input?: unknown };
      const values = Array.isArray(body.input) ? body.input : [];
      return sendJson(response, 200, {
        object: "list",
        model: "fixture-embedding",
        data: values.map((_, index) => ({
          object: "embedding",
          index,
          embedding: [1, 0, 0],
        })),
      });
    }
    if (request.url === "/v1/chat/completions") {
      await readJson(request);
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      for (const content of [
        "项目的插件内核负责能力装配与生命周期管理 [P1]。",
        "研究工作台则把资料、问答、引用和笔记组织在同一个研究库中 [P2]。",
      ]) {
        response.write(
          `data: ${JSON.stringify({
            id: "fixture-chat",
            object: "chat.completion.chunk",
            created: 0,
            model: "fixture-chat",
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          })}\n\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      response.write("data: [DONE]\n\n");
      return response.end();
    }
    return sendJson(response, 404, { error: "not found" });
  } catch {
    return sendJson(response, 400, { error: "invalid request" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "fixture.ready", port }));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
