import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Operator } from "@smartpark/shared";
import AdminDashboard from "./AdminDashboard";
import { API_BASE_URL } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

function operatorsResponse(items: Operator[]): Response {
  return new Response(JSON.stringify({ operators: items }), { status: 200 });
}

function operatorResponse(operator: Operator): Response {
  return new Response(JSON.stringify(operator), { status: 200 });
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
  it("loads and lists pending operators on mount", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]));
    await renderDashboard();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API_BASE_URL}/admin/operators?status=PENDING`);
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveList = resolve;
      }),
    );
    await renderDashboard();

    expect(container.textContent).toContain("Loading PENDING operators...");

    await act(async () => resolveList(operatorsResponse([pendingOperator])));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Loading pending operators...");
    expect(operatorCard("Koregaon Parking Co")).toBeTruthy();
  });

  it("shows an empty state when no operators match the filter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(operatorsResponse([]));
    await renderDashboard();

    expect(container.textContent).toContain("No operators with PENDING status.");
  });

  it("refetches the list when the status filter changes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]))
      .mockResolvedValueOnce(operatorsResponse([underReviewOperator]));
    await renderDashboard();

    await act(async () => buttonWithText("Under Review").click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe(`${API_BASE_URL}/admin/operators?status=UNDER_REVIEW`);
    const card = operatorCard("Baner Lots");
    expect(card.textContent).toContain("UNDER REVIEW");
    expect(buttonWithText("Approve")).toBeTruthy();
    expect(buttonWithText("Reject")).toBeTruthy();
  });

  it("shows the correct workflow actions for each status", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]))
      .mockResolvedValueOnce(operatorsResponse([underReviewOperator]))
      .mockResolvedValueOnce(operatorsResponse([verifiedOperator]))
      .mockResolvedValueOnce(operatorsResponse([rejectedOperator]));
    await renderDashboard();

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
    expect(verifiedCard.querySelector(".admin-review-button")).toBeNull();
    expect(verifiedCard.querySelector(".admin-approve-button")).toBeNull();
    expect(verifiedCard.querySelector(".admin-reject-button")).toBeNull();

    await act(async () => buttonWithText("Rejected").click());
    await settle();
    const rejectedCard = operatorCard("Viman City");
    expect(rejectedCard.textContent).toContain("REJECTED");
    expect(rejectedCard.querySelector(".admin-review-button")).toBeNull();
    expect(rejectedCard.querySelector(".admin-approve-button")).toBeNull();
    expect(rejectedCard.querySelector(".admin-reject-button")).toBeNull();
  });

  it("reviews a pending operator and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]))
      .mockResolvedValueOnce(
        operatorResponse({ ...pendingOperator, verificationStatus: "UNDER_REVIEW" }),
      )
      .mockResolvedValueOnce(operatorsResponse([]));
    await renderDashboard();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![0]).toBe(`${API_BASE_URL}/admin/operators/3/review`);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer access-token" },
    });
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/operators?status=PENDING`);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Koregaon Parking Co");
    expect(status?.textContent).toContain("reviewed");
  });

  it("approves an under-review operator and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([]))
      .mockResolvedValueOnce(operatorsResponse([underReviewOperator]))
      .mockResolvedValueOnce(
        operatorResponse({ ...underReviewOperator, verificationStatus: "VERIFIED" }),
      )
      .mockResolvedValueOnce(operatorsResponse([]));
    await renderDashboard();
    await act(async () => buttonWithText("Under Review").click());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-approve-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/operators/4/approve`);
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer access-token" },
    });
    expect(fetchMock.mock.calls[3]![0]).toBe(`${API_BASE_URL}/admin/operators?status=UNDER_REVIEW`);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Baner Lots");
    expect(status?.textContent).toContain("approved");
  });

  it("rejects an under-review operator and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([]))
      .mockResolvedValueOnce(operatorsResponse([underReviewOperator]))
      .mockResolvedValueOnce(
        operatorResponse({ ...underReviewOperator, verificationStatus: "REJECTED" }),
      )
      .mockResolvedValueOnce(operatorsResponse([]));
    await renderDashboard();
    await act(async () => buttonWithText("Under Review").click());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-reject-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/operators/4/reject`);
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer access-token" },
    });
    expect(fetchMock.mock.calls[3]![0]).toBe(`${API_BASE_URL}/admin/operators?status=UNDER_REVIEW`);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Baner Lots");
    expect(status?.textContent).toContain("rejected");
  });

  it("prevents duplicate submissions while an action is in flight", async () => {
    let resolveAction!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveAction = resolve;
        }),
      )
      .mockResolvedValueOnce(operatorsResponse([]));
    await renderDashboard();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    expect(container.textContent).toContain("Reviewing...");
    const reviewButton = container.querySelector<HTMLButtonElement>(".admin-review-button")!;
    expect(reviewButton.disabled).toBe(true);

    await act(async () => reviewButton.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () =>
      resolveAction(operatorResponse({ ...pendingOperator, verificationStatus: "UNDER_REVIEW" })),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/operators?status=PENDING`);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("reviewed");
  });

  it.each([
    [401, "UNAUTHORIZED", "Your admin session is no longer authorized"],
    [403, "FORBIDDEN", "Only administrators can manage operator verification"],
    [404, "OPERATOR_NOT_FOUND", "could not be found or is no longer available"],
    [409, "OPERATOR_STATUS_CONFLICT", "already changed status"],
    [500, "INTERNAL_ERROR", "500 failure"],
  ] as const)("shows action error %i with a useful message", async (status, code, message) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]))
      .mockResolvedValueOnce(adminErrorResponse(status, code, `${status} failure`));
    await renderDashboard();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it("shows a load error and calls onError with the message", async () => {
    const onError = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      adminErrorResponse(401, "UNAUTHORIZED", "Admin token invalid"),
    );
    await renderDashboard({ onError });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your admin session is no longer authorized",
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no longer authorized"));
  });

  it("calls onError when an action fails", async () => {
    const onError = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]))
      .mockResolvedValueOnce(adminErrorResponse(403, "FORBIDDEN", "Not an admin"));
    await renderDashboard({ onError });

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
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Network request failed"));
    await renderDashboard();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to reach the admin service.",
    );
  });

  it("resets action feedback when the filter changes", async () => {
    let resolveAction!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(operatorsResponse([pendingOperator]))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveAction = resolve;
        }),
      )
      .mockResolvedValueOnce(operatorsResponse([]))
      .mockResolvedValueOnce(operatorsResponse([underReviewOperator]));
    await renderDashboard();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-review-button")!.click(),
    );
    await act(async () =>
      resolveAction(operatorResponse({ ...pendingOperator, verificationStatus: "UNDER_REVIEW" })),
    );
    await settle();
    expect(container.querySelector('[role="status"]')).toBeTruthy();

    await act(async () => buttonWithText("Under Review").click());
    await settle();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(operatorCard("Baner Lots")).toBeTruthy();
  });
});
