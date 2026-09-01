import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const response = {
  facilityId: "PUN-000001",
  totalSlots: 2,
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
    {
      id: 2,
      slotCode: "A02",
      facilityId: 1,
      zoneId: null,
      vehicleType: "car",
      status: "OCCUPIED",
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

async function renderApp() {
  await act(async () => {
    root.render(<App />);
  });
}

async function submitFacilityId(value: string) {
  const input = container.querySelector<HTMLInputElement>("#facility-id")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await act(async () => {
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
  });
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await renderApp();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("public availability screen", () => {
  it("renders the initial state with accessible controls", () => {
    expect(container.querySelector("h1")?.textContent).toContain("SmartPark India");
    expect(container.querySelector("label")?.textContent).toBe("Facility ID");
    expect(container.querySelector("button")?.textContent).toContain("Check availability");
    expect(container.textContent).toContain("Enter a facility ID");
  });

  it("shows loading while the availability request is pending", async () => {
    let resolveRequest!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    await submitFacilityId("1");
    expect(container.textContent).toContain("Loading facility availability...");
    expect(container.querySelector("button")?.hasAttribute("disabled")).toBe(true);

    resolveRequest(new Response(JSON.stringify(response), { status: 200 }));
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("renders live status, confidence, timestamp, disclaimer, and slot statuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );

    await submitFacilityId("1");
    expect(container.textContent).toContain("Live now");
    expect(container.textContent).toContain("HIGH");
    expect(container.textContent).toContain("9/1/2026");
    expect(container.textContent).toContain(response.disclaimer);
    expect(container.textContent).toContain("A01");
    expect(container.textContent).toContain("AVAILABLE");
    expect(container.textContent).toContain("A02");
    expect(container.textContent).toContain("OCCUPIED");
  });

  it("renders an empty state for a facility with zero slots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...response, totalSlots: 0, availableSlots: 0, slots: [] }), {
        status: 200,
      }),
    );

    await submitFacilityId("1");
    expect(container.textContent).toContain("No slots are currently reported");
    expect(container.textContent).toContain("Available0");
    expect(container.textContent).toContain("Total slots0");
  });

  it("handles invalid IDs, facility-not-found, and network errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await submitFacilityId("");
    expect(container.textContent).toContain("Enter a valid positive facility ID.");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Facility not found" } }), { status: 404 }),
    );
    await submitFacilityId("999");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Facility not found");

    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    await submitFacilityId("1");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Network unavailable");
  });
});
