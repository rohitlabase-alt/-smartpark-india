/**
 * SQL data access for admin operator verification (Phase 8, Part 1;
 * docs/API_SPEC.md §2 admin, docs/DATABASE.md §2.4). Reuses the operators
 * table exactly as-migrated — no new columns. State transitions use a guarded
 * conditional UPDATE (`WHERE verification_status = from`) so a lost update or
 * a concurrent admin action surfaces as a miss rather than an overwrite.
 */
import type { OperatorStatus } from "@smartpark/shared";
import { getPool } from "../../db.js";
import {
  mapOperator,
  type OperatorResult,
  type OperatorRow,
} from "../operators/operators.repository.js";

export const adminRepository = {
  /** Operators filtered by verification status, oldest first. */
  async listByStatus(status: OperatorStatus): Promise<OperatorRow[]> {
    const { rows } = await getPool().query<OperatorResult>(
      `SELECT id, name, business_type, registration_number, verification_status, created_at
       FROM operators WHERE verification_status = $1 AND deleted_at IS NULL
       ORDER BY id ASC`,
      [status],
    );
    return rows.map(mapOperator);
  },

  /**
   * Transitions `verification_status` from `fromStatus` to `status`, bumping
   * `updated_at`. Approval also records the acting admin identity in
   * `approved_by`/`approved_at` (the only reviewer columns the schema has);
   * review/reject leave those untouched. Returns undefined when the operator
   * is missing, soft-deleted, or no longer in `fromStatus`.
   */
  async updateVerificationStatus(
    id: number,
    input: {
      status: OperatorStatus;
      fromStatus: OperatorStatus;
      approvedBy?: number | null;
      approvedAt?: Date | null;
    },
  ): Promise<OperatorRow | undefined> {
    const { rows } = await getPool().query<OperatorResult>(
      `UPDATE operators
       SET verification_status = $2,
           updated_at = now(),
           approved_by = CASE WHEN $3::bigint IS NULL THEN approved_by ELSE $3 END,
           approved_at = CASE WHEN $4::timestamptz IS NULL THEN approved_at ELSE $4 END
       WHERE id = $1 AND verification_status = $5 AND deleted_at IS NULL
       RETURNING id, name, business_type, registration_number, verification_status, created_at`,
      [id, input.status, input.approvedBy ?? null, input.approvedAt ?? null, input.fromStatus],
    );
    return rows[0] ? mapOperator(rows[0]) : undefined;
  },
};
