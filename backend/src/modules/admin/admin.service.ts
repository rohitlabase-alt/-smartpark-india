/**
 * Admin operator verification and facility control application logic
 * (Phase 8, Parts 1 & 3).
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
 */
import type { Operator, OperatorStatus, ParkingFacility } from "@smartpark/shared";
import { conflict, notFound } from "../../http/errors.js";
import { operatorsRepository, toOperatorDto } from "../operators/operators.repository.js";
import { facilitiesRepository, toFacilityDto } from "../parking/facilities.repository.js";
import { adminRepository } from "./admin.repository.js";

export const adminService = {
  async listOperators(status: OperatorStatus): Promise<{ operators: Operator[] }> {
    const rows = await adminRepository.listByStatus(status);
    return { operators: rows.map(toOperatorDto) };
  },

  /** PENDING → UNDER_REVIEW. */
  async reviewOperator(operatorId: number): Promise<Operator> {
    return this.transition(operatorId, "PENDING", "UNDER_REVIEW");
  },

  /** UNDER_REVIEW → VERIFIED, recording the acting admin in approved_by/approved_at. */
  async approveOperator(adminUserId: number, operatorId: number): Promise<Operator> {
    return this.transition(operatorId, "UNDER_REVIEW", "VERIFIED", {
      approvedBy: adminUserId,
      approvedAt: new Date(),
    });
  },

  /** UNDER_REVIEW → REJECTED. No approved_by/approved_at write. */
  async rejectOperator(operatorId: number): Promise<Operator> {
    return this.transition(operatorId, "UNDER_REVIEW", "REJECTED");
  },

  async transition(
    operatorId: number,
    fromStatus: OperatorStatus,
    toStatus: OperatorStatus,
    approval?: { approvedBy: number; approvedAt: Date },
  ): Promise<Operator> {
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
    const updated = await adminRepository.updateVerificationStatus(operatorId, {
      status: toStatus,
      fromStatus,
      approvedBy: approval?.approvedBy,
      approvedAt: approval?.approvedAt,
    });
    if (!updated) {
      throw conflict("OPERATOR_STATUS_CONFLICT", "Operator status changed concurrently");
    }
    return toOperatorDto(updated);
  },

  // ── Facility control (Phase 8, Part 3) ──────────────────────────────────

  async listFacilities(status: OperatorStatus): Promise<{ facilities: ParkingFacility[] }> {
    const rows = await adminRepository.listFacilitiesByStatus(status);
    return { facilities: rows.map(toFacilityDto) };
  },

  /** PENDING → UNDER_REVIEW. */
  async reviewFacility(facilityId: number): Promise<ParkingFacility> {
    return transitionFacility(facilityId, "PENDING", "UNDER_REVIEW");
  },

  /** UNDER_REVIEW → VERIFIED, recording the acting admin. */
  async approveFacility(adminUserId: number, facilityId: number): Promise<ParkingFacility> {
    return transitionFacility(facilityId, "UNDER_REVIEW", "VERIFIED", {
      approvedBy: adminUserId,
      approvedAt: new Date(),
    });
  },

  /** UNDER_REVIEW → REJECTED. Clears approved_by/approved_at. */
  async rejectFacility(facilityId: number): Promise<ParkingFacility> {
    return transitionFacility(facilityId, "UNDER_REVIEW", "REJECTED", undefined, true);
  },

  /** VERIFIED → ACTIVE. Guarded toggle. */
  async activateFacility(facilityId: number): Promise<ParkingFacility> {
    return toggleFacilityActive(facilityId, true);
  },

  /** VERIFIED → INACTIVE. Guarded toggle. */
  async deactivateFacility(facilityId: number): Promise<ParkingFacility> {
    return toggleFacilityActive(facilityId, false);
  },
};

async function transitionFacility(
  facilityId: number,
  fromStatus: OperatorStatus,
  toStatus: OperatorStatus,
  approval?: { approvedBy: number; approvedAt: Date },
  clearApproval?: boolean,
): Promise<ParkingFacility> {
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

  const updated = await adminRepository.updateFacilityVerificationStatus(facilityId, {
    status: toStatus,
    fromStatus,
    approvedBy: approval?.approvedBy,
    approvedAt: approval?.approvedAt,
    clearApproval,
  });
  if (!updated) {
    throw conflict("FACILITY_STATUS_CONFLICT", "Facility status changed concurrently");
  }
  return toFacilityDto(updated);
}

async function toggleFacilityActive(facilityId: number, active: boolean): Promise<ParkingFacility> {
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

  const updated = await adminRepository.updateFacilityActiveStatus(facilityId, active);
  if (!updated) {
    throw conflict("FACILITY_STATUS_CONFLICT", "Facility active status changed concurrently");
  }
  return toFacilityDto(updated);
}
