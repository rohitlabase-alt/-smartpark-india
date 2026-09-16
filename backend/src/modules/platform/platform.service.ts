/**
 * Platform dashboard application logic (Phase 8, Part 4; admin-only). Produces
 * aggregate counts (no user PII) and a bounded slice of the newest audit
 * events for the admin overview. `recentAuditEvents` uses the same deterministic
 * ordering as the audit API.
 */
import {
  OPERATOR_STATUSES,
  PAYMENT_STATUSES,
  RESERVATION_STATES,
  type PlatformSummary,
} from "@smartpark/shared";
import { auditRepository, toAuditEventDto } from "../audit/audit.repository.js";
import { platformRepository, type StatusBreakdownRow } from "./platform.repository.js";

const RECENT_AUDIT_EVENTS_LIMIT = 10;

function toStatusMap(
  vocabulary: readonly string[],
  rows: StatusBreakdownRow[],
): Record<string, number> {
  const map: Record<string, number> = Object.fromEntries(vocabulary.map((status) => [status, 0]));
  for (const row of rows) {
    if (row.status in map) map[row.status] = row.count;
  }
  return map;
}

export const platformService = {
  async summary(): Promise<PlatformSummary> {
    const [
      counts,
      operatorsByStatus,
      facilitiesByStatus,
      reservationsByStatus,
      paymentsByStatus,
      recentAuditEventCount,
      recentAudit,
    ] = await Promise.all([
      platformRepository.counts(),
      platformRepository.operatorStatusBreakdown(),
      platformRepository.facilityStatusBreakdown(),
      platformRepository.reservationStateBreakdown(),
      platformRepository.paymentStatusBreakdown(),
      auditRepository.countAll(),
      auditRepository.list({ limit: RECENT_AUDIT_EVENTS_LIMIT, offset: 0 }),
    ]);

    return {
      users: counts.users,
      operators: counts.operators,
      operatorsByStatus: toStatusMap(OPERATOR_STATUSES, operatorsByStatus),
      facilities: counts.facilities,
      facilitiesByStatus: toStatusMap(OPERATOR_STATUSES, facilitiesByStatus),
      activeFacilities: counts.activeFacilities,
      inactiveFacilities: counts.inactiveFacilities,
      parkingSlots: counts.parkingSlots,
      reservations: counts.reservations,
      reservationsByStatus: toStatusMap(RESERVATION_STATES, reservationsByStatus),
      payments: counts.payments,
      paymentsByStatus: toStatusMap(PAYMENT_STATUSES, paymentsByStatus),
      recentAuditEventCount,
      recentAuditEvents: recentAudit.events.map(toAuditEventDto),
    };
  },
};
