import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Operator,
  ParkingFacility,
  ParkingSlot,
  PublicUser,
  Reservation,
} from "@smartpark/shared";
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

const reservation: Reservation = {
  id: 12,
  reservationCode: "BKG-ABC123",
  userId: 7,
  facilityId: 4,
  zoneId: null,
  slotId: 9,
  startsAt: "2026-09-10T08:00:00.000Z",
  endsAt: "2026-09-10T10:00:00.000Z",
  state: "CONFIRMED",
  cancelReason: null,
  cancelledAt: null,
  confirmedAt: "2026-09-01T10:05:00.000Z",
  createdAt: "2026-09-01T10:05:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
};

const zonedReservation: Reservation = {
  ...reservation,
  id: 13,
  reservationCode: "BKG-ZONE456",
  zoneId: 6,
  slotId: null,
};

const uncountedReservation: Reservation = {
  ...reservation,
  id: 14,
  reservationCode: "BKG-OTHER789",
  facilityId: 999,
  slotId: 100,
  state: "COMPLETED",
  confirmedAt: null,
};

const cancelledReservation: Reservation = {
  ...reservation,
  id: 15,
  reservationCode: "BKG-CANCELLED",
  state: "CANCELLED",
  confirmedAt: null,
  cancelledAt: "2026-09-02T09:30:00.000Z",
  cancelReason: "Customer changed plans",
};

function reservationsResponse(items: Reservation[]): Response {
  return new Response(JSON.stringify({ reservations: items }), { status: 200 });
}

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

function setTextarea(id: string, value: string) {
  act(() => {
    const element = container.querySelector<HTMLTextAreaElement>(`#${id}`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonWithText(text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes(text),
  )!;
}

function reservationCard(code: string): HTMLLIElement {
  return Array.from(container.querySelectorAll<HTMLLIElement>(".reservation-card")).find((card) =>
    card.textContent?.includes(code),
  )!;
}

function reservationError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
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
      .mockResolvedValueOnce(reservationsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("Koregaon Parking Co");
    expect(container.textContent).toContain("Koregaon Lot");
    expect(container.textContent).toContain("A01");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]![0]).toContain("/operators/me/reservations");
    expect(fetchMock.mock.calls[3]![0]).toContain("/facilities/4/slots");

    const camp = Array.from(container.querySelectorAll<HTMLButtonElement>(".facility-item")).find(
      (button) => button.textContent?.includes("Camp Lot"),
    )!;
    await act(async () => camp.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4]![0]).toContain("/facilities/5/slots");
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
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([]));
    await renderDashboard();
    expect(container.textContent).toContain("No facilities are associated");
    expect(container.textContent).not.toContain("slots");
  });

  it("shows an empty slot state", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([]))
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
      .mockResolvedValueOnce(reservationsResponse([]))
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

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4]![0]).toContain("/operators/me/facilities/4/slots");
    expect(fetchMock.mock.calls[4]![1]).toMatchObject({
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
      .mockResolvedValueOnce(reservationsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Create Parking Slot").click());
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Enter a slot code");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    setField("slot-code", "x".repeat(41));
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("40 characters or fewer");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    setField("slot-code", "B01");
    setField("slot-vehicle-type", "v".repeat(33));
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-create-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("32 characters or fewer");
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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

    expect(fetchMock.mock.calls[4]![0]).toContain("/facilities/4/slots/9");
    expect(fetchMock.mock.calls[4]![1]).toMatchObject({
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
      .mockResolvedValueOnce(reservationsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit slot").click());
    setField("edit-slot-vehicle-type-9", " ");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".slot-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Enter a vehicle type");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("shows slot creation loading state and prevents duplicate POST requests", async () => {
    let resolveCreate!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("opens the selected facility edit form with authoritative values", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([]))
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
      .mockResolvedValueOnce(reservationsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Edit facility").click());

    setField("edit-facility-name", " ");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Name, facility type, and city are required");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    setField("edit-facility-name", facility.name);
    setField("edit-facility-capacity", "0");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Capacity must be a whole number");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    setField("edit-facility-capacity", String(facility.capacity));
    setField("edit-facility-latitude", "91");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".facility-edit-form")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Enter valid latitude and longitude");
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4]![0]).toContain("/operators/me/facilities/4");
    expect(fetchMock.mock.calls[4]![1]).toMatchObject({
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(6);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
      .mockResolvedValueOnce(reservationsResponse([]))
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
      .mockResolvedValueOnce(reservationsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    for (const text of ["Delete", "Save", "Update"]) {
      expect(container.textContent).not.toContain(text);
    }
    expect(container.textContent).toContain("Create facility");
    expect(container.textContent).toContain("Edit facility");
  });

  it("loads operator-wide reservations alongside facilities and slots", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]![0]).toContain("/operators/me/reservations");
    expect(container.textContent).toContain("Reservations");
    expect(container.textContent).toContain("1 total");
    expect(container.textContent).toContain("BKG-ABC123");
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/reservations/"),
      expect.anything(),
    );
  });

  it("renders full reservation details in a readable format", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("BKG-ABC123");
    expect(container.textContent).toContain("Koregaon Lot");
    expect(container.textContent).toContain("A01");
    expect(container.textContent).toContain("CONFIRMED");
    expect(container.textContent).toContain(new Date(reservation.startsAt).toLocaleString());
    expect(container.textContent).toContain(new Date(reservation.endsAt).toLocaleString());
    expect(container.textContent).toContain(
      new Date(reservation.confirmedAt as string).toLocaleString(),
    );
    expect(container.querySelectorAll("time").length).toBeGreaterThan(0);
  });

  it("resolves reservation facility names and slot codes from loaded data", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([facility, secondFacility]), { status: 200 }),
      )
      .mockResolvedValueOnce(reservationsResponse([reservation, uncountedReservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("Koregaon Lot");
    expect(container.textContent).toContain("A01");
    expect(container.textContent).toContain("Facility #999");
    expect(container.textContent).toContain("Slot #100");
    expect(container.textContent).toContain("COMPLETED");
  });

  it("does not resolve a cross-facility reservation to a selected-facility slot code", async () => {
    const crossFacilityReservation: Reservation = {
      ...reservation,
      id: 21,
      reservationCode: "BKG-OTHERFAC",
      facilityId: secondFacility.id,
      slotId: slot.id,
      state: "COMPLETED",
      confirmedAt: null,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([facility, secondFacility]), { status: 200 }),
      )
      .mockResolvedValueOnce(reservationsResponse([crossFacilityReservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    const crossCard = Array.from(
      container.querySelectorAll<HTMLLIElement>(".reservation-card"),
    ).find((card) => card.textContent?.includes("BKG-OTHERFAC"));
    expect(crossCard?.textContent).toContain("Slot #9");
    expect(crossCard?.textContent).not.toContain("A01");
  });

  it("shows an empty reservations state", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("No reservations have been made for your facilities.");
    expect(container.textContent).not.toContain("BKG-ABC123");
  });

  it("shows a reservation API error without breaking facilities and slots", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "SERVICE_DOWN", message: "Reservations unavailable" },
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Reservations unavailable",
    );
    expect(container.textContent).toContain("Koregaon Lot");
    expect(container.textContent).toContain("A01");
    expect(container.querySelector(".facility-item.selected")?.textContent).toContain(
      "Koregaon Lot",
    );
  });

  it("does not render customer PII for reservations", async () => {
    const customerReservation: Reservation = {
      ...reservation,
      id: 20,
      reservationCode: "BKG-PII001",
      userId: 987654321,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([customerReservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("BKG-PII001");
    expect(container.textContent).not.toContain("987654321");
    expect(container.textContent).not.toContain("operator@example.com");
    expect(container.textContent).not.toContain("Operator Owner");
    expect(container.textContent).not.toContain("User ID");
  });

  it("handles a null slot id by showing an unassigned slot and a zone when present", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([zonedReservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("Not assigned");
    expect(container.textContent).toContain("Zone #6");
  });

  it("omits the zone and unassigned slot fields when they are not present", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).not.toContain("Zone");
    expect(container.textContent).not.toContain("Not assigned");
  });

  it("shows cancellation fields for cancelled reservations", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([cancelledReservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(container.textContent).toContain("BKG-CANCELLED");
    expect(container.textContent).toContain("CANCELLED");
    expect(container.textContent).toContain("Customer changed plans");
    expect(container.textContent).toContain(
      new Date(cancelledReservation.cancelledAt as string).toLocaleString(),
    );
    expect(container.textContent).not.toContain("Confirmed");
  });

  it("ignores a stale unmounted reservation response", async () => {
    let resolveReservations!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveReservations = resolve;
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await act(async () => root.render(<OperatorDashboard accessToken="access-token" />));
    expect(container.textContent).toContain("Loading reservations...");
    act(() => root.unmount());
    resolveReservations(reservationsResponse([reservation]));
    await settle();
    expect(container.textContent).not.toContain("BKG-ABC123");
  });
});

describe("operator reservation cancellation", () => {
  it("shows a cancel action only for CONFIRMED reservations", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(
        reservationsResponse([reservation, cancelledReservation, uncountedReservation]),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    expect(reservationCard("BKG-ABC123").querySelector(".cancel-reservation-button")).toBeTruthy();
    expect(reservationCard("BKG-CANCELLED").querySelector(".cancel-reservation-button")).toBeNull();
    expect(reservationCard("BKG-OTHER789").querySelector(".cancel-reservation-button")).toBeNull();
  });

  it("opens an inline confirmation and closes it via Keep Reservation without an API call", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Cancel Reservation").click());

    const confirmation = container.querySelector(".cancellation-confirmation");
    expect(confirmation).toBeTruthy();
    expect(confirmation?.textContent).toContain("Cancel reservation?");
    expect(confirmation?.textContent).toContain("BKG-ABC123");
    expect(confirmation?.textContent).toContain("Cancellation reason (optional)");
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".cancellation-confirmation textarea",
    );
    expect(textarea).toBeTruthy();
    expect(textarea?.maxLength).toBe(500);
    expect(buttonWithText("Confirm Cancellation")).toBeTruthy();

    await act(async () => buttonWithText("Keep Reservation").click());
    expect(container.querySelector(".cancellation-confirmation")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("confirms cancellation with a trimmed reason and updates the reservation from the response", async () => {
    const cancelled = {
      ...reservation,
      state: "CANCELLED" as const,
      cancelReason: "venue closed",
      cancelledAt: "2026-09-02T09:30:00.000Z",
      updatedAt: "2026-09-02T09:30:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reservation: cancelled }), { status: 200 }),
      );
    await renderDashboard();
    await act(async () => buttonWithText("Cancel Reservation").click());
    setTextarea("cancellation-reason-12", "  venue closed  ");
    await act(async () =>
      container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4]![0]).toContain("/operators/me/reservations/BKG-ABC123/cancel");
    expect(fetchMock.mock.calls[4]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ reason: "venue closed" }),
    });
    const card = reservationCard("BKG-ABC123");
    expect(card.textContent).toContain("CANCELLED");
    expect(card.querySelector(".cancel-reservation-button")).toBeNull();
    expect(card.textContent).toContain("venue closed");
    expect(card.textContent).toContain(new Date(cancelled.cancelledAt as string).toLocaleString());
    expect(container.querySelector(".cancellation-confirmation")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("cancelled");
  });

  it("allows cancellation with an empty reason and omits it from the request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reservation: {
              ...reservation,
              state: "CANCELLED",
              cancelledAt: "2026-09-02T09:30:00.000Z",
            },
          }),
          { status: 200 },
        ),
      );
    await renderDashboard();
    await act(async () => buttonWithText("Cancel Reservation").click());
    await act(async () =>
      container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
    );
    await settle();

    expect(fetchMock.mock.calls[4]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(reservationCard("BKG-ABC123").textContent).toContain("CANCELLED");
  });

  it("shows cancellation submitting state and prevents duplicate submissions", async () => {
    let resolveCancel!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();
    await act(async () => buttonWithText("Cancel Reservation").click());
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCancel = resolve;
      }),
    );
    const form = container.querySelector<HTMLFormElement>(".cancellation-confirmation")!;
    await act(async () => form.requestSubmit());
    expect(container.textContent).toContain("Cancelling...");
    expect(
      container.querySelector<HTMLButtonElement>(".cancellation-confirmation button[type=submit]")
        ?.disabled,
    ).toBe(true);
    await act(async () => form.requestSubmit());
    expect(fetchMock).toHaveBeenCalledTimes(5);
    resolveCancel(
      new Response(
        JSON.stringify({
          reservation: {
            ...reservation,
            state: "CANCELLED",
            cancelledAt: "2026-09-02T09:30:00.000Z",
          },
        }),
        { status: 200 },
      ),
    );
    await settle();
    expect(reservationCard("BKG-ABC123").textContent).toContain("CANCELLED");
  });

  it.each([
    [401, "UNAUTHORIZED", "Your operator session is no longer authorized"],
    [403, "FORBIDDEN", "Your account is not authorized to cancel reservations"],
    [404, "BOOKING_NOT_FOUND", "not found or is no longer in one of your facilities"],
    [500, "INTERNAL_ERROR", "500 failure"],
  ])(
    "shows cancellation error %i and keeps the confirmation open",
    async (status, code, message) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
        .mockResolvedValueOnce(reservationsResponse([reservation]))
        .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
        .mockResolvedValueOnce(reservationError(status, code, `${status} failure`));
      await renderDashboard();
      await act(async () => buttonWithText("Cancel Reservation").click());
      await act(async () =>
        container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
      );
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
      expect(container.querySelector(".cancellation-confirmation")).toBeTruthy();
      expect(reservationCard("BKG-ABC123").querySelector(".cancel-reservation-button")).toBeNull();
      expect(buttonWithText("Confirm Cancellation")).toBeTruthy();
    },
  );

  it("shows a useful message and refreshes state when the reservation is already cancelled", async () => {
    const alreadyCancelled = {
      ...reservation,
      state: "CANCELLED" as const,
      cancelledAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(
        reservationError(409, "ALREADY_CANCELLED", "This booking is already cancelled"),
      )
      .mockResolvedValueOnce(reservationsResponse([alreadyCancelled]));
    await renderDashboard();
    await act(async () => buttonWithText("Cancel Reservation").click());
    await act(async () =>
      container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[5]![0]).toContain("/operators/me/reservations");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This reservation is already cancelled.",
    );
    const card = reservationCard("BKG-ABC123");
    expect(card.textContent).toContain("CANCELLED");
    expect(card.querySelector(".cancel-reservation-button")).toBeNull();
    expect(container.querySelector(".cancellation-confirmation")).toBeNull();
  });

  it("shows a useful message and hides the action when the reservation is completed", async () => {
    const completedNow = {
      ...reservation,
      state: "COMPLETED" as const,
      updatedAt: "2026-09-02T08:00:00.000Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(
        reservationError(422, "CANNOT_CANCEL_COMPLETED", "Completed bookings cannot be cancelled"),
      )
      .mockResolvedValueOnce(reservationsResponse([completedNow]));
    await renderDashboard();
    await act(async () => buttonWithText("Cancel Reservation").click());
    await act(async () =>
      container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
    );
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Completed reservations cannot be cancelled.",
    );
    const card = reservationCard("BKG-ABC123");
    expect(card.textContent).toContain("COMPLETED");
    expect(card.querySelector(".cancel-reservation-button")).toBeNull();
    expect(container.querySelector(".cancellation-confirmation")).toBeNull();
  });

  it("cancelling one reservation does not change another reservation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation, zonedReservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reservation: {
              ...reservation,
              state: "CANCELLED",
              cancelReason: "maintenance",
              cancelledAt: "2026-09-02T09:30:00.000Z",
            },
          }),
          { status: 200 },
        ),
      );
    await renderDashboard();
    const cardA = reservationCard("BKG-ABC123");
    const cardB = reservationCard("BKG-ZONE456");
    await act(async () =>
      cardA.querySelector<HTMLButtonElement>(".cancel-reservation-button")!.click(),
    );
    await act(async () =>
      container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
    );
    await settle();

    expect(cardA.textContent).toContain("CANCELLED");
    expect(cardA.querySelector(".cancel-reservation-button")).toBeNull();
    expect(cardB.textContent).toContain("CONFIRMED");
    expect(cardB.querySelector(".cancel-reservation-button")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("ignores a stale cancellation response when a newer cancellation is active", async () => {
    let resolveA!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(operator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([facility]), { status: 200 }))
      .mockResolvedValueOnce(reservationsResponse([reservation, zonedReservation]))
      .mockResolvedValueOnce(new Response(JSON.stringify([slot]), { status: 200 }));
    await renderDashboard();

    const cardA = reservationCard("BKG-ABC123");
    const cardB = reservationCard("BKG-ZONE456");
    await act(async () =>
      cardA.querySelector<HTMLButtonElement>(".cancel-reservation-button")!.click(),
    );
    setTextarea("cancellation-reason-12", "first reason");
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveA = resolve;
      }),
    );
    await act(async () =>
      container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
    );
    expect(container.textContent).toContain("Cancelling...");

    await act(async () =>
      cardB.querySelector<HTMLButtonElement>(".cancel-reservation-button")!.click(),
    );
    expect(container.querySelector(".cancellation-confirmation")?.textContent).toContain(
      "BKG-ZONE456",
    );

    resolveA(
      new Response(
        JSON.stringify({
          reservation: {
            ...reservation,
            state: "CANCELLED",
            cancelledAt: "2026-09-02T09:30:00.000Z",
          },
        }),
        { status: 200 },
      ),
    );
    await settle();

    expect(cardA.textContent).toContain("Cancel Reservation");
    expect(cardA.textContent).not.toContain("CANCELLED");
    expect(container.querySelector(".cancellation-confirmation")?.textContent).toContain(
      "BKG-ZONE456",
    );
    expect(container.textContent).not.toContain("first reason");

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          reservation: {
            ...zonedReservation,
            state: "CANCELLED",
            cancelledAt: "2026-09-02T10:00:00.000Z",
          },
        }),
        { status: 200 },
      ),
    );
    await act(async () =>
      container.querySelector<HTMLFormElement>(".cancellation-confirmation")!.requestSubmit(),
    );
    await settle();

    expect(cardB.textContent).toContain("CANCELLED");
    expect(cardB.querySelector(".cancel-reservation-button")).toBeNull();
    expect(container.querySelector(".cancellation-confirmation")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
