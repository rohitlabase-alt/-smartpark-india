/**
 * Operator + parking facility API routes (docs/API_SPEC.md §2 operators).
 * Every operator route requires authentication and the PARKING_OPERATOR role
 * (RBAC enforced server-side via requireRole); ownership is checked in the
 * services (IDOR resistance, docs/SECURITY.md §5).
 */
import { Router } from "express";
import { z } from "zod";
import { FACILITY_TYPES } from "@smartpark/shared";
import { asyncHandler } from "../../http/async-handler.js";
import { notFound } from "../../http/errors.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { operatorsService } from "./operators.service.js";
import { facilitiesService } from "../parking/facilities.service.js";

const operatorRegisterSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    businessType: z.string().trim().min(1).max(64).optional(),
    registrationNumber: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const createFacilitySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    type: z.enum(FACILITY_TYPES),
    city: z.string().trim().min(1).max(64),
    state: z.string().trim().min(1).max(64).optional(),
    area: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    capacity: z.number().int().min(1).max(100_000),
    description: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const updateFacilitySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    type: z.enum(FACILITY_TYPES).optional(),
    city: z.string().trim().min(1).max(64).optional(),
    state: z.string().trim().min(1).max(64).nullable().optional(),
    area: z.string().trim().min(1).max(160).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    capacity: z.number().int().min(1).max(100_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const OPERATOR_ROUTES = requireRole("PARKING_OPERATOR");

export const operatorsRouter = Router();

operatorsRouter.post(
  "/register",
  requireAuth(),
  validateBody(operatorRegisterSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(201).json(await operatorsService.registerOperator(req.auth.userId, req.body));
  }),
);

operatorsRouter.get(
  "/me",
  requireAuth(),
  OPERATOR_ROUTES,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(await operatorsService.getOwnOperator(req.auth.userId));
  }),
);

operatorsRouter.get(
  "/me/reservations",
  requireAuth(),
  OPERATOR_ROUTES,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(await operatorsService.listOperatorReservations(req.auth.userId));
  }),
);

operatorsRouter.post(
  "/me/facilities",
  requireAuth(),
  OPERATOR_ROUTES,
  validateBody(createFacilitySchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(201).json(await facilitiesService.createFacility(req.auth.userId, req.body));
  }),
);

operatorsRouter.get(
  "/me/facilities",
  requireAuth(),
  OPERATOR_ROUTES,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(await facilitiesService.listFacilities(req.auth.userId));
  }),
);

operatorsRouter.patch(
  "/me/facilities/:facilityId",
  requireAuth(),
  OPERATOR_ROUTES,
  validateBody(updateFacilitySchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const facilityId = Number(req.params.facilityId);
    if (!Number.isInteger(facilityId) || facilityId <= 0) {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }
    res.json(await facilitiesService.updateFacility(req.auth.userId, facilityId, req.body));
  }),
);
