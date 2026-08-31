/**
 * Reservation/booking routes (docs/API_SPEC.md §2 reservations).
 * Phase 2C implements create / own-list / own-detail / cancel. The
 * payment-dependent `confirm` endpoint is deferred (no payments this phase).
 * All booking routes require auth; ownership is enforced server-side.
 * Mounted at /api/v1/reservations.
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/async-handler.js";
import { badRequest } from "../../http/errors.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { bookingsService } from "./reservations.service.js";

const createBookingSchema = z
  .object({
    facilityId: z.number().int().positive(),
    slotId: z.number().int().positive().optional(),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
  })
  .strict();

const cancelSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const reservationsRouter = Router();

reservationsRouter.use(requireAuth());

reservationsRouter.get(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(await bookingsService.listBookings(req.auth.userId));
  }),
);

reservationsRouter.post(
  "/",
  validateBody(createBookingSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(201).json(await bookingsService.createBooking(req.auth.userId, req.body));
  }),
);

reservationsRouter.get(
  "/:code",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.params.code) {
      throw badRequest("VALIDATION_ERROR", "Missing booking code");
    }
    res.json(await bookingsService.getBooking(req.auth.userId, req.params.code));
  }),
);

reservationsRouter.post(
  "/:code/cancel",
  validateBody(cancelSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.params.code) {
      throw badRequest("VALIDATION_ERROR", "Missing booking code");
    }
    res.json(
      await bookingsService.cancelBooking(req.auth.userId, req.params.code, req.body?.reason),
    );
  }),
);
