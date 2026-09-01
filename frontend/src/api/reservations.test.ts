import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingListResponse, BookingResponse, PublicUser } from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import { createReservation, fetchReservations } from "./reservations";

const user: PublicUser = {
  id: 7,
  email: "driver@example.com",
  fullName: "Asha Driver",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const bookingResponse: BookingListResponse = {
  reservations: [
    {
      id: 12,
      reservationCode: "BKG-ABC123",
      userId: user.id,
      facilityId: 4,
      zoneId: null,
      slotId: 9,
      startsAt: "2026-09-10T08:00:00.000Z",
      endsAt: "2026-09-10T10:00:00.000Z",
      state: "CONFIRMED",
      cancelReason: null,
      cancelledAt: null,
      confirmedAt: "2026-09-01T10:05:00.000Z",
      createdAt: "2026-09-01T10:05:00.000Z",
      updatedAt: "2026-09-01T10:05:00.000Z",
    },
  ],
};

const createResponse: BookingResponse = { reservation: bookingResponse.reservations[0]! };
const createInput = {
  facilityId: 4,
  slotId: 9,
  startsAt: "2026-09-10T08:00:00.000Z",
  endsAt: "2026-09-10T10:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("reservations API client", () => {
  it("posts a reservation with the bearer access token and exact JSON body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(createResponse), { status: 201 }));

    await expect(createReservation("access-token", createInput)).resolves.toEqual(createResponse);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/reservations`, {
      method: "POST",
      body: JSON.stringify(createInput),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
  });

  it("surfaces reservation creation API errors", async () => {
    const errors = [
      [400, "VALIDATION_ERROR", "Invalid request body"],
      [401, "UNAUTHORIZED", "Authentication required"],
      [404, "FACILITY_NOT_FOUND", "Parking facility not found"],
      [404, "SLOT_NOT_FOUND", "Parking slot not found"],
      [400, "SLOT_UNAVAILABLE", "This slot is not available"],
      [409, "RESERVATION_CONFLICT", "This slot is already booked"],
    ] as const;

    for (const [status, code, message] of errors) {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code, message } }), { status }),
        );
      await expect(createReservation("access-token", createInput)).rejects.toMatchObject({
        name: "AuthApiError",
        status,
        code,
        message,
      } satisfies Partial<AuthApiError>);
      fetchMock.mockRestore();
    }
  });

  it("rejects malformed successful reservation responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ reservation: { reservationCode: "BKG-INCOMPLETE" } }), {
        status: 201,
      }),
    );

    await expect(createReservation("access-token", createInput)).rejects.toThrow(
      "incomplete or malformed",
    );
  });

  it("surfaces reservation creation network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network unavailable"));

    await expect(createReservation("access-token", createInput)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the reservations service.",
    });
  });

  it("gets reservations with the bearer access token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(bookingResponse), { status: 200 }));

    await expect(fetchReservations("access-token")).resolves.toEqual(bookingResponse);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/reservations`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("parses an empty BookingListResponse", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ reservations: [] }), { status: 200 }),
    );

    await expect(fetchReservations("access-token")).resolves.toEqual({ reservations: [] });
  });

  it("surfaces unauthorized responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } }),
        { status: 401 },
      ),
    );

    await expect(fetchReservations("access-token")).rejects.toMatchObject({
      name: "AuthApiError",
      status: 401,
      code: "UNAUTHORIZED",
      message: "Missing bearer token",
    } satisfies Partial<AuthApiError>);
  });

  it("surfaces API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "RESERVATIONS_UNAVAILABLE", message: "Try again later" } }),
        { status: 503 },
      ),
    );

    await expect(fetchReservations("access-token")).rejects.toMatchObject({
      status: 503,
      code: "RESERVATIONS_UNAVAILABLE",
      message: "Try again later",
    });
  });

  it("rejects malformed successful responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ reservations: [{ reservationCode: "BKG-INCOMPLETE" }] }), {
        status: 200,
      }),
    );

    await expect(fetchReservations("access-token")).rejects.toThrow("incomplete or malformed");
  });
});
