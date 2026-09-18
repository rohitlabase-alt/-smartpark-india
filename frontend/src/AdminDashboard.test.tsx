import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATOR_STATUSES,
  PAYMENT_STATUSES,
  RESERVATION_STATES,
  type AuditEvent,
  type Operator,
  type PlatformSummary,
} from "@smartpark/shared";
import AdminDashboard from "./AdminDashboard";
import { API_BASE_URL } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function zeroMap<T extends readonly string[]>(keys: T): Record<(typeof keys)[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<(typeof keys)[number], number>;
}

const emptySummary: PlatformSummary = {
  users: 1,
  operators: 0,
  operatorsByStatus: zeroMap(OPERATOR_STATUSES),
  facilities: 0,
  activeFacilities: 0,
  inactiveFacilities: 0,
  facilitiesByStatus: zeroMap(OPERATOR_STATUSES),
  parkingSlots: 0,
  reservations: 0,
  reservationsByStatus: zeroMap(RESERVATION_STATES),
  payments: 0,
  paymentsByStatus: zeroMap(PAYMENT_STATUSES),
  activeParkingSessions: 0,
  occupiedSlots: 0,
  availableSlots: 0,
  recentAuditEvents: [],
  recentAuditEventCount: 0,
};

const pendingOperator: Operator = {
  id: 3,
  name: "Koregaon Parking Co",
  businessType: "private",
  registrationNumber: "ABC-123",
  verificationStatus: "PENDING",
  createdAt: "2026-09-01T10:00:00.000Z",
};

const underReviewOperator: Operator = {
  ...pendingOperator,
  id: 4,
  name: "Baner Lots",
  verificationStatus: "UNDER_REVIEW",
};

const verifiedOperator: Operator = {
  ...pendingOperator,
  id: 5,
  name: "Camp Garage",
  verificationStatus: "VERIFIED",
};

const rejectedOperator: Operator = {
  ...pendingOperator,
  id: 6,
  name: "Viman City",
  verificationStatus: "REJECTED",
};

const auditEvent: AuditEvent = {
  id: 9,
  actorUserId: 1,
  actorEmail: "admin@example.com",
  action: "OPERATOR_APPROVED",
  entityType: "OPERATOR",
  entityId: 4,
  metadata: {},
  createdAt: "2026-09-02T10:00:00.000Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function listFor(status: string): Operator[] {
  switch (status) {
    case "PENDING":
      return [pendingOperator];
    case "UNDER_REVIEW":
      return [underReviewOperator];
    case "VERIFIED":
      return [verifiedOperator];
    case "REJECTED":
      return [rejectedOperator];
    default:
      return [];
  }
}

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function routeAdmin(handlers: Array<[string, Handler]> = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    for (const [fragment, handler] of handlers) {
      if (url.includes(fragment)) return handler(input, init);
    }
    if (url.includes("/admin/platform-summary")) return json(emptySummary);
    if (url.includes("/admin/operators?")) {
      const match = /[?&]status=([^&]+)/.exec(url);
      return json({ operators: listFor(match ? decodeURIComponent(match[1]!) : "PENDING") });
    }
    if (/\/admin\/operators\/\d+\/review$/.test(url))
      return json({ ...pendingOperator, verificationStatus: "UNDER_REVIEW" });
    if (/\/admin\/operators\/\d+\/approve$/.test(url))
      return json({ ...underReviewOperator, verificationStatus: "VERIFIED" });
    if (/\/admin\/operators\/\d+\/reject$/.test(url))
      return json({ ...underReviewOperator, verificationStatus: "REJECTED" });
    if (url.includes("/admin/audit-events"))
      return json({ events: [], page: 1, limit: 20, total: 0 });
    return json({});
  });
}

function urls(mock: ReturnType<typeof routeAdmin>): string[] {
  return mock.mock.calls.map(([input]) => String(input));
}

function reviewCalls(mock: ReturnType<typeof routeAdmin>): unknown[][] {
  return mock.mock.calls.filter(([input]) => /\/operators\/\d+\/review$/.test(String(input)));
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDashboard(
  props: { accessToken?: string; onError?: (message: string) => void } = {},
) {
  await act(async () =>
    root.render(
      <AdminDashboard accessToken={props.accessToken ?? "access-token"} onError={props.onError} />,
    ),
  );
  await settle();
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!button) throw new Error(`No button with text "${text}"`);
  return button;
}

async function openOperators() {
  await act(async () => buttonWithText("Operators").click());
  await settle();
}

function operatorCard(name: string): HTMLLIElement {
  const card = Array.from(container.querySelectorAll<HTMLLIElement>(".admin-operator-card")).find(
    (entry) => entry.textContent?.includes(name),
  );
  if (!card) throw new Error(`No operator card with "${name}"`);
  return card;
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

describe("AdminDashboard", () => {
  it("shows the overview section by default", async () => {
    const fetchMock = routeAdmin();
    await renderDashboard();

    expect(container.textContent).toContain("Admin Dashboard");
    expect(container.textContent).toContain("Platform Overview");
    expect(container.querySelectorAll(".metric")).toHaveLength(9);
    expect(container.textContent).toContain("No recent platform events.");
    expect(urls(fetchMock).some((url) => url.includes("/admin/platform-summary"))).toBe(true);
  });

  it("navigates from an overview shortcut to operator verification", async () => {
    routeAdmin();
    await renderDashboard();
    await act(async () => buttonWithText("Verify operators").click());
    await settle();
    expect(container.textContent).toContain("Operator verification");
    expect(operatorCard("Koregaon Parking Co")).toBeTruthy();
  });

  it("loads and lists pending operators when the Operators section opens", async () => {
    const fetchMock = routeAdmin();
    await renderDashboard();
    await openOperators();

    expect(urls(fetchMock)).toContain(`${API_BASE_URL}/admin/operators?status=PENDING`);
    const card = operatorCard("Koregaon Parking Co");
    expect(card.textContent).toContain("#3");
    expect(card.textContent).toContain("private");
    expect(card.textContent).toContain("ABC-123");
    expect(card.textContent).toContain("PENDING");
    expect(card.textContent).toContain(new Date(pendingOperator.createdAt).toLocaleString());
    expect(container.querySelector(".admin-review-button")).toBeTruthy();
    expect(container.querySelector(".admin-approve-button")).toBeNull();
    expect(container.querySelector(".admin-reject-button")).toBeNull();
  });

  it("shows a loading notice while the operator list is being fetched", async () => {
    let resolveList!: (response: Response) => void;
    routeAdmin([
      [
        "status=PENDING",
        () =>
          new Promise<Response>((resolve) => {
            resolveList = resolve;
          }),
      ],
    ]);
    await renderDashboard();
    await openOperators();

    expect(container.textContent).toContain("Loading PENDING operators...");

    await act(async () => resolveList(json({ operators: [pendingOperator] })));
    await settle();
    expect(container.textContent).not.toContain("Loading PENDING operators...");
    expect(operatorCard("Koregaon Parking Co")).toBeTruthy();
  });

  it("shows an empty state when no operators match the filter", async () => {
    routeAdmin([["status=PENDING", () => json({ operators: [] })]]);
    await renderDashboard();
    await openOperators();

    expect(container.textContent).toContain("No operators with PENDING status.");
  });

  it("refetches the list when the status filter changes", async () => {
    const fetchMock = routeAdmin();
    await renderDashboard();
    await openOperators();

    await act(async () => buttonWithText("Under Review").click());
    await settle();

    expect(urls(fetchMock)).toContain(`${API_BASE_URL}/admin/operators?status=UNDER_REVIEW`);
    const card = operatorCard("Baner Lots");
    expect(card.textContent).toContain("UNDER REVIEW");
    expect(buttonWithText("Approve")).toBeTruthy();
    expect(buttonWithText("Reject")).toBeTruthy();
  });

  it("shows the correct workflow actions for each status", async () => {
    routeAdmin();
    await renderDashboard();
    await openOperators();

    const pendingCard = operatorCard("Koregaon Parking Co");
    expect(pendingCard.querySelector(".admin-review-button")).toBeTruthy();
    expect(pendingCard.querySelector(".admin-approve-button")).toBeNull();
    expect(pendingCard.querySelector(".admin-reject-button")).toBeNull();

    await act(async () => buttonWithText("Under Review").click());
    await settle();
    const reviewCard = operatorCard("Baner Lots");
    expect(reviewCard.querySelector(".admin-review-button")).toBeNull();
    expect(reviewCard.querySelector(".admin-approve-button")).toBeTruthy();
    expect(reviewCard.querySelector(".admin-reject-button")).toBeTruthy();

    await act(async () => buttonWithText("Verified").click());
    await settle();
    const verifiedCard = operatorCard("Camp Garage");
    expect(verifiedCard.textContent).toContain("VERIFIED");
    expect(verifiedCard.querySelector(".admin-approve-button")).toBeNull();

    await act(async () => buttonWithText("Rejected").click());
    await settle();
    const rejectedCard = operatorCard("Viman City");
    expect(rejectedCard.textContent).toContain("REJECTED");
    expect(rejectedCard.querySelector(".admin-review-button")).toBeNull();
  });

  it("reviews a pending operator and refreshes the list", async () => {
    let pendingCalls = 0;
    const fetchMock = routeAdmin([
      ["status=PENDING", () => json({ operators: pendingCalls++ === 0 ? [pendingOperator] : [] })],
      [
        "/operators/3/review",
        () => json({ ...pendingOperator, verificationStatus: "UNDER_REVIEW" }),
      ],
    ]);
    await renderDashboard();
    await openOperators();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    await settle();

    const calls = reviewCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer access-token" },
    });
    expect(container.querySelector(".admin-operator-list")).toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Koregaon Parking Co");
    expect(status?.textContent).toContain("reviewed");
  });

  it("approves an under-review operator and refreshes the list", async () => {
    let underCalls = 0;
    const fetchMock = routeAdmin([
      [
        "status=UNDER_REVIEW",
        () => json({ operators: underCalls++ === 0 ? [underReviewOperator] : [] }),
      ],
      [
        "/operators/4/approve",
        () => json({ ...underReviewOperator, verificationStatus: "VERIFIED" }),
      ],
    ]);
    await renderDashboard();
    await openOperators();
    await act(async () => buttonWithText("Under Review").click());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-approve-button")!.click(),
    );
    await settle();

    expect(urls(fetchMock).some((url) => url.endsWith("/admin/operators/4/approve"))).toBe(true);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Baner Lots");
    expect(status?.textContent).toContain("approved");
  });

  it("rejects an under-review operator and refreshes the list", async () => {
    let underCalls = 0;
    const fetchMock = routeAdmin([
      [
        "status=UNDER_REVIEW",
        () => json({ operators: underCalls++ === 0 ? [underReviewOperator] : [] }),
      ],
      [
        "/operators/4/reject",
        () => json({ ...underReviewOperator, verificationStatus: "REJECTED" }),
      ],
    ]);
    await renderDashboard();
    await openOperators();
    await act(async () => buttonWithText("Under Review").click());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-reject-button")!.click(),
    );
    await settle();

    expect(urls(fetchMock).some((url) => url.endsWith("/admin/operators/4/reject"))).toBe(true);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Baner Lots");
    expect(status?.textContent).toContain("rejected");
  });

  it("prevents duplicate submissions while an action is in flight", async () => {
    let resolveAction!: (response: Response) => void;
    let pendingCalls = 0;
    const fetchMock = routeAdmin([
      ["status=PENDING", () => json({ operators: pendingCalls++ === 0 ? [pendingOperator] : [] })],
      [
        "/operators/3/review",
        () =>
          new Promise<Response>((resolve) => {
            resolveAction = resolve;
          }),
      ],
    ]);
    await renderDashboard();
    await openOperators();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    expect(container.textContent).toContain("Reviewing...");
    const reviewButton = container.querySelector<HTMLButtonElement>(".admin-review-button")!;
    expect(reviewButton.disabled).toBe(true);

    await act(async () => reviewButton.click());
    expect(reviewCalls(fetchMock)).toHaveLength(1);

    await act(async () =>
      resolveAction(json({ ...pendingOperator, verificationStatus: "UNDER_REVIEW" })),
    );
    await settle();

    expect(container.querySelector('[role="status"]')?.textContent).toContain("reviewed");
  });

  it.each([
    [401, "UNAUTHORIZED", "Your admin session is no longer authorized"],
    [403, "FORBIDDEN", "Only administrators can manage operator verification"],
    [404, "OPERATOR_NOT_FOUND", "could not be found or is no longer available"],
    [409, "OPERATOR_STATUS_CONFLICT", "already changed status"],
    [500, "INTERNAL_ERROR", "500 failure"],
  ] as const)("shows action error %i with a useful message", async (status, code, message) => {
    routeAdmin([
      [
        "/operators/3/review",
        () => json({ error: { code, message: `${status} failure` } }, status),
      ],
    ]);
    await renderDashboard();
    await openOperators();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it("shows a load error and calls onError with the message", async () => {
    const onError = vi.fn();
    routeAdmin([
      [
        "status=PENDING",
        () => json({ error: { code: "UNAUTHORIZED", message: "Admin token invalid" } }, 401),
      ],
    ]);
    await renderDashboard({ onError });
    await openOperators();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your admin session is no longer authorized",
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no longer authorized"));
  });

  it("calls onError when an action fails", async () => {
    const onError = vi.fn();
    routeAdmin([
      [
        "/operators/3/review",
        () => json({ error: { code: "FORBIDDEN", message: "Not an admin" } }, 403),
      ],
    ]);
    await renderDashboard({ onError });
    await openOperators();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Only administrators can manage operator verification",
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Only administrators"));
  });

  it("shows a useful message when the admin service is unreachable", async () => {
    routeAdmin([
      [
        "status=PENDING",
        () => {
          throw new TypeError("Network request failed");
        },
      ],
    ]);
    await renderDashboard();
    await openOperators();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to reach the admin service.",
    );
  });

  it("resets action feedback when the filter changes", async () => {
    let resolveAction!: (response: Response) => void;
    routeAdmin([
      [
        "/operators/3/review",
        () =>
          new Promise<Response>((resolve) => {
            resolveAction = resolve;
          }),
      ],
    ]);
    await renderDashboard();
    await openOperators();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    await act(async () =>
      resolveAction(json({ ...pendingOperator, verificationStatus: "UNDER_REVIEW" })),
    );
    await settle();
    expect(container.querySelector('[role="status"]')).toBeTruthy();

    await act(async () => buttonWithText("Under Review").click());
    await settle();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(operatorCard("Baner Lots")).toBeTruthy();
  });

  it("opens the Platform section and loads the platform analytics", async () => {
    const fetchMock = routeAdmin();
    await renderDashboard();

    expect(container.textContent).toContain("Platform overview");

    await act(async () => buttonWithText("Platform").click());
    await settle();

    expect(
      urls(fetchMock).filter((url) => url.includes("/admin/platform-summary")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Platform analytics");
    expect(container.textContent).toContain("Platform Overview");
    expect(container.querySelectorAll(".metric")).toHaveLength(11);
  });

  it("returns to the operators section without refetching analytics", async () => {
    const fetchMock = routeAdmin();
    await renderDashboard();

    await act(async () => buttonWithText("Platform").click());
    await settle();
    const summaryCalls = urls(fetchMock).filter((url) =>
      url.includes("/admin/platform-summary"),
    ).length;

    await act(async () => buttonWithText("Operators").click());
    await settle();

    expect(urls(fetchMock)).toContain(`${API_BASE_URL}/admin/operators?status=PENDING`);
    expect(urls(fetchMock).filter((url) => url.includes("/admin/platform-summary")).length).toBe(
      summaryCalls,
    );
    expect(container.textContent).toContain("Operator verification");
  });

  it("opens the Audit Trail section and renders events", async () => {
    const fetchMock = routeAdmin([
      ["/admin/audit-events", () => json({ events: [auditEvent], page: 1, limit: 20, total: 1 })],
    ]);
    await renderDashboard();

    await act(async () => buttonWithText("Audit Trail").click());
    await settle();

    expect(urls(fetchMock)).toContain(`${API_BASE_URL}/admin/audit-events?page=1&limit=20`);
    expect(container.textContent).toContain("Audit trail");
    expect(container.textContent).toContain("Operator approved");
    expect(container.textContent).toContain("admin@example.com");
    expect(container.querySelectorAll(".audit-event-item")).toHaveLength(1);
  });
});
