import { describe, expect, it, vi } from "vitest";
import { API_BASE_URL, AvailabilityApiError, fetchFacilityAvailability } from "./availability";

const validResponse = {
  facilityId: "PUN-000001",
  totalSlots: 1,
  availableSlots: 1,
  isLive: true,
  sources: ["MANUAL"],
  lastUpdatedAt: "2026-09-01T10:00:00.000Z",
  confidence: "HIGH",
  disclaimer: "Operator-reported availability. Not guaranteed.",
  slots: [
    {
      id: 1,
      slotCode: "A01",
      facilityId: 1,
      zoneId: null,
      vehicleType: "car",
      status: "AVAILABLE",
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ],
};

describe("fetchFacilityAvailability", () => {
  it("uses the configured API base URL and returns the typed response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(validResponse), { status: 200 }));

    await expect(fetchFacilityAvailability("1")).resolves.toEqual(validResponse);
    expect(API_BASE_URL).toMatch(/^https?:\/\//);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/parking/1/availability`, {
      headers: { Accept: "application/json" },
    });
    fetchMock.mockRestore();
  });

  it("encodes the facility ID in the request path", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(validResponse), { status: 200 }));

    await fetchFacilityAvailability("Pune parking");
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API_BASE_URL}/parking/Pune%20parking/availability`);
    fetchMock.mockRestore();
  });

  it("surfaces API errors and rejects malformed successful responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Facility not found" } }), { status: 404 }),
    );
    await expect(fetchFacilityAvailability("999")).rejects.toMatchObject({
      name: "AvailabilityApiError",
      status: 404,
      message: "Facility not found",
    } satisfies Partial<AvailabilityApiError>);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    );
    await expect(fetchFacilityAvailability("1")).rejects.toThrow("incomplete or malformed");
    fetchMock.mockRestore();
  });
});
