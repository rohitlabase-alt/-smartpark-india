/**
 * Parking zone application logic (docs/API_SPEC.md §2 operators / facilities,
 * Phase 10 society parking). Ownership is enforced server-side
 * (docs/SECURITY.md §5, IDOR resistance): an operator can only manage zones of
 * facilities they own, and a zone id outside the caller's facility surfaces as
 * a 404 (no existence disclosure). Deletes carry a hard guard against a zone
 * that still has assigned slots (409 ZONE_IN_USE).
 */
import type { CreateZoneRequest, ParkingZone, UpdateZoneRequest } from "@smartpark/shared";
import { conflict, notFound } from "../../http/errors.js";
import { withTransaction } from "../../db.js";
import { slotsService } from "./slots.service.js";
import { zonesRepository, toZoneDto } from "./zones.repository.js";
import { auditService } from "../audit/audit.service.js";

async function assertFacilityOwnership(userId: number, facilityId: number): Promise<void> {
  await slotsService.assertFacilityOwnership(userId, facilityId);
}

export const zonesService = {
  async createZone(
    userId: number,
    facilityId: number,
    input: CreateZoneRequest,
  ): Promise<ParkingZone> {
    await assertFacilityOwnership(userId, facilityId);
    return withTransaction(async (client) => {
      const zone = await zonesRepository.create(
        {
          facilityId,
          name: input.name.trim(),
          kind: input.kind?.trim() || "car",
        },
        client,
      );
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "ZONE_CREATED",
        entityType: "PARKING_ZONE",
        entityId: zone.id,
        metadata: { facilityId, zoneName: zone.name },
      });
      return toZoneDto(zone);
    });
  },

  async listZones(userId: number, facilityId: number): Promise<ParkingZone[]> {
    await assertFacilityOwnership(userId, facilityId);
    const zones = await zonesRepository.listByFacility(facilityId);
    return zones.map(toZoneDto);
  },

  async updateZone(
    userId: number,
    facilityId: number,
    zoneId: number,
    input: UpdateZoneRequest,
  ): Promise<ParkingZone> {
    await assertFacilityOwnership(userId, facilityId);
    await this.assertZoneInFacility(facilityId, zoneId);
    return withTransaction(async (client) => {
      const updated = await zonesRepository.update(
        zoneId,
        {
          name: input.name?.trim(),
          kind: input.kind?.trim(),
          isActive: input.isActive,
        },
        client,
      );
      if (!updated) {
        throw notFound("ZONE_NOT_CHANGED", "Nothing to update");
      }
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "ZONE_UPDATED",
        entityType: "PARKING_ZONE",
        entityId: zoneId,
        metadata: { facilityId, updatedFields: Object.keys(input) },
      });
      return toZoneDto(updated);
    });
  },

  async deleteZone(userId: number, facilityId: number, zoneId: number): Promise<void> {
    await assertFacilityOwnership(userId, facilityId);
    await this.assertZoneInFacility(facilityId, zoneId);
    return withTransaction(async (client) => {
      // A zone with assigned slots cannot be deleted (security: slots would be
      // silently detached and availability/booking semantics would drift).
      // This guard runs on the SAME tx client as the delete below, so it sees
      // the same snapshot (no TOCTOU window with the pool connection); and the
      // FK added by migration 0012 (ON DELETE RESTRICT) backstops it — if a
      // slot is reassigned/inserted between the count and the DELETE, Postgres
      // still refuses the delete with a 23503, which we map back to the same
      // ZONE_IN_USE conflict instead of letting a zone disappear under rows.
      if ((await zonesRepository.countSlotsInZone(zoneId, client)) > 0) {
        throw conflict("ZONE_IN_USE", "This zone still has parking slots assigned");
      }
      let deleted: boolean;
      try {
        deleted = await zonesRepository.delete(zoneId, client);
      } catch (err) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "23503") {
          // A slot was attached to this zone on another connection after our
          // guard ran. The DB refused the DELETE (RESTRICT); surface the exact
          // same API contract rather than a 500.
          throw conflict("ZONE_IN_USE", "This zone still has parking slots assigned");
        }
        throw err;
      }
      if (!deleted) {
        throw notFound("ZONE_NOT_FOUND", "Parking zone not found");
      }
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "ZONE_DELETED",
        entityType: "PARKING_ZONE",
        entityId: zoneId,
        metadata: { facilityId },
      });
    });
  },

  /**
   * Resolves a zone and verifies it belongs to the given facility. A miss or a
   * cross-facility zone surfaces as 404 so outside facilities are never
   * disclosed (docs/SECURITY.md §5).
   */
  async assertZoneInFacility(facilityId: number, zoneId: number): Promise<void> {
    const zone = await zonesRepository.findById(zoneId);
    if (!zone || zone.facilityId !== facilityId) {
      throw notFound("ZONE_NOT_FOUND", "Parking zone not found");
    }
  },
};
