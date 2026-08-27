import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtractedBlock, Source, SourceExtractor } from "@cangshu/application";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { PdfSourceExtractor } from "../src/extraction/pdf-source-extractor.js";
import { SourceExtractorRouter } from "../src/extraction/source-extractor-router.js";
import { TextSourceExtractor } from "../src/extraction/text-source-extractor.js";
import { WebSourceExtractor } from "../src/extraction/web-source-extractor.js";
import { ContentAddressedBlobStore } from "../src/storage/content-addressed-blob-store.js";

describe("Text and Markdown Source extraction", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("preserves Unicode paragraphs and stable 1-based line ranges", async () => {
    const root = await mkdtemp(join(tmpdir(), "cangshu-text-extractor-"));
    roots.push(root);
    const blobs = new ContentAddressedBlobStore(root);
    const stored = await blobs.put(
      new TextEncoder().encode("标题\r\n\r\n第一段中文\r\n第二行\r\n\r\n\r\nemoji 😀\r\n"),
    );
    const source: Source = {
      id: "source-1",
      notebookId: "notebook-1",
      title: "测试 Markdown",
      kind: "markdown",
      status: "extracting",
      mimeType: "text/markdown",
      storageKey: stored.storageKey,
      contentHash: stored.contentHash,
      sizeBytes: stored.sizeBytes,
      passageCount: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };

    const extractor = new TextSourceExtractor(blobs);
    await expect(extractor.extract(source)).resolves.toEqual([
      { content: "标题", locator: { kind: "text", startLine: 1, endLine: 1 } },
      {
        content: "第一段中文\n第二行",
        locator: { kind: "text", startLine: 3, endLine: 4 },
      },
      { content: "emoji 😀", locator: { kind: "text", startLine: 7, endLine: 7 } },
    ]);
  });

  it("preserves long lines and ignores an all-blank Source", async () => {
    const root = await mkdtemp(join(tmpdir(), "cangshu-text-extractor-"));
    roots.push(root);
    const blobs = new ContentAddressedBlobStore(root);
    const longLine = "藏".repeat(10_000);
    const longStored = await blobs.put(new TextEncoder().encode(`${longLine}\n\n末尾`));
    const blankStored = await blobs.put(new TextEncoder().encode("\n \r\n\t\n"));
    const base: Omit<Source, "storageKey" | "contentHash" | "sizeBytes"> = {
      id: "source-long",
      notebookId: "notebook-1",
      title: "长文本",
      kind: "text",
      status: "extracting",
      mimeType: "text/plain",
      passageCount: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const extractor = new TextSourceExtractor(blobs);

    const blocks = await extractor.extract({
      ...base,
      storageKey: longStored.storageKey,
      contentHash: longStored.contentHash,
      sizeBytes: longStored.sizeBytes,
    });
    expect(blocks).toEqual([
      { content: longLine, locator: { kind: "text", startLine: 1, endLine: 1 } },
      { content: "末尾", locator: { kind: "text", startLine: 3, endLine: 3 } },
    ]);
    await expect(
      extractor.extract({
        ...base,
        id: "source-blank",
        storageKey: blankStored.storageKey,
        contentHash: blankStored.contentHash,
        sizeBytes: blankStored.sizeBytes,
      }),
    ).resolves.toEqual([]);
  });
});

describe("web Source extraction", () => {
  it("keeps readable paragraphs with the final URL and removes navigation and duplicate title", async () => {
    const fetcher = {
      async fetch() {
        return {
          finalUrl: "https://example.com/final-article",
          html: `<!doctype html>
            <html>
              <head><title>Research Notes</title></head>
              <body>
                <nav>Home Pricing Sign in</nav>
                <main>
                  <article>
                    <h1>Research Notes</h1>
                    <p>First evidence paragraph with enough meaningful article text to keep.</p>
                    <p>Second finding explains the result in another complete paragraph.</p>
                  </article>
                </main>
                <footer>Copyright and unrelated links</footer>
              </body>
            </html>`,
        };
      },
    };
    const source: Source = {
      id: "web-source",
      notebookId: "notebook-1",
      title: "Research Notes",
      kind: "web",
      status: "extracting",
      mimeType: "text/html",
      originalUrl: "https://example.com/start",
      passageCount: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };

    const extractor = new WebSourceExtractor(fetcher);
    await expect(extractor.extract(source)).resolves.toEqual([
      {
        content: "First evidence paragraph with enough meaningful article text to keep.",
        locator: { kind: "web", url: "https://example.com/final-article", paragraph: 1 },
      },
      {
        content: "Second finding explains the result in another complete paragraph.",
        locator: { kind: "web", url: "https://example.com/final-article", paragraph: 2 },
      },
    ]);
  });
});

describe("PDF Source extraction", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("extracts text by page and ignores an empty page", async () => {
    const root = await mkdtemp(join(tmpdir(), "cangshu-pdf-extractor-"));
    roots.push(root);
    const blobs = new ContentAddressedBlobStore(root);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("First page evidence", { x: 48, y: 720, size: 14, font });
    pdf.addPage();
    pdf.addPage().drawText("Third page finding", { x: 48, y: 720, size: 14, font });
    const stored = await blobs.put(await pdf.save());
    const source: Source = {
      id: "pdf-source",
      notebookId: "notebook-1",
      title: "Multi-page PDF",
      kind: "pdf",
      status: "extracting",
      mimeType: "application/pdf",
      storageKey: stored.storageKey,
      contentHash: stored.contentHash,
      sizeBytes: stored.sizeBytes,
      passageCount: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };

    const extractor = new PdfSourceExtractor(blobs);
    await expect(extractor.extract(source)).resolves.toEqual([
      { content: "First page evidence", locator: { kind: "pdf", page: 1 } },
      { content: "Third page finding", locator: { kind: "pdf", page: 3 } },
    ]);
  });

  it("returns no blocks for an image-only shape and rejects malformed PDF bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cangshu-pdf-extractor-"));
    roots.push(root);
    const blobs = new ContentAddressedBlobStore(root);
    const imageOnly = await PDFDocument.create();
    imageOnly.addPage().drawRectangle({ x: 20, y: 20, width: 200, height: 200 });
    const emptyStored = await blobs.put(await imageOnly.save());
    const malformedStored = await blobs.put(new TextEncoder().encode("not a PDF"));
    const base: Omit<Source, "storageKey" | "contentHash" | "sizeBytes"> = {
      id: "pdf-empty",
      notebookId: "notebook-1",
      title: "Image-only PDF",
      kind: "pdf",
      status: "extracting",
      mimeType: "application/pdf",
      passageCount: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const extractor = new PdfSourceExtractor(blobs);

    await expect(
      extractor.extract({
        ...base,
        storageKey: emptyStored.storageKey,
        contentHash: emptyStored.contentHash,
        sizeBytes: emptyStored.sizeBytes,
      }),
    ).resolves.toEqual([]);
    await expect(
      extractor.extract({
        ...base,
        id: "pdf-malformed",
        storageKey: malformedStored.storageKey,
        contentHash: malformedStored.contentHash,
        sizeBytes: malformedStored.sizeBytes,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TYPE_UNSUPPORTED" });
  });
});

describe("Source extractor routing", () => {
  it.each([
    ["pdf", "pdf"],
    ["web", "web"],
    ["text", "text"],
    ["markdown", "text"],
  ] as const)("routes %s Sources through the %s extractor", async (kind, expected) => {
    const calls: string[] = [];
    const extractor = (name: string): SourceExtractor => ({
      async extract(): Promise<readonly ExtractedBlock[]> {
        calls.push(name);
        return [];
      },
    });
    const router = new SourceExtractorRouter({
      pdf: extractor("pdf"),
      web: extractor("web"),
      text: extractor("text"),
    });

    await router.extract({ kind } as Source);

    expect(calls).toEqual([expected]);
  });
});
