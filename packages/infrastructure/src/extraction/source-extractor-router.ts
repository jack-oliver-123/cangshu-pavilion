import type { ExtractedBlock, Source, SourceExtractor } from "@cangshu/application";

export interface SourceExtractorRoutes {
  readonly pdf: SourceExtractor;
  readonly web: SourceExtractor;
  readonly text: SourceExtractor;
}

export class SourceExtractorRouter implements SourceExtractor {
  constructor(private readonly routes: SourceExtractorRoutes) {}

  extract(source: Source): Promise<readonly ExtractedBlock[]> {
    if (source.kind === "pdf") return this.routes.pdf.extract(source);
    if (source.kind === "web") return this.routes.web.extract(source);
    return this.routes.text.extract(source);
  }
}
