import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/domain.js";
import { splitIntoPassages } from "../src/modules/source-ingestion.js";

describe("Passage splitting", () => {
  it("records exact character ranges in the original extracted block", () => {
    const block: ExtractedBlock = {
      content: "  alpha beta  ",
      locator: { kind: "text", startLine: 7, endLine: 7 },
    };

    const [passage] = splitIntoPassages([block]);

    expect(passage).toEqual({
      ordinal: 0,
      content: "alpha beta",
      locator: {
        kind: "text",
        startLine: 7,
        endLine: 7,
        characterStart: 2,
        characterEnd: 12,
      },
      tokenEstimate: 3,
    });
    expect(
      block.content.slice(passage?.locator.characterStart, passage?.locator.characterEnd),
    ).toBe(passage?.content);
  });

  it("uses stable global ordinals, bounded chunks, and overlapping source ranges", () => {
    const longContent = Array.from(
      { length: 240 },
      (_, index) => `segment-${index.toString().padStart(3, "0")}`,
    ).join(" ");
    const blocks: readonly ExtractedBlock[] = [
      { content: longContent, locator: { kind: "pdf", page: 2 } },
      {
        content: "final evidence",
        locator: { kind: "web", url: "https://example.com", paragraph: 4 },
      },
    ];

    const passages = splitIntoPassages(blocks);

    expect(passages.length).toBeGreaterThan(2);
    expect(passages.map((passage) => passage.ordinal)).toEqual(passages.map((_, index) => index));
    for (const passage of passages) {
      expect(passage.content.length).toBeLessThanOrEqual(1_600);
      expect(passage.tokenEstimate).toBe(Math.ceil(passage.content.length / 4));
      const original = passage.locator.kind === "pdf" ? longContent : (blocks[1]?.content ?? "");
      expect(original.slice(passage.locator.characterStart, passage.locator.characterEnd)).toBe(
        passage.content,
      );
    }

    const pdfPassages = passages.filter((passage) => passage.locator.kind === "pdf");
    for (let index = 1; index < pdfPassages.length; index += 1) {
      const previous = pdfPassages[index - 1];
      const current = pdfPassages[index];
      expect(current?.locator.characterStart).toBeLessThan(previous?.locator.characterEnd ?? 0);
      expect(
        (previous?.locator.characterEnd ?? 0) - (current?.locator.characterStart ?? 0),
      ).toBeLessThanOrEqual(160);
    }
  });

  it("does not create a second chunk at the exact size boundary", () => {
    const content = "x".repeat(1_600);

    const passages = splitIntoPassages([
      { content, locator: { kind: "text", startLine: 1, endLine: 1 } },
    ]);

    expect(passages).toHaveLength(1);
    expect(passages[0]?.content).toBe(content);
    expect(passages[0]?.locator).toMatchObject({ characterStart: 0, characterEnd: 1_600 });
  });
});
