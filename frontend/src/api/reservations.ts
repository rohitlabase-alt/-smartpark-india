import {
  RESERVATION_STATES,
  type BookingListResponse,
  type BookingResponse,
  type CreateBookingRequest,
  type Reservation,
} from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";

function isReservation(value: unknown): value is Reservation {
  if (!value || typeof value !== "object") return false;
  const reservation = value as Partial<Reservation>;
  return (
    typeof reservation.id === "number" &&
    Number.isFinite(reservation.id) &&
    typeof reservation.reservationCode === "string" &&
    reservation.reservationCode.length > 0 &&
    typeof reservation.userId === "number" &&
    Number.isFinite(reservation.userId) &&
    typeof reservation.facilityId === "number" &&
    Number.isFinite(reservation.facilityId) &&
    (reservation.zoneId === null || typeof reservation.zoneId === "number") &&
    (reservation.slotId === null || typeof reservation.slotId === "number") &&
    typeof reservation.startsAt === "string" &&
    typeof reservation.endsAt === "string" &&
    typeof reservation.state === "string" &&
    RESERVATION_STATES.includes(reservation.state as Reservation["state"]) &&
    (reservation.cancelReason === null || typeof reservation.cancelReason === "string") &&
    (reservation.cancelledAt === null || typeof reservation.cancelledAt === "string") &&
    (reservation.confirmedAt === null || typeof reservation.confirmedAt === "string") &&
    typeof reservation.createdAt === "string" &&
    typeof reservation.updatedAt === "string"
  );
}

function isBookingListResponse(value: unknown): value is BookingListResponse {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { reservations?: unknown }).reservations) &&
    (value as { reservations: unknown[] }).reservations.every(isReservation)
  );
}

function isBookingResponse(value: unknown): value is BookingResponse {
  return (
    !!value &&
    typeof value === "object" &&
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
    throw new AuthApiError("The reservations response was not valid JSON.", response.status);
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

export async function fetchReservations(accessToken: string): Promise<BookingListResponse> {
  const body = await requestJson(
    "/reservations",
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Unable to reach the reservations service.",
    "Unable to load your reservations.",
  );

  if (!isBookingListResponse(body)) {
    throw new AuthApiError("The reservations response was incomplete or malformed.");
  }

  return body;
}

export async function getReservation(
  accessToken: string,
  reservationCode: string,
): Promise<BookingResponse> {
  const body = await requestJson(
    `/reservations/${encodeURIComponent(reservationCode)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Unable to reach the reservations service.",
    "Unable to load reservation details.",
  );

  if (!isBookingResponse(body)) {
    throw new AuthApiError("The reservation detail response was incomplete or malformed.");
  }

  return body;
}

export async function createReservation(
  accessToken: string,
  input: CreateBookingRequest,
): Promise<BookingResponse> {
  const body = await requestJson(
    "/reservations",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    },
    "Unable to reach the reservations service.",
    "Unable to create your reservation.",
  );

  if (!isBookingResponse(body)) {
    throw new AuthApiError("The reservation response was incomplete or malformed.");
  }

  return body;
}

export async function cancelReservation(
  accessToken: string,
  reservationCode: string,
): Promise<BookingResponse> {
  const body = await requestJson(
    `/reservations/${encodeURIComponent(reservationCode)}/cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    },
    "Unable to reach the reservations service.",
    "Unable to cancel your reservation.",
  );

  if (!isBookingResponse(body)) {
    throw new AuthApiError("The cancellation response was incomplete or malformed.");
  }

  return body;
}
