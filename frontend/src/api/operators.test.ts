import { afterEach, describe, expect, it, vi } from "vitest";
import type { Operator, ParkingFacility, ParkingSlot } from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import {
  getOperatorFacilities,
  getOperatorFacilitySlots,
  getOperatorMe,
  createOperatorFacility,
  registerOperator,
  updateOperatorFacility,
} from "./operators";

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
  description: "A covered parking lot",
  type: "private",
  country: "India",
  state: "Maharashtra",
  city: "Pune",
  area: "Koregaon Park",
  address: "1 Lane",
  latitude: 18.5362,
  longitude: 73.8958,
  operatorId: 3,
  capacity: 40,
  verificationStatus: "VERIFIED",
  availabilityMode: "MANUAL",
  isActive: true,
  isDemo: false,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

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

const registrationInput = {
  name: "New Parking Co",
  businessType: "private",
  registrationNumber: "REG-123",
};
const facilityInput = {
  name: "New Lot",
  type: "private" as const,
  city: "Pune",
  state: "Maharashtra",
  capacity: 80,
};
const facilityUpdateInput = {
  name: "Updated Lot",
  type: "off-street" as const,
  city: "Mumbai",
  state: "Maharashtra",
  area: "Andheri",
  address: "2 Main Road",
  latitude: 19.1197,
  longitude: 72.8468,
  capacity: 90,
  description: "Updated description",
};

afterEach(() => vi.restoreAllMocks());

function apiError(status: number, code: string) {
  return new Response(JSON.stringify({ error: { code, message: `${code} message` } }), { status });
}

describe("operator registration API client", () => {
  it("posts the exact registration input with the bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(operator), { status: 201 }));
    await expect(registerOperator("access-token", registrationInput)).resolves.toEqual(operator);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/operators/register`, {
      method: "POST",
      body: JSON.stringify(registrationInput),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
  });

  it("rejects malformed successful registration responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: operator.id, name: operator.name }), { status: 201 }),
    );
    await expect(registerOperator("access-token", registrationInput)).rejects.toThrow(
      "incomplete or malformed",
    );
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHORIZED"],
    [403, "ACCOUNT_INACTIVE"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces %i registration responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(registerOperator("access-token", registrationInput)).rejects.toMatchObject({
      status,
      code,
    });
  });

  it("surfaces registration network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(registerOperator("access-token", registrationInput)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the operator service.",
    } satisfies Partial<AuthApiError>);
  });
});

describe("operator profile API client", () => {
  it("gets the operator profile with the bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(operator), { status: 200 }));
    await expect(getOperatorMe("access-token")).resolves.toEqual(operator);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/operators/me`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("rejects malformed profiles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: operator.id, name: operator.name }), { status: 200 }),
    );
    await expect(getOperatorMe("access-token")).rejects.toThrow("incomplete or malformed");
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
  ])("surfaces %i profile responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(getOperatorMe("access-token")).rejects.toMatchObject({ status, code });
  });

  it("surfaces profile network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(getOperatorMe("access-token")).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the operator service.",
    } satisfies Partial<AuthApiError>);
  });
});

describe("operator facilities API client", () => {
  it("patches a facility with the exact supported fields and bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(facility), { status: 200 }));
    await expect(updateOperatorFacility("access-token", 42, facilityUpdateInput)).resolves.toEqual(
      facility,
    );
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/operators/me/facilities/42`, {
      method: "PATCH",
      body: JSON.stringify(facilityUpdateInput),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<
      string,
      unknown
    >;
    expect(sentBody).not.toHaveProperty("operatorId");
    expect(sentBody).not.toHaveProperty("ownership");
    expect(sentBody).not.toHaveProperty("verificationStatus");
    expect(sentBody).not.toHaveProperty("isActive");
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "FACILITY_NOT_FOUND"],
    [409, "CONFLICT"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces facility update response %i", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(
      updateOperatorFacility("access-token", 42, facilityUpdateInput),
    ).rejects.toMatchObject({
      status,
      code,
    });
  });

  it("rejects malformed update responses and maps network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: facility.id }), { status: 200 }),
    );
    await expect(updateOperatorFacility("access-token", 42, facilityUpdateInput)).rejects.toThrow(
      "incomplete or malformed",
    );

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(
      updateOperatorFacility("access-token", 42, facilityUpdateInput),
    ).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the operator service.",
    } satisfies Partial<AuthApiError>);
  });

  it("posts the facility input with the bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(facility), { status: 201 }));
    await expect(createOperatorFacility("access-token", facilityInput)).resolves.toEqual(facility);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/operators/me/facilities`, {
      method: "POST",
      body: JSON.stringify(facilityInput),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHORIZED"],
    [403, "ACCOUNT_INACTIVE"],
    [409, "CONFLICT"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces facility creation response %i", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(createOperatorFacility("access-token", facilityInput)).rejects.toMatchObject({
      status,
      code,
    });
  });

  it("rejects malformed successful facility responses and network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: facility.id }), { status: 201 }),
    );
    await expect(createOperatorFacility("access-token", facilityInput)).rejects.toThrow(
      "incomplete or malformed",
    );

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(createOperatorFacility("access-token", facilityInput)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the operator service.",
    } satisfies Partial<AuthApiError>);
  });

  it("does not expose implementation details for malformed error responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 400 }));
    await expect(createOperatorFacility("access-token", facilityInput)).rejects.toThrow(
      "not valid JSON",
    );
  });

  it("gets facilities with the bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([facility]), { status: 200 }));
    await expect(getOperatorFacilities("access-token")).resolves.toEqual([facility]);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/operators/me/facilities`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("accepts an empty facility list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await expect(getOperatorFacilities("access-token")).resolves.toEqual([]);
  });

  it("rejects malformed facility lists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: facility.id, name: facility.name }]), { status: 200 }),
    );
    await expect(getOperatorFacilities("access-token")).rejects.toThrow("incomplete or malformed");
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
  ])("surfaces %i facility responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(getOperatorFacilities("access-token")).rejects.toMatchObject({ status, code });
  });

  it("surfaces facility network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(getOperatorFacilities("access-token")).rejects.toThrow("Unable to reach");
  });
});

describe("operator facility slots API client", () => {
  it("gets slots from the selected facility path with the bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([slot]), { status: 200 }));
    await expect(getOperatorFacilitySlots("access-token", facility.id)).resolves.toEqual([slot]);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/operators/me/facilities/4/slots`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("accepts an empty slot list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await expect(getOperatorFacilitySlots("access-token", facility.id)).resolves.toEqual([]);
  });

  it("rejects malformed slot lists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: slot.id, slotCode: slot.slotCode }]), { status: 200 }),
    );
    await expect(getOperatorFacilitySlots("access-token", facility.id)).rejects.toThrow(
      "incomplete or malformed",
    );
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
  ])("surfaces %i slot responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(getOperatorFacilitySlots("access-token", facility.id)).rejects.toMatchObject({
      status,
      code,
    });
  });

  it("surfaces slot network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(getOperatorFacilitySlots("access-token", facility.id)).rejects.toThrow(
      "Unable to reach",
    );
  });
});
