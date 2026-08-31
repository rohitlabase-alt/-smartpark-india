import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { HttpError } from "../http/errors.js";
import { asyncHandler } from "../http/async-handler.js";

/**
 * Validates req.body against a zod schema and replaces it with the parsed
 * output (so downstream handlers see typed/cleaned values). 400 VALIDATION_ERROR
 * with flattened field details on failure (API_SPEC §1 conventions).
 */
export function validateBody<T>(schema: ZodType<T>) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", "Invalid request body", {
        issues: parsed.error.flatten(),
      });
    }
    req.body = parsed.data;
    next();
  });
}
