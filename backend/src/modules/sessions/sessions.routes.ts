/**
 * Parking session routes (docs/API_SPEC.md §2 parking-sessions).
 * Phase 9 Block 1: entry/exit foundation for operational parking sessions.
 * All routes require auth. Ownership is enforced server-side (a session can
 * be acted upon by the reservation owner or a VERIFIED facility operator);
 * identifier lookups surface 404 so unrelated users cannot probe others'
 * sessions (docs/SECURITY.md §5).
 * Mounted at /api/v1/parking-sessions.
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/async-handler.js";
import { notFound } from "../../http/errors.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sessionsService } from "./sessions.service.js";

const entrySchema = z
  .object({
    reservationCode: z.string().trim().min(1).max(64),
  })
  .strict();

/** Session ids are BIGSERIAL — anything non-numeric is a miss, not a bug. */
function parseSessionId(raw: string): number | undefined {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth());

sessionsRouter.post(
  "/entry",
  validateBody(entrySchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res
      .status(201)
      .json(
        await sessionsService.enterParking(
          req.auth.userId,
          req.auth.roles,
          req.body.reservationCode,
        ),
      );
  }),
);

sessionsRouter.get(
  "/by-reservation/:reservationCode",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const code = req.params.reservationCode?.trim() ?? "";
    if (!code || code.length > 64) {
      throw notFound("SESSION_NOT_FOUND", "Parking session not found");
    }
    res.json(await sessionsService.getSessionByReservation(req.auth.userId, req.auth.roles, code));
  }),
);

sessionsRouter.get(
  "/:id",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const sessionId = parseSessionId(req.params.id);
    if (!sessionId) {
      throw notFound("SESSION_NOT_FOUND", "Parking session not found");
    }
    res.json(await sessionsService.getSession(req.auth.userId, req.auth.roles, sessionId));
  }),
);

sessionsRouter.post(
  "/:id/exit",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const sessionId = parseSessionId(req.params.id);
    if (!sessionId) {
      throw notFound("SESSION_NOT_FOUND", "Parking session not found");
    }
    res.json(await sessionsService.exitParking(req.auth.userId, req.auth.roles, sessionId));
  }),
);
