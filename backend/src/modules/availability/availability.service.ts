/**
 * Public availability application logic (docs/API_SPEC.md §3).
 * Deterministic from database state — no predictive availability.
 */
import type { FacilityAvailabilityResponse } from "@smartpark/shared";
import { notFound } from "../../http/errors.js";
import { facilitiesRepository } from "../parking/facilities.repository.js";
import { loadFacilityAvailability } from "./availability.repository.js";

const DISCLAIMER = "Operator-reported availability. Not guaranteed.";

/**
 * Derived confidence: manual source always reports HIGH (a human set it).
 * A real freshness-window policy for multiple sources lands with the
 * availability engine phase; Phase 2B keeps `isLive` tied to having data.
 */
function deriveConfidence(hasData: boolean): "HIGH" | "LOW" {
  return hasData ? "HIGH" : "LOW";
}

export const availabilityService = {
  /**
   * Public availability for a single facility. Only ACTIVE, non-soft-deleted
   * facilities are served (docs/API_SPEC.md: search only returns active
   * facilities; detail follows the same honesty rule).
   */
  async getFacilityAvailability(facilityIdExpr: string): Promise<FacilityAvailabilityResponse> {
    const facilityId = Number(facilityIdExpr);
    if (!Number.isInteger(facilityId) || facilityId <= 0) {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }
    const facility = await facilitiesRepository.findById(facilityId);
    if (!facility || !facility.isActive) {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }

    const data = await loadFacilityAvailability(facility);
    const hasData = data.lastUpdatedAt !== null;
    const confidence = deriveConfidence(hasData);

    return {
      facilityId: facility.parkingId,
      totalSlots: data.slots.length,
      availableSlots: data.counts.AVAILABLE,
      isLive: hasData && confidence === "HIGH",
      sources: hasData ? ["MANUAL"] : [],
      lastUpdatedAt: data.lastUpdatedAt
        ? data.lastUpdatedAt.toISOString()
        : new Date(0).toISOString(),
      confidence,
      disclaimer: DISCLAIMER,
      slots: data.slots.map((s) => ({
        id: s.id,
        slotCode: s.slotCode,
        facilityId: s.facilityId,
        zoneId: s.zoneId,
        vehicleType: s.vehicleType,
        status: s.status,
        reservationsEnabled: s.reservationsEnabled,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
  },
};
