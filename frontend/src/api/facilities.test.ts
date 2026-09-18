import { describe, expect, it, vi } from "vitest";
import { API_BASE_URL, FacilitiesApiError, fetchPublicFacilities } from "./facilities";

const validFacility = {
  id: 1,
  parkingId: "PUN-000001",
  name: "Phase2B Parking",
  description: null,
  type: "off-street",
  city: "Pune",
  state: null,
  area: "Viman Nagar",
  address: null,
  capacity: 10,
  hourlyRate: 100,
  availabilityMode: "MANUAL",
  totalSlots: 4,
  availableSlots: 2,
  availableVehicleTypes: ["bike", "car"],
  isLive: true,
  confidence: "HIGH",
  lastUpdatedAt: "2026-09-01T10:00:00.000Z",
};

const validResponse = { facilities: [validFacility] };

describe("fetchPublicFacilities", () => {
  it("uses the configured API base URL and returns the typed response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(validResponse), { status: 200 }));

    await expect(fetchPublicFacilities()).resolves.toEqual(validResponse);
    expect(API_BASE_URL).toMatch(/^https?:\/\//);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/parking/facilities`, {
      headers: { Accept: "application/json" },
    });
    fetchMock.mockRestore();
  });

  it("surfaces API errors and rejects malformed successful responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Something broke" } }), { status: 500 }),
    );
    await expect(fetchPublicFacilities()).rejects.toMatchObject({
      name: "FacilitiesApiError",
      status: 500,
      message: "Something broke",
    } satisfies Partial<FacilitiesApiError>);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ facilities: [{ unexpected: true }] }), { status: 200 }),
    );
    await expect(fetchPublicFacilities()).rejects.toThrow("incomplete or malformed");
    fetchMock.mockRestore();
  });

  it("rejects a facility card with a non-positive hourly rate", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ facilities: [{ ...validFacility, hourlyRate: 0 }] }), {
        status: 200,
      }),
    );
    await expect(fetchPublicFacilities()).rejects.toThrow("incomplete or malformed");
    fetchMock.mockRestore();
  });
});
