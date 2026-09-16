import { afterEach, describe, expect, it, vi } from "vitest";
import type { Operator, ParkingFacility } from "@smartpark/shared";
import { API_BASE_URL, AuthApiError } from "./auth";
import {
  activateFacility,
  approveFacility,
  approveOperator,
  deactivateFacility,
  listAdminFacilities,
  listAdminOperators,
  rejectFacility,
  rejectOperator,
  reviewFacility,
  reviewOperator,
} from "./admin";

const operator: Operator = {
  id: 3,
  name: "Koregaon Parking Co",
  businessType: "private",
  registrationNumber: "ABC-123",
  verificationStatus: "PENDING",
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
  verificationStatus: "PENDING",
  availabilityMode: "MANUAL",
  isActive: true,
  isDemo: false,
  approvedBy: null,
  approvedAt: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

function apiError(status: number, code: string) {
  return new Response(JSON.stringify({ error: { code, message: `${code} message` } }), { status });
}

describe("admin operators list API client", () => {
  it("gets operators for the requested status filter with the bearer token", async () => {
    const verified = { ...operator, verificationStatus: "VERIFIED" as const };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ operators: [verified] }), { status: 200 }));
    await expect(listAdminOperators("access-token", "VERIFIED")).resolves.toEqual([verified]);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/admin/operators?status=VERIFIED`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("defaults the status filter to PENDING", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ operators: [operator] }), { status: 200 }));
    await expect(listAdminOperators("access-token")).resolves.toEqual([operator]);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${API_BASE_URL}/admin/operators?status=PENDING`,
    );
  });

  it.each(["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED"] as const)(
    "passes the %s status filter through to the endpoint",
    async (status) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ operators: [] }), { status: 200 }));
      await expect(listAdminOperators("access-token", status)).resolves.toEqual([]);
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        `${API_BASE_URL}/admin/operators?status=${status}`,
      );
    },
  );

  it("accepts an empty operator list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ operators: [] }), { status: 200 }),
    );
    await expect(listAdminOperators("access-token")).resolves.toEqual([]);
  });

  it("rejects malformed operator list responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ operators: [{ id: operator.id }] }), { status: 200 }),
    );
    await expect(listAdminOperators("access-token")).rejects.toThrow("incomplete or malformed");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ operators: "not-an-array" }), { status: 200 }),
    );
    await expect(listAdminOperators("access-token")).rejects.toThrow("incomplete or malformed");
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces %i list responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(listAdminOperators("access-token")).rejects.toMatchObject({ status, code });
  });

  it("maps list network failures to the admin service error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(listAdminOperators("access-token")).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the admin service.",
    } satisfies Partial<AuthApiError>);
  });

  it("rejects non-JSON error bodies without exposing internals", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 400 }));
    await expect(listAdminOperators("access-token")).rejects.toThrow("not valid JSON");
  });
});

describe("operator review API client", () => {
  const reviewUrl = `${API_BASE_URL}/admin/operators/5/review`;

  it("posts to the exact review endpoint with the bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(operator), { status: 200 }));
    await expect(reviewOperator("access-token", 5)).resolves.toEqual(operator);
    expect(fetchMock).toHaveBeenCalledWith(reviewUrl, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("rejects malformed review responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: operator.id }), { status: 200 }),
    );
    await expect(reviewOperator("access-token", 5)).rejects.toThrow("incomplete or malformed");
  });

  it.each([0, -3, 1.5, NaN, Infinity])(
    "rejects invalid operator id %s without fetching",
    async (operatorId) => {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      await expect(reviewOperator("access-token", operatorId)).rejects.toMatchObject({
        name: "AuthApiError",
        message: "Invalid operator id.",
      } satisfies Partial<AuthApiError>);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "OPERATOR_NOT_FOUND"],
    [409, "OPERATOR_STATUS_CONFLICT"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces %i review responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(reviewOperator("access-token", 5)).rejects.toMatchObject({ status, code });
  });

  it("maps review network failures to the admin service error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(reviewOperator("access-token", 5)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the admin service.",
    } satisfies Partial<AuthApiError>);
  });
});

describe("operator approve API client", () => {
  const approveUrl = `${API_BASE_URL}/admin/operators/5/approve`;

  it("posts to the exact approve endpoint with the bearer token", async () => {
    const approved = { ...operator, verificationStatus: "VERIFIED" as const };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(approved), { status: 200 }));
    await expect(approveOperator("access-token", 5)).resolves.toEqual(approved);
    expect(fetchMock).toHaveBeenCalledWith(approveUrl, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("rejects malformed approve responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ name: operator.name }), { status: 200 }),
    );
    await expect(approveOperator("access-token", 5)).rejects.toThrow("incomplete or malformed");
  });

  it("rejects invalid operator ids without fetching", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(approveOperator("access-token", 0)).rejects.toThrow("Invalid operator id.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "OPERATOR_NOT_FOUND"],
    [409, "OPERATOR_STATUS_CONFLICT"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces %i approve responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(approveOperator("access-token", 5)).rejects.toMatchObject({ status, code });
  });

  it("maps approve network failures to the admin service error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(approveOperator("access-token", 5)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the admin service.",
    } satisfies Partial<AuthApiError>);
  });
});

describe("operator reject API client", () => {
  const rejectUrl = `${API_BASE_URL}/admin/operators/5/reject`;

  it("posts to the exact reject endpoint with the bearer token", async () => {
    const rejected = { ...operator, verificationStatus: "REJECTED" as const };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(rejected), { status: 200 }));
    await expect(rejectOperator("access-token", 5)).resolves.toEqual(rejected);
    expect(fetchMock).toHaveBeenCalledWith(rejectUrl, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("rejects malformed reject responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: operator.id, name: operator.name }), { status: 200 }),
    );
    await expect(rejectOperator("access-token", 5)).rejects.toThrow("incomplete or malformed");
  });

  it("rejects invalid operator ids without fetching", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(rejectOperator("access-token", Number.NaN)).rejects.toThrow(
      "Invalid operator id.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "OPERATOR_NOT_FOUND"],
    [409, "OPERATOR_STATUS_CONFLICT"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces %i reject responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(rejectOperator("access-token", 5)).rejects.toMatchObject({ status, code });
  });

  it("maps reject network failures to the admin service error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(rejectOperator("access-token", 5)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the admin service.",
    } satisfies Partial<AuthApiError>);
  });
});

describe("admin facilities list API client", () => {
  it("gets facilities for the requested status filter with the bearer token", async () => {
    const verified = { ...facility, verificationStatus: "VERIFIED" as const };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ facilities: [verified] }), { status: 200 }));
    await expect(listAdminFacilities("access-token", "VERIFIED")).resolves.toEqual([verified]);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/admin/facilities?status=VERIFIED`, {
      headers: { Accept: "application/json", Authorization: "Bearer access-token" },
    });
  });

  it("defaults the status filter to PENDING", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ facilities: [facility] }), { status: 200 }));
    await expect(listAdminFacilities("access-token")).resolves.toEqual([facility]);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${API_BASE_URL}/admin/facilities?status=PENDING`,
    );
  });

  it.each(["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED"] as const)(
    "passes the %s status filter through to the endpoint",
    async (status) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ facilities: [] }), { status: 200 }));
      await expect(listAdminFacilities("access-token", status)).resolves.toEqual([]);
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        `${API_BASE_URL}/admin/facilities?status=${status}`,
      );
    },
  );

  it("accepts an empty facility list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ facilities: [] }), { status: 200 }),
    );
    await expect(listAdminFacilities("access-token")).resolves.toEqual([]);
  });

  it("rejects malformed facility list responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ facilities: [{ id: facility.id }] }), { status: 200 }),
    );
    await expect(listAdminFacilities("access-token")).rejects.toThrow("incomplete or malformed");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ facilities: "not-an-array" }), { status: 200 }),
    );
    await expect(listAdminFacilities("access-token")).rejects.toThrow("incomplete or malformed");
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [500, "INTERNAL_ERROR"],
  ])("surfaces %i list responses", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
    await expect(listAdminFacilities("access-token")).rejects.toMatchObject({ status, code });
  });

  it("maps list network failures to the admin service error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(listAdminFacilities("access-token")).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the admin service.",
    } satisfies Partial<AuthApiError>);
  });
});

describe("facility transition API clients", () => {
  const transitions = [
    ["review", reviewFacility, "review"],
    ["approve", approveFacility, "approve"],
    ["reject", rejectFacility, "reject"],
    ["activate", activateFacility, "activate"],
    ["deactivate", deactivateFacility, "deactivate"],
  ] as const;

  it.each(transitions)(
    "%s posts to the exact endpoint with the bearer token",
    async (_, call, action) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify(facility), { status: 200 }));
      await expect(call("access-token", 7)).resolves.toEqual(facility);
      expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/admin/facilities/7/${action}`, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: "Bearer access-token" },
      });
    },
  );

  it.each(transitions)("%s rejects malformed responses", async (_, call, action) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: facility.id }), { status: 200 }),
    );
    await expect(call("access-token", 7)).rejects.toThrow(
      `The facility ${action} response was incomplete or malformed.`,
    );
  });

  it.each(transitions)("%s rejects invalid facility ids without fetching", async (_, call) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(call("access-token", 0)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Invalid facility id.",
    } satisfies Partial<AuthApiError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(transitions)("%s surfaces 401/403/404/409/500 responses", async (_, call, action) => {
    const errorCases: [number, string][] = [
      [401, "UNAUTHORIZED"],
      [403, "FORBIDDEN"],
      [404, "FACILITY_NOT_FOUND"],
      [409, "FACILITY_STATUS_CONFLICT"],
      [500, "INTERNAL_ERROR"],
    ];
    for (const [status, code] of errorCases) {
      vi.restoreAllMocks();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code));
      await expect(call("access-token", 7)).rejects.toMatchObject({ status, code });
    }
    expect(action.length).toBeGreaterThan(0);
  });

  it.each(transitions)("%s maps network failures to the admin service error", async (_, call) => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(call("access-token", 7)).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Unable to reach the admin service.",
    } satisfies Partial<AuthApiError>);
  });
});
