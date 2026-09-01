import { act } from "react";
import type { PublicUser } from "@smartpark/shared";
import { createRoot, type Root } from "react-dom/client";
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

async function renderApp() {
  await act(async () => root.render(<App />));
}

async function remountApp() {
  act(() => root.unmount());
  container.replaceChildren();
  root = createRoot(container);
  await renderApp();
}

function setInput(id: string, value: string) {
  act(() => {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(label: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav button")).find(
      (candidate) => candidate.textContent?.includes(label),
    );
    if (!button) throw new Error(`Navigation button not found: ${label}`);
    button.click();
  });
}

async function submitForm() {
  await act(async () => {
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function startFormSubmission() {
  act(() => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
}

beforeEach(async () => {
  clearMemorySession();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await renderApp();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMemorySession();
  vi.restoreAllMocks();
});

describe("frontend authentication foundation", () => {
  it("starts unauthenticated and keeps availability available", () => {
    expect(container.textContent).toContain("Check a parking facility");
    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).toContain("Create account");
  });

  it("shows loading during login, validates /auth/me, and displays the user", async () => {
    let resolveLogin!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const loginRequest = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });
    fetchMock
      .mockReturnValueOnce(loginRequest)
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }));
    await clickButton("Sign in");
    setInput("login-email", user.email);
    setInput("login-password", "password123");
    startFormSubmission();
    expect(container.textContent).toContain("Signing in...");
    resolveLogin(new Response(JSON.stringify(session), { status: 200 }));
    await act(async () => await loginRequest);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toContain("/auth/me");
    expect(container.textContent).toContain(user.fullName!);
    expect(container.textContent).toContain("Sign out");
  });

  it("handles invalid login credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
        }),
        { status: 401 },
      ),
    );
    await clickButton("Sign in");
    setInput("login-email", user.email);
    setInput("login-password", "wrong");
    await submitForm();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Invalid email or password",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles registration success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await clickButton("Create account");
    setInput("register-name", user.fullName!);
    setInput("register-email", user.email);
    setInput("register-password", "password123");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }));
    await submitForm();
    expect(container.textContent).toContain(user.fullName);
  });

  it("handles registration validation and API errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "DUPLICATE_EMAIL", message: "Email already registered" },
        }),
        { status: 409 },
      ),
    );
    await clickButton("Create account");
    setInput("register-email", user.email);
    setInput("register-password", "short");
    await submitForm();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("between 8 and 128");
    setInput("register-password", "password123");
    await submitForm();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Email already registered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles expired sessions by attempting refresh, then returns to unauthenticated state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "INVALID_TOKEN", message: "Invalid or expired access token" },
        }),
        { status: 401 },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "REFRESH_TOKEN_INVALID", message: "Invalid or revoked refresh token" },
        }),
        { status: 401 },
      ),
    );
    const { setMemorySession } = await import("./api/auth");
    setMemorySession(session);
    await remountApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Your session has expired");
    expect(container.textContent).toContain("Sign in");
  });

  it("logs out with the backend contract and clears the session", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }));
    const { setMemorySession } = await import("./api/auth");
    setMemorySession(session);
    await remountApp();
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await clickButton("Sign out");
    expect(fetchMock.mock.calls[1]![0]).toContain("/auth/logout");
    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).not.toContain("Sign out");
  });
});
