import {
  OPERATOR_STATUSES,
  type Operator,
  type OperatorStatus,
  type ParkingFacility,
} from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import { isFacility } from "./operators";

/** Wire shape of GET /api/v1/admin/operators (docs/API_SPEC.md §2 admin). */
export interface AdminOperatorListResponse {
  operators: Operator[];
}

/** Wire shape of GET /api/v1/admin/facilities (docs/API_SPEC.md §2 admin). */
export interface AdminFacilityListResponse {
  facilities: ParkingFacility[];
}

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

function isAdminOperatorListResponse(value: unknown): value is AdminOperatorListResponse {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { operators?: unknown }).operators) &&
    (value as { operators: unknown[] }).operators.every(isOperator)
  );
}

function isAdminFacilityListResponse(value: unknown): value is AdminFacilityListResponse {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { facilities?: unknown }).facilities) &&
    (value as { facilities: unknown[] }).facilities.every(isFacility)
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
    throw new AuthApiError("Unable to reach the admin service.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthApiError("The admin response was not valid JSON.", response.status);
  }

  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const message =
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Admin request failed.";
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    throw new AuthApiError(message, response.status, code);
  }

  return body;
}

function assertOperatorId(operatorId: number): void {
  if (typeof operatorId !== "number" || !Number.isInteger(operatorId) || operatorId <= 0) {
    throw new AuthApiError("Invalid operator id.");
  }
}

async function transitionOperator(
  accessToken: string,
  operatorId: number,
  action: "review" | "approve" | "reject",
): Promise<Operator> {
  assertOperatorId(operatorId);
  const body = await request(
    `/admin/operators/${encodeURIComponent(operatorId)}/${action}`,
    accessToken,
    { method: "POST" },
  );
  if (!isOperator(body)) {
    throw new AuthApiError(`The operator ${action} response was incomplete or malformed.`);
  }
  return body;
}

/** GET /api/v1/admin/operators?status=… — filtered operator list, oldest first. */
export async function listAdminOperators(
  accessToken: string,
  status: OperatorStatus = "PENDING",
): Promise<Operator[]> {
  const body = await request(`/admin/operators?${new URLSearchParams({ status })}`, accessToken);
  if (!isAdminOperatorListResponse(body)) {
    throw new AuthApiError("The admin operators response was incomplete or malformed.");
  }
  return body.operators;
}

/** POST /api/v1/admin/operators/:id/review — PENDING → UNDER_REVIEW. */
export function reviewOperator(accessToken: string, operatorId: number): Promise<Operator> {
  return transitionOperator(accessToken, operatorId, "review");
}

/** POST /api/v1/admin/operators/:id/approve — UNDER_REVIEW → VERIFIED. */
export function approveOperator(accessToken: string, operatorId: number): Promise<Operator> {
  return transitionOperator(accessToken, operatorId, "approve");
}

/** POST /api/v1/admin/operators/:id/reject — UNDER_REVIEW → REJECTED. */
export function rejectOperator(accessToken: string, operatorId: number): Promise<Operator> {
  return transitionOperator(accessToken, operatorId, "reject");
}

function assertFacilityId(facilityId: number): void {
  if (typeof facilityId !== "number" || !Number.isInteger(facilityId) || facilityId <= 0) {
    throw new AuthApiError("Invalid facility id.");
  }
}

type FacilityTransition = "review" | "approve" | "reject" | "activate" | "deactivate";

async function transitionFacility(
  accessToken: string,
  facilityId: number,
  action: FacilityTransition,
): Promise<ParkingFacility> {
  assertFacilityId(facilityId);
  const body = await request(
    `/admin/facilities/${encodeURIComponent(facilityId)}/${action}`,
    accessToken,
    { method: "POST" },
  );
  if (!isFacility(body)) {
    throw new AuthApiError(`The facility ${action} response was incomplete or malformed.`);
  }
  return body;
}

/** GET /api/v1/admin/facilities?status=… — filtered facility list, oldest first. */
export async function listAdminFacilities(
  accessToken: string,
  status: OperatorStatus = "PENDING",
): Promise<ParkingFacility[]> {
  const body = await request(`/admin/facilities?${new URLSearchParams({ status })}`, accessToken);
  if (!isAdminFacilityListResponse(body)) {
    throw new AuthApiError("The admin facilities response was incomplete or malformed.");
  }
  return body.facilities;
}

/** POST /api/v1/admin/facilities/:id/review — PENDING → UNDER_REVIEW. */
export function reviewFacility(accessToken: string, facilityId: number): Promise<ParkingFacility> {
  return transitionFacility(accessToken, facilityId, "review");
}

/** POST /api/v1/admin/facilities/:id/approve — UNDER_REVIEW → VERIFIED. */
export function approveFacility(accessToken: string, facilityId: number): Promise<ParkingFacility> {
  return transitionFacility(accessToken, facilityId, "approve");
}

/** POST /api/v1/admin/facilities/:id/reject — UNDER_REVIEW → REJECTED. */
export function rejectFacility(accessToken: string, facilityId: number): Promise<ParkingFacility> {
  return transitionFacility(accessToken, facilityId, "reject");
}

/** POST /api/v1/admin/facilities/:id/activate — VERIFIED → active. */
export function activateFacility(
  accessToken: string,
  facilityId: number,
): Promise<ParkingFacility> {
  return transitionFacility(accessToken, facilityId, "activate");
}

/** POST /api/v1/admin/facilities/:id/deactivate — VERIFIED → inactive. */
export function deactivateFacility(
  accessToken: string,
  facilityId: number,
): Promise<ParkingFacility> {
  return transitionFacility(accessToken, facilityId, "deactivate");
}
