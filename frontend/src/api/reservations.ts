import { RESERVATION_STATES, type BookingListResponse, type Reservation } from "@smartpark/shared";
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

export async function fetchReservations(accessToken: string): Promise<BookingListResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/reservations`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new AuthApiError("Unable to reach the reservations service.");
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
        : "Unable to load your reservations.";
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    throw new AuthApiError(message, response.status, code);
  }

  if (!isBookingListResponse(body)) {
    throw new AuthApiError(
      "The reservations response was incomplete or malformed.",
      response.status,
    );
  }

  return body;
}
