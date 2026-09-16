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
import { forbidden, notFound, conflict } from "../../http/errors.js";
import { withTransaction } from "../../db.js";
import { assertVerifiedOperator } from "../operators/operator-verification.js";
import { facilitiesRepository } from "./facilities.repository.js";
import { slotsRepository, toSlotDto } from "./slots.repository.js";
import { hasActiveSessionForSlot } from "../sessions/sessions.repository.js";
import { auditService } from "../audit/audit.service.js";

export const slotsService = {
  async createSlot(
    userId: number,
    facilityId: number,
    input: CreateSlotRequest,
  ): Promise<ParkingSlot> {
    await this.assertFacilityOwnership(userId, facilityId);
    return withTransaction(async (client) => {
      const slot = await slotsRepository.create(
        {
          slotCode: input.slotCode.trim().toUpperCase(),
          facilityId,
          status: input.status ?? "AVAILABLE",
          vehicleType: input.vehicleType?.trim() || "car",
          reservationsEnabled: input.reservationsEnabled ?? true,
        },
        client,
      );
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "SLOT_CREATED",
        entityType: "SLOT",
        entityId: slot.id,
        metadata: { facilityId, slotCode: slot.slotCode },
      });
      return toSlotDto(slot);
    });
  },

  async listSlots(userId: number, facilityId: number): Promise<ParkingSlot[]> {
    await this.assertFacilityOwnership(userId, facilityId);
    const slots = await slotsRepository.listByFacility(facilityId);
    return slots.map(toSlotDto);
  },

  async updateSlot(userId: number, slotId: number, input: UpdateSlotRequest): Promise<ParkingSlot> {
    const operator = await assertVerifiedOperator(userId);
    return withTransaction(async (client) => {
      // The row lock serializes against the guarded occupancy UPDATE the
      // entry transaction runs: an operator cannot observe a pre-entry slot
      // and then free it while the entry commits underneath (docs/SECURITY.md
      // §5 — manual occupancy guard).
      const slot = await slotsRepository.findByIdForUpdate(client, slotId);
      if (!slot) {
        throw notFound("SLOT_NOT_FOUND", "Parking slot not found");
      }
      const facility = await facilitiesRepository.findById(slot.facilityId);
      if (!facility || facility.operatorId !== operator.id) {
        throw forbidden("FORBIDDEN", "This slot belongs to a different operator");
      }

      // Manual occupancy guard: a slot that is backing an ACTIVE parking
      // session (the occupancy source of truth is parking_slots.status, and
      // entry sets it to OCCUPIED) must not be flipped away from OCCUPIED by
      // hand. The slot row lock above serializes against the entry
      // transaction's guarded occupy UPDATE, so the decision is race-free:
      // whichever side acquires the row lock first, the other observes the
      // committed outcome (entry aborts with SLOT_UNAVAILABLE, or the manual
      // change is rejected with SLOT_IN_USE).
      if (input.status !== undefined && input.status !== "OCCUPIED") {
        if (await hasActiveSessionForSlot(client, slotId)) {
          throw conflict("SLOT_IN_USE", "This slot is occupied by an active parking session");
        }
      }

      const updated = await slotsRepository.update(
        slotId,
        {
          vehicleType: input.vehicleType?.trim(),
          status: input.status,
          reservationsEnabled: input.reservationsEnabled,
        },
        client,
      );
      if (!updated) {
        throw notFound("SLOT_NOT_CHANGED", "Nothing to update");
      }
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "SLOT_UPDATED",
        entityType: "SLOT",
        entityId: slotId,
        metadata: { facilityId: slot.facilityId, updatedFields: Object.keys(input) },
      });
      return toSlotDto(updated);
    });
  },

  /** Ensures the caller's operator org is VERIFIED and owns the given facility. */
  async assertFacilityOwnership(userId: number, facilityId: number): Promise<void> {
    const operator = await assertVerifiedOperator(userId);
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
