/**
 * SQL data access for admin operator verification and facility control
 * (Phase 8, Parts 1 & 3). State transitions use a guarded conditional UPDATE
 * (`WHERE verification_status = from`) so a lost update or a concurrent admin
 * action surfaces as a miss rather than an overwrite.
 */
import type { OperatorStatus } from "@smartpark/shared";
import type { PoolClient } from "pg";
import { getPool } from "../../db.js";
import {
  mapOperator,
  type OperatorResult,
  type OperatorRow,
} from "../operators/operators.repository.js";
import { type FacilityRow, type FacilityResult } from "../parking/facilities.repository.js";

function mapFacilityAdmin(row: FacilityResult): FacilityRow {
  return {
    id: Number(row.id),
    parkingId: row.parking_id,
    name: row.name,
    description: row.description,
    type: row.type as import("@smartpark/shared").FacilityType,
    country: row.country,
    state: row.state,
    city: row.city,
    area: row.area,
    address: row.address,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    operatorId: Number(row.operator_id),
    capacity: row.capacity,
    verificationStatus: row.verification_status as OperatorStatus,
    availabilityMode: row.availability_mode as import("@smartpark/shared").AvailabilityMode,
    isActive: row.is_active,
    isDemo: row.is_demo,
    pricing: row.pricing,
    approvedBy: row.approved_by === null ? null : Number(row.approved_by),
    approvedAt: row.approved_at === null ? null : row.approved_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const FACILITY_SELECT_COLUMNS = `
  id, parking_id, name, description, type, country, state, city, area, address,
  latitude, longitude, operator_id, capacity, verification_status,
  availability_mode, is_active, is_demo, pricing, approved_by, approved_at,
  created_at, updated_at`;

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
   * is missing, soft-deleted, or no longer in `fromStatus`. Runs on the given
   * client when supplied so the transition joins a caller's transaction.
   */
  async updateVerificationStatus(
    id: number,
    input: {
      status: OperatorStatus;
      fromStatus: OperatorStatus;
      approvedBy?: number | null;
      approvedAt?: Date | null;
    },
    client?: PoolClient,
  ): Promise<OperatorRow | undefined> {
    const target = client ?? getPool();
    const { rows } = await target.query<OperatorResult>(
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

  // ── Facility control (Phase 8, Part 3) ──────────────────────────────────

  /** Facilities filtered by verification status, oldest first. */
  async listFacilitiesByStatus(status: OperatorStatus): Promise<FacilityRow[]> {
    const { rows } = await getPool().query<FacilityResult>(
      `SELECT ${FACILITY_SELECT_COLUMNS}
       FROM parking_facilities
       WHERE verification_status = $1 AND deleted_at IS NULL
       ORDER BY id ASC`,
      [status],
    );
    return rows.map(mapFacilityAdmin);
  },

  /**
   * Guarded facility verification-status transition. Conditional UPDATE with
   * `WHERE verification_status = fromStatus` ensures atomicity against
   * concurrent conflicting transitions (returns undefined on conflict).
   *
   * Approval records the acting admin in approved_by/approved_at.
   * Transitions to non-verified states clear approved_by/approved_at.
   */
  async updateFacilityVerificationStatus(
    id: number,
    input: {
      status: OperatorStatus;
      fromStatus: OperatorStatus;
      approvedBy?: number | null;
      approvedAt?: Date | null;
      clearApproval?: boolean;
    },
    client?: PoolClient,
  ): Promise<FacilityRow | undefined> {
    const setApprovedBy = input.clearApproval
      ? "NULL"
      : "CASE WHEN $3::bigint IS NULL THEN approved_by ELSE $3 END";
    const setApprovedAt = input.clearApproval
      ? "NULL"
      : "CASE WHEN $4::timestamptz IS NULL THEN approved_at ELSE $4 END";
    const params =
      input.clearApproval === true
        ? [id, input.status, input.fromStatus]
        : [id, input.status, input.approvedBy ?? null, input.approvedAt ?? null, input.fromStatus];
    const fromStatusRef = input.clearApproval === true ? "$3" : "$5";

    const target = client ?? getPool();
    const { rows } = await target.query<FacilityResult>(
      `UPDATE parking_facilities
       SET verification_status = $2,
           ${setApprovedBy.startsWith("NULL") ? "approved_by = NULL," : "approved_by = " + setApprovedBy + ","}
           ${setApprovedAt.startsWith("NULL") ? "approved_at = NULL," : "approved_at = " + setApprovedAt + ","}
           updated_at = now()
       WHERE id = $1 AND verification_status = ${fromStatusRef} AND deleted_at IS NULL
       RETURNING ${FACILITY_SELECT_COLUMNS}`,
      params,
    );
    return rows[0] ? mapFacilityAdmin(rows[0]) : undefined;
  },

  /**
   * Guarded facility active/inactive toggle. Only allowed for VERIFIED
   * facilities. Conditional UPDATE with `WHERE is_active = currentActive`
   * returns undefined on concurrent conflict.
   */
  async updateFacilityActiveStatus(
    id: number,
    active: boolean,
    client?: PoolClient,
  ): Promise<FacilityRow | undefined> {
    const target = client ?? getPool();
    const { rows } = await target.query<FacilityResult>(
      `UPDATE parking_facilities
       SET is_active = $2, updated_at = now()
       WHERE id = $1 AND is_active = $3
         AND verification_status = 'VERIFIED'
         AND deleted_at IS NULL
       RETURNING ${FACILITY_SELECT_COLUMNS}`,
      [id, active, !active],
    );
    return rows[0] ? mapFacilityAdmin(rows[0]) : undefined;
  },
};
