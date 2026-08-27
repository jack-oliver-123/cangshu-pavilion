export type ApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_TYPE_UNSUPPORTED"
  | "WEB_FETCH_BLOCKED"
  | "WEB_FETCH_FAILED"
  | "SOURCE_NOT_READY"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "INSUFFICIENT_EVIDENCE"
  | "UNAUTHORIZED"
  | "REMOTE_ACCESS_REQUIRES_PASSWORD"
  | "NOT_READY"
  | "INTERNAL_ERROR";

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(input: {
    code: ApplicationErrorCode;
    message: string;
    status: number;
    details?: Readonly<Record<string, unknown>>;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ApplicationError";
    this.code = input.code;
    this.status = input.status;
    if (input.details) {
      this.details = input.details;
    }
  }
}

export function notFound(entity: string, id: string): ApplicationError {
  return new ApplicationError({
    code: "NOT_FOUND",
    message: `${entity} was not found.`,
    status: 404,
    details: { entity, id },
  });
}
