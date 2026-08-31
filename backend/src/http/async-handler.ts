import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async route/middleware handler so rejections reach Express 4's
 * error handler instead of crashing the process (Express 4 does not
 * forward rejected promises to next(err) automatically).
 *
 * Generic over the request type so handlers can read authenticated context
 * (e.g. `AuthenticatedRequest` after requireAuth()).
 */
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req as Req, res, next).catch(next);
  };
}
