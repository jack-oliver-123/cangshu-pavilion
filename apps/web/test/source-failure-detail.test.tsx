import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceFailureDetail } from "../src/components/SourceFailureDetail.js";

describe("SourceFailureDetail", () => {
  it("renders the localized processing stage and readable summary", () => {
    const html = renderToStaticMarkup(
      <SourceFailureDetail
        failure={{
          stage: "embed",
          code: "PROVIDER_UNAVAILABLE",
          message: "向量服务暂时不可用。",
          retryable: true,
        }}
      />,
    );

    expect(html).toContain("失败阶段：向量化");
    expect(html).toContain("向量服务暂时不可用。");
  });

  it("uses the Chinese catalog for stable failure codes", () => {
    const html = renderToStaticMarkup(
      <SourceFailureDetail
        failure={{
          stage: "extract",
          code: "SOURCE_TYPE_UNSUPPORTED",
          message: "No readable text was found in this Source.",
          retryable: false,
        }}
      />,
    );

    expect(html).toContain("未找到可读取的正文，或资料类型不受支持。");
    expect(html).not.toContain("No readable text");
  });
});
