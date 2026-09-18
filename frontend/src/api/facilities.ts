import {
  AVAILABILITY_CONFIDENCES,
  FACILITY_TYPES,
  type PublicFacilityListResponse,
  type PublicParkingFacility,
} from "@smartpark/shared";
import { API_BASE_URL } from "./auth";

export { API_BASE_URL } from "./auth";

export class FacilitiesApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "FacilitiesApiError";
    this.status = status;
  }
}

function isPublicParkingFacility(value: unknown): value is PublicParkingFacility {
  if (!value || typeof value !== "object") return false;
  const facility = value as Partial<PublicParkingFacility>;
  return (
    typeof facility.id === "number" &&
    typeof facility.parkingId === "string" &&
    typeof facility.name === "string" &&
    (facility.description === null || typeof facility.description === "string") &&
    typeof facility.type === "string" &&
    FACILITY_TYPES.includes(facility.type) &&
    typeof facility.city === "string" &&
    (facility.state === null || typeof facility.state === "string") &&
    (facility.area === null || typeof facility.area === "string") &&
    (facility.address === null || typeof facility.address === "string") &&
    typeof facility.capacity === "number" &&
    typeof facility.hourlyRate === "number" &&
    facility.hourlyRate > 0 &&
    typeof facility.totalSlots === "number" &&
    typeof facility.availableSlots === "number" &&
    Array.isArray(facility.availableVehicleTypes) &&
    facility.availableVehicleTypes.every((t) => typeof t === "string") &&
    typeof facility.isLive === "boolean" &&
    typeof facility.confidence === "string" &&
    AVAILABILITY_CONFIDENCES.includes(facility.confidence) &&
    typeof facility.lastUpdatedAt === "string"
  );
}

function isPublicFacilityListResponse(value: unknown): value is PublicFacilityListResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as Partial<PublicFacilityListResponse>).facilities) &&
    (value as Partial<PublicFacilityListResponse>).facilities!.every(isPublicParkingFacility),
  );
}

export async function fetchPublicFacilities(): Promise<PublicFacilityListResponse> {
  const response = await fetch(`${API_BASE_URL}/parking/facilities`, {
    headers: { Accept: "application/json" },
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FacilitiesApiError("The facilities response was not valid JSON.", response.status);
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "Unable to load parking facilities.";
    throw new FacilitiesApiError(message, response.status);
  }

  if (!isPublicFacilityListResponse(body)) {
    throw new FacilitiesApiError(
      "The facilities response was incomplete or malformed.",
      response.status,
    );
  }

  return body;
}
