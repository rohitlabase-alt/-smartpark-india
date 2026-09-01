import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingListResponse, PublicUser } from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import { fetchReservations } from "./reservations";

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

afterEach(() => vi.restoreAllMocks());

describe("reservations API client", () => {
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
