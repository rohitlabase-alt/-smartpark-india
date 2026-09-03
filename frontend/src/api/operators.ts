import {
  OPERATOR_STATUSES,
  PARKING_SLOT_STATUSES,
  type CreateFacilityRequest,
  type CreateSlotRequest,
  type Operator,
  type OperatorRegisterRequest,
  type ParkingFacility,
  type ParkingSlot,
  type UpdateFacilityRequest,
  type UpdateSlotRequest,
} from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";

function isOperator(value: unknown): value is Operator {
  if (!value || typeof value !== "object") return false;
  const operator = value as Partial<Operator>;
  return (
    typeof operator.id === "number" &&
    Number.isFinite(operator.id) &&
    typeof operator.name === "string" &&
    (operator.businessType === null || typeof operator.businessType === "string") &&
    (operator.registrationNumber === null || typeof operator.registrationNumber === "string") &&
    typeof operator.verificationStatus === "string" &&
    OPERATOR_STATUSES.includes(operator.verificationStatus) &&
    typeof operator.createdAt === "string"
  );
}

function isFacility(value: unknown): value is ParkingFacility {
  if (!value || typeof value !== "object") return false;
  const facility = value as Partial<ParkingFacility>;
  return (
    typeof facility.id === "number" &&
    Number.isFinite(facility.id) &&
    typeof facility.parkingId === "string" &&
    typeof facility.name === "string" &&
    (facility.description === null || typeof facility.description === "string") &&
    typeof facility.type === "string" &&
    typeof facility.country === "string" &&
    (facility.state === null || typeof facility.state === "string") &&
    typeof facility.city === "string" &&
    (facility.area === null || typeof facility.area === "string") &&
    (facility.address === null || typeof facility.address === "string") &&
    (facility.latitude === null || typeof facility.latitude === "number") &&
    (facility.longitude === null || typeof facility.longitude === "number") &&
    typeof facility.operatorId === "number" &&
    Number.isFinite(facility.operatorId) &&
    typeof facility.capacity === "number" &&
    Number.isFinite(facility.capacity) &&
    typeof facility.verificationStatus === "string" &&
    OPERATOR_STATUSES.includes(facility.verificationStatus) &&
    (facility.availabilityMode === "MANUAL" ||
      facility.availabilityMode === "API" ||
      facility.availabilityMode === "IOT") &&
    typeof facility.isActive === "boolean" &&
    typeof facility.isDemo === "boolean" &&
    typeof facility.createdAt === "string" &&
    typeof facility.updatedAt === "string"
  );
}

function isSlot(value: unknown): value is ParkingSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<ParkingSlot>;
  return (
    typeof slot.id === "number" &&
    Number.isFinite(slot.id) &&
    typeof slot.slotCode === "string" &&
    typeof slot.facilityId === "number" &&
    Number.isFinite(slot.facilityId) &&
    (slot.zoneId === null || typeof slot.zoneId === "number") &&
    typeof slot.vehicleType === "string" &&
    typeof slot.status === "string" &&
    PARKING_SLOT_STATUSES.includes(slot.status) &&
    typeof slot.reservationsEnabled === "boolean" &&
    typeof slot.createdAt === "string" &&
    typeof slot.updatedAt === "string"
  );
}

async function request(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new AuthApiError("Unable to reach the operator service.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthApiError("The operator response was not valid JSON.", response.status);
  }

  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const message =
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Operator request failed.";
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    throw new AuthApiError(message, response.status, code);
  }

  return body;
}

export async function registerOperator(
  accessToken: string,
  input: OperatorRegisterRequest,
): Promise<Operator> {
  const body = await request("/operators/register", accessToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isOperator(body)) {
    throw new AuthApiError("The operator registration response was incomplete or malformed.");
  }
  return body;
}

export async function createOperatorFacility(
  accessToken: string,
  input: CreateFacilityRequest,
): Promise<ParkingFacility> {
  const body = await request("/operators/me/facilities", accessToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isFacility(body)) {
    throw new AuthApiError("The facility response was incomplete or malformed.");
  }
  return body;
}

export async function updateOperatorFacility(
  accessToken: string,
  facilityId: number,
  input: UpdateFacilityRequest,
): Promise<ParkingFacility> {
  const body = await request(
    `/operators/me/facilities/${encodeURIComponent(facilityId)}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  if (!isFacility(body)) {
    throw new AuthApiError("The facility response was incomplete or malformed.");
  }
  return body;
}

export async function createOperatorSlot(
  accessToken: string,
  facilityId: number,
  input: CreateSlotRequest,
): Promise<ParkingSlot> {
  const body = await request(
    `/operators/me/facilities/${encodeURIComponent(facilityId)}/slots`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  if (!isSlot(body)) {
    throw new AuthApiError("The slot response was incomplete or malformed.");
  }
  return body;
}

export async function updateOperatorSlot(
  accessToken: string,
  facilityId: number,
  slotId: number,
  input: UpdateSlotRequest,
): Promise<ParkingSlot> {
  const body = await request(
    `/operators/me/facilities/${encodeURIComponent(facilityId)}/slots/${encodeURIComponent(slotId)}`,
    accessToken,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  if (!isSlot(body)) {
    throw new AuthApiError("The slot response was incomplete or malformed.");
  }
  return body;
}

export async function getOperatorMe(accessToken: string): Promise<Operator> {
  const body = await request("/operators/me", accessToken);
  if (!isOperator(body)) {
    throw new AuthApiError("The operator response was incomplete or malformed.");
  }
  return body;
}

export async function getOperatorFacilities(accessToken: string): Promise<ParkingFacility[]> {
  const body = await request("/operators/me/facilities", accessToken);
  if (!Array.isArray(body) || !body.every(isFacility)) {
    throw new AuthApiError("The facilities response was incomplete or malformed.");
  }
  return body;
}

export async function getOperatorFacilitySlots(
  accessToken: string,
  facilityId: number,
): Promise<ParkingSlot[]> {
  const body = await request(
    `/operators/me/facilities/${encodeURIComponent(facilityId)}/slots`,
    accessToken,
  );
  if (!Array.isArray(body) || !body.every(isSlot)) {
    throw new AuthApiError("The facility slots response was incomplete or malformed.");
  }
  return body;
}
