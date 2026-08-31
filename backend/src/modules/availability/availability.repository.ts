/**
 * SQL data access for the public availability read (docs/API_SPEC.md §3).
 */
import type { FacilityRow } from "../parking/facilities.repository.js";
import {
  countAvailabilityByFacility,
  listActiveSlotsByFacility,
  SlotRow,
} from "../parking/slots.repository.js";

export interface FacilityAvailabilityData {
  facility: FacilityRow;
  slots: SlotRow[];
  counts: Record<"AVAILABLE" | "OCCUPIED" | "RESERVED" | "UNKNOWN", number>;
  lastUpdatedAt: Date | null;
}

/**
 * Loads everything needed to build the public availability response for a
 * single eligible facility (active + not soft-deleted).
 */
export async function loadFacilityAvailability(
  facility: FacilityRow,
): Promise<FacilityAvailabilityData> {
  const [slots, { counts, lastUpdatedAt }] = await Promise.all([
    listActiveSlotsByFacility(facility.id),
    countAvailabilityByFacility(facility.id),
  ]);
  return { facility, slots, counts, lastUpdatedAt };
}

export type { SlotRow };
