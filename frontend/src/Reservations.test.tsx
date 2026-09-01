import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@smartpark/shared";
import App from "./App";
import { clearMemorySession, setMemorySession, type AuthSession } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInSeconds: 1800,
  user,
} satisfies AuthSession;

const reservation = {
  id: 12,
  reservationCode: "BKG-ABC123",
  userId: user.id,
  facilityId: 4,
  zoneId: null,
  slotId: 9,
  startsAt: "2026-09-10T08:00:00.000Z",
  endsAt: "2026-09-10T10:00:00.000Z",
  state: "CONFIRMED" as const,
  cancelReason: null,
  cancelledAt: null,
  confirmedAt: "2026-09-01T10:05:00.000Z",
  createdAt: "2026-09-01T10:05:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
};

const cancelledReservation = {
  ...reservation,
  state: "CANCELLED" as const,
  cancelledAt: "2026-09-01T10:10:00.000Z",
  updatedAt: "2026-09-01T10:10:00.000Z",
};

const completedReservation = {
  ...reservation,
  state: "COMPLETED" as const,
};

const availability = {
  facilityId: "PUN-000004",
  totalSlots: 4,
  availableSlots: 2,
  isLive: true,
  sources: ["MANUAL" as const],
  lastUpdatedAt: "2026-09-01T10:00:00.000Z",
  confidence: "HIGH" as const,
  disclaimer: "Operator-reported availability. Not guaranteed.",
  slots: [
    {
      id: 9,
      slotCode: "A01",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "AVAILABLE" as const,
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: 10,
      slotCode: "A02",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "OCCUPIED" as const,
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: 11,
      slotCode: "A03",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "AVAILABLE" as const,
      reservationsEnabled: false,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: 12,
      slotCode: "A04",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "RESERVED" as const,
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

async function renderAuthenticatedApp() {
  setMemorySession(session);
  await act(async () => {
    root.render(<App />);
  });
}

async function openReservations() {
  await act(async () => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav button")).find(
      (candidate) => candidate.textContent?.includes("My Reservations"),
    );
    if (!button) throw new Error("My Reservations button not found");
    button.click();
  });
}

async function clickButton(label: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.includes(label),
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    button.click();
  });
}

async function renderReservationList(items: unknown[]) {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ reservations: items }), { status: 200 }));
  await renderAuthenticatedApp();
  await openReservations();
  await settleAsyncWork();
  return fetchMock;
}

function setInput(id: string, value: string) {
  act(() => {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelect(id: string, value: string) {
  act(() => {
    const select = container.querySelector<HTMLSelectElement>(`#${id}`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function loadAvailability() {
  setInput("facility-id", "4");
  await act(async () => {
    container.querySelector<HTMLFormElement>(".search-form")!.requestSubmit();
  });
  await settleAsyncWork();
}

async function submitReservation() {
  await act(async () => {
    container.querySelector<HTMLFormElement>(".reservation-form")!.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fillReservationForm() {
  setSelect("reservation-slot", "9");
  setInput("reservation-start", "2026-09-10T08:00");
  setInput("reservation-end", "2026-09-10T10:00");
}

async function settleAsyncWork() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  clearMemorySession();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMemorySession();
  vi.restoreAllMocks();
});

describe("My Reservations screen", () => {
  it("keeps availability public and does not fetch reservations until selected", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));
    await renderAuthenticatedApp();

    expect(container.textContent).toContain("Check a parking facility");
    expect(container.textContent).toContain("My Reservations");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain("/auth/me");
  });

  it("shows only eligible slots in the reservation form after availability loads", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(availability), { status: 200 }));
    await renderAuthenticatedApp();
    await loadAvailability();

    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>("#reservation-slot option"),
    );
    expect(options.map((option) => option.value)).toEqual(["", "9", "12"]);
    expect(container.textContent).toContain("Create a reservation");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not expose reservation creation to unauthenticated users", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await act(async () => root.render(<App />));

    expect(container.querySelector(".reservation-creation")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows cancellation only for confirmed reservations", async () => {
    await renderReservationList([reservation, cancelledReservation, completedReservation]);

    expect(container.querySelectorAll(".cancel-reservation-button")).toHaveLength(1);
    expect(container.textContent).toContain("CANCELLED");
    expect(container.textContent).toContain("COMPLETED");
  });

  it("opens an accessible confirmation without immediately sending a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();
    await clickButton("Cancel Reservation");

    expect(container.textContent).toContain("Cancel this reservation?");
    expect(container.textContent).toContain("BKG-ABC123");
    expect(container.textContent).toContain("Facility 4");
    expect(container.textContent).toContain("Slot 9");
    expect(container.textContent).toContain("Payment and refunds are not implemented.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("closes cancellation confirmation without sending a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();
    await clickButton("Cancel Reservation");
    await clickButton("Keep Reservation");

    expect(container.textContent).not.toContain("Cancel this reservation?");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("confirms cancellation once and updates the reservation authoritatively", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservation: cancelledReservation }), { status: 200 }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();
    await clickButton("Cancel Reservation");
    await clickButton("Confirm Cancellation");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![0]).toContain("/reservations/BKG-ABC123/cancel");
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(container.textContent).toContain("CANCELLED");
    expect(container.textContent).not.toContain("Cancel Reservation");
    expect(container.textContent).toContain("Reservation BKG-ABC123 has been cancelled.");
  });

  it("shows cancellation loading state and prevents duplicate requests", async () => {
    let resolveCancellation!: (value: Response) => void;
    const cancellationRequest = new Promise<Response>((resolve) => {
      resolveCancellation = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      )
      .mockReturnValueOnce(cancellationRequest);
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();
    await clickButton("Cancel Reservation");
    await clickButton("Confirm Cancellation");

    expect(container.textContent).toContain("Cancelling reservation...");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const confirmButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Cancelling..."),
    );
    expect(confirmButton?.disabled).toBe(true);

    confirmButton?.click();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    resolveCancellation(
      new Response(JSON.stringify({ reservation: cancelledReservation }), { status: 200 }),
    );
    await settleAsyncWork();
  });

  it.each([
    [401, "UNAUTHORIZED", "You are not authorized to cancel this reservation."],
    [404, "BOOKING_NOT_FOUND", "This reservation could not be found."],
    [
      422,
      "CANNOT_CANCEL_COMPLETED",
      "This reservation has already been completed and cannot be cancelled.",
    ],
  ] as const)("shows %s cancellation errors", async (status, code, message) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code, message: "Backend error" } }), { status }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();
    await clickButton("Cancel Reservation");
    await clickButton("Confirm Cancellation");

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(container.textContent).toContain("BKG-ABC123");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes the list when the backend reports an already-cancelled reservation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "ALREADY_CANCELLED", message: "Already cancelled" } }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [cancelledReservation] }), { status: 200 }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();
    await clickButton("Cancel Reservation");
    await clickButton("Confirm Cancellation");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]![0]).toContain("/reservations");
    expect(container.textContent).toContain("CANCELLED");
    expect(container.textContent).not.toContain("Cancel Reservation");
    expect(container.textContent).toContain("This reservation is already cancelled.");
  });

  it("shows a network error and keeps the reservation available", async () => {
    const fetchMock = await renderReservationList([reservation]);
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    await clickButton("Cancel Reservation");
    await clickButton("Confirm Cancellation");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Unable to reach the reservations service.",
    );
    expect(container.textContent).toContain("CONFIRMED");
  });

  it("validates the reservation time range before creating", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(availability), { status: 200 }));
    await renderAuthenticatedApp();
    await loadAvailability();
    setSelect("reservation-slot", "9");
    setInput("reservation-start", "2026-09-10T10:00");
    setInput("reservation-end", "2026-09-10T08:00");
    await submitReservation();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "End time must be after start time.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("submits the numeric facility ID and ISO times, then shows confirmation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(availability), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reservation }), { status: 201 }));
    await renderAuthenticatedApp();
    await loadAvailability();
    fillReservationForm();
    await submitReservation();

    expect(fetchMock.mock.calls[2]![0]).toContain("/reservations");
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        facilityId: 4,
        slotId: 9,
        startsAt: "2026-09-10T08:00:00.000Z",
        endsAt: "2026-09-10T10:00:00.000Z",
      }),
    });
    expect(container.textContent).toContain("BKG-ABC123");
    expect(container.textContent).toContain("Reservation confirmed");
    expect(container.textContent).toContain("CONFIRMED");
    expect(container.textContent).toContain("View My Reservations");
  });

  it("prevents duplicate reservation submissions while creating", async () => {
    let resolveCreate!: (value: Response) => void;
    const createRequest = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(availability), { status: 200 }))
      .mockReturnValueOnce(createRequest);
    await renderAuthenticatedApp();
    await loadAvailability();
    fillReservationForm();
    act(() => container.querySelector<HTMLFormElement>(".reservation-form")!.requestSubmit());
    expect(container.textContent).toContain("Creating reservation...");
    act(() => container.querySelector<HTMLFormElement>(".reservation-form")!.requestSubmit());
    expect(fetchMock).toHaveBeenCalledTimes(3);

    resolveCreate(new Response(JSON.stringify({ reservation }), { status: 201 }));
    await settleAsyncWork();
  });

  it.each([
    ["SLOT_UNAVAILABLE", "This slot cannot be reserved right now."],
    [
      "RESERVATION_CONFLICT",
      "This slot is no longer available for that time. Choose another time or slot.",
    ],
  ])("shows %s creation errors", async (code, message) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(availability), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code, message: "Backend error" } }), {
          status: code === "RESERVATION_CONFLICT" ? 409 : 400,
        }),
      );
    await renderAuthenticatedApp();
    await loadAvailability();
    fillReservationForm();
    await submitReservation();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
  });

  it("shows a network error without breaking availability", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(availability), { status: 200 }))
      .mockRejectedValueOnce(new Error("Network unavailable"));
    await renderAuthenticatedApp();
    await loadAvailability();
    fillReservationForm();
    await submitReservation();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Unable to reach the reservations service.",
    );
    expect(container.textContent).toContain("Parking availability");
  });

  it("shows loading while reservations are being fetched", async () => {
    let resolveReservations!: (value: Response) => void;
    const reservationsRequest = new Promise<Response>((resolve) => {
      resolveReservations = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockReturnValueOnce(reservationsRequest);
    await renderAuthenticatedApp();

    await openReservations();
    expect(container.textContent).toContain("Loading your reservations...");

    resolveReservations(new Response(JSON.stringify({ reservations: [] }), { status: 200 }));
    await settleAsyncWork();
  });

  it("renders an empty reservation history", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reservations: [] }), { status: 200 }));
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();

    expect(container.textContent).toContain("You have no reservations yet.");
  });

  it("renders reservation details and status", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();

    expect(container.textContent).toContain("BKG-ABC123");
    expect(container.textContent).toContain("Facility ID4");
    expect(container.textContent).toContain("Slot ID9");
    expect(container.textContent).toContain("Start time");
    expect(container.textContent).toContain("End time");
    expect(container.textContent).toContain("CONFIRMED");
    expect(container.textContent).toContain("Created");
    expect(container.querySelector('time[datetime="2026-09-10T08:00:00.000Z"]')).not.toBeNull();
    expect(container.querySelector('time[datetime="2026-09-10T10:00:00.000Z"]')).not.toBeNull();
    expect(container.querySelector('time[datetime="2026-09-01T10:05:00.000Z"]')).not.toBeNull();
  });

  it("omits the slot field when a reservation has no slot", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [{ ...reservation, slotId: null }] }), {
          status: 200,
        }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();

    expect(container.textContent).not.toContain("Slot ID");
  });

  it("shows an unauthorized error without exposing reservation data", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }), {
          status: 401,
        }),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "You are not authorized to view reservations.",
    );
    expect(container.textContent).not.toContain("BKG-ABC123");
  });

  it("shows API and network errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockRejectedValueOnce(new Error("Network unavailable"));
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Unable to reach the reservations service.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows an API error response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Try again later" } }),
          { status: 503 },
        ),
      );
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Try again later");
  });

  it("keeps logout functional and removes the reservations view", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservations: [reservation] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await renderAuthenticatedApp();
    await openReservations();
    await settleAsyncWork();

    await act(async () => {
      const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav button")).find(
        (candidate) => candidate.textContent?.includes("Sign out"),
      );
      if (!button) throw new Error("Sign out button not found");
      button.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).not.toContain("My Reservations");
    expect(container.textContent).not.toContain("BKG-ABC123");
  });

  it("does not expose the reservations navigation or call its API unauthenticated", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await act(async () => root.render(<App />));

    expect(container.textContent).not.toContain("My Reservations");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
