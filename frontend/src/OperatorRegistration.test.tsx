import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Operator, PublicUser } from "@smartpark/shared";
import App from "./App";
import OperatorRegistration from "./OperatorRegistration";
import { clearMemorySession, setMemorySession, type AuthSession } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const normalUser: PublicUser = {
  id: 7,
  email: "driver@example.com",
  fullName: "Asha Driver",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: "2026-09-01T10:00:00.000Z",
};
const operatorUser: PublicUser = { ...normalUser, roles: ["USER", "PARKING_OPERATOR"] };
const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInSeconds: 1800,
  user: normalUser,
} satisfies AuthSession;
const operator: Operator = {
  id: 3,
  name: "New Parking Co",
  businessType: "private",
  registrationNumber: "REG-123",
  verificationStatus: "PENDING",
  createdAt: "2026-09-01T10:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderRegistration() {
  await act(async () =>
    root.render(
      <OperatorRegistration
        accessToken="access-token"
        onOpenDashboard={vi.fn()}
        onRegistered={vi.fn(async () => undefined)}
      />,
    ),
  );
}

function setInput(id: string, value: string) {
  act(() => {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderAppWithUser(user: PublicUser) {
  setMemorySession({ ...session, user });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/parking/facilities")) {
      return new Response(JSON.stringify({ facilities: [] }), { status: 200 });
    }
    if (url.includes("/auth/me")) {
      return new Response(JSON.stringify(user), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  await act(async () => root.render(<App />));
  await settle();
}

function goToProfileTab() {
  const profileTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(
    (button) => button.textContent?.includes("Profile"),
  )!;
  act(() => profileTab.click());
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

describe("operator registration access", () => {
  it("does not expose registration to unauthenticated users", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ facilities: [] }), { status: 200 }));
    await act(async () => root.render(<App />));
    await settle();
    expect(container.textContent).not.toContain("Register as a parking operator");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/operators/register"))).toBe(
      false,
    );
  });

  it("shows registration to an authenticated normal user", async () => {
    await renderAppWithUser(normalUser);
    goToProfileTab();
    expect(container.textContent).toContain("Register as a parking operator");
    expect(container.textContent).not.toContain("Parking Operations");
  });

  it("does not show registration to an existing operator", async () => {
    await renderAppWithUser(operatorUser);
    goToProfileTab();
    expect(container.textContent).not.toContain("Register as a parking operator");
    expect(container.textContent).toContain("Parking Operations");
  });
});

describe("operator registration form", () => {
  it("renders only the operator registration fields and validates the name", async () => {
    await renderRegistration();
    expect(container.querySelector("#operator-name")).not.toBeNull();
    expect(container.querySelector("#operator-business-type")).not.toBeNull();
    expect(container.querySelector("#operator-registration-number")).not.toBeNull();
    expect(container.querySelector("#facility-name")).toBeNull();
    setInput("operator-name", " ");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(container.textContent).toContain("Enter an operator organization name");
  });

  it("submits the exact fields, shows loading, prevents duplicates, and revalidates the role", async () => {
    let resolveRegistration!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await renderAppWithUser(normalUser);
    goToProfileTab();
    const entryButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Register as a parking operator"),
    )!;
    await act(async () => entryButton.click());
    setInput("operator-name", "New Parking Co");
    setInput("operator-business-type", "private");
    setInput("operator-registration-number", "REG-123");
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRegistration = resolve;
      }),
    );
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(container.textContent).toContain("Registering...");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/operators/register")).length,
    ).toBe(1);
    const registerCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/operators/register"),
    )!;
    expect(registerCall[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        name: "New Parking Co",
        businessType: "private",
        registrationNumber: "REG-123",
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
    resolveRegistration(new Response(JSON.stringify(operator), { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(operatorUser), { status: 200 }));
    await settle();
    expect(container.textContent).toContain("Operator organization created");
    expect(container.textContent).toContain("pending");
    expect(container.textContent).toContain("Operator Dashboard");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/me"))).toBe(true);
  });

  it("shows registration API, authorization, network, and malformed-response errors", async () => {
    const errors = [
      [400, "Invalid organization name"],
      [401, "Your session is no longer authorized"],
      [403, "Your account is not authorized"],
      [503, "Service unavailable"],
    ] as const;
    for (const [status, message] of errors) {
      vi.restoreAllMocks();
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "ERROR", message } }), { status }),
        );
      await renderRegistration();
      setInput("operator-name", "New Parking Co");
      await act(async () => container.querySelector("form")!.requestSubmit());
      await settle();
      expect(container.textContent).toContain(message);
      fetchMock.mockRestore();
      act(() => root.unmount());
      container.replaceChildren();
      root = createRoot(container);
    }

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await renderRegistration();
    setInput("operator-name", "New Parking Co");
    await act(async () => container.querySelector("form")!.requestSubmit());
    await settle();
    expect(container.textContent).toContain("Unable to reach the operator service");
  });

  it("rejects a malformed successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: operator.id }), { status: 201 }),
    );
    await renderRegistration();
    setInput("operator-name", "New Parking Co");
    await act(async () => container.querySelector("form")!.requestSubmit());
    await settle();
    expect(container.textContent).toContain("incomplete or malformed");
  });
});
