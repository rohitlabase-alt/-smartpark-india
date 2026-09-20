/**
 * Operator zone management routes (docs/API_SPEC.md §2 operators / facilities,
 * Phase 10 society parking). Requires auth + PARKING_OPERATOR; ownership is
 * enforced in the service. Mounted at /api/v1/operators/me/facilities
 * (parallel to the slots router, e.g. /:facilityId/zones).
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/async-handler.js";
import { notFound } from "../../http/errors.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { zonesService } from "./zones.service.js";

const createZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

const updateZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    kind: z.string().trim().min(1).max(32).optional(),
    isActive: z.boolean().optional(),
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

function parseZoneId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw notFound("ZONE_NOT_FOUND", "Parking zone not found");
  }
  return id;
}

export function buildZonesRouter(): Router {
  const router = Router();

  router.post(
    "/:facilityId/zones",
    requireAuth(),
    OPERATOR_ROUTES,
    validateBody(createZoneSchema),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const facilityId = parseFacilityId(req.params.facilityId);
      res.status(201).json(await zonesService.createZone(req.auth.userId, facilityId, req.body));
    }),
  );

  router.get(
    "/:facilityId/zones",
    requireAuth(),
    OPERATOR_ROUTES,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const facilityId = parseFacilityId(req.params.facilityId);
      res.json(await zonesService.listZones(req.auth.userId, facilityId));
    }),
  );

  router.patch(
    "/:facilityId/zones/:zoneId",
    requireAuth(),
    OPERATOR_ROUTES,
    validateBody(updateZoneSchema),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const facilityId = parseFacilityId(req.params.facilityId);
      const zoneId = parseZoneId(req.params.zoneId);
      res.json(await zonesService.updateZone(req.auth.userId, facilityId, zoneId, req.body));
    }),
  );

  router.delete(
    "/:facilityId/zones/:zoneId",
    requireAuth(),
    OPERATOR_ROUTES,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const facilityId = parseFacilityId(req.params.facilityId);
      const zoneId = parseZoneId(req.params.zoneId);
      await zonesService.deleteZone(req.auth.userId, facilityId, zoneId);
      res.status(204).end();
    }),
  );

  return router;
}
