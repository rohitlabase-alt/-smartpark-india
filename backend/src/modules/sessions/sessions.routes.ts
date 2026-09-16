/**
 * Parking session routes (docs/API_SPEC.md §2 parking-sessions).
 * Phase 9 Block 1: entry/exit foundation for operational parking sessions.
 * Phase 9 Block 3: parking-pass verification-token entry + pass read.
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
import type { ParkingSessionEntryRequest } from "@smartpark/shared";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sessionsService } from "./sessions.service.js";

const MAX_TOKEN_LENGTH = 4096;

/**
 * Entry accepts exactly ONE credential: a booking reference OR a parking-pass
 * verification token. `.strict()` rejects unknown keys; the refine enforces
 * the exclusive-or (docs/API_SPEC.md §2 parking-sessions).
 */
const entrySchema = z
  .object({
    reservationCode: z.string().trim().min(1).max(64).optional(),
    verificationToken: z.string().trim().min(1).max(MAX_TOKEN_LENGTH).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.reservationCode !== undefined ? 1 : 0) +
        (value.verificationToken !== undefined ? 1 : 0) ===
      1,
    { message: "Provide exactly one of reservationCode or verificationToken" },
  );

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
    const credential = req.body as ParkingSessionEntryRequest;
    res
      .status(201)
      .json(await sessionsService.enterParking(req.auth.userId, req.auth.roles, credential));
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
  "/by-reservation/:reservationCode/pass",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const code = req.params.reservationCode?.trim() ?? "";
    if (!code || code.length > 64) {
      throw notFound("BOOKING_NOT_FOUND", "Booking not found");
    }
    res.json(await sessionsService.getParkingPass(req.auth.userId, req.auth.roles, code));
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
