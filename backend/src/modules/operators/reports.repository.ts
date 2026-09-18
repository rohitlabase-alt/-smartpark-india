/**
 * SQL data access for operator occupancy reports (Phase 9 Block B;
 * docs/API_SPEC.md §2 operators). Read-only aggregate counts scoped in SQL to
 * the authenticated operator's own facilities — the client never supplies a
 * facility or operator id (docs/SECURITY.md §5, IDOR resistance). No new
 * tables: every figure is derived from the existing parking_facilities /
 * parking_slots / parking_sessions rows.
 */
import { getPool } from "../../db.js";

export interface OccupancyReportPeriod {
  from?: string;
  to?: string;
}

export interface OccupancyReportTotals {
  start: string | null;
  end: string | null;
  totalFacilities: number;
  totalSlots: number;
  availableSlots: number;
  occupiedSlots: number;
  activeSessions: number;
  completedSessions: number;
  cancelledSessions: number;
}

interface OccupancyResult {
  period_start: Date | null;
  period_end: Date | null;
  total_facilities: number;
  total_slots: number;
  available_slots: number;
  occupied_slots: number;
  active_sessions: number;
  completed_sessions: number;
  cancelled_sessions: number;
}

export const reportsRepository = {
  /**
   * Single-statement occupancy rollup using idempotent scalar subqueries (the
   * platform-summary pattern). Facility/slot counts and ACTIVE sessions are
   * live snapshots; COMPLETED/CANCELLED sessions are counted by their end
   * (`exit_at`) within the optional period bounds. When a bound is omitted the
   * report falls back to the observed min entry_at / max exit_at so the period
   * is always meaningful. Session subqueries share one soft-deleted-facility
   * join, so a deleted facility (and its sessions) is excluded everywhere.
   */
  async occupancy(
    operatorId: number,
    period: OccupancyReportPeriod,
  ): Promise<OccupancyReportTotals> {
    const params: unknown[] = [operatorId];
    let periodSql = "";
    if (period.from !== undefined) {
      params.push(period.from);
      periodSql += ` AND ps.exit_at >= $${params.length}`;
    }
    if (period.to !== undefined) {
      params.push(period.to);
      periodSql += ` AND ps.exit_at <= $${params.length}`;
    }

    const { rows } = await getPool().query<OccupancyResult>(
      `SELECT
         (SELECT min(ps.entry_at) FROM parking_sessions ps
            JOIN parking_facilities f ON f.id = ps.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1) AS period_start,
         (SELECT max(coalesce(ps.exit_at, ps.entry_at)) FROM parking_sessions ps
            JOIN parking_facilities f ON f.id = ps.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1) AS period_end,
         (SELECT count(*)::int FROM parking_facilities f
            WHERE f.operator_id = $1 AND f.deleted_at IS NULL) AS total_facilities,
         (SELECT count(*)::int FROM parking_slots s
            JOIN parking_facilities f ON f.id = s.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1 AND s.deleted_at IS NULL) AS total_slots,
         (SELECT count(*)::int FROM parking_slots s
            JOIN parking_facilities f ON f.id = s.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1 AND s.deleted_at IS NULL AND s.status = 'AVAILABLE') AS available_slots,
         (SELECT count(*)::int FROM parking_slots s
            JOIN parking_facilities f ON f.id = s.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1 AND s.deleted_at IS NULL AND s.status = 'OCCUPIED') AS occupied_slots,
         (SELECT count(*)::int FROM parking_sessions ps
            JOIN parking_facilities f ON f.id = ps.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1 AND ps.status = 'ACTIVE') AS active_sessions,
         (SELECT count(*)::int FROM parking_sessions ps
            JOIN parking_facilities f ON f.id = ps.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1 AND ps.status = 'COMPLETED'${periodSql}) AS completed_sessions,
         (SELECT count(*)::int FROM parking_sessions ps
            JOIN parking_facilities f ON f.id = ps.facility_id AND f.deleted_at IS NULL
            WHERE f.operator_id = $1 AND ps.status = 'CANCELLED'${periodSql}) AS cancelled_sessions`,
      params,
    );

    const row = rows[0]!;
    return {
      start: period.from ?? (row.period_start ? row.period_start.toISOString() : null),
      end: period.to ?? (row.period_end ? row.period_end.toISOString() : null),
      totalFacilities: row.total_facilities,
      totalSlots: row.total_slots,
      availableSlots: row.available_slots,
      occupiedSlots: row.occupied_slots,
      activeSessions: row.active_sessions,
      completedSessions: row.completed_sessions,
      cancelledSessions: row.cancelled_sessions,
    };
  },
};
