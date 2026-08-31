/**
 * Application error carrying an HTTP status and the API_SPEC §1 error code.
 * Thrown by services/middleware and translated to the standard
 * { error: { code, message, details? } } envelope by the central error handler.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(code: string, message: string): HttpError {
  return new HttpError(400, code, message);
}

export function unauthorized(
  code = "UNAUTHORIZED",
  message = "Authentication required",
): HttpError {
  return new HttpError(401, code, message);
}

export function forbidden(code = "FORBIDDEN", message = "Insufficient permissions"): HttpError {
  return new HttpError(403, code, message);
}

export function notFound(code = "NOT_FOUND", message = "Resource not found"): HttpError {
  return new HttpError(404, code, message);
}

export function conflict(code: string, message: string): HttpError {
  return new HttpError(409, code, message);
}
