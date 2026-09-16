import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParkingSession, PublicUser } from "@smartpark/shared";
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

const confirmedReservation = {
  id: 12,
  reservationCode: "BKG-ABC123",
  userId: user.id,
  facilityId: 4,
  zoneId: null,
  slotId: 9,
  startsAt: "2026-09-10T08:00:00.000Z",
  endsAt: "2026-09-10T10:00:00.000Z",
  state: "CONFIRMED" as const,
  amount: 200,
  paymentStatus: "SUCCESS" as const,
  cancelReason: null,
  cancelledAt: null,
  confirmedAt: "2026-09-01T10:05:00.000Z",
  createdAt: "2026-09-01T10:05:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
};

const pendingReservation = {
  ...confirmedReservation,
  id: 13,
  reservationCode: "BKG-PENDING987",
  slotId: 10,
  state: "PENDING_PAYMENT" as const,
  paymentStatus: "INITIATED" as const,
  confirmedAt: null,
};

const cancelledReservation = {
  ...confirmedReservation,
  id: 14,
  reservationCode: "BKG-CANCELLED",
  state: "CANCELLED" as const,
  cancelledAt: "2026-09-01T10:10:00.000Z",
  updatedAt: "2026-09-01T10:10:00.000Z",
};

const activeSession: ParkingSession = {
  id: 501,
  reservationId: 12,
  facilityId: 4,
  slotId: 9,
  userId: 7,
  entryAt: "2026-09-10T08:00:00.000Z",
  exitAt: null,
  status: "ACTIVE",
  createdAt: "2026-09-10T08:00:00.000Z",
  updatedAt: "2026-09-10T08:10:00.000Z",
};

const completedSession: ParkingSession = {
  ...activeSession,
  status: "COMPLETED",
  exitAt: "2026-09-10T10:00:00.000Z",
};

function sessionResponse(session: ParkingSession): Response {
  return new Response(JSON.stringify({ session }), { status: 200 });
}

function entryResponse(session: ParkingSession, entryToken: string): Response {
  return new Response(JSON.stringify({ session, entryToken }), { status: 200 });
}

function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}

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

async function settleAsyncWork() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDetailFor(items: unknown[]) {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ reservations: items }), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ reservation: items[0] }), { status: 200 }),
    );
  await renderAuthenticatedApp();
  await openReservations();
  await settleAsyncWork();
  await clickButton("View Details");
  await settleAsyncWork();
  return fetchMock;
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

describe("driver parking sessions", () => {
  it("shows the parking panel only for a confirmed reservation", async () => {
    await renderDetailFor([confirmedReservation]);
    expect(container.querySelector(".parking-session-panel")).toBeTruthy();
    expect(container.textContent).toContain("Parking session");
    expect(container.textContent).toContain("Enter parking");
  });

  it("hides the parking panel for pending and cancelled reservations", async () => {
    await renderDetailFor([pendingReservation]);
    expect(container.querySelector(".parking-session-panel")).toBeNull();
    expect(container.textContent).not.toContain("Enter parking");
  });

  it("hides the parking panel after a reservation is cancelled", async () => {
    await renderDetailFor([cancelledReservation]);
    expect(container.querySelector(".parking-session-panel")).toBeNull();
    expect(container.textContent).not.toContain("Enter parking");
  });

  it("requires an authenticated session to reach the reservations area", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await act(async () => root.render(<App />));
    expect(container.textContent).not.toContain("My Reservations");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enters a vehicle and returns a one-time entry token", async () => {
    const fetchMock = await renderDetailFor([confirmedReservation]);
    fetchMock.mockResolvedValueOnce(entryResponse(activeSession, "GATE-TOKEN-1"));
    await clickButton("Enter parking");
    await settleAsyncWork();
    expect(fetchMock.mock.calls[3]![0]).toContain("/parking-sessions/entry");
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ reservationCode: "BKG-ABC123" }),
    });
    expect(container.textContent).toContain(
      "Vehicle entered. Copy the one-time token for the entry gate.",
    );
    expect(container.textContent).toContain("ACTIVE");
    expect(container.textContent).toContain("Slot ID");
    expect(container.textContent).toContain("9");
    expect(container.querySelector<HTMLElement>(".entry-token-code")?.textContent).toBe(
      "GATE-TOKEN-1",
    );
    expect(container.textContent).toContain("Copy entry token");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("copies the one-time entry token to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      const fetchMock = await renderDetailFor([confirmedReservation]);
      fetchMock.mockResolvedValueOnce(entryResponse(activeSession, "GATE-TOKEN-1"));
      await clickButton("Enter parking");
      await settleAsyncWork();
      await clickButton("Copy entry token");
      await settleAsyncWork();
      expect(writeText).toHaveBeenCalledWith("GATE-TOKEN-1");
      expect(container.textContent).toContain("Copied");
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("shows a friendly error when the booking reference is unknown", async () => {
    const fetchMock = await renderDetailFor([confirmedReservation]);
    fetchMock.mockResolvedValueOnce(apiError(404, "BOOKING_NOT_FOUND", "no such reservation"));
    await clickButton("Enter parking");
    await settleAsyncWork();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "No reservation matches this booking reference.",
    );
    expect(container.textContent).toContain("Enter parking");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("recovers an already-active session without issuing a new token", async () => {
    const fetchMock = await renderDetailFor([confirmedReservation]);
    fetchMock
      .mockResolvedValueOnce(apiError(409, "SESSION_ALREADY_ACTIVE", "active"))
      .mockResolvedValueOnce(sessionResponse(activeSession));
    await clickButton("Enter parking");
    await settleAsyncWork();
    expect(fetchMock.mock.calls[4]![0]).toContain("/parking-sessions/by-reservation/BKG-ABC123");
    expect(container.textContent).toContain(
      "This reservation already has an active parking session.",
    );
    expect(container.textContent).toContain("ACTIVE");
    expect(container.textContent).toContain("Exit vehicle");
    expect(container.querySelectorAll(".entry-token-code").length).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("exits the vehicle and marks the session complete", async () => {
    const fetchMock = await renderDetailFor([confirmedReservation]);
    fetchMock
      .mockResolvedValueOnce(entryResponse(activeSession, "GATE-TOKEN-1"))
      .mockResolvedValueOnce(sessionResponse(completedSession));
    await clickButton("Enter parking");
    await settleAsyncWork();
    await clickButton("Exit vehicle");
    await settleAsyncWork();
    expect(fetchMock.mock.calls[4]![0]).toContain("/parking-sessions/501/exit");
    expect(fetchMock.mock.calls[4]![1]).toMatchObject({ method: "POST" });
    expect(container.textContent).toContain("Vehicle exited; the slot was released.");
    expect(container.textContent).toContain("COMPLETED");
    expect(container.textContent).toContain("Enter parking");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("keeps the session visible when the exit fails", async () => {
    const fetchMock = await renderDetailFor([confirmedReservation]);
    fetchMock
      .mockResolvedValueOnce(entryResponse(activeSession, "GATE-TOKEN-1"))
      .mockResolvedValueOnce(apiError(409, "SESSION_NOT_ACTIVE", "already left"));
    await clickButton("Enter parking");
    await settleAsyncWork();
    await clickButton("Exit vehicle");
    await settleAsyncWork();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This session is no longer active.",
    );
    expect(container.textContent).toContain("ACTIVE");
    expect(container.textContent).toContain("Exit vehicle");
  });

  it("shows a pending state and prevents duplicate entry requests", async () => {
    let resolveEntry!: (response: Response) => void;
    const fetchMock = await renderDetailFor([confirmedReservation]);
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveEntry = resolve;
      }),
    );
    await clickButton("Enter parking");
    expect(container.textContent).toContain("Starting your parking session...");
    expect(container.querySelector(".parking-session-panel button")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    resolveEntry(entryResponse(activeSession, "GATE-TOKEN-1"));
    await settleAsyncWork();
    expect(container.querySelector<HTMLElement>(".entry-token-code")?.textContent).toBe(
      "GATE-TOKEN-1",
    );
  });
});
