/**
 * Parking slot application logic (docs/API_SPEC.md §2 operators / facilities).
 * Ownership is enforced server-side (docs/SECURITY.md §5, IDOR resistance):
 * an operator can only manage slots of facilities they own.
 */
import type {
  CreateSlotRequest,
  ParkingSlot,
  ParkingSlotStatus,
  UpdateSlotRequest,
} from "@smartpark/shared";
import { forbidden, notFound } from "../../http/errors.js";
import { operatorsRepository } from "../operators/operators.repository.js";
import { facilitiesRepository } from "./facilities.repository.js";
import { slotsRepository, toSlotDto } from "./slots.repository.js";

export const slotsService = {
  async createSlot(
    userId: number,
    facilityId: number,
    input: CreateSlotRequest,
  ): Promise<ParkingSlot> {
    await this.assertFacilityOwnership(userId, facilityId);
    const slot = await slotsRepository.create({
      slotCode: input.slotCode.trim().toUpperCase(),
      facilityId,
      status: input.status ?? "AVAILABLE",
      vehicleType: input.vehicleType?.trim() || "car",
      reservationsEnabled: input.reservationsEnabled ?? true,
    });
    return toSlotDto(slot);
  },

  async listSlots(userId: number, facilityId: number): Promise<ParkingSlot[]> {
    await this.assertFacilityOwnership(userId, facilityId);
    const slots = await slotsRepository.listByFacility(facilityId);
    return slots.map(toSlotDto);
  },

  async updateSlot(userId: number, slotId: number, input: UpdateSlotRequest): Promise<ParkingSlot> {
    const operator = await operatorsRepository.findByOwnerUser(userId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
    }
    const slot = await slotsRepository.findById(slotId);
    if (!slot) {
      throw notFound("SLOT_NOT_FOUND", "Parking slot not found");
    }
    const facility = await facilitiesRepository.findById(slot.facilityId);
    if (!facility || facility.operatorId !== operator.id) {
      throw forbidden("FORBIDDEN", "This slot belongs to a different operator");
    }

    const updated = await slotsRepository.update(slotId, {
      vehicleType: input.vehicleType?.trim(),
      status: input.status,
      reservationsEnabled: input.reservationsEnabled,
    });
    if (!updated) {
      throw notFound("SLOT_NOT_CHANGED", "Nothing to update");
    }
    return toSlotDto(updated);
  },

  /** Ensures the given facility exists and belongs to the caller's operator org. */
  async assertFacilityOwnership(userId: number, facilityId: number): Promise<void> {
    const operator = await operatorsRepository.findByOwnerUser(userId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
    }
    const facility = await facilitiesRepository.findById(facilityId);
    if (!facility) {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }
    if (facility.operatorId !== operator.id) {
      throw forbidden("FORBIDDEN", "This facility belongs to a different operator");
    }
  },
};

export function isKnownSlotStatus(status: string): status is ParkingSlotStatus {
  return (
    status === "AVAILABLE" ||
    status === "RESERVED" ||
    status === "OCCUPIED" ||
    status === "OUT_OF_SERVICE" ||
    status === "MAINTENANCE" ||
    status === "UNKNOWN"
  );
}
