import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiError } from "@smartpark/shared";
import { HttpError } from "./errors.js";

/** JSON 404 for unknown routes (kept consistent with API_SPEC §1). */
export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = { error: { code: "NOT_FOUND", message: "Route not found" } };
  res.status(404).json(body);
};

/**
 * Central error handler. HttpError → mapped status/code; malformed JSON body
 * → 400 INVALID_JSON; anything else → 500. Never leaks internals to clients.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiError = {
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    };
    res.status(err.status).json(body);
    return;
  }

  // express.json() rejects malformed request bodies with type
  // "entity.parse.failed" and a 400 status.
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    const body: ApiError = {
      error: { code: "INVALID_JSON", message: "Request body is not valid JSON" },
    };
    res.status(400).json(body);
    return;
  }

  console.error("[api] unhandled error:", err);
  const body: ApiError = {
    error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
  };
  res.status(500).json(body);
};
