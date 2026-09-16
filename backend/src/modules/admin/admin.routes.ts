/**
 * Admin operator verification and facility control routes (Phase 8, Parts 1 & 3;
 * docs/API_SPEC.md §2 admin). Mounted at /api/v1/admin. Every endpoint requires
 * authentication plus the ADMIN role, enforced server-side via requireAuth +
 * requireRole — client role claims are never trusted (docs/SECURITY.md §5).
 */
import { Router } from "express";
import { z } from "zod";
import { OPERATOR_STATUSES, type OperatorStatus } from "@smartpark/shared";
import { asyncHandler } from "../../http/async-handler.js";
import { badRequest, notFound } from "../../http/errors.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { adminService } from "./admin.service.js";

const ADMIN_ROUTES = requireRole("ADMIN");

const statusSchema = z.enum(OPERATOR_STATUSES);

function parseOperatorId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw notFound("OPERATOR_NOT_FOUND", "Operator not found");
  }
  return id;
}

function parseFacilityId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
  }
  return id;
}

function parseStatusFilter(raw: unknown): OperatorStatus {
  if (typeof raw !== "string") {
    throw badRequest("VALIDATION_ERROR", "status must be one of: " + OPERATOR_STATUSES.join(", "));
  }
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("VALIDATION_ERROR", "status must be one of: " + OPERATOR_STATUSES.join(", "));
  }
  return parsed.data;
}

export const adminRouter = Router();

adminRouter.use(requireAuth());
adminRouter.use(ADMIN_ROUTES);

// ── Operator verification (Phase 8, Part 1) ───────────────────────────────

adminRouter.get(
  "/operators",
  asyncHandler(async (req, res) => {
    const status = parseStatusFilter(req.query.status ?? "PENDING");
    res.json(await adminService.listOperators(status));
  }),
);

adminRouter.post(
  "/operators/:operatorId/review",
  asyncHandler(async (req, res) => {
    res.json(await adminService.reviewOperator(parseOperatorId(req.params.operatorId)));
  }),
);

adminRouter.post(
  "/operators/:operatorId/approve",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(
      await adminService.approveOperator(req.auth.userId, parseOperatorId(req.params.operatorId)),
    );
  }),
);

adminRouter.post(
  "/operators/:operatorId/reject",
  asyncHandler(async (req, res) => {
    res.json(await adminService.rejectOperator(parseOperatorId(req.params.operatorId)));
  }),
);

// ── Facility control (Phase 8, Part 3) ────────────────────────────────────

adminRouter.get(
  "/facilities",
  asyncHandler(async (req, res) => {
    const status = parseStatusFilter(req.query.status ?? "PENDING");
    res.json(await adminService.listFacilities(status));
  }),
);

adminRouter.post(
  "/facilities/:facilityId/review",
  asyncHandler(async (req, res) => {
    res.json(await adminService.reviewFacility(parseFacilityId(req.params.facilityId)));
  }),
);

adminRouter.post(
  "/facilities/:facilityId/approve",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(
      await adminService.approveFacility(req.auth.userId, parseFacilityId(req.params.facilityId)),
    );
  }),
);

adminRouter.post(
  "/facilities/:facilityId/reject",
  asyncHandler(async (req, res) => {
    res.json(await adminService.rejectFacility(parseFacilityId(req.params.facilityId)));
  }),
);

adminRouter.post(
  "/facilities/:facilityId/activate",
  asyncHandler(async (req, res) => {
    res.json(await adminService.activateFacility(parseFacilityId(req.params.facilityId)));
  }),
);

adminRouter.post(
  "/facilities/:facilityId/deactivate",
  asyncHandler(async (req, res) => {
    res.json(await adminService.deactivateFacility(parseFacilityId(req.params.facilityId)));
  }),
);
