/**
 * Admin operator verification and facility control application logic
 * (Phase 8, Parts 1, 3 & 4).
 *
 * Operator workflow (docs/API_SPEC.md §2 admin):
 *   PENDING → UNDER_REVIEW → VERIFIED | REJECTED
 *
 * Facility workflow (Phase 8, Part 3):
 *   PENDING → UNDER_REVIEW → VERIFIED | REJECTED
 *   VERIFIED → ACTIVE | INACTIVE
 *
 * Every transition is guarded: the entity must currently be in the expected
 * source status, otherwise 409. Unknown entities are 404 (no existence
 * disclosure). The DB conditional-UPDATE makes the check and the write atomic
 * across concurrent admins.
 *
 * Reviewer identity: approval records the acting admin in approved_by/approved_at;
 * non-verified transitions clear those columns (mirrors operator workflow).
 *
 * Audit (Phase 8, Part 4): every transition writes an audit event (the acting
 * admin from the authenticated session) INSIDE the same transaction as the
 * status update, so a transition can never commit without its audit record.
 */
import type {
  AuditEventAction,
  Operator,
  OperatorStatus,
  ParkingFacility,
} from "@smartpark/shared";
import { conflict, notFound } from "../../http/errors.js";
import { withTransaction } from "../../db.js";
import { operatorsRepository, toOperatorDto } from "../operators/operators.repository.js";
import { facilitiesRepository, toFacilityDto } from "../parking/facilities.repository.js";
import { auditService } from "../audit/audit.service.js";
import { adminRepository } from "./admin.repository.js";

export const adminService = {
  async listOperators(status: OperatorStatus): Promise<{ operators: Operator[] }> {
    const rows = await adminRepository.listByStatus(status);
    return { operators: rows.map(toOperatorDto) };
  },

  /** PENDING → UNDER_REVIEW (+ audit). */
  async reviewOperator(adminUserId: number, operatorId: number): Promise<Operator> {
    return transitionOperator(
      adminUserId,
      operatorId,
      "PENDING",
      "UNDER_REVIEW",
      "OPERATOR_REVIEWED",
    );
  },

  /** UNDER_REVIEW → VERIFIED (+ audit), recording the acting admin. */
  async approveOperator(adminUserId: number, operatorId: number): Promise<Operator> {
    return transitionOperator(
      adminUserId,
      operatorId,
      "UNDER_REVIEW",
      "VERIFIED",
      "OPERATOR_APPROVED",
      {
        approvedBy: adminUserId,
        approvedAt: new Date(),
      },
    );
  },

  /** UNDER_REVIEW → REJECTED (+ audit). No approved_by/approved_at write. */
  async rejectOperator(adminUserId: number, operatorId: number): Promise<Operator> {
    return transitionOperator(
      adminUserId,
      operatorId,
      "UNDER_REVIEW",
      "REJECTED",
      "OPERATOR_REJECTED",
    );
  },

  // ── Facility control (Phase 8, Part 3) ──────────────────────────────────

  async listFacilities(status: OperatorStatus): Promise<{ facilities: ParkingFacility[] }> {
    const rows = await adminRepository.listFacilitiesByStatus(status);
    return { facilities: rows.map(toFacilityDto) };
  },

  /** PENDING → UNDER_REVIEW (+ audit). */
  async reviewFacility(adminUserId: number, facilityId: number): Promise<ParkingFacility> {
    return transitionFacility(
      adminUserId,
      facilityId,
      "PENDING",
      "UNDER_REVIEW",
      "FACILITY_REVIEWED",
    );
  },

  /** UNDER_REVIEW → VERIFIED (+ audit), recording the acting admin. */
  async approveFacility(adminUserId: number, facilityId: number): Promise<ParkingFacility> {
    return transitionFacility(
      adminUserId,
      facilityId,
      "UNDER_REVIEW",
      "VERIFIED",
      "FACILITY_APPROVED",
      { approvedBy: adminUserId, approvedAt: new Date() },
    );
  },

  /** UNDER_REVIEW → REJECTED (+ audit). Clears approved_by/approved_at. */
  async rejectFacility(adminUserId: number, facilityId: number): Promise<ParkingFacility> {
    return transitionFacility(
      adminUserId,
      facilityId,
      "UNDER_REVIEW",
      "REJECTED",
      "FACILITY_REJECTED",
      undefined,
      true,
    );
  },

  /** VERIFIED → ACTIVE (+ audit). Guarded toggle. */
  async activateFacility(adminUserId: number, facilityId: number): Promise<ParkingFacility> {
    return toggleFacilityActive(adminUserId, facilityId, true);
  },

  /** VERIFIED → INACTIVE (+ audit). Guarded toggle. */
  async deactivateFacility(adminUserId: number, facilityId: number): Promise<ParkingFacility> {
    return toggleFacilityActive(adminUserId, facilityId, false);
  },
};

async function transitionOperator(
  adminUserId: number,
  operatorId: number,
  fromStatus: OperatorStatus,
  toStatus: OperatorStatus,
  action: AuditEventAction,
  approval?: { approvedBy: number; approvedAt: Date },
): Promise<Operator> {
  return withTransaction(async (client) => {
    const operator = await operatorsRepository.findById(operatorId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "Operator not found");
    }
    if (operator.verificationStatus !== fromStatus) {
      throw conflict(
        "OPERATOR_STATUS_CONFLICT",
        `Operator is ${operator.verificationStatus}; expected ${fromStatus} for this transition`,
      );
    }
    const updated = await adminRepository.updateVerificationStatus(
      operatorId,
      {
        status: toStatus,
        fromStatus,
        approvedBy: approval?.approvedBy,
        approvedAt: approval?.approvedAt,
      },
      client,
    );
    if (!updated) {
      throw conflict("OPERATOR_STATUS_CONFLICT", "Operator status changed concurrently");
    }
    await auditService.createEvent(client, {
      actorUserId: adminUserId,
      action,
      entityType: "OPERATOR",
      entityId: operatorId,
      metadata: { fromStatus, toStatus },
    });
    return toOperatorDto(updated);
  });
}

async function transitionFacility(
  adminUserId: number,
  facilityId: number,
  fromStatus: OperatorStatus,
  toStatus: OperatorStatus,
  action: AuditEventAction,
  approval?: { approvedBy: number; approvedAt: Date },
  clearApproval?: boolean,
): Promise<ParkingFacility> {
  return withTransaction(async (client) => {
    const facilityById = await facilitiesRepository.findById(facilityId);
    if (!facilityById) {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }
    if (facilityById.verificationStatus !== fromStatus) {
      throw conflict(
        "FACILITY_STATUS_CONFLICT",
        `Facility is ${facilityById.verificationStatus}; expected ${fromStatus} for this transition`,
      );
    }

    const updated = await adminRepository.updateFacilityVerificationStatus(
      facilityId,
      {
        status: toStatus,
        fromStatus,
        approvedBy: approval?.approvedBy,
        approvedAt: approval?.approvedAt,
        clearApproval,
      },
      client,
    );
    if (!updated) {
      throw conflict("FACILITY_STATUS_CONFLICT", "Facility status changed concurrently");
    }
    await auditService.createEvent(client, {
      actorUserId: adminUserId,
      action,
      entityType: "FACILITY",
      entityId: facilityId,
      metadata: { fromStatus, toStatus },
    });
    return toFacilityDto(updated);
  });
}

async function toggleFacilityActive(
  adminUserId: number,
  facilityId: number,
  active: boolean,
): Promise<ParkingFacility> {
  return withTransaction(async (client) => {
    const facility = await facilitiesRepository.findById(facilityId);
    if (!facility) {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }
    if (facility.verificationStatus !== "VERIFIED") {
      throw conflict(
        "FACILITY_STATUS_CONFLICT",
        `Facility is ${facility.verificationStatus}; only VERIFIED facilities can be activated/deactivated`,
      );
    }

    const updated = await adminRepository.updateFacilityActiveStatus(facilityId, active, client);
    if (!updated) {
      throw conflict("FACILITY_STATUS_CONFLICT", "Facility active status changed concurrently");
    }
    await auditService.createEvent(client, {
      actorUserId: adminUserId,
      action: active ? "FACILITY_ACTIVATED" : "FACILITY_DEACTIVATED",
      entityType: "FACILITY",
      entityId: facilityId,
      metadata: { active },
    });
    return toFacilityDto(updated);
  });
}
