import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATOR_STATUSES,
  PAYMENT_STATUSES,
  RESERVATION_STATES,
  type PlatformSummary,
} from "@smartpark/shared";
import AdminPlatform from "./AdminPlatform";
import { API_BASE_URL } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function zeroMap<T extends readonly string[]>(keys: T): Record<(typeof keys)[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<(typeof keys)[number], number>;
}

const summary: PlatformSummary = {
  users: 5,
  operators: 3,
  operatorsByStatus: {
    ...zeroMap(OPERATOR_STATUSES),
    VERIFIED: 2,
    PENDING: 1,
  },
  facilities: 4,
  activeFacilities: 3,
  inactiveFacilities: 1,
  facilitiesByStatus: {
    ...zeroMap(OPERATOR_STATUSES),
    VERIFIED: 3,
    PENDING: 1,
  },
  parkingSlots: 12,
  reservations: 8,
  reservationsByStatus: {
    ...zeroMap(RESERVATION_STATES),
    CONFIRMED: 5,
    PENDING_PAYMENT: 3,
  },
  payments: 6,
  paymentsByStatus: {
    ...zeroMap(PAYMENT_STATUSES),
    SUCCESS: 6,
  },
  recentAuditEvents: [],
  recentAuditEventCount: 0,
  activeParkingSessions: 1,
  occupiedSlots: 1,
  availableSlots: 11,
};

function summaryResponse(value: PlatformSummary = summary): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function adminErrorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPlatform(
  props: { accessToken?: string; onError?: (message: string) => void } = {},
) {
  await act(async () =>
    root.render(
      <AdminPlatform accessToken={props.accessToken ?? "access-token"} onError={props.onError} />,
    ),
  );
  await settle();
}

function metricValue(label: string): string | null | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(".metric"))
    .find((metric) => metric.querySelector("span")?.textContent === label)
    ?.querySelector("strong")?.textContent;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("AdminPlatform", () => {
  it("loads the platform summary and renders the analytics", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(summaryResponse());

    await renderPlatform();

    expect(fetchMock.mock.calls[0]![0]).toBe(`${API_BASE_URL}/admin/platform-summary`);
    expect(container.textContent).toContain("Platform Overview");
    expect(container.querySelectorAll(".metric")).toHaveLength(11);
    expect(container.textContent).toContain("Admins & users");
    expect(container.textContent).toContain("Parking slots");
    expect(container.textContent).toContain("Operators by status");
    expect(container.textContent).toContain("Reservations by state");
  });

  it("shows a loading notice while the summary is being fetched", async () => {
    let resolveSummary!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveSummary = resolve;
      }),
    );
    await renderPlatform();

    expect(container.textContent).toContain("Loading platform overview...");

    await act(async () => resolveSummary(summaryResponse()));
    await settle();
    expect(container.textContent).not.toContain("Loading platform overview...");
    expect(container.querySelectorAll(".metric")).toHaveLength(11);
  });

  it("renders the live parking-occupancy metrics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(summaryResponse());
    await renderPlatform();

    expect(container.textContent).toContain("Active sessions");
    expect(container.textContent).toContain("Slots occupied");
    expect(container.textContent).toContain("Slots available");
    expect(metricValue("Active sessions")).toBe("1");
    expect(metricValue("Slots occupied")).toBe("1");
    expect(metricValue("Slots available")).toBe("11");
  });

  it("renders breakdown counts and an empty breakdown state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(summaryResponse());
    await renderPlatform();

    const operatorBreakdown = Array.from(
      container.querySelectorAll<HTMLElement>(".breakdown-card"),
    ).find((card) => card.querySelector("h4")?.textContent === "Operators by status")!;
    expect(operatorBreakdown.textContent).toContain("verified");
    expect(operatorBreakdown.textContent).toContain("2");

    const reservations = Array.from(
      container.querySelectorAll<HTMLElement>(".breakdown-card"),
    ).find((card) => card.querySelector("h4")?.textContent === "Reservations by state")!;
    expect(reservations.textContent).toContain("confirmed");
  });

  it("shows a load error and calls onError for an unauthorized summary", async () => {
    const onError = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      adminErrorResponse(401, "UNAUTHORIZED", "Admin token invalid"),
    );
    await renderPlatform({ onError });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your admin session is no longer authorized",
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no longer authorized"));
  });

  it("reports a forbidden summary with an analytics-specific message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      adminErrorResponse(403, "FORBIDDEN", "Not an admin"),
    );
    await renderPlatform();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Only administrators can view platform analytics.",
    );
  });

  it("shows a useful message when the admin service is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Network request failed"));
    await renderPlatform();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to reach the admin service.",
    );
  });

  it("refetches the summary when Refresh is clicked", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(summaryResponse())
      .mockResolvedValueOnce(summaryResponse());
    await renderPlatform();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".platform-refresh-button")!.click(),
    );
    await settle();

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/admin/platform-summary"))
        .length,
    ).toBe(2);
  });
});
