import {
  ApplicationError,
  type ExtractedBlock,
  type Source,
  type SourceBlobStore,
  type SourceExtractor,
} from "@cangshu/application";

export class TextSourceExtractor implements SourceExtractor {
  constructor(private readonly blobs: SourceBlobStore) {}

  async extract(source: Source): Promise<readonly ExtractedBlock[]> {
    if (source.kind !== "text" && source.kind !== "markdown") {
      throw unsupported(`TextSourceExtractor does not support Source kind "${source.kind}".`);
    }
    if (!source.storageKey) {
      throw unsupported("Text Source does not have stored bytes.");
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(
        await this.blobs.read(source.storageKey),
      );
    } catch (error) {
      throw new ApplicationError({
        code: "SOURCE_TYPE_UNSUPPORTED",
        message: "Text Source is not valid UTF-8.",
        status: 422,
        cause: error,
      });
    }

    return paragraphsWithLineRanges(content);
  }
}

export function paragraphsWithLineRanges(content: string): readonly ExtractedBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ExtractedBlock[] = [];
  let current: string[] = [];
  let startLine = 0;

  const flush = (endLine: number): void => {
    if (current.length === 0) {
      return;
    }
    blocks.push({
      content: current.join("\n").trim(),
      locator: { kind: "text", startLine, endLine },
    });
    current = [];
    startLine = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      flush(index);
      continue;
    }
    if (current.length === 0) {
      startLine = index + 1;
    }
    current.push(line);
  }
  flush(lines.length);
  return blocks;
}

function unsupported(message: string): ApplicationError {
  return new ApplicationError({ code: "SOURCE_TYPE_UNSUPPORTED", message, status: 422 });
}
