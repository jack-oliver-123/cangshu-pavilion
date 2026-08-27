import type { AnswerEvent } from "./types.js";

interface SuccessEnvelope<T> {
  readonly ok: true;
  readonly data: T;
  readonly requestId: string;
}

interface ErrorEnvelope {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?: readonly Readonly<{ path: readonly (string | number)[]; message: string }>[];
  };
  readonly requestId: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly issues?: ErrorEnvelope["error"]["issues"],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: "GET", ...(signal ? { signal } : {}) });
  }

  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  }

  put<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  delete<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: "DELETE", ...(signal ? { signal } : {}) });
  }

  upload<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
    return this.request<T>(
      path,
      { method: "POST", body: form, ...(signal ? { signal } : {}) },
      false,
    );
  }

  async streamAnswer(
    path: string,
    question: string,
    onEvent: (event: AnswerEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.fetcher(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || !response.body) {
      throw await responseError(response);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    async function* chunks(): AsyncGenerator<string> {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        yield result.value;
      }
    }
    for await (const event of iterateSseChunks(chunks())) {
      onEvent(event.data as AnswerEvent);
    }
  }

  private async request<T>(path: string, init: RequestInit, json = true): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(path, {
        ...init,
        credentials: "same-origin",
        ...(json && init.body ? { headers: { "content-type": "application/json" } } : {}),
      });
    } catch {
      throw new ApiError("NETWORK_ERROR", "无法连接到藏书阁服务。", 0);
    }
    if (!response.ok) throw await responseError(response);
    const envelope = (await response.json()) as SuccessEnvelope<T> | ErrorEnvelope;
    if (!envelope.ok) {
      throw new ApiError(
        envelope.error.code,
        envelope.error.message,
        response.status,
        envelope.requestId,
        envelope.error.issues,
      );
    }
    return envelope.data;
  }
}

export async function parseSseChunks(
  chunks: Iterable<string> | AsyncIterable<string>,
): Promise<readonly Readonly<{ event: string; data: unknown }>[]> {
  const events: { event: string; data: unknown }[] = [];
  for await (const event of iterateSseChunks(chunks)) events.push(event);
  return events;
}

export async function* iterateSseChunks(
  chunks: Iterable<string> | AsyncIterable<string>,
): AsyncGenerator<Readonly<{ event: string; data: unknown }>> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = block.split("\n");
      const event = lines
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (event && data) yield { event, data: JSON.parse(data) as unknown };
      boundary = buffer.indexOf("\n\n");
    }
  }
}

async function responseError(response: Response): Promise<ApiError> {
  try {
    const envelope = (await response.json()) as ErrorEnvelope;
    if (!envelope.ok && envelope.error) {
      return new ApiError(
        envelope.error.code,
        envelope.error.message,
        response.status,
        envelope.requestId,
        envelope.error.issues,
      );
    }
  } catch {
    // Fall through to a stable transport error without retaining the response body.
  }
  return new ApiError("HTTP_ERROR", "请求未能完成。", response.status);
}
