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

function buttonWithText(text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes(text),
  )!;
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

describe("operator dashboard", () => {
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

  it("creates a slot with server-authoritative defaults and updates the selected list", async () => {
    const createdSlot = {
      ...slot,
      id: 10,
      slotCode: "B01",
      vehicleType: "car",
      status: "AVAILABLE" as const,
      reservationsEnabled: true,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(createdSlot), { status: 201 }));
    await renderDashboard();
    await act(async () => buttonWithText("Create Parking Slot").click());
    expect(container.textContent).toContain("server default: AVAILABLE");
    expect(container.textContent).toContain("server default: enabled");
    setField("slot-code", " B01 ");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]![0]).toContain("/operators/me/facilities/4/slots");
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ slotCode: "B01" }),
    });
    expect(container.textContent).toContain("B01");
    expect(container.textContent).toContain("reservations enabled");
    expect(container.textContent).toContain("created with status AVAILABLE");
    expect(container.querySelector(".slot-create-form")).toBeNull();
    expect(container.querySelector(".facility-item.selected")?.textContent).toContain(
      "Koregaon Lot",
    );
  });

  it("validates slot creation and preserves the selected facility", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Create Parking Slot").click());
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Enter a slot code");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    setField("slot-code", "x".repeat(41));
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("40 characters or fewer");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    setField("slot-code", "B01");
    setField("slot-vehicle-type", "v".repeat(33));
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("32 characters or fewer");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector(".facility-item.selected")?.textContent).toContain(
      "Koregaon Lot",
    );
  });

  it("edits a slot using read-only identity fields and the authoritative response", async () => {
    const updatedSlot = {
      ...slot,
      vehicleType: "motorcycle",
      status: "OCCUPIED" as const,
      reservationsEnabled: false,
      updatedAt: "2026-09-01T11:00:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updatedSlot), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit slot").click());
    expect(container.querySelector<HTMLInputElement>("#edit-slot-code-9")?.readOnly).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#edit-slot-code-9")?.value).toBe("A01");
    setField("edit-slot-vehicle-type-9", " motorcycle ");
    setField("edit-slot-status-9", "OCCUPIED", "change");
    await act(async () =>
      container.querySelector<HTMLInputElement>("#edit-slot-reservations-9")!.click(),
    );
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-edit-form")!.requestSubmit(),
    );
    await settle();

    expect(fetchMock.mock.calls[3]![0]).toContain("/facilities/4/slots/9");
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        vehicleType: "motorcycle",
        status: "OCCUPIED",
        reservationsEnabled: false,
      }),
    });
    expect(container.querySelector(".slot-edit-form")).toBeNull();
    expect(container.textContent).toContain("A01 was updated with status OCCUPIED");
    expect(container.textContent).toContain("motorcycle · OCCUPIED · reservations disabled");
  });

  it("validates slot edits before making a PATCH request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit slot").click());
    setField("edit-slot-vehicle-type-9", " ");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Enter a vehicle type");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows slot creation loading state and prevents duplicate POST requests", async () => {
    let resolveCreate!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Create Parking Slot").click());
    setField("slot-code", "B01");
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const form = container.querySelector<HTMLFormElement>(".slot-create-form")!;
    await act(async () => form.requestSubmit());
    expect(container.textContent).toContain("Creating...");
    expect(
      container.querySelector<HTMLButtonElement>(".slot-create-form button[type=submit]")?.disabled,
    ).toBe(true);
    await act(async () => form.requestSubmit());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    resolveCreate(new Response(JSON.stringify({ ...slot, slotCode: "B01" }), { status: 201 }));
    await settle();
  });

  it.each([
    [400, "400 failure", "VALIDATION_ERROR"],
    [401, "Your operator session is no longer authorized", "UNAUTHORIZED"],
    [403, "Your account is not authorized", "FORBIDDEN"],
    [404, "404 failure", "FACILITY_NOT_FOUND"],
    [409, "409 failure", "DUPLICATE_SLOT_CODE"],
  ])("shows slot creation error %i and preserves form data", async (status, message, code) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code, message: `${status} failure` } }), { status }),
      );
    await renderDashboard();
    await act(async () => buttonWithText("Create Parking Slot").click());
    setField("slot-code", "B01");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(container.querySelector<HTMLInputElement>("#slot-code")?.value).toBe("B01");
  });

  it("ignores a stale slot creation response after changing facilities", async () => {
    let resolveCreate!: (response: Response) => void;
    const secondSlot = { ...slot, id: 10, facilityId: secondFacility.id, slotCode: "B01" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([facility, secondFacility]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Create Parking Slot").click());
    setField("slot-code", "A02");
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([secondSlot]), { status: 200 }));
    const camp = Array.from(container.querySelectorAll<HTMLButtonElement>(".facility-item")).find(
      (button) => button.textContent?.includes("Camp Lot"),
    )!;
    await act(async () => camp.click());
    await settle();
    resolveCreate(new Response(JSON.stringify({ ...slot, slotCode: "A02" }), { status: 201 }));
    await settle();

    expect(container.querySelector(".facility-item.selected")?.textContent).toContain("Camp Lot");
    expect(container.textContent).toContain("B01");
    expect(container.textContent).not.toContain("A02");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("opens the selected facility edit form with authoritative values", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());

    expect(container.querySelector<HTMLInputElement>("#edit-facility-name")?.value).toBe(
      facility.name,
    );
    expect(container.querySelector<HTMLSelectElement>("#edit-facility-type")?.value).toBe(
      facility.type,
    );
    expect(container.querySelector<HTMLInputElement>("#edit-facility-city")?.value).toBe(
      facility.city,
    );
    expect(container.querySelector<HTMLInputElement>("#edit-facility-capacity")?.value).toBe(
      String(facility.capacity),
    );
    expect(container.querySelector("#edit-facility-is-active")).toBeNull();
    expect(container.querySelector("#edit-facility-verification-status")).toBeNull();
    expect(container.querySelector("#edit-facility-operator-id")).toBeNull();
  });

  it("validates edit fields before making a PATCH request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());

    setField("edit-facility-name", " ");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Name, facility type, and city are required");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    setField("edit-facility-name", facility.name);
    setField("edit-facility-capacity", "0");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Capacity must be a whole number");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    setField("edit-facility-capacity", String(facility.capacity));
    setField("edit-facility-latitude", "91");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Enter valid latitude and longitude");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("updates only the selected facility from the authoritative PATCH response", async () => {
    const updatedFacility = {
      ...facility,
      name: "Updated Lot",
      city: "Mumbai",
      capacity: 90,
      updatedAt: "2026-09-01T11:00:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([facility, secondFacility]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());
    setField("edit-facility-name", "Updated Lot");
    setField("edit-facility-city", "Mumbai");
    setField("edit-facility-capacity", "90");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(updatedFacility), { status: 200 }));
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]![0]).toContain("/operators/me/facilities/4");
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Lot",
        type: "private",
        city: "Mumbai",
        capacity: 90,
        state: "Maharashtra",
        area: "Koregaon Park",
      }),
    });
    expect(container.textContent).toContain("Updated Lot");
    expect(container.textContent).toContain("updated successfully");
    expect(container.textContent).toContain("Camp Lot");
    expect(container.querySelector(".facility-item.selected")?.textContent).toContain(
      "Updated Lot",
    );
    expect(container.querySelector(".facility-edit-form")).toBeNull();
  });

  it("shows saving state and prevents duplicate PATCH submissions", async () => {
    let resolveUpdate!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const form = container.querySelector<HTMLFormElement>(".facility-edit-form")!;
    await act(async () => form.requestSubmit());
    expect(container.textContent).toContain("Saving...");
    expect(container.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true);
    await act(async () => form.requestSubmit());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    resolveUpdate(new Response(JSON.stringify(facility), { status: 200 }));
    await settle();
  });

  it.each([
    [400, "400 failure", "VALIDATION_ERROR"],
    [401, "Your operator session is no longer authorized", "UNAUTHORIZED"],
    [403, "Your account is not authorized", "FORBIDDEN"],
    [404, "404 failure", "FACILITY_NOT_FOUND"],
    [409, "409 failure", "CONFLICT"],
  ])("shows facility update error %i", async (status, message, code) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code, message: `${status} failure` } }), { status }),
      );
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(container.querySelector<HTMLInputElement>("#edit-facility-name")?.value).toBe(
      facility.name,
    );
  });

  it("keeps edit state protected when selection changes before PATCH resolves", async () => {
    let resolveUpdate!: (response: Response) => void;
    const secondSlot = { ...slot, id: 10, facilityId: secondFacility.id, slotCode: "B01" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([facility, secondFacility]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([secondSlot]), { status: 200 }));
    const camp = Array.from(container.querySelectorAll<HTMLButtonElement>(".facility-item")).find(
      (button) => button.textContent?.includes("Camp Lot"),
    )!;
    await act(async () => camp.click());
    await settle();
    resolveUpdate(
      new Response(JSON.stringify({ ...facility, name: "Stale Update" }), { status: 200 }),
    );
    await settle();

    expect(container.querySelector(".facility-item.selected")?.textContent).toContain("Camp Lot");
    expect(container.textContent).not.toContain("Stale Update");
    expect(container.textContent).toContain("B01");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("ignores a stale facility update error after selection changes", async () => {
    let rejectUpdate!: (reason: Error) => void;
    const secondSlot = { ...slot, id: 10, facilityId: secondFacility.id, slotCode: "B01" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([facility, secondFacility]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());
    fetchMock.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectUpdate = reject;
      }),
    );
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([secondSlot]), { status: 200 }));
    const camp = Array.from(container.querySelectorAll<HTMLButtonElement>(".facility-item")).find(
      (button) => button.textContent?.includes("Camp Lot"),
    )!;
    await act(async () => camp.click());
    await settle();
    rejectUpdate(new Error("stale failure"));
    await settle();

    expect(container.querySelector(".facility-item.selected")?.textContent).toContain("Camp Lot");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("B01");
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
    for (const text of ["Delete", "Save", "Update"]) {
      expect(container.textContent).not.toContain(text);
    }
    expect(container.textContent).toContain("Create facility");
    expect(container.textContent).toContain("Edit facility");
  });
});
