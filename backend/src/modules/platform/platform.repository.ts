/**
 * SQL data access for the platform dashboard (Phase 8, Part 4; admin-only).
 * Aggregate counts only — the summary deliberately exposes no user PII.
 */
import { getPool } from "../../db.js";

export interface PlatformCounts {
  users: number;
  operators: number;
  facilities: number;
  activeFacilities: number;
  inactiveFacilities: number;
  parkingSlots: number;
  activeParkingSessions: number;
  occupiedSlots: number;
  availableSlots: number;
  reservations: number;
  payments: number;
}

export interface StatusBreakdownRow {
  status: string;
  count: number;
}

export const platformRepository = {
  /** Top-level counts, each an idempotent scalar subquery. */
  async counts(): Promise<PlatformCounts> {
    const { rows } = await getPool().query<{
      users: number;
      operators: number;
      facilities: number;
      active_facilities: number;
      inactive_facilities: number;
      parking_slots: number;
      active_parking_sessions: number;
      occupied_slots: number;
      available_slots: number;
      reservations: number;
      payments: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE deleted_at IS NULL)          AS users,
         (SELECT count(*)::int FROM operators WHERE deleted_at IS NULL)      AS operators,
         (SELECT count(*)::int FROM parking_facilities WHERE deleted_at IS NULL) AS facilities,
         (SELECT count(*)::int FROM parking_facilities
            WHERE deleted_at IS NULL AND is_active)                     AS active_facilities,
         (SELECT count(*)::int FROM parking_facilities
            WHERE deleted_at IS NULL AND NOT is_active)                 AS inactive_facilities,
         (SELECT count(*)::int FROM parking_slots WHERE deleted_at IS NULL)  AS parking_slots,
         (SELECT count(*)::int FROM parking_sessions WHERE status = 'ACTIVE') AS active_parking_sessions,
         (SELECT count(*)::int FROM parking_slots
            WHERE deleted_at IS NULL AND status = 'OCCUPIED')           AS occupied_slots,
         (SELECT count(*)::int FROM parking_slots
            WHERE deleted_at IS NULL AND status = 'AVAILABLE')          AS available_slots,
         (SELECT count(*)::int FROM reservations WHERE deleted_at IS NULL)   AS reservations,
         (SELECT count(*)::int FROM payments)                           AS payments`,
    );
    const row = rows[0]!;
    return {
      users: row.users,
      operators: row.operators,
      facilities: row.facilities,
      activeFacilities: row.active_facilities,
      inactiveFacilities: row.inactive_facilities,
      parkingSlots: row.parking_slots,
      activeParkingSessions: row.active_parking_sessions,
      occupiedSlots: row.occupied_slots,
      availableSlots: row.available_slots,
      reservations: row.reservations,
      payments: row.payments,
    };
  },

  async operatorStatusBreakdown(): Promise<StatusBreakdownRow[]> {
    return this.breakdown("operators", "verification_status");
  },

  async facilityStatusBreakdown(): Promise<StatusBreakdownRow[]> {
    return this.breakdown("parking_facilities", "verification_status");
  },

  async reservationStateBreakdown(): Promise<StatusBreakdownRow[]> {
    return this.breakdown("reservations", "state");
  },

  async paymentStatusBreakdown(): Promise<StatusBreakdownRow[]> {
    return this.breakdown("payments", "status");
  },

  /**
   * Shared count-per-value query; cast keeps node-postgres BIGINT as a number.
   * `payments` predates the soft-delete convention (migration 0006) and has no
   * deleted_at column, so the filter is only applied to soft-delete tables.
   */
  async breakdown(
    table: "operators" | "parking_facilities" | "reservations" | "payments",
    column: string,
  ): Promise<StatusBreakdownRow[]> {
    const softDelete = table === "payments" ? "" : "WHERE deleted_at IS NULL";
    const { rows } = await getPool().query<{ status: string | null; count: number }>(
      `SELECT ${column} AS status, count(*)::int AS count
       FROM ${table}
       ${softDelete}
       GROUP BY ${column}
       ORDER BY count DESC, ${column} ASC`,
    );
    return rows.map((row) => ({ status: row.status ?? "UNKNOWN", count: row.count }));
  },
};
