import {
  ApplicationError,
  type ExtractedBlock,
  type Source,
  type SourceBlobStore,
  type SourceExtractor,
} from "@cangshu/application";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export class PdfSourceExtractor implements SourceExtractor {
  constructor(private readonly blobs: SourceBlobStore) {}

  async extract(source: Source): Promise<readonly ExtractedBlock[]> {
    if (source.kind !== "pdf" || !source.storageKey) {
      throw unsupported("PDF Source does not have valid stored bytes.");
    }

    try {
      const loading = getDocument({
        data: new Uint8Array(await this.blobs.read(source.storageKey)),
        useSystemFonts: true,
      });
      try {
        const document = await loading.promise;
        const blocks: ExtractedBlock[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          try {
            const text = await page.getTextContent();
            const content = text.items
              .flatMap((item) => ("str" in item ? [item.str] : []))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (content.length > 0) {
              blocks.push({ content, locator: { kind: "pdf", page: pageNumber } });
            }
          } finally {
            page.cleanup();
          }
        }
        return blocks;
      } finally {
        await loading.destroy();
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw unsupported("PDF Source could not be parsed.", error);
    }
  }
}

function unsupported(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "SOURCE_TYPE_UNSUPPORTED",
    message,
    status: 422,
    ...(cause === undefined ? {} : { cause }),
  });
}
