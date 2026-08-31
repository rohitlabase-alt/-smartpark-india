/**
 * Parking facility application logic (docs/API_SPEC.md §2 operators /
 * facilities). Ownership (docs/SECURITY.md §5: IDOR resistance) is enforced
 * server-side: a handler may only reach facilities owned by the operator of
 * the authenticated user.
 */
import type {
  CreateFacilityRequest,
  ParkingFacility,
  UpdateFacilityRequest,
} from "@smartpark/shared";
import { forbidden, notFound } from "../../http/errors.js";
import { operatorsRepository } from "../operators/operators.repository.js";
import { buildParkingId, facilitiesRepository, toFacilityDto } from "./facilities.repository.js";

export const facilitiesService = {
  async createFacility(userId: number, input: CreateFacilityRequest): Promise<ParkingFacility> {
    const operator = await operatorsRepository.findByOwnerUser(userId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
    }
    const sequence = await facilitiesRepository.nextParkingSequence();
    const facility = await facilitiesRepository.create({
      parkingId: buildParkingId(input.city, sequence),
      operatorId: operator.id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      type: input.type,
      country: "India",
      state: input.state?.trim() || null,
      city: input.city.trim(),
      area: input.area?.trim() || null,
      address: input.address?.trim() || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      capacity: input.capacity,
    });
    return toFacilityDto(facility);
  },

  async listFacilities(userId: number): Promise<ParkingFacility[]> {
    const operator = await operatorsRepository.findByOwnerUser(userId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
    }
    const facilities = await facilitiesRepository.listByOperator(operator.id);
    return facilities.map(toFacilityDto);
  },

  async updateFacility(
    userId: number,
    facilityId: number,
    input: UpdateFacilityRequest,
  ): Promise<ParkingFacility> {
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

    const updated = await facilitiesRepository.update(facilityId, {
      name: input.name?.trim(),
      description: input.description !== undefined ? input.description : undefined,
      type: input.type,
      city: input.city?.trim(),
      state: input.state !== undefined ? (input.state?.trim() ?? null) : undefined,
      area: input.area !== undefined ? (input.area?.trim() ?? null) : undefined,
      address: input.address !== undefined ? (input.address?.trim() ?? null) : undefined,
      latitude: input.latitude,
      longitude: input.longitude,
      capacity: input.capacity,
      isActive: input.isActive,
    });
    if (!updated) {
      // No updatable fields provided (empty PATCH).
      throw notFound("FACILITY_NOT_CHANGED", "Nothing to update");
    }
    return toFacilityDto(updated);
  },
};
