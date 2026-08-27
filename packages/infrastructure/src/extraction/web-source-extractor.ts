import {
  ApplicationError,
  type ExtractedBlock,
  type Source,
  type SourceExtractor,
} from "@cangshu/application";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface FetchedWebPage {
  readonly finalUrl: string;
  readonly html: string;
}

export interface WebPageFetcher {
  fetch(url: string): Promise<FetchedWebPage>;
}

export class WebSourceExtractor implements SourceExtractor {
  constructor(private readonly fetcher: WebPageFetcher) {}

  async extract(source: Source): Promise<readonly ExtractedBlock[]> {
    if (source.kind !== "web" || !source.originalUrl) {
      throw unsupported("Web Source does not have a valid original URL.");
    }

    const page = await this.fetcher.fetch(source.originalUrl);
    const { document } = parseHTML(page.html);
    const article = new Readability(document as unknown as Document, { charThreshold: 20 }).parse();
    if (!article?.content) {
      throw unsupported("Web page does not contain readable article content.");
    }

    const articleDocument = parseHTML(article.content).document;
    const title = normalize(article.title ?? source.title);
    const candidates = articleDocument.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre");
    const paragraphs: string[] = [];
    for (const candidate of candidates) {
      const content = normalize(candidate.textContent ?? "");
      if (content.length === 0 || content === title) {
        continue;
      }
      if (paragraphs.at(-1) !== content) {
        paragraphs.push(content);
      }
    }
    if (paragraphs.length === 0) {
      const fallback = normalize(article.textContent ?? "");
      if (fallback.length > 0 && fallback !== title) {
        paragraphs.push(fallback);
      }
    }

    return paragraphs.map((content, index) => ({
      content,
      locator: { kind: "web", url: page.finalUrl, paragraph: index + 1 },
    }));
  }
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unsupported(message: string): ApplicationError {
  return new ApplicationError({ code: "SOURCE_TYPE_UNSUPPORTED", message, status: 422 });
}
