import {
  PARKING_SESSION_STATUSES,
  type ParkingPassResponse,
  type ParkingSession,
  type ParkingSessionEntryRequest,
  type ParkingSessionEntryResponse,
  type ParkingSessionResponse,
} from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";

export function isParkingSession(value: unknown): value is ParkingSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ParkingSession>;
  return (
    typeof session.id === "number" &&
    Number.isFinite(session.id) &&
    typeof session.reservationId === "number" &&
    Number.isFinite(session.reservationId) &&
    typeof session.facilityId === "number" &&
    Number.isFinite(session.facilityId) &&
    typeof session.slotId === "number" &&
    Number.isFinite(session.slotId) &&
    typeof session.userId === "number" &&
    Number.isFinite(session.userId) &&
    typeof session.entryAt === "string" &&
    (session.exitAt === null || typeof session.exitAt === "string") &&
    typeof session.status === "string" &&
    PARKING_SESSION_STATUSES.includes(session.status as ParkingSession["status"]) &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string"
  );
}

function isParkingPassResponse(value: unknown): value is ParkingPassResponse {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { verificationToken?: unknown }).verificationToken === "string"
  );
}

function isParkingSessionResponse(value: unknown): value is ParkingSessionResponse {
  return (
    !!value &&
    typeof value === "object" &&
    isParkingSession((value as { session?: unknown }).session)
  );
}

function isParkingSessionEntryResponse(value: unknown): value is ParkingSessionEntryResponse {
  return (
    !!value &&
    typeof value === "object" &&
    isParkingSession((value as { session?: unknown }).session) &&
    typeof (value as { entryToken?: unknown }).entryToken === "string"
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
    throw new AuthApiError("The parking session response was not valid JSON.", response.status);
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

/**
 * Entry: converts a paid/confirmed reservation into an active parking session.
 * Accepts exactly ONE credential — a booking reference OR a parking-pass
 * verification token (the server enforces the exclusive-or). The returned
 * entryToken is a one-time bearer credential (safe for a future QR / gate
 * flow) and is never persisted or returned again.
 */
export async function enterParking(
  accessToken: string,
  credential: ParkingSessionEntryRequest,
): Promise<ParkingSessionEntryResponse> {
  const body = await requestJson(
    "/parking-sessions/entry",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(credential),
    },
    "Unable to reach the parking session service.",
    "Unable to enter the parking session.",
  );

  if (!isParkingSessionEntryResponse(body)) {
    throw new AuthApiError("The parking session entry response was incomplete or malformed.");
  }

  return body;
}

/**
 * Reads the parking-pass verification token for a confirmed reservation
 * (reservation owner or a VERIFIED operator of its facility). The token is
 * deterministic and unsigned-for-format-guard — the driver presents it at the
 * gate, and the operator may scan it to verify and enter the vehicle. The raw
 * token is never stored server-side; only its SHA-256 digest is.
 */
export async function getParkingSessionPass(
  accessToken: string,
  reservationCode: string,
): Promise<ParkingPassResponse> {
  const body = await requestJson(
    `/parking-sessions/by-reservation/${encodeURIComponent(reservationCode)}/pass`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Unable to reach the parking session service.",
    "Unable to load the parking pass.",
  );

  if (!isParkingPassResponse(body)) {
    throw new AuthApiError("The parking pass response was incomplete or malformed.");
  }

  return body;
}

export async function getParkingSession(
  accessToken: string,
  sessionId: number,
): Promise<ParkingSessionResponse> {
  const body = await requestJson(
    `/parking-sessions/${sessionId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Unable to reach the parking session service.",
    "Unable to load the parking session.",
  );

  if (!isParkingSessionResponse(body)) {
    throw new AuthApiError("The parking session response was incomplete or malformed.");
  }

  return body;
}

/**
 * Resumes the most recent session for a booking code (owner or facility
 * operator). Lets a driver reload the app and still see/exit their active
 * session, and lets an operator confirm a vehicle's on-site state. The entry
 * token is never returned by this read.
 */
export async function getParkingSessionByReservation(
  accessToken: string,
  reservationCode: string,
): Promise<ParkingSessionResponse> {
  const body = await requestJson(
    `/parking-sessions/by-reservation/${encodeURIComponent(reservationCode)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Unable to reach the parking session service.",
    "Unable to load the parking session.",
  );

  if (!isParkingSessionResponse(body)) {
    throw new AuthApiError("The parking session response was incomplete or malformed.");
  }

  return body;
}

export async function exitParking(
  accessToken: string,
  sessionId: number,
): Promise<ParkingSessionResponse> {
  const body = await requestJson(
    `/parking-sessions/${sessionId}/exit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    },
    "Unable to reach the parking session service.",
    "Unable to exit the parking session.",
  );

  if (!isParkingSessionResponse(body)) {
    throw new AuthApiError("The parking session exit response was incomplete or malformed.");
  }

  return body;
}
