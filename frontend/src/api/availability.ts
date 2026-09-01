import {
  AVAILABILITY_CONFIDENCES,
  AVAILABILITY_SOURCES,
  PARKING_SLOT_STATUSES,
  type FacilityAvailabilityResponse,
} from "@smartpark/shared";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1"
).replace(/\/$/, "");

export class AvailabilityApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AvailabilityApiError";
    this.status = status;
  }
}

function isAvailabilityResponse(value: unknown): value is FacilityAvailabilityResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<FacilityAvailabilityResponse>;
  if (
    typeof response.facilityId !== "string" ||
    typeof response.totalSlots !== "number" ||
    typeof response.availableSlots !== "number" ||
    typeof response.isLive !== "boolean" ||
    !Array.isArray(response.sources) ||
    !response.sources.every((source) => AVAILABILITY_SOURCES.includes(source)) ||
    typeof response.lastUpdatedAt !== "string" ||
    !response.confidence ||
    !AVAILABILITY_CONFIDENCES.includes(response.confidence) ||
    typeof response.disclaimer !== "string" ||
    !Array.isArray(response.slots)
  ) {
    return false;
  }

  return response.slots.every(
    (slot) =>
      slot &&
      typeof slot === "object" &&
      typeof slot.id === "number" &&
      typeof slot.slotCode === "string" &&
      typeof slot.facilityId === "number" &&
      (slot.zoneId === null || typeof slot.zoneId === "number") &&
      typeof slot.vehicleType === "string" &&
      PARKING_SLOT_STATUSES.includes(slot.status) &&
      typeof slot.reservationsEnabled === "boolean" &&
      typeof slot.createdAt === "string" &&
      typeof slot.updatedAt === "string",
  );
}

export async function fetchFacilityAvailability(
  facilityId: string,
): Promise<FacilityAvailabilityResponse> {
  const response = await fetch(
    `${API_BASE_URL}/parking/${encodeURIComponent(facilityId)}/availability`,
    {
      headers: { Accept: "application/json" },
    },
  );

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AvailabilityApiError(
      "The availability response was not valid JSON.",
      response.status,
    );
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
        : "Unable to load availability for this facility.";
    throw new AvailabilityApiError(message, response.status);
  }

  if (!isAvailabilityResponse(body)) {
    throw new AvailabilityApiError(
      "The availability response was incomplete or malformed.",
      response.status,
    );
  }

  return body;
}
