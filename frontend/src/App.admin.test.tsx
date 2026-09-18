import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATOR_STATUSES,
  PAYMENT_STATUSES,
  RESERVATION_STATES,
  type PlatformSummary,
  type PublicUser,
} from "@smartpark/shared";
import App from "./App";
import { clearMemorySession, setMemorySession, type AuthSession } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function zeroMap<T extends readonly string[]>(keys: T): Record<(typeof keys)[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<(typeof keys)[number], number>;
}

const emptySummary: PlatformSummary = {
  users: 1,
  operators: 0,
  operatorsByStatus: zeroMap(OPERATOR_STATUSES),
  facilities: 0,
  activeFacilities: 0,
  inactiveFacilities: 0,
  facilitiesByStatus: zeroMap(OPERATOR_STATUSES),
  parkingSlots: 0,
  reservations: 0,
  reservationsByStatus: zeroMap(RESERVATION_STATES),
  payments: 0,
  paymentsByStatus: zeroMap(PAYMENT_STATUSES),
  activeParkingSessions: 0,
  occupiedSlots: 0,
  availableSlots: 0,
  recentAuditEvents: [],
  recentAuditEventCount: 0,
};

const adminUser: PublicUser = {
  id: 1,
  email: "admin@smartpark.in",
  fullName: "System Admin",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER", "ADMIN"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const operatorUser: PublicUser = {
  id: 7,
  email: "operator@example.com",
  fullName: "Operator Owner",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER", "PARKING_OPERATOR"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const normalUser: PublicUser = {
  id: 2,
  email: "driver@example.com",
  fullName: "Regular Driver",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const adminAndOperatorUser: PublicUser = {
  id: 9,
  email: "super@example.com",
  fullName: "Super Admin",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER", "ADMIN", "PARKING_OPERATOR"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const session = {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  expiresInSeconds: 1800,
  user: adminUser,
} satisfies AuthSession;

let container: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function routeFetch(user: PublicUser, handlers: Array<[string, () => Response]> = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    for (const [fragment, handler] of handlers) {
      if (url.includes(fragment)) return handler();
    }
    if (url.includes("/parking/facilities")) return json({ facilities: [] });
    if (url.includes("/auth/me")) return json(user);
    return json({});
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderAppWithUser(user: PublicUser) {
  setMemorySession({ ...session, user });
  await act(async () => root.render(<App />));
  await settle();
}

function goToProfileTab() {
  const profileTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(
    (button) => button.textContent?.includes("Profile"),
  )!;
  act(() => profileTab.click());
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes(text),
    ) ?? null
  );
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

describe("admin dashboard navigation", () => {
  it("shows the Admin Console entry for ADMIN users", async () => {
    routeFetch(adminUser);
    await renderAppWithUser(adminUser);
    goToProfileTab();
    const adminEntry = buttonWithText("Admin Console");
    expect(adminEntry).not.toBeNull();
    expect(container.textContent).not.toContain("Platform Overview");
  });

  it("opens AdminDashboard when the Admin Console entry is clicked", async () => {
    const fetchMock = routeFetch(adminUser, [
      ["/admin/platform-summary", () => json(emptySummary)],
    ]);
    await renderAppWithUser(adminUser);
    goToProfileTab();

    await act(async () => buttonWithText("Admin Console")!.click());
    await settle();

    expect(container.textContent).toContain("Admin Console");
    expect(container.textContent).toContain("Admin Dashboard");
    expect(container.textContent).toContain("Platform Overview");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/admin/platform-summary")),
    ).toBe(true);
  });

  it("passes the current access token to the admin API", async () => {
    const fetchMock = routeFetch(adminUser, [
      ["/admin/platform-summary", () => json(emptySummary)],
    ]);
    await renderAppWithUser(adminUser);
    goToProfileTab();

    await act(async () => buttonWithText("Admin Console")!.click());
    await settle();

    const summaryCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/admin/platform-summary"),
    )!;
    const authHeader = summaryCall[1]?.headers as Record<string, string> | undefined;
    expect(authHeader?.Authorization).toBe("Bearer test-access-token");
  });

  it("does not show the Admin Console entry for normal users", async () => {
    routeFetch(normalUser);
    await renderAppWithUser(normalUser);
    goToProfileTab();
    expect(buttonWithText("Admin Console")).toBeNull();
    expect(container.textContent).toContain("Register as a parking operator");
  });

  it("does not show the Admin Console entry for operator-only users", async () => {
    routeFetch(operatorUser);
    await renderAppWithUser(operatorUser);
    goToProfileTab();
    expect(buttonWithText("Admin Console")).toBeNull();
    expect(container.textContent).toContain("Parking Operations");
  });

  it("hides admin controls and makes no admin request when unauthenticated", async () => {
    const fetchMock = routeFetch(normalUser);
    await act(async () => root.render(<App />));
    await settle();
    goToProfileTab();
    expect(buttonWithText("Admin Console")).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/admin/"))).toBe(false);
  });

  it("removes admin access after logout", async () => {
    routeFetch(adminUser, [["/auth/logout", () => new Response(null, { status: 204 })]]);
    await renderAppWithUser(adminUser);
    goToProfileTab();

    await act(async () => buttonWithText("Sign out")!.click());
    await settle();

    expect(buttonWithText("Admin Console")).toBeNull();
    expect(container.textContent).toContain("Sign in to book parking");
  });

  it("shows both Admin Console and Parking Operations for users with both roles", async () => {
    routeFetch(adminAndOperatorUser);
    await renderAppWithUser(adminAndOperatorUser);
    goToProfileTab();
    expect(buttonWithText("Admin Console")).not.toBeNull();
    expect(buttonWithText("Parking Operations")).not.toBeNull();
  });

  it("preserves the regular navigation for admin users", async () => {
    routeFetch(adminUser);
    await renderAppWithUser(adminUser);
    expect(container.textContent).toContain("Parking near you");
    expect(container.textContent).toContain("My Bookings");
    goToProfileTab();
    expect(buttonWithText("Sign out")).not.toBeNull();
    expect(buttonWithText("Admin Console")).not.toBeNull();
  });

  it("does not allow non-admin users to open the admin screen through the UI", async () => {
    routeFetch(normalUser);
    await renderAppWithUser(normalUser);
    goToProfileTab();
    expect(buttonWithText("Admin Console")).toBeNull();
    expect(container.textContent).not.toContain("Admin Dashboard");
  });
});
