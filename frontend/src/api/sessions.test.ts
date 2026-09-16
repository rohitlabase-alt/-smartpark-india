import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParkingSession, PublicUser } from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import {
  enterParking,
  exitParking,
  getParkingSession,
  getParkingSessionByReservation,
  isParkingSession,
} from "./sessions";

const user: PublicUser = {
  id: 11,
  email: "driver@example.com",
  fullName: "Asha Driver",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const activeSession: ParkingSession = {
  id: 501,
  reservationId: 301,
  facilityId: 201,
  slotId: 101,
  userId: user.id,
  entryAt: "2026-09-15T08:00:00.000Z",
  exitAt: null,
  status: "ACTIVE",
  createdAt: "2026-09-15T08:00:00.000Z",
  updatedAt: "2026-09-15T08:00:00.000Z",
};

const completedSession: ParkingSession = {
  ...activeSession,
  exitAt: "2026-09-15T10:00:00.000Z",
  status: "COMPLETED",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("isParkingSession validator", () => {
  it("accepts a valid active session", () => {
    expect(isParkingSession(activeSession)).toBe(true);
  });

  it("accepts a completed session with exitAt", () => {
    expect(isParkingSession(completedSession)).toBe(true);
  });

  it.each([null, undefined, 123, {}, { id: "1" }, { ...activeSession, status: "INVALID" }])(
    "rejects invalid value %j",
    (v) => {
      expect(isParkingSession(v)).toBe(false);
    },
  );
});

describe("enterParking API client", () => {
  it("sends reservation code in the body with bearer token", async () => {
    const entryToken = "ses_abcdef1234567890abcdef1234567890abcdef12";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ session: activeSession, entryToken }), { status: 201 }),
      );

    const result = await enterParking("access-token", "BKG-ABC123");
    expect(result.session.status).toBe("ACTIVE");
    expect(result.entryToken).toBe(entryToken);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/parking-sessions/entry`, {
      method: "POST",
      body: JSON.stringify({ reservationCode: "BKG-ABC123" }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
  });

  it.each([
    [401, "UNAUTHORIZED", "Authentication required"],
    [404, "BOOKING_NOT_FOUND", "Booking not found"],
    [
      409,
      "RESERVATION_NOT_ENTRYABLE",
      "Reservation is not ready for entry (current state: PENDING_PAYMENT)",
    ],
    [409, "SLOT_OCCUPIED", "This parking slot is already occupied"],
  ] as const)("surfaces %i %s entry errors", async (status, code, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code, message } }), { status }),
    );
    await expect(enterParking("access-token", "BKG-ABC123")).rejects.toMatchObject({
      name: "AuthApiError",
      status,
      code,
      message,
    } satisfies Partial<AuthApiError>);
  });

  it("rejects malformed entry responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ session: { id: 1 } }), { status: 201 }),
    );
    await expect(enterParking("access-token", "BKG-ABC123")).rejects.toThrow(
      "incomplete or malformed",
    );
  });

  it("surfaces network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(enterParking("access-token", "BKG-ABC123")).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the parking session service.",
    });
  });
});

describe("getParkingSession API client", () => {
  it("requests the session by id with bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ session: activeSession }), { status: 200 }));

    const result = await getParkingSession("access-token", 501);
    expect(result.session.id).toBe(501);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/parking-sessions/501`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it.each([
    [401, "UNAUTHORIZED", "Authentication required"],
    [404, "SESSION_NOT_FOUND", "Parking session not found"],
  ] as const)("surfaces %i %s get errors", async (status, code, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code, message } }), { status }),
    );
    await expect(getParkingSession("access-token", 501)).rejects.toMatchObject({
      name: "AuthApiError",
      status,
      code,
      message,
    } satisfies Partial<AuthApiError>);
  });

  it("rejects malformed get responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ session: { id: 1 } }), { status: 200 }),
    );
    await expect(getParkingSession("access-token", 1)).rejects.toThrow("incomplete or malformed");
  });

  it("surfaces network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(getParkingSession("access-token", 1)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the parking session service.",
    });
  });
});

describe("getParkingSessionByReservation API client", () => {
  it("requests the latest session by reservation code with bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ session: activeSession }), { status: 200 }));

    const result = await getParkingSessionByReservation("access-token", "BKG-ABC123");
    expect(result.session.id).toBe(501);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/parking-sessions/by-reservation/BKG-ABC123`,
      {
        headers: { Accept: "application/json", Authorization: "Bearer access-token" },
      },
    );
  });

  it("encodes the reservation code in the path", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ session: activeSession }), { status: 200 }));
    await getParkingSessionByReservation("access-token", "BKG A/B");
    expect(fetchMock.mock.calls[0]![0]).toContain("/by-reservation/BKG%20A%2FB");
  });

  it.each([
    [401, "UNAUTHORIZED", "Authentication required"],
    [404, "SESSION_NOT_FOUND", "No parking session found for this reservation"],
  ] as const)("surfaces %i %s lookup errors", async (status, code, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code, message } }), { status }),
    );
    await expect(
      getParkingSessionByReservation("access-token", "BKG-ABC123"),
    ).rejects.toMatchObject({
      name: "AuthApiError",
      status,
      code,
      message,
    } satisfies Partial<AuthApiError>);
  });

  it("rejects malformed lookup responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ session: { id: 1 } }), { status: 200 }),
    );
    await expect(getParkingSessionByReservation("access-token", "BKG-ABC123")).rejects.toThrow(
      "incomplete or malformed",
    );
  });

  it("surfaces network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(
      getParkingSessionByReservation("access-token", "BKG-ABC123"),
    ).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the parking session service.",
    });
  });
});

describe("exitParking API client", () => {
  it("posts to the exit endpoint with bearer token and empty body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ session: completedSession }), { status: 200 }),
      );

    const result = await exitParking("access-token", 501);
    expect(result.session.status).toBe("COMPLETED");
    expect(result.session.exitAt).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/parking-sessions/501/exit`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
  });

  it.each([
    [401, "UNAUTHORIZED", "Authentication required"],
    [404, "SESSION_NOT_FOUND", "Parking session not found"],
    [409, "SESSION_NOT_ACTIVE", "This parking session is not active"],
  ] as const)("surfaces %i %s exit errors", async (status, code, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code, message } }), { status }),
    );
    await expect(exitParking("access-token", 501)).rejects.toMatchObject({
      name: "AuthApiError",
      status,
      code,
      message,
    } satisfies Partial<AuthApiError>);
  });

  it("rejects malformed exit responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ session: { id: 1 } }), { status: 200 }),
    );
    await expect(exitParking("access-token", 1)).rejects.toThrow("incomplete or malformed");
  });

  it("surfaces network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(exitParking("access-token", 1)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the parking session service.",
    });
  });
});
