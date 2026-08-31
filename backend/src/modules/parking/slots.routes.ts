/**
 * Operator slot management routes (docs/API_SPEC.md §2 operators).
 * Requires auth + PARKING_OPERATOR; ownership enforced in the service.
 * Mounted at /api/v1/operators/me/facilities/:facilityId/slots.
 */
import { Router } from "express";
import { z } from "zod";
import { PARKING_SLOT_STATUSES } from "@smartpark/shared";
import { asyncHandler } from "../../http/async-handler.js";
import { notFound } from "../../http/errors.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { slotsService } from "../parking/slots.service.js";

const createSlotSchema = z
  .object({
    slotCode: z.string().trim().min(1).max(40),
    vehicleType: z.string().trim().min(1).max(32).optional(),
    status: z.enum(PARKING_SLOT_STATUSES).optional(),
    reservationsEnabled: z.boolean().optional(),
  })
  .strict();

const updateSlotSchema = z
  .object({
    vehicleType: z.string().trim().min(1).max(32).optional(),
    status: z.enum(PARKING_SLOT_STATUSES).optional(),
    reservationsEnabled: z.boolean().optional(),
  })
  .strict();

const OPERATOR_ROUTES = requireRole("PARKING_OPERATOR");

function parseFacilityId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
  }
  return id;
}

function parseSlotId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw notFound("SLOT_NOT_FOUND", "Parking slot not found");
  }
  return id;
}

export function buildSlotsRouter(): Router {
  const router = Router();

  router.post(
    "/:facilityId/slots",
    requireAuth(),
    OPERATOR_ROUTES,
    validateBody(createSlotSchema),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const facilityId = parseFacilityId(req.params.facilityId);
      res.status(201).json(await slotsService.createSlot(req.auth.userId, facilityId, req.body));
    }),
  );

  router.get(
    "/:facilityId/slots",
    requireAuth(),
    OPERATOR_ROUTES,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const facilityId = parseFacilityId(req.params.facilityId);
      res.json(await slotsService.listSlots(req.auth.userId, facilityId));
    }),
  );

  router.patch(
    "/:facilityId/slots/:slotId",
    requireAuth(),
    OPERATOR_ROUTES,
    validateBody(updateSlotSchema),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const slotId = parseSlotId(req.params.slotId);
      res.json(await slotsService.updateSlot(req.auth.userId, slotId, req.body));
    }),
  );

  return router;
}
