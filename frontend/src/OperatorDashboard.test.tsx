import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Operator, ParkingFacility, ParkingSlot, PublicUser } from "@smartpark/shared";
import App from "./App";
import OperatorDashboard from "./OperatorDashboard";
import { clearMemorySession, setMemorySession, type AuthSession } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

const normalUser: PublicUser = { ...operatorUser, email: "driver@example.com", roles: ["USER"] };
const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInSeconds: 1800,
  user: operatorUser,
} satisfies AuthSession;

const operator: Operator = {
  id: 3,
  name: "Koregaon Parking Co",
  businessType: "private",
  registrationNumber: "ABC-123",
  verificationStatus: "ACTIVE",
  createdAt: "2026-09-01T10:00:00.000Z",
};

const facility: ParkingFacility = {
  id: 4,
  parkingId: "PUN-000004",
  name: "Koregaon Lot",
  description: null,
  type: "private",
  country: "India",
  state: "Maharashtra",
  city: "Pune",
  area: "Koregaon Park",
  address: null,
  latitude: null,
  longitude: null,
  operatorId: 3,
  capacity: 40,
  verificationStatus: "VERIFIED",
  availabilityMode: "MANUAL",
  isActive: true,
  isDemo: false,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};
const secondFacility = { ...facility, id: 5, parkingId: "PUN-000005", name: "Camp Lot" };
const slot: ParkingSlot = {
  id: 9,
  slotCode: "A01",
  facilityId: 4,
  zoneId: null,
  vehicleType: "car",
  status: "AVAILABLE",
  reservationsEnabled: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDashboard() {
  await act(async () => root.render(<OperatorDashboard accessToken="access-token" />));
  await settle();
}

async function renderAppWithUser(user: PublicUser) {
  setMemorySession({ ...session, user });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(user), { status: 200 }),
  );
  await act(async () => root.render(<App />));
  await settle();
}

function setField(id: string, value: string, eventName = "input") {
  act(() => {
    const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
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

describe("operator dashboard visibility", () => {
  it("shows navigation only for a server-issued operator role", async () => {
    await renderAppWithUser(operatorUser);
    expect(container.textContent).toContain("Operator Dashboard");
    expect(container.textContent).toContain("Check a parking facility");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("hides navigation and makes no operator request for a normal user", async () => {
    await renderAppWithUser(normalUser);
    expect(container.textContent).not.toContain("Operator Dashboard");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/operators/"))).toBe(
      false,
    );
  });

  it("hides navigation and makes no request while unauthenticated", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await act(async () => root.render(<App />));
    expect(container.textContent).not.toContain("Operator Dashboard");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes operator access after logout", async () => {
    await renderAppWithUser(operatorUser);
    const logout = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav button")).find(
      (button) => button.textContent?.includes("Sign out"),
    )!;
    await act(async () => logout.click());
    expect(container.textContent).not.toContain("Operator Dashboard");
  });
});

describe("read-only operator dashboard", () => {
  it("loads profile and facilities, then lazily loads slots for the selected facility", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([facility, secondFacility]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("Koregaon Parking Co");
    expect(container.textContent).toContain("Koregaon Lot");
    expect(container.textContent).toContain("A01");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![0]).toContain("/facilities/4/slots");

    const camp = Array.from(container.querySelectorAll<HTMLButtonElement>(".facility-item")).find(
      (button) => button.textContent?.includes("Camp Lot"),
    )!;
    await act(async () => camp.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]![0]).toContain("/facilities/5/slots");
  });

  it("shows profile loading while the profile request is pending", async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await act(async () => root.render(<OperatorDashboard accessToken="access-token" />));
    expect(container.textContent).toContain("Loading operator profile");
    resolve(new Response(JSON.stringify(operator), { status: 200 }));
  });

  it("shows facilities loading and the empty facility state", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("No facilities are associated");
    expect(container.textContent).not.toContain("slots");
  });

  it("shows an empty slot state", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("has no slots to display");
  });

  it("validates and creates a facility without sending client-owned fields", async () => {
    const createdFacility = {
      ...facility,
      id: 8,
      parkingId: "PUN-000008",
      name: "New Lot",
      verificationStatus: "PENDING" as const,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(createdFacility), { status: 201 }));
    await renderDashboard();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-create-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Name, facility type, and city are required");

    setField("facility-name", "New Lot");
    setField("facility-type", "private", "change");
    setField("facility-city", "Pune");
    setField("facility-capacity", "80");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-create-form")!.requestSubmit(),
    );
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "New Lot", type: "private", city: "Pune", capacity: 80 }),
    });
    expect(container.textContent).toContain("New Lot");
    expect(container.textContent).toContain("pending verification");
  });

  it("disables duplicate facility submissions while creation is pending", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
    await renderDashboard();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    setField("facility-name", "New Lot");
    setField("facility-type", "private", "change");
    setField("facility-city", "Pune");
    setField("facility-capacity", "80");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-create-form")!.requestSubmit(),
    );
    expect(
      container.querySelector<HTMLButtonElement>(".facility-create-form button[type=submit]")
        ?.disabled,
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    resolve(new Response(JSON.stringify({ ...facility, name: "New Lot" }), { status: 201 }));
    await settle();
  });

  it.each([
    [400, "400 failure"],
    [401, "Your operator session is no longer authorized"],
    [403, "Your operator account is inactive"],
    [409, "409 failure"],
  ])("shows facility creation error %i", async (status, message) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code:
                status === 403
                  ? "ACCOUNT_INACTIVE"
                  : status === 409
                    ? "CONFLICT"
                    : status === 401
                      ? "UNAUTHORIZED"
                      : "VALIDATION_ERROR",
              message: `${status} failure`,
            },
          }),
          { status },
        ),
      );
    await renderDashboard();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    setField("facility-name", "New Lot");
    setField("facility-type", "private", "change");
    setField("facility-city", "Pune");
    setField("facility-capacity", "80");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-create-form")!.requestSubmit(),
    );
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it.each([
    [401, "Your operator session is no longer authorized"],
    [403, "Your account is not authorized"],
  ])("shows authorization errors for profile status %i", async (status, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "AUTH", message: "Denied" } }), { status }),
    );
    await renderDashboard();
    expect(container.textContent).toContain(message);
  });

  it("shows API errors, network errors, and malformed responses safely", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "SERVICE_DOWN", message: "Try again later" } }),
        {
          status: 503,
        },
      ),
    );
    await renderDashboard();
    expect(container.textContent).toContain("Try again later");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    act(() => root.unmount());
    container.replaceChildren();
    root = createRoot(container);
    await renderDashboard();
    expect(container.textContent).toContain("Unable to reach the operator service");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: operator.id }), { status: 200 }),
    );
    act(() => root.unmount());
    container.replaceChildren();
    root = createRoot(container);
    await renderDashboard();
    expect(container.textContent).toContain("incomplete or malformed");
  });

  it("renders no facility mutation controls other than creation", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    for (const text of ["Edit", "Delete", "Save", "Update"]) {
      expect(container.textContent).not.toContain(text);
    }
    expect(container.textContent).toContain("Create facility");
  });
});
