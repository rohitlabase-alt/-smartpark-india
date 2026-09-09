import { afterEach, describe, expect, it, vi } from "vitest";
import type { Payment, PublicUser, Reservation } from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import { initiatePayment, verifyPayment } from "./payments";

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

const pendingReservation: Reservation = {
  id: 13,
  reservationCode: "BKG-PENDING987",
  userId: user.id,
  facilityId: 4,
  zoneId: null,
  slotId: 10,
  startsAt: "2026-09-12T08:00:00.000Z",
  endsAt: "2026-09-12T10:00:00.000Z",
  state: "PENDING_PAYMENT",
  amount: 200,
  paymentStatus: "INITIATED",
  cancelReason: null,
  cancelledAt: null,
  confirmedAt: null,
  createdAt: "2026-09-02T10:05:00.000Z",
  updatedAt: "2026-09-02T10:05:00.000Z",
};

const confirmedReservation: Reservation = {
  ...pendingReservation,
  state: "CONFIRMED",
  paymentStatus: "SUCCESS",
  confirmedAt: "2026-09-02T10:06:00.000Z",
  updatedAt: "2026-09-02T10:06:00.000Z",
};

const initiatedPayment: Payment = {
  id: 1,
  reservationId: 13,
  provider: "MOCK",
  providerTxnId: "MOCK-BKG-PENDING987-200",
  amount: 200,
  status: "PENDING",
  createdAt: "2026-09-02T10:05:30.000Z",
  updatedAt: "2026-09-02T10:05:30.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("payments API client", () => {
  it("initiates a payment with the bearer token, reservation code body and Idempotency-Key header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ payment: initiatedPayment }), { status: 200 }),
      );

    await expect(initiatePayment("access-token", "BKG-PENDING987", "uuid-123")).resolves.toEqual({
      payment: initiatedPayment,
    });
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/payments/initiate`, {
      method: "POST",
      body: JSON.stringify({ reservationCode: "BKG-PENDING987" }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
        "Idempotency-Key": "uuid-123",
      },
    });
  });

  it("omits the Idempotency-Key header when no key is provided", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ payment: initiatedPayment }), { status: 200 }),
      );

    await expect(initiatePayment("access-token", "BKG-PENDING987")).resolves.toEqual({
      payment: initiatedPayment,
    });
    const [, options] = fetchMock.mock.calls[0]!;
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
    expect("Idempotency-Key" in (options!.headers as Record<string, string>)).toBe(false);
  });

  it.each([
    [401, "UNAUTHORIZED", "Authentication required"],
    [404, "BOOKING_NOT_FOUND", "Booking not found"],
    [409, "PAYMENT_NOT_PENDING", "Payment is only available while the reservation is pending"],
    [409, "PAYMENT_UNAVAILABLE", "This reservation has no chargeable amount"],
  ] as const)("surfaces %i %s initiate errors", async (status, code, message) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code, message } }), { status }),
      );
    await expect(initiatePayment("access-token", "BKG-PENDING987")).rejects.toMatchObject({
      name: "AuthApiError",
      status,
      code,
      message,
    } satisfies Partial<AuthApiError>);
    fetchMock.mockRestore();
  });

  it("rejects malformed payment initiation responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ payment: { id: 1 } }), { status: 200 }),
    );

    await expect(initiatePayment("access-token", "BKG-PENDING987")).rejects.toThrow(
      "incomplete or malformed",
    );
  });

  it("surfaces payment initiation network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(initiatePayment("access-token", "BKG-PENDING987")).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the payments service.",
    });
  });

  it("verifies a payment and parses the full confirmation response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          payment: { ...initiatedPayment, status: "SUCCESS" },
          reservation: confirmedReservation,
        }),
        { status: 200 },
      ),
    );

    await expect(verifyPayment("access-token", "MOCK-BKG-PENDING987-200")).resolves.toEqual({
      payment: { ...initiatedPayment, status: "SUCCESS" },
      reservation: confirmedReservation,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/payments/MOCK-BKG-PENDING987-200/verify`,
      {
        method: "POST",
        headers: { Accept: "application/json", Authorization: "Bearer access-token" },
      },
    );
  });

  it("parses a failed verification into a FAILED reservation", async () => {
    const failedPayment: Payment = { ...initiatedPayment, status: "FAILED" };
    const failedReservation: Reservation = {
      ...pendingReservation,
      state: "FAILED",
      paymentStatus: "FAILED",
      updatedAt: "2026-09-02T10:06:00.000Z",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ payment: failedPayment, reservation: failedReservation }), {
        status: 200,
      }),
    );

    await expect(verifyPayment("access-token", "MOCK-BKG-PENDING987-200")).resolves.toEqual({
      payment: failedPayment,
      reservation: failedReservation,
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it.each([
    [401, "UNAUTHORIZED", "Authentication required"],
    [404, "PAYMENT_NOT_FOUND", "Payment not found"],
    [409, "PAYMENT_ALREADY_FAILED", "This payment already failed"],
    [409, "RESERVATION_NOT_CONFIRMABLE", "The reservation is no longer pending payment"],
  ] as const)("surfaces %i %s verify errors", async (status, code, message) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code, message } }), { status }),
      );
    await expect(verifyPayment("access-token", "MOCK-BKG-PENDING987-200")).rejects.toMatchObject({
      name: "AuthApiError",
      status,
      code,
      message,
    } satisfies Partial<AuthApiError>);
    fetchMock.mockRestore();
  });

  it("rejects malformed payment verification responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ payment: { id: 1 }, reservation: { reservationCode: "x" } }), {
        status: 200,
      }),
    );

    await expect(verifyPayment("access-token", "MOCK-BKG-PENDING987-200")).rejects.toThrow(
      "incomplete or malformed",
    );
  });

  it("surfaces payment verification network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(verifyPayment("access-token", "MOCK-BKG-PENDING987-200")).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the payments service.",
    });
  });
});
