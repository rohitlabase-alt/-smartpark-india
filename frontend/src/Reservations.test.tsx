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
