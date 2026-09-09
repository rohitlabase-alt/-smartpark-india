/**
 * Admin operator verification application logic (Phase 8, Part 1).
 *
 * Workflow (docs/API_SPEC.md §2 admin):
 *   PENDING → UNDER_REVIEW → VERIFIED | REJECTED
 *
 * Every transition is guarded: the operator must currently be in the expected
 * source status, otherwise 409 OPERATOR_STATUS_CONFLICT. Unknown operators are
 * 404 (no existence disclosure). The DB conditional-UPDATE makes the check and
 * the write atomic across concurrent admins.
 *
 * Reviewer identity: the `operators` schema exposes `approved_by`/`approved_at`
 * only, so review does not record a reviewer (no `reviewed_by` column exists —
 * documented schema limitation). Approval records the acting admin.
 */
import type { Operator, OperatorStatus } from "@smartpark/shared";
import { conflict, notFound } from "../../http/errors.js";
import { operatorsRepository, toOperatorDto } from "../operators/operators.repository.js";
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
};
