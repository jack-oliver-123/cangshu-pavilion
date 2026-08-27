import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { ApplicationError } from "@cangshu/application";
import ipaddr from "ipaddr.js";
import type { FetchedWebPage, WebPageFetcher } from "./web-source-extractor.js";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface AddressResolver {
  resolve(hostname: string): Promise<readonly ResolvedAddress[]>;
}

export interface PinnedHttpRequest {
  readonly url: string;
  readonly address: string;
  readonly family: 4 | 6;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface PinnedHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
}

export interface PinnedHttpTransport {
  request(input: PinnedHttpRequest): Promise<PinnedHttpResponse>;
}

export interface SafeWebPageFetcherOptions {
  readonly resolver?: AddressResolver;
  readonly transport?: PinnedHttpTransport;
  readonly maxRedirects?: number;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class SafeWebPageFetcher implements WebPageFetcher {
  private readonly resolver: AddressResolver;
  private readonly transport: PinnedHttpTransport;
  private readonly maxRedirects: number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: SafeWebPageFetcherOptions = {}) {
    this.resolver = options.resolver ?? new NodeAddressResolver();
    this.transport = options.transport ?? new NodePinnedHttpTransport();
    this.maxRedirects = options.maxRedirects ?? 3;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async fetch(inputUrl: string): Promise<FetchedWebPage> {
    let url = parseAllowedUrl(inputUrl);

    for (let redirectCount = 0; ; redirectCount += 1) {
      const address = await this.resolvePublicAddress(url.hostname);
      let response: PinnedHttpResponse;
      try {
        response = await this.transport.request({
          url: url.toString(),
          address: address.address,
          family: address.family,
          timeoutMs: this.timeoutMs,
          maxBytes: this.maxBytes,
        });
      } catch (error) {
        if (error instanceof ResponseTooLargeError) {
          throw tooLarge();
        }
        throw failed("The web page could not be fetched.");
      }

      if (response.body.byteLength > this.maxBytes) {
        throw tooLarge();
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.location;
        if (!location || redirectCount >= this.maxRedirects) {
          throw failed("The web page redirect chain is invalid or too long.");
        }
        url = parseAllowedUrl(new URL(location, url).toString());
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw failed("The web page returned an unsuccessful response.");
      }
      const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
      if (
        !contentType.startsWith("text/html") &&
        !contentType.startsWith("application/xhtml+xml")
      ) {
        throw failed("The web page did not return HTML content.");
      }

      try {
        return {
          finalUrl: url.toString(),
          html: new TextDecoder("utf-8", { fatal: true }).decode(response.body),
        };
      } catch {
        throw failed("The web page did not contain valid UTF-8 HTML.");
      }
    }
  }

  private async resolvePublicAddress(hostname: string): Promise<ResolvedAddress> {
    const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
    const family = isIP(normalizedHostname);
    const addresses: readonly ResolvedAddress[] = family
      ? [{ address: normalizedHostname, family: family as 4 | 6 }]
      : await this.resolveHostname(normalizedHostname);

    if (
      addresses.length === 0 ||
      addresses.some(
        (entry) => isIP(entry.address) !== entry.family || !isPublicAddress(entry.address),
      )
    ) {
      throw blocked("The web page host resolves to a blocked network address.");
    }
    const selected = addresses[0];
    if (!selected) {
      throw blocked("The web page host did not resolve to a usable address.");
    }
    return selected;
  }

  private async resolveHostname(hostname: string): Promise<readonly ResolvedAddress[]> {
    try {
      return await this.resolver.resolve(hostname);
    } catch {
      throw failed("The web page host could not be resolved.");
    }
  }
}

export class NodeAddressResolver implements AddressResolver {
  async resolve(hostname: string): Promise<readonly ResolvedAddress[]> {
    const results = await lookup(hostname, { all: true, verbatim: true });
    return results.flatMap((result) =>
      result.family === 4 || result.family === 6
        ? [{ address: result.address, family: result.family }]
        : [],
    );
  }
}

export class NodePinnedHttpTransport implements PinnedHttpTransport {
  request(input: PinnedHttpRequest): Promise<PinnedHttpResponse> {
    const url = new URL(input.url);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (typeof options === "object" && options.all) {
        callback(null, [{ address: input.address, family: input.family }]);
      } else {
        callback(null, input.address, input.family);
      }
    };

    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      const outgoing = request(
        url,
        {
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "CangshuPavilion/0.1 research-fetcher",
          },
          lookup: pinnedLookup,
          signal: controller.signal,
        },
        (response) => {
          this.consume(response, input.maxBytes)
            .then((body) => {
              clearTimeout(timer);
              resolve({
                status: response.statusCode ?? 0,
                headers: normalizeHeaders(response.headers),
                body,
              });
            })
            .catch((error) => {
              clearTimeout(timer);
              reject(error);
            });
        },
      );
      outgoing.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      outgoing.end();
    });
  }

  private async consume(response: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
    const declaredLength = Number(response.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      response.destroy();
      throw new ResponseTooLargeError();
    }

    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.byteLength;
      if (received > maxBytes) {
        response.destroy();
        throw new ResponseTooLargeError();
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }
}

class ResponseTooLargeError extends Error {}

function parseAllowedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw blocked("The web page URL is invalid.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw blocked("The web page URL uses a blocked scheme or contains credentials.");
  }
  return url;
}

function isPublicAddress(address: string): boolean {
  try {
    if (ipaddr.IPv6.isValid(address)) {
      const parsed = ipaddr.IPv6.parse(address);
      if (parsed.isIPv4MappedAddress()) {
        return parsed.toIPv4Address().range() === "unicast";
      }
      return parsed.range() === "unicast";
    }
    return ipaddr.IPv4.isValid(address) && ipaddr.IPv4.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}

function normalizeHeaders(
  headers: IncomingHttpHeaders,
): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(", ") : value,
    ]),
  );
}

function blocked(message: string): ApplicationError {
  return new ApplicationError({ code: "WEB_FETCH_BLOCKED", message, status: 422 });
}

function failed(message: string): ApplicationError {
  return new ApplicationError({ code: "WEB_FETCH_FAILED", message, status: 502 });
}

function tooLarge(): ApplicationError {
  return new ApplicationError({
    code: "SOURCE_TOO_LARGE",
    message: "The web page exceeds the configured size limit.",
    status: 413,
  });
}
