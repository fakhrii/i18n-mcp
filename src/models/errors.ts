export type ErrorCode =
  | "PROJECT_NOT_FOUND"
  | "INVALID_AST"
  | "MALFORMED_JSON"
  | "MISSING_LOCALE_DIRECTORY"
  | "UNSUPPORTED_I18N_LIBRARY"
  | "AMBIGUOUS_NAMESPACE"
  | "TRANSLATION_FAILURE"
  | "DUPLICATE_KEY"
  | "CONFLICTING_KEY"
  | "SOURCE_TRANSFORMATION_FAILURE"
  | "PERMISSION_ERROR"
  | "UNKNOWN_ERROR";

export interface StructuredErrorDetails {
  file?: string;
  line?: number;
  column?: number;
  namespace?: string;
  key?: string;
  [key: string]: unknown;
}

export class I18nMcpError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: StructuredErrorDetails;

  constructor(message: string, code: ErrorCode = "UNKNOWN_ERROR", details?: StructuredErrorDetails) {
    super(message);
    this.name = "I18nMcpError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
