import { messages } from "../messages.js";
import type { SourceFailure } from "../types.js";

export function SourceFailureDetail(props: { readonly failure: SourceFailure }) {
  const summaries: Readonly<Record<string, string>> = messages.sourceFailureSummaries;
  return (
    <p className="failure-detail">
      <span className="failure-stage">
        {messages.sourceFailureStage}：{messages.sourceFailureStages[props.failure.stage]}
      </span>
      <span>{summaries[props.failure.code] ?? props.failure.message}</span>
    </p>
  );
}
