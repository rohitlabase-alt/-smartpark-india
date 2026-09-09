import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type InitiatePaymentResponse,
  type Payment,
  type VerifyPaymentResponse,
} from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import { isReservation } from "./reservations";

function isPayment(value: unknown): value is Payment {
  if (!value || typeof value !== "object") return false;
  const payment = value as Partial<Payment>;
  return (
    typeof payment.id === "number" &&
    Number.isFinite(payment.id) &&
    typeof payment.reservationId === "number" &&
    Number.isFinite(payment.reservationId) &&
    typeof payment.provider === "string" &&
    PAYMENT_PROVIDERS.includes(payment.provider as Payment["provider"]) &&
    (payment.providerTxnId === null || typeof payment.providerTxnId === "string") &&
    typeof payment.amount === "number" &&
    Number.isFinite(payment.amount) &&
    typeof payment.status === "string" &&
    PAYMENT_STATUSES.includes(payment.status as Payment["status"]) &&
    typeof payment.createdAt === "string" &&
    typeof payment.updatedAt === "string"
  );
}

function isInitiatePaymentResponse(value: unknown): value is InitiatePaymentResponse {
  return (
    !!value && typeof value === "object" && isPayment((value as { payment?: unknown }).payment)
  );
}

function isVerifyPaymentResponse(value: unknown): value is VerifyPaymentResponse {
  return (
    !!value &&
    typeof value === "object" &&
    isPayment((value as { payment?: unknown }).payment) &&
    isReservation((value as { reservation?: unknown }).reservation)
  );
}

async function requestJson(
  path: string,
  options: RequestInit,
  networkErrorMessage: string,
  apiErrorMessage: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new AuthApiError(networkErrorMessage);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthApiError("The payment response was not valid JSON.", response.status);
  }

  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const message =
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : apiErrorMessage;
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    throw new AuthApiError(message, response.status, code);
  }

  return body;
}

export async function initiatePayment(
  accessToken: string,
  reservationCode: string,
  idempotencyKey?: string,
): Promise<InitiatePaymentResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const body = await requestJson(
    "/payments/initiate",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ reservationCode }),
    },
    "Unable to reach the payments service.",
    "Unable to initiate payment.",
  );

  if (!isInitiatePaymentResponse(body)) {
    throw new AuthApiError("The payment initiation response was incomplete or malformed.");
  }

  return body;
}

export async function verifyPayment(
  accessToken: string,
  providerTxnId: string,
): Promise<VerifyPaymentResponse> {
  const body = await requestJson(
    `/payments/${encodeURIComponent(providerTxnId)}/verify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    "Unable to reach the payments service.",
    "Unable to verify payment.",
  );

  if (!isVerifyPaymentResponse(body)) {
    throw new AuthApiError("The payment verification response was incomplete or malformed.");
  }

  return body;
}
