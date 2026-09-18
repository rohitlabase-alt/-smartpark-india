/**
 * Operator occupancy report application logic (Phase 9 Block B;
 * docs/API_SPEC.md §2 operators). Read-only. Reuses the same VERIFIED-operator
 * gate as the other operational operator actions (403 OPERATOR_NOT_VERIFIED /
 * 404 OPERATOR_NOT_FOUND), and derives the scope server-side from the
 * authenticated operator — an operator can only ever read their own
 * facilities' occupancy.
 */
import type { OperatorOccupancyReport } from "@smartpark/shared";
import { assertVerifiedOperator } from "./operator-verification.js";
import { reportsRepository, type OccupancyReportPeriod } from "./reports.repository.js";

export const reportsService = {
  async getOccupancyReport(
    userId: number,
    period: OccupancyReportPeriod,
  ): Promise<OperatorOccupancyReport> {
    const operator = await assertVerifiedOperator(userId);
    return reportsRepository.occupancy(operator.id, period);
  },
};
