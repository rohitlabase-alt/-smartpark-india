import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "@smartpark/shared";
import AdminAudit from "./AdminAudit";
import { API_BASE_URL } from "./api/auth";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const slotEvent: AuditEvent = {
  id: 41,
  actorUserId: 1,
  actorEmail: "admin@smartpark.in",
  action: "SLOT_CREATED",
  entityType: "SLOT",
  entityId: 9,
  metadata: { slotCode: "A01" },
  createdAt: "2026-09-10T08:00:00.000Z",
};

const approvedEvent: AuditEvent = {
  id: 40,
  actorUserId: null,
  actorEmail: null,
  action: "OPERATOR_APPROVED",
  entityType: "OPERATOR",
  entityId: 3,
  metadata: {},
  createdAt: "2026-09-09T09:30:00.000Z",
};

const gateRejectedEvent: AuditEvent = {
  id: 39,
  actorUserId: 5,
  actorEmail: "operator@example.com",
  action: "GATE_ENTRY_REJECTED",
  entityType: "RESERVATION",
  entityId: 601,
  metadata: { reason: "INVALID_TOKEN" },
  createdAt: "2026-09-11T08:05:00.000Z",
};

function eventsResponse(
  events: AuditEvent[],
  page = 1,
  limit = 20,
  total = events.length,
): Response {
  return new Response(JSON.stringify({ events, page, limit, total }), { status: 200 });
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

async function renderAudit(
  props: { accessToken?: string; onError?: (message: string) => void } = {},
) {
  await act(async () =>
    root.render(
      <AdminAudit accessToken={props.accessToken ?? "access-token"} onError={props.onError} />,
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

function selectWithLabel(label: string): HTMLSelectElement {
  const labels = Array.from(container.querySelectorAll<HTMLLabelElement>(".audit-filters label"));
  const found = labels.find(
    (entry) => entry.querySelector(".audit-filter-label")?.textContent === label,
  );
  if (!found) throw new Error(`No audit filter labelled "${label}"`);
  return found.querySelector("select")!;
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

describe("AdminAudit", () => {
  it("loads and labels audit events on mount", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(eventsResponse([slotEvent, approvedEvent]));

    await renderAudit();

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${API_BASE_URL}/admin/audit-events?page=1&limit=20`,
    );
    expect(container.textContent).toContain("Audit Trail");
    expect(container.textContent).toContain("2 events");
    expect(container.textContent).toContain("Slot created");
    expect(container.textContent).toContain("Operator approved");
    expect(container.textContent).toContain("admin@smartpark.in");
    expect(container.textContent).toContain("System");
    expect(container.textContent).toContain("#9");
  });

  it("shows a loading notice while events are fetched", async () => {
    let resolveEvents!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveEvents = resolve;
      }),
    );
    await renderAudit();

    expect(container.textContent).toContain("Loading audit events...");

    await act(async () => resolveEvents(eventsResponse([])));
    await settle();
    expect(container.textContent).not.toContain("Loading audit events...");
  });

  it("lists the gate verification actions in the audit action filter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(eventsResponse([]));
    await renderAudit();

    const select = container.querySelector<HTMLSelectElement>(".audit-filters select")!;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options).toContain("Gate entry verified");
    expect(options).toContain("Gate entry rejected");
    expect(options).toContain("Gate exit verified");
    expect(options).toContain("Gate exit rejected");
    expect(options).toContain("Slot occupied");
    expect(options).toContain("Slot released");
  });

  it("labels gate rejection events in the audit trail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(eventsResponse([gateRejectedEvent]));
    await renderAudit();

    expect(container.textContent).toContain("Gate entry rejected");
    expect(container.textContent).toContain("operator@example.com");
    expect(container.textContent).toContain("reservation");
  });

  it("shows an empty state when no audit events match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(eventsResponse([], 1, 20, 0));
    await renderAudit();

    expect(container.textContent).toContain("No audit events match these filters.");
    expect(container.textContent).toContain("0 events");
  });

  it("refetches audit events and resets to page 1 when Apply filters is clicked", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(eventsResponse([slotEvent, approvedEvent]))
      .mockResolvedValueOnce(eventsResponse([approvedEvent]));

    await renderAudit();

    await act(async () => {
      selectWithLabel("Action").value = "OPERATOR_APPROVED";
      selectWithLabel("Action").dispatchEvent(new Event("change", { bubbles: true }));
      selectWithLabel("Entity").value = "OPERATOR";
      selectWithLabel("Entity").dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => buttonWithText("Apply filters").click());
    await settle();

    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      `${API_BASE_URL}/admin/audit-events?action=OPERATOR_APPROVED&entityType=OPERATOR&page=1&limit=20`,
    );
  });

  it("converts date filters into inclusive day boundaries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(eventsResponse([approvedEvent]))
      .mockResolvedValueOnce(eventsResponse([approvedEvent]));

    await renderAudit();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      const dateInputs = Array.from(
        container.querySelectorAll<HTMLInputElement>('.audit-filters input[type="date"]'),
      );
      nativeSetter.call(dateInputs[0]!, "2026-09-09");
      dateInputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      nativeSetter.call(dateInputs[1]!, "2026-09-10");
      dateInputs[1]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonWithText("Apply filters").click());
    await settle();

    const url = decodeURIComponent(String(fetchMock.mock.calls[1]![0]));
    expect(url).toContain("from=2026-09-09T00:00:00.000Z");
    expect(url).toContain("to=2026-09-10T23:59:59.999Z");
    expect(url).toContain("page=1&limit=20");
  });

  it("paginates forward and disables the Next button on the last page", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(eventsResponse([slotEvent], 1, 20, 35))
      .mockResolvedValueOnce(eventsResponse([approvedEvent], 2, 20, 35));

    await renderAudit();

    expect(container.textContent).toContain("Page 1 of 2");
    expect(buttonWithText("Previous").disabled).toBe(true);
    expect(buttonWithText("Next").disabled).toBe(false);

    await act(async () => buttonWithText("Next").click());
    await settle();

    expect(String(fetchMock.mock.calls[1]![0])).toContain("page=2&limit=20");
    expect(container.textContent).toContain("Page 2 of 2");
    expect(buttonWithText("Next").disabled).toBe(true);
    expect(buttonWithText("Previous").disabled).toBe(false);
  });

  it("resets to the first page when the page size changes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(eventsResponse([slotEvent], 1, 20, 35))
      .mockResolvedValueOnce(eventsResponse([approvedEvent], 1, 50, 35));

    await renderAudit();

    await act(async () => {
      const limitSelect = container.querySelector<HTMLSelectElement>(".audit-limit-label select")!;
      limitSelect.value = "50";
      limitSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      `${API_BASE_URL}/admin/audit-events?page=1&limit=50`,
    );
    expect(container.textContent).toContain("1 of 1");
  });

  it("shows a load error and calls onError for an unauthorized request", async () => {
    const onError = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      adminErrorResponse(401, "UNAUTHORIZED", "Admin token invalid"),
    );
    await renderAudit({ onError });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your admin session is no longer authorized",
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no longer authorized"));
  });

  it("shows a useful message when the admin service is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Network request failed"));
    await renderAudit();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to reach the admin service.",
    );
  });
});
