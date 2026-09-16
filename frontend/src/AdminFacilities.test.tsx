import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ParkingFacility } from "@smartpark/shared";
import AdminFacilities from "./AdminFacilities";
import { API_BASE_URL } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function facility(overrides: Partial<ParkingFacility>): ParkingFacility {
  return {
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
    ...overrides,
  };
}

const pendingFacility = facility({});
const underReviewFacility = facility({ id: 5, verificationStatus: "UNDER_REVIEW" });
const verifiedActiveFacility = facility({ id: 6, verificationStatus: "VERIFIED", isActive: true });
const verifiedInactiveFacility = facility({
  id: 7,
  verificationStatus: "VERIFIED",
  isActive: false,
});
const rejectedFacility = facility({ id: 8, verificationStatus: "REJECTED" });

function facilitiesResponse(items: ParkingFacility[]): Response {
  return new Response(JSON.stringify({ facilities: items }), { status: 200 });
}

function facilityResponse(item: ParkingFacility): Response {
  return new Response(JSON.stringify(item), { status: 200 });
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

async function renderFacilities(
  props: { accessToken?: string; onError?: (message: string) => void } = {},
) {
  await act(async () =>
    root.render(
      <AdminFacilities accessToken={props.accessToken ?? "access-token"} onError={props.onError} />,
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

function facilityCard(name: string): HTMLLIElement {
  const card = Array.from(container.querySelectorAll<HTMLLIElement>(".admin-facility-card")).find(
    (entry) => entry.textContent?.includes(name),
  );
  if (!card) throw new Error(`No facility card with "${name}"`);
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

describe("AdminFacilities", () => {
  it("loads and lists pending facilities on mount", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]));
    await renderFacilities();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API_BASE_URL}/admin/facilities?status=PENDING`);
    const card = facilityCard("Koregaon Lot");
    expect(card.textContent).toContain("PUN-000004");
    expect(card.textContent).toContain("Pune");
    expect(card.textContent).toContain("Koregaon Park");
    expect(card.textContent).toContain("#3");
    expect(card.textContent).toContain("40");
    expect(card.textContent).toContain("Pending review");
    expect(card.textContent).toContain("Active");
    expect(card.querySelector(".admin-facility-review-button")).toBeTruthy();
    expect(card.querySelector(".admin-facility-approve-button")).toBeNull();
    expect(card.querySelector(".admin-facility-reject-button")).toBeNull();
  });

  it("shows a loading notice while the facility list is being fetched", async () => {
    let resolveList!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveList = resolve;
      }),
    );
    await renderFacilities();

    expect(container.textContent).toContain("Loading PENDING facilities...");

    await act(async () => resolveList(facilitiesResponse([pendingFacility])));
    await settle();
    expect(facilityCard("Koregaon Lot")).toBeTruthy();
  });

  it("shows an empty state when no facilities match the filter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(facilitiesResponse([]));
    await renderFacilities();

    expect(container.textContent).toContain("No facilities with PENDING status.");
  });

  it("refetches the list when the status filter changes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(facilitiesResponse([underReviewFacility]));
    await renderFacilities();

    await act(async () => buttonWithText("Under Review").click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `${API_BASE_URL}/admin/facilities?status=UNDER_REVIEW`,
    );
    const card = facilityCard("Koregaon Lot");
    expect(card.textContent).toContain("Under review");
    expect(buttonWithText("Approve")).toBeTruthy();
    expect(buttonWithText("Reject")).toBeTruthy();
  });

  it("fetches all statuses when the All filter is selected and dedupes by id", async () => {
    const duplicate = { ...pendingFacility, verificationStatus: "VERIFIED" as const };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(facilitiesResponse([underReviewFacility]))
      .mockResolvedValueOnce(facilitiesResponse([duplicate, verifiedActiveFacility]))
      .mockResolvedValueOnce(facilitiesResponse([rejectedFacility]));
    await renderFacilities();

    await act(async () => buttonWithText("All").click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      `${API_BASE_URL}/admin/facilities?status=PENDING`,
    );
    expect(String(fetchMock.mock.calls[4]![0])).toBe(
      `${API_BASE_URL}/admin/facilities?status=REJECTED`,
    );
    const cards = container.querySelectorAll<HTMLLIElement>(".admin-facility-card");
    expect(cards.length, container.innerHTML).toBe(4);
  });

  it("shows the correct workflow actions for each verification status", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(facilitiesResponse([underReviewFacility]))
      .mockResolvedValueOnce(facilitiesResponse([verifiedActiveFacility]))
      .mockResolvedValueOnce(facilitiesResponse([rejectedFacility]));

    await renderFacilities();
    const pendingCard = facilityCard("Koregaon Lot");
    expect(pendingCard.querySelector(".admin-facility-review-button")).toBeTruthy();
    expect(pendingCard.querySelector(".admin-facility-approve-button")).toBeNull();
    expect(pendingCard.querySelector(".admin-facility-reject-button")).toBeNull();

    await act(async () => buttonWithText("Under Review").click());
    await settle();
    const reviewCard = facilityCard("Koregaon Lot");
    expect(reviewCard.querySelector(".admin-facility-review-button")).toBeNull();
    expect(reviewCard.querySelector(".admin-facility-approve-button")).toBeTruthy();
    expect(reviewCard.querySelector(".admin-facility-reject-button")).toBeTruthy();

    await act(async () => buttonWithText("Verified").click());
    await settle();
    const verifiedCard = facilityCard("Koregaon Lot");
    expect(verifiedCard.textContent).toContain("Verified");
    expect(verifiedCard.querySelector(".admin-facility-deactivate-button")).toBeTruthy();
    expect(verifiedCard.querySelector(".admin-facility-activate-button")).toBeNull();
    expect(verifiedCard.querySelector(".admin-facility-review-button")).toBeNull();

    await act(async () => buttonWithText("Rejected").click());
    await settle();
    const rejectedCard = facilityCard("Koregaon Lot");
    expect(rejectedCard.textContent).toContain("Rejected");
    expect(rejectedCard.querySelector("button")).toBeNull();
  });

  it("shows an Activate action for a VERIFIED but inactive facility", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(facilitiesResponse([verifiedInactiveFacility]));
    await renderFacilities();

    await act(async () => buttonWithText("Verified").click());
    await settle();
    const card = facilityCard("Koregaon Lot");
    expect(card.textContent).toContain("Inactive");
    expect(card.querySelector(".admin-facility-activate-button")).toBeTruthy();
    expect(card.querySelector(".admin-facility-deactivate-button")).toBeNull();
  });

  it("reviews a pending facility and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(
        facilityResponse({ ...pendingFacility, verificationStatus: "UNDER_REVIEW" }),
      )
      .mockResolvedValueOnce(facilitiesResponse([]));
    await renderFacilities();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-review-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![0]).toBe(`${API_BASE_URL}/admin/facilities/4/review`);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer access-token" },
    });
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/facilities?status=PENDING`);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Koregaon Lot");
    expect(status?.textContent).toContain("reviewed");
  });

  it("approves an under-review facility and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([]))
      .mockResolvedValueOnce(facilitiesResponse([underReviewFacility]))
      .mockResolvedValueOnce(
        facilityResponse({ ...underReviewFacility, verificationStatus: "VERIFIED" }),
      )
      .mockResolvedValueOnce(facilitiesResponse([]));
    await renderFacilities();
    await act(async () => buttonWithText("Under Review").click());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-approve-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/facilities/5/approve`);
    expect(fetchMock.mock.calls[3]![0]).toBe(
      `${API_BASE_URL}/admin/facilities?status=UNDER_REVIEW`,
    );
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Koregaon Lot");
    expect(status?.textContent).toContain("approved");
  });

  it("rejects an under-review facility and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([underReviewFacility]))
      .mockResolvedValueOnce(
        facilityResponse({ ...underReviewFacility, verificationStatus: "REJECTED" }),
      )
      .mockResolvedValueOnce(facilitiesResponse([]));
    await renderFacilities();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-reject-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![0]).toBe(`${API_BASE_URL}/admin/facilities/5/reject`);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/facilities?status=PENDING`);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("rejected");
  });

  it("deactivates a verified active facility and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(facilitiesResponse([verifiedActiveFacility]))
      .mockResolvedValueOnce(facilityResponse({ ...verifiedActiveFacility, isActive: false }))
      .mockResolvedValueOnce(facilitiesResponse([]));
    await renderFacilities();
    await act(async () => buttonWithText("Verified").click());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-deactivate-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/facilities/6/deactivate`);
    expect(fetchMock.mock.calls[3]![0]).toBe(`${API_BASE_URL}/admin/facilities?status=VERIFIED`);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Koregaon Lot");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("deactivated");
  });

  it("activates a verified inactive facility and refreshes the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(facilitiesResponse([verifiedInactiveFacility]))
      .mockResolvedValueOnce(facilityResponse({ ...verifiedInactiveFacility, isActive: true }))
      .mockResolvedValueOnce(facilitiesResponse([]));
    await renderFacilities();
    await act(async () => buttonWithText("Verified").click());
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-activate-button")!.click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/facilities/7/activate`);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Koregaon Lot");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("activated");
  });

  it("prevents duplicate submissions while an action is in flight", async () => {
    let resolveAction!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveAction = resolve;
        }),
      )
      .mockResolvedValueOnce(facilitiesResponse([]));
    await renderFacilities();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-review-button")!.click(),
    );
    expect(container.textContent).toContain("Reviewing...");
    const reviewButton = container.querySelector<HTMLButtonElement>(
      ".admin-facility-review-button",
    )!;
    expect(reviewButton.disabled).toBe(true);

    await act(async () => reviewButton.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () =>
      resolveAction(facilityResponse({ ...pendingFacility, verificationStatus: "UNDER_REVIEW" })),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![0]).toBe(`${API_BASE_URL}/admin/facilities?status=PENDING`);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("reviewed");
  });

  it.each([
    [401, "UNAUTHORIZED", "Your admin session is no longer authorized"],
    [403, "FORBIDDEN", "Only administrators can manage facilities"],
    [404, "FACILITY_NOT_FOUND", "could not be found or is no longer available"],
    [409, "FACILITY_STATUS_CONFLICT", "already changed status"],
    [500, "INTERNAL_ERROR", "500 failure"],
  ] as const)("shows actio error %i with a useful message", async (status, code, message) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockResolvedValueOnce(adminErrorResponse(status, code, `${status} failure`));
    await renderFacilities();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-review-button")!.click(),
    );
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it("shows a load error and calls onError with the message", async () => {
    const onError = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      adminErrorResponse(401, "UNAUTHORIZED", "Admin token invalid"),
    );
    await renderFacilities({ onError });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your admin session is no longer authorized",
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no longer authorized"));
  });

  it("shows a useful message when the admin service is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Network request failed"));
    await renderFacilities();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to reach the admin service.",
    );
  });

  it("resets action feedback when the filter changes", async () => {
    let resolveAction!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(facilitiesResponse([pendingFacility]))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveAction = resolve;
        }),
      )
      .mockResolvedValueOnce(facilitiesResponse([]))
      .mockResolvedValueOnce(facilitiesResponse([underReviewFacility]));
    await renderFacilities();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(".admin-facility-review-button")!.click(),
    );
    await act(async () =>
      resolveAction(facilityResponse({ ...pendingFacility, verificationStatus: "UNDER_REVIEW" })),
    );
    await settle();
    expect(container.querySelector('[role="status"]')).toBeTruthy();

    await act(async () => buttonWithText("Under Review").click());
    await settle();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(facilityCard("Koregaon Lot")).toBeTruthy();
  });
});
