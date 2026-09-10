import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@smartpark/shared";
import App from "./App";
import { clearMemorySession, setMemorySession, type AuthSession } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderAppWithUser(user: PublicUser) {
  setMemorySession({ ...session, user });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(user), { status: 200 }),
  );
  await act(async () => root.render(<App />));
  await settle();
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
  it("shows Admin Control Panel button for ADMIN users", async () => {
    await renderAppWithUser(adminUser);
    const adminButton = buttonWithText("Admin Control Panel");
    expect(adminButton).not.toBeNull();
    expect(adminButton?.tagName).toBe("BUTTON");
  });

  it("opens AdminDashboard when the Admin Control Panel button is clicked", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(adminUser), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ operators: [] }), { status: 200 }));
    await renderAppWithUser(adminUser);

    await act(async () => buttonWithText("Admin Control Panel")!.click());
    await settle();

    expect(container.textContent).toContain("Admin Dashboard");
    expect(container.textContent).toContain("Operator verification");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toContain("/admin/operators");
  });

  it("passes the current access token to AdminDashboard", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(adminUser), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ operators: [] }), { status: 200 }));
    await renderAppWithUser(adminUser);

    await act(async () => buttonWithText("Admin Control Panel")!.click());
    await settle();

    const authHeader = fetchMock.mock.calls[1]![1]?.headers as Record<string, string> | undefined;
    expect(authHeader?.Authorization).toBe("Bearer test-access-token");
  });

  it("does not show Admin Control Panel button for normal users", async () => {
    await renderAppWithUser(normalUser);
    expect(buttonWithText("Admin Control Panel")).toBeNull();
    expect(container.textContent).toContain("Check a parking facility");
    expect(container.textContent).toContain("Sign out");
  });

  it("does not show Admin Control Panel button for operator-only users", async () => {
    await renderAppWithUser(operatorUser);
    expect(buttonWithText("Admin Control Panel")).toBeNull();
    expect(container.textContent).toContain("Operator Dashboard");
  });

  it("hides admin controls and makes no admin request when unauthenticated", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await act(async () => root.render(<App />));
    expect(buttonWithText("Admin Control Panel")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes admin access after logout", async () => {
    await renderAppWithUser(adminUser);
    const signOut = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav button")).find(
      (button) => button.textContent?.includes("Sign out"),
    )!;
    await act(async () => signOut.click());
    expect(buttonWithText("Admin Control Panel")).toBeNull();
    expect(container.textContent).toContain("Sign in");
  });

  it("shows Admin Control Panel for users with both ADMIN and PARKING_OPERATOR roles", async () => {
    await renderAppWithUser(adminAndOperatorUser);
    expect(buttonWithText("Admin Control Panel")).not.toBeNull();
    expect(buttonWithText("Operator Dashboard")).not.toBeNull();
  });

  it("preserves availability screen and all other navigation for admin users", async () => {
    await renderAppWithUser(adminUser);
    expect(container.textContent).toContain("Check a parking facility");
    expect(container.textContent).toContain("My Reservations");
    expect(buttonWithText("Admin Control Panel")).not.toBeNull();
    expect(buttonWithText("Sign out")).not.toBeNull();
  });

  it("does not allow non-admin users to open the admin screen through the UI", async () => {
    await renderAppWithUser(normalUser);
    expect(buttonWithText("Admin Control Panel")).toBeNull();
    expect(container.textContent).not.toContain("Admin Dashboard");
    expect(container.textContent).not.toContain("Operator verification");
  });
});
