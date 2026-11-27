export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "must_change_password"
  | "unsupported_media_type"
  | "payload_too_large"
  | "range_not_satisfiable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  rate_limited: 429,
  must_change_password: 403,
  unsupported_media_type: 415,
  payload_too_large: 413,
  range_not_satisfiable: 416,
  internal: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra?: { fields?: Record<string, string>; headers?: Record<string, string>; [k: string]: unknown },
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Không tìm thấy") => new ApiError("not_found", what);
export const conflict = (m: string, extra?: ApiError["extra"]) => new ApiError("conflict", m, extra);
export const invalid = (m: string, fields?: Record<string, string>) => new ApiError("validation", m, { fields });
