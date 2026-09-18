import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PublicUser } from "@smartpark/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { clearMemorySession, type AuthSession } from "./api/auth";

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

let container: HTMLDivElement;
let root: Root;

function routeFetch(
  handlers: Record<string, (input: RequestInfo | URL) => Response | Promise<Response>>,
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    for (const [fragment, handler] of Object.entries(handlers)) {
      if (url.includes(fragment)) return handler(input);
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

function goToProfileTab() {
  const profileTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(
    (button) => button.textContent?.includes("Profile"),
  )!;
  act(() => profileTab.click());
}

function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  button.click();
}

function setInput(id: string, value: string) {
  act(() => {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderAppAndSettle() {
  act(() => root.render(<App />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openAuth(mode: "login" | "register") {
  goToProfileTab();
  act(() => {
    clickButton(mode === "login" ? "Sign in" : "Create account");
  });
}

async function submitForm() {
  await act(async () => {
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
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

describe("frontend authentication foundation", () => {
  it("starts unauthenticated, keeps browsing available, and offers sign-in", async () => {
    routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
    });
    await renderAppAndSettle();
    expect(container.textContent).toContain("Parking near you");
    expect(container.textContent).toContain("Sign in to book parking");
    goToProfileTab();
    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).toContain("Create account");
  });

  it("shows loading during login, validates /auth/me, and displays the user", async () => {
    let resolveLogin!: (value: Response) => void;
    const loginRequest = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });
    const fetchMock = routeFetch({
      "/auth/login": () => loginRequest,
      "/auth/me": () => new Response(JSON.stringify(user), { status: 200 }),
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
    });
    await renderAppAndSettle();
    await openAuth("login");
    setInput("auth-email", user.email);
    setInput("auth-password", "password123");
    act(() => {
      container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    });
    expect(container.textContent).toContain("Signing in...");
    resolveLogin(new Response(JSON.stringify(session), { status: 200 }));
    await act(async () => await loginRequest);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("/auth/login"))
        .length,
    ).toBe(1);
    expect(
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("/auth/me")).length,
    ).toBe(1);
    expect(container.textContent).toContain("Asha Driver");
    expect(container.textContent).toContain("Sign out");
  });

  it("handles invalid login credentials", async () => {
    const fetchMock = routeFetch({
      "/auth/login": () =>
        new Response(
          JSON.stringify({
            error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
          }),
          { status: 401 },
        ),
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
    });
    await renderAppAndSettle();
    await openAuth("login");
    setInput("auth-email", user.email);
    setInput("auth-password", "wrongpassword");
    await submitForm();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Invalid email or password",
    );
    expect(
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("/auth/login"))
        .length,
    ).toBe(1);
  });

  it("handles registration success", async () => {
    const fetchMock = routeFetch({
      "/auth/register": () => new Response(JSON.stringify(session), { status: 201 }),
      "/auth/me": () => new Response(JSON.stringify(user), { status: 200 }),
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
    });
    await renderAppAndSettle();
    await openAuth("register");
    setInput("auth-name", user.fullName ?? "");
    setInput("auth-email", user.email);
    setInput("auth-password", "password123");
    await submitForm();
    expect(container.textContent).toContain("Asha Driver");
    expect(
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("/auth/register"))
        .length,
    ).toBe(1);
  });

  it("handles registration validation and API errors", async () => {
    const fetchMock = routeFetch({
      "/auth/register": () =>
        new Response(
          JSON.stringify({
            error: { code: "DUPLICATE_EMAIL", message: "Email already registered" },
          }),
          { status: 409 },
        ),
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
    });
    await renderAppAndSettle();
    await openAuth("register");
    setInput("auth-name", user.fullName ?? "");
    setInput("auth-email", user.email);
    setInput("auth-password", "short");
    await submitForm();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Password must be at least 8 characters",
    );
    setInput("auth-password", "password123");
    await submitForm();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "An account with that email already exists. Sign in instead.",
    );
    expect(
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("/auth/register"))
        .length,
    ).toBe(1);
  });

  it("handles expired sessions by attempting refresh, then returns to unauthenticated state", async () => {
    const fetchMock = routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
      "/auth/me": () =>
        new Response(
          JSON.stringify({
            error: { code: "INVALID_TOKEN", message: "Invalid or expired access token" },
          }),
          { status: 401 },
        ),
      "/auth/refresh": () =>
        new Response(
          JSON.stringify({
            error: { code: "REFRESH_TOKEN_INVALID", message: "Invalid or revoked refresh token" },
          }),
          { status: 401 },
        ),
    });
    const { setMemorySession } = await import("./api/auth");
    setMemorySession(session);
    await renderAppAndSettle();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("/auth/me")).length,
    ).toBe(1);
    expect(
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("/auth/refresh"))
        .length,
    ).toBe(1);
    expect(container.textContent).toContain("Your session has expired");
    expect(container.textContent).toContain("Sign in to book parking");
  });

  it("logs out with the backend contract and clears the session", async () => {
    const fetchMock = routeFetch({
      "/parking/facilities": () =>
        new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
      "/auth/me": () => new Response(JSON.stringify(user), { status: 200 }),
      "/auth/logout": () => new Response(null, { status: 204 }),
    });
    const { setMemorySession } = await import("./api/auth");
    setMemorySession(session);
    await renderAppAndSettle();
    goToProfileTab();
    act(() => {
      clickButton("Sign out");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      fetchMock.mock.calls.some((call: unknown[]) => String(call[0]).includes("/auth/logout")),
    ).toBe(true);
    expect(container.textContent).toContain("Sign in to book parking");
    expect(container.textContent).not.toContain("Sign out");
  });
});
