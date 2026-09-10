import { OPERATOR_STATUSES, type Operator, type OperatorStatus } from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";

/** Wire shape of GET /api/v1/admin/operators (docs/API_SPEC.md §2 admin). */
export interface AdminOperatorListResponse {
  operators: Operator[];
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
