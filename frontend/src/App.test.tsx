import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PublicParkingFacility, PublicUser } from "@smartpark/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { clearMemorySession, setMemorySession, type AuthSession } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const facility: PublicParkingFacility = {
  id: 1,
  parkingId: "PUN-000001",
  name: "Shivaji Nagar Public Parking",
  description: null,
  type: "public",
  city: "Pune",
  state: "Maharashtra",
  area: "Shivaji Nagar",
  address: "FC Road",
  capacity: 40,
  hourlyRate: 80,
  availabilityMode: "MANUAL",
  totalSlots: 10,
  availableSlots: 6,
  availableVehicleTypes: ["car", "bike"],
  isLive: true,
  confidence: "HIGH",
  lastUpdatedAt: "2026-09-01T10:00:00.000Z",
};

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

let container: HTMLDivElement;
let root: Root;

function routeFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    for (const [fragment, handler] of Object.entries(handlers)) {
      if (url.includes(fragment)) return handler();
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

async function renderAppAndSettle() {
  act(() => root.render(<App />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function selectTab(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(
    (candidate) => candidate.textContent?.includes(label),
  )!;
  act(() => button.click());
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

describe("app shell", () => {
  it("surfaces a facilities outage with a retry action", async () => {
    routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ error: { message: "Availability service is down" } }), {
          status: 503,
        }),
    });
    await renderAppAndSettle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Availability service is down",
    );
    expect(container.textContent).toContain("Try again");
    expect(container.textContent).toContain("Sign in to book parking");
  });

  it("renders the home shell with navigation and real facility cards", async () => {
    routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [facility] }), { status: 200 }),
    });
    await renderAppAndSettle();
    expect(container.textContent).toContain("Parking near you");
    expect(container.textContent).toContain(facility.name);
    expect(container.textContent).toContain(facility.parkingId);
    expect(container.textContent).toContain("View slots");
    for (const label of ["Home", "Find Parking", "Bookings", "Pass", "Profile"]) {
      expect(container.textContent).toContain(label);
    }
  });

  it("navigates between the main tabs for a guest", async () => {
    routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [facility] }), { status: 200 }),
    });
    await renderAppAndSettle();

    selectTab("Find Parking");
    expect(container.textContent).toContain("Find Parking");
    expect(container.textContent).toContain(facility.name);

    selectTab("Bookings");
    expect(container.textContent).toContain("Your bookings");
    expect(container.textContent).toContain("Sign in to see your bookings and parking passes.");

    selectTab("Pass");
    expect(container.textContent).toContain("Parking pass");
    expect(container.textContent).toContain("Sign in to access your digital parking pass.");

    selectTab("Profile");
    expect(container.textContent).toContain("Your profile");
    expect(container.textContent).toContain("Create account");

    selectTab("Home");
    expect(container.textContent).toContain("Parking near you");
  });

  it("gates booking behind sign-in for guests", async () => {
    routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [facility] }), { status: 200 }),
    });
    await renderAppAndSettle();
    act(() => container.querySelector<HTMLButtonElement>(".facility-card")!.click());
    expect(container.textContent).toContain("Welcome back");
    expect(container.querySelector("#auth-email")).not.toBeNull();

    act(() => container.querySelector<HTMLButtonElement>(".sp-subpage-back")!.click());
    expect(container.textContent).toContain("Parking near you");
  });

  it("opens the booking flow for an authenticated user", async () => {
    const fetchMock = routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [facility] }), { status: 200 }),
      "/auth/me": () => new Response(JSON.stringify(user), { status: 200 }),
    });
    setMemorySession(session);
    await renderAppAndSettle();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/me"))).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>(".facility-card")!.click());
    expect(container.textContent).toContain(facility.name);
    expect(container.querySelector(".sp-subpage-back")).not.toBeNull();
  });
});
