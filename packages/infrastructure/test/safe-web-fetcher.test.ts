import { describe, expect, it } from "vitest";
import {
  type PinnedHttpRequest,
  type PinnedHttpResponse,
  SafeWebPageFetcher,
} from "../src/extraction/safe-web-fetcher.js";

class ScriptedTransport {
  readonly requests: PinnedHttpRequest[] = [];

  constructor(private readonly responses: readonly (PinnedHttpResponse | Error)[]) {}

  async request(input: PinnedHttpRequest): Promise<PinnedHttpResponse> {
    this.requests.push(input);
    const response = this.responses[this.requests.length - 1];
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error("Unexpected request");
    }
    return response;
  }
}

const htmlResponse = (html: string): PinnedHttpResponse => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: new TextEncoder().encode(html),
});

describe("safe web fetching", () => {
  it("pins a validated public DNS address to the actual request", async () => {
    const transport = new ScriptedTransport([htmlResponse("<article>Evidence</article>")]);
    const fetcher = new SafeWebPageFetcher({
      resolver: { resolve: async () => [{ address: "93.184.216.34", family: 4 }] },
      transport,
    });

    await expect(fetcher.fetch("https://example.com/article")).resolves.toEqual({
      finalUrl: "https://example.com/article",
      html: "<article>Evidence</article>",
    });
    expect(transport.requests).toEqual([
      expect.objectContaining({
        url: "https://example.com/article",
        address: "93.184.216.34",
        family: 4,
      }),
    ]);
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest",
    "http://[::1]/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("rejects blocked address %s before transport", async (url) => {
    const transport = new ScriptedTransport([]);
    const fetcher = new SafeWebPageFetcher({
      resolver: { resolve: async () => [] },
      transport,
    });

    await expect(fetcher.fetch(url)).rejects.toMatchObject({ code: "WEB_FETCH_BLOCKED" });
    expect(transport.requests).toEqual([]);
  });

  it.each([
    { addresses: [{ address: "10.0.0.8", family: 4 as const }] },
    {
      addresses: [
        { address: "93.184.216.34", family: 4 as const },
        { address: "192.168.1.8", family: 4 as const },
      ],
    },
    { addresses: [{ address: "::1", family: 6 as const }] },
  ])("rejects unsafe DNS answer sets before transport", async ({ addresses }) => {
    const transport = new ScriptedTransport([]);
    const fetcher = new SafeWebPageFetcher({
      resolver: { resolve: async () => addresses },
      transport,
    });

    await expect(fetcher.fetch("https://example.com/")).rejects.toMatchObject({
      code: "WEB_FETCH_BLOCKED",
    });
    expect(transport.requests).toEqual([]);
  });

  it("revalidates a redirect and never connects to its private target", async () => {
    const transport = new ScriptedTransport([
      {
        status: 302,
        headers: { location: "http://10.0.0.5/internal" },
        body: new Uint8Array(),
      },
    ]);
    const fetcher = new SafeWebPageFetcher({
      resolver: { resolve: async () => [{ address: "93.184.216.34", family: 4 }] },
      transport,
    });

    await expect(fetcher.fetch("https://example.com/start")).rejects.toMatchObject({
      code: "WEB_FETCH_BLOCKED",
    });
    expect(transport.requests).toHaveLength(1);
  });

  it("rejects URL credentials, oversized bodies, and redacts transport failures", async () => {
    const transport = new ScriptedTransport([
      htmlResponse("x".repeat(33)),
      new Error("request failed with Authorization: Bearer secret-value"),
    ]);
    const fetcher = new SafeWebPageFetcher({
      resolver: { resolve: async () => [{ address: "93.184.216.34", family: 4 }] },
      transport,
      maxBytes: 32,
    });

    await expect(fetcher.fetch("https://user:pass@example.com/")).rejects.toMatchObject({
      code: "WEB_FETCH_BLOCKED",
    });
    await expect(fetcher.fetch("https://example.com/large")).rejects.toMatchObject({
      code: "SOURCE_TOO_LARGE",
    });
    const error = await fetcher.fetch("https://example.com/failure").catch((caught) => caught);
    expect(error).toMatchObject({ code: "WEB_FETCH_FAILED" });
    expect(JSON.stringify(error)).not.toContain("secret-value");
  });

  it("caps redirects and maps timeout details to a stable error", async () => {
    const redirect = (location: string): PinnedHttpResponse => ({
      status: 302,
      headers: { location },
      body: new Uint8Array(),
    });
    const transport = new ScriptedTransport([
      redirect("/two"),
      redirect("/three"),
      new Error("ETIMEDOUT connecting with Authorization: private-token"),
    ]);
    const fetcher = new SafeWebPageFetcher({
      resolver: { resolve: async () => [{ address: "93.184.216.34", family: 4 }] },
      transport,
      maxRedirects: 1,
    });

    await expect(fetcher.fetch("https://example.com/one")).rejects.toMatchObject({
      code: "WEB_FETCH_FAILED",
    });
    expect(transport.requests).toHaveLength(2);

    const timeoutFetcher = new SafeWebPageFetcher({
      resolver: { resolve: async () => [{ address: "93.184.216.34", family: 4 }] },
      transport: new ScriptedTransport([
        new Error("ETIMEDOUT connecting with Authorization: private-token"),
      ]),
    });
    const error = await timeoutFetcher.fetch("https://example.com/").catch((caught) => caught);
    expect(error).toMatchObject({ code: "WEB_FETCH_FAILED" });
    expect(JSON.stringify(error)).not.toContain("private-token");
  });
});
