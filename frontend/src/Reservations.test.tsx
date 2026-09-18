import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicParkingFacility, Reservation } from "@smartpark/shared";
import { BookingsScreen } from "./screens/BookingsScreen";
import { BookingFlowScreen } from "./screens/BookingFlowScreen";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const facility: PublicParkingFacility = {
  id: 4,
  parkingId: "PUN-000004",
  name: "Shivaji Nagar Public Parking",
  description: null,
  type: "public",
  city: "Pune",
  state: "Maharashtra",
  area: "Shivaji Nagar",
  address: "FC Road",
  capacity: 40,
  hourlyRate: 100,
  availabilityMode: "MANUAL",
  totalSlots: 4,
  availableSlots: 2,
  availableVehicleTypes: ["car"],
  isLive: true,
  confidence: "HIGH",
  lastUpdatedAt: "2026-09-01T10:00:00.000Z",
};

const reservation = {
  id: 12,
  reservationCode: "BKG-ABC123",
  userId: 7,
  facilityId: 4,
  zoneId: null,
  slotId: 9,
  startsAt: "2026-09-10T08:00:00.000Z",
  endsAt: "2026-09-10T10:00:00.000Z",
  state: "CONFIRMED" as const,
  amount: 200,
  paymentStatus: "SUCCESS" as const,
  cancelReason: null,
  cancelledAt: null,
  confirmedAt: "2026-09-01T10:05:00.000Z",
  createdAt: "2026-09-01T10:05:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
};

const cancelledReservation = {
  ...reservation,
  state: "CANCELLED" as const,
  cancelledAt: "2026-09-01T10:10:00.000Z",
  cancelReason: "changed plans",
  updatedAt: "2026-09-01T10:10:00.000Z",
};

const completedReservation = {
  ...reservation,
  state: "COMPLETED" as const,
};

const activeReservation = {
  ...reservation,
  id: 14,
  reservationCode: "BKG-ACTIVE456",
  state: "ACTIVE" as const,
};

const pendingReservation = {
  id: 13,
  reservationCode: "BKG-PENDING987",
  userId: 7,
  facilityId: 4,
  zoneId: null,
  slotId: 10,
  startsAt: "2026-09-12T08:00:00.000Z",
  endsAt: "2026-09-12T10:00:00.000Z",
  state: "PENDING_PAYMENT" as const,
  amount: 200,
  paymentStatus: "INITIATED" as const,
  cancelReason: null,
  cancelledAt: null,
  confirmedAt: null,
  createdAt: "2026-09-02T10:05:00.000Z",
  updatedAt: "2026-09-02T10:05:00.000Z",
};

const confirmedReservation = {
  ...pendingReservation,
  state: "CONFIRMED" as const,
  paymentStatus: "SUCCESS" as const,
  confirmedAt: "2026-09-02T10:06:00.000Z",
  updatedAt: "2026-09-02T10:06:00.000Z",
};

const initiatedPayment = {
  id: 1,
  reservationId: 13,
  provider: "MOCK" as const,
  providerTxnId: "MOCK-BKG-PENDING987-200",
  amount: 200,
  status: "PENDING" as const,
  createdAt: "2026-09-02T10:05:30.000Z",
  updatedAt: "2026-09-02T10:05:30.000Z",
};

const succeededPayment = {
  ...initiatedPayment,
  id: 2,
  providerTxnId: "MOCK-BKG-UNIQUE-200",
  status: "SUCCESS" as const,
};

const session = {
  id: 55,
  reservationId: 14,
  facilityId: 4,
  slotId: 9,
  userId: 7,
  entryAt: "2026-09-10T08:10:00.000Z",
  exitAt: null,
  status: "ACTIVE" as const,
  createdAt: "2026-09-10T08:10:00.000Z",
  updatedAt: "2026-09-10T08:10:00.000Z",
};

const availability = {
  facilityId: "PUN-000004",
  totalSlots: 4,
  availableSlots: 2,
  isLive: true,
  sources: ["MANUAL" as const],
  lastUpdatedAt: "2026-09-01T10:00:00.000Z",
  confidence: "HIGH" as const,
  disclaimer: "Operator-reported availability. Not guaranteed.",
  slots: [
    {
      id: 9,
      slotCode: "A01",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "AVAILABLE" as const,
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: 10,
      slotCode: "A02",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "OCCUPIED" as const,
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: 11,
      slotCode: "A03",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "AVAILABLE" as const,
      reservationsEnabled: false,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: 12,
      slotCode: "A04",
      facilityId: 4,
      zoneId: null,
      vehicleType: "car",
      status: "RESERVED" as const,
      reservationsEnabled: true,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ],
};

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function routeFetch(handlers: Array<[string, Handler]> = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    for (const [fragment, handler] of handlers) {
      if (url.includes(fragment)) return handler(input, init);
    }
    return json({ error: { message: "Not found" } }, 404);
  });
}

function urls(mock: ReturnType<typeof routeFetch>): string[] {
  return mock.mock.calls.map(([input]) => String(input));
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderBookings(
  options: {
    accessToken?: string;
    onViewPass?: (r: Reservation) => void;
    onSignIn?: () => void;
  } = {},
) {
  await act(async () =>
    root.render(
      <BookingsScreen
        accessToken={options.accessToken ?? "access-token"}
        facilities={[facility]}
        onViewPass={options.onViewPass ?? vi.fn()}
        onSignIn={options.onSignIn ?? vi.fn()}
      />,
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

describe("BookingsScreen", () => {
  it("shows a sign-in empty state when there is no session and calls onSignIn", async () => {
    const onSignIn = vi.fn();
    routeFetch();
    await renderBookings({ accessToken: "", onSignIn });
    expect(container.textContent).toContain("Sign in to see your bookings and parking passes.");
    await act(async () => buttonWithText("Sign in").click());
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("loads and renders bookings with facility names, amounts, and status labels", async () => {
    routeFetch([["/reservations", () => json({ reservations: [reservation] })]]);
    await renderBookings();
    expect(container.textContent).toContain("Shivaji Nagar Public Parking");
    expect(container.textContent).toContain("BKG-ABC123");
    expect(container.textContent).toContain("Confirmed");
    expect(container.textContent).toContain("₹200");
  });

  it("shows a loading notice and then an empty state", async () => {
    let resolveList!: (value: Response) => void;
    routeFetch([
      [
        "/reservations",
        () =>
          new Promise<Response>((resolve) => {
            resolveList = resolve;
          }),
      ],
    ]);
    await renderBookings();
    expect(container.textContent).toContain("Loading your bookings...");
    await act(async () => resolveList(json({ reservations: [] })));
    await settle();
    expect(container.textContent).not.toContain("Loading your bookings...");
    expect(container.textContent).toContain(
      "You have no bookings yet. Find parking to make your first one.",
    );
  });

  it("shows a network error and retries", async () => {
    let calls = 0;
    routeFetch([
      [
        "/reservations",
        () =>
          calls++ === 0
            ? json({ error: { message: "boom" } }, 503)
            : json({ reservations: [reservation] }),
      ],
    ]);
    await renderBookings();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("boom");
    await act(async () => buttonWithText("Try again").click());
    await settle();
    expect(container.textContent).toContain("BKG-ABC123");
  });

  it("shows the session-expired message for a 401", async () => {
    routeFetch([["/reservations", () => json({ error: { message: "nope" } }, 401)]]);
    await renderBookings();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Your session expired. Please sign in again.",
    );
  });

  it("renders the correct action per status", async () => {
    routeFetch([
      [
        "/reservations",
        () =>
          json({
            reservations: [
              pendingReservation,
              reservation,
              activeReservation,
              completedReservation,
            ],
          }),
      ],
    ]);
    await renderBookings();

    expect(buttonWithText("Pay & confirm")).toBeTruthy();
    await act(async () => buttonWithText("Cancel").click());
    expect(container.textContent).not.toContain("Exit parking");
    await act(async () => buttonWithText("Keep booking").click());

    await act(async () => buttonWithText("Upcoming").click());
    await act(async () => buttonWithText("Completed").click());
    expect(container.textContent).toContain("This booking is completed.");

    await act(async () => buttonWithText("Active").click());
    expect(buttonWithText("Exit parking")).toBeTruthy();
  });

  it("pays and confirms a pending reservation", async () => {
    const fetchMock = routeFetch([
      ["/reservations", () => json({ reservations: [pendingReservation] })],
      ["/payments/initiate", () => json({ payment: initiatedPayment })],
      [
        "/payments/MOCK-BKG-PENDING987-200/verify",
        () => json({ payment: succeededPayment, reservation: confirmedReservation }),
      ],
    ]);
    await renderBookings();

    await act(async () => buttonWithText("Pay & confirm").click());
    await settle();

    const calls = urls(fetchMock);
    expect(calls.some((url) => url.includes("/payments/initiate"))).toBe(true);
    expect(calls.some((url) => url.includes("/payments/MOCK-BKG-PENDING987-200/verify"))).toBe(
      true,
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Payment confirmed. Your booking is now active.",
    );
  });

  it("shows a payment error inline", async () => {
    routeFetch([
      ["/reservations", () => json({ reservations: [pendingReservation] })],
      [
        "/payments/initiate",
        () =>
          json(
            { error: { code: "PAYMENT_NOT_PENDING", message: "no longer waiting for payment" } },
            409,
          ),
      ],
    ]);
    await renderBookings();
    await act(async () => buttonWithText("Pay & confirm").click());
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "no longer waiting for payment",
    );
    expect(buttonWithText("Pay & confirm")).toBeTruthy();
  });

  it("cancels a confirmed booking after inline confirmation and refreshes", async () => {
    const fetchMock = routeFetch([
      ["/reservations/BKG-ABC123/cancel", () => json({ reservation: cancelledReservation })],
      ["/reservations", () => json({ reservations: [reservation] })],
    ]);
    await renderBookings();

    await act(async () => buttonWithText("Cancel").click());
    expect(container.textContent).toContain("Cancel this booking?");
    await act(async () => buttonWithText("Yes, cancel").click());
    await settle();

    const calls = urls(fetchMock);
    expect(calls.some((url) => url.endsWith("/reservations/BKG-ABC123/cancel"))).toBe(true);
  });

  it("keeps the booking when cancellation is dismissed without a request", async () => {
    const fetchMock = routeFetch([["/reservations", () => json({ reservations: [reservation] })]]);
    await renderBookings();

    await act(async () => buttonWithText("Cancel").click());
    await act(async () => buttonWithText("Keep booking").click());

    expect(container.textContent).not.toContain("Cancel this booking?");
    expect(urls(fetchMock).some((url) => url.includes("/cancel"))).toBe(false);
  });

  it("prevents duplicate cancellation submissions", async () => {
    let resolveCancel!: (value: Response) => void;
    const fetchMock = routeFetch([
      [
        "/reservations/BKG-ABC123/cancel",
        () =>
          new Promise<Response>((resolve) => {
            resolveCancel = resolve;
          }),
      ],
      ["/reservations", () => json({ reservations: [reservation] })],
    ]);
    await renderBookings();

    await act(async () => buttonWithText("Cancel").click());
    await act(async () => buttonWithText("Yes, cancel").click());
    expect(container.textContent).toContain("Cancelling...");
    const confirmButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".cancellation-actions button"),
    );
    confirmButtons.forEach((button) => expect(button.disabled).toBe(true));
    expect(urls(fetchMock).filter((url) => url.includes("/cancel")).length).toBe(1);

    await act(async () => resolveCancel(json({ reservation: cancelledReservation })));
    await settle();
  });

  it("shows cancellation errors and keeps the booking visible", async () => {
    routeFetch([
      [
        "/reservations/BKG-ABC123/cancel",
        () =>
          json({ error: { code: "CANNOT_CANCEL_COMPLETED", message: "already completed" } }, 422),
      ],
      ["/reservations", () => json({ reservations: [reservation] })],
    ]);
    await renderBookings();
    await act(async () => buttonWithText("Cancel").click());
    await act(async () => buttonWithText("Yes, cancel").click());
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already completed");
    expect(container.textContent).toContain("Confirmed");
  });

  it("exits an active session", async () => {
    const fetchMock = routeFetch([
      ["/reservations", () => json({ reservations: [activeReservation] })],
      ["/parking-sessions/by-reservation/BKG-ACTIVE456", () => json({ session })],
      ["/parking-sessions/55/exit", () => json({ session: { ...session, status: "COMPLETED" } })],
    ]);
    await renderBookings();

    await act(async () => buttonWithText("Exit parking").click());
    await settle();

    const calls = urls(fetchMock);
    expect(
      calls.some((url) => url.includes("/parking-sessions/by-reservation/BKG-ACTIVE456")),
    ).toBe(true);
    expect(calls.some((url) => url.endsWith("/parking-sessions/55/exit"))).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Vehicle exited");
  });

  it("asks the app to open the pass for a confirmed booking", async () => {
    const onViewPass = vi.fn();
    routeFetch([["/reservations", () => json({ reservations: [reservation] })]]);
    await renderBookings({ onViewPass });

    await act(async () => buttonWithText("View pass").click());
    expect(onViewPass).toHaveBeenCalledWith(reservation);
  });
});

describe("BookingFlowScreen", () => {
  function renderFlow() {
    return act(async () =>
      root.render(
        <BookingFlowScreen
          facility={facility}
          accessToken="access-token"
          onExit={vi.fn()}
          onFinished={vi.fn()}
        />,
      ),
    );
  }

  it("loads availability and lets the user pick a bookable spot", async () => {
    routeFetch([["/parking/4/availability", () => json(availability)]]);
    await renderFlow();
    await settle();

    expect(container.textContent).toContain("Select a slot");
    const options = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="option"]'),
    );
    expect(options.map((option) => option.textContent)).toEqual(["A01car", "A04car"]);
    options.forEach((option) => expect(option.disabled).toBe(false));

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[role="option"]')!.click(),
    );
    expect(buttonWithText("Book this spot")).toBeTruthy();
  });

  it("shows an availability error", async () => {
    routeFetch([
      ["/parking/4/availability", () => json({ error: { message: "Facility offline" } }, 503)],
    ]);
    await renderFlow();
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Facility offline");
    expect(buttonWithText("Back to facilities")).toBeTruthy();
  });

  it("reserves, pays, and reveals a parking pass without a transaction-id input", async () => {
    const fetchMock = routeFetch([
      ["/parking/4/availability", () => json(availability)],
      ["/payments/initiate", () => json({ payment: initiatedPayment })],
      [
        "/payments/MOCK-BKG-PENDING987-200/verify",
        () => json({ payment: succeededPayment, reservation: confirmedReservation }),
      ],
      [
        "/parking-sessions/by-reservation/BKG-PENDING987/pass",
        () => json({ verificationToken: "TOK-123" }),
      ],
      // POST /reservations (create)
      [
        "/reservations",
        (_input, init) => {
          if ((init?.method ?? "GET") === "POST")
            return json({ reservation: pendingReservation }, 201);
          return json({ error: { message: "Not found" } }, 404);
        },
      ],
    ]);
    await renderFlow();
    await settle();

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[role="option"]')!.click(),
    );
    await act(async () => buttonWithText("Book this spot").click());
    expect(container.textContent).toContain("Booking details");

    await act(async () => buttonWithText("Reserve now").click());
    await settle();

    expect(container.textContent).toContain("Confirm & pay");
    expect(container.textContent).toContain("Charged amount");
    expect(container.textContent).toContain("BKG-PENDING987");

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/reservations") && init?.method === "POST",
    )!;
    expect(JSON.parse(String(createCall[1]!.body))).toMatchObject({
      facilityId: 4,
      slotId: 9,
    });

    await act(async () => buttonWithText("View parking pass").click());
    expect(container.textContent).toContain("Parking Pass");
    await act(async () => buttonWithText("Show parking pass").click());
    await settle();

    expect(container.querySelector('[aria-label="Parking pass token"]')?.textContent).toBe(
      "TOK-123",
    );
    expect(container.textContent).not.toContain("__FAIL__");
    expect(
      container.querySelector('input[placeholder*="transaction" i], .payment-actions input'),
    ).toBeNull();
    expect(container.textContent).not.toContain("MOCK-BKG-UNIQUE-200");
  });

  it("shows the reservation creation error", async () => {
    routeFetch([
      ["/parking/4/availability", () => json(availability)],
      [
        "/reservations",
        (_input, init) => {
          if ((init?.method ?? "GET") === "POST")
            return json(
              { error: { code: "RESERVATION_CONFLICT", message: "no longer available " } },
              409,
            );
          return json({ error: { message: "Not found" } }, 404);
        },
      ],
    ]);
    await renderFlow();
    await settle();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[role="option"]')!.click(),
    );
    await act(async () => buttonWithText("Book this spot").click());
    await act(async () => buttonWithText("Reserve now").click());
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("no longer available");
  });
});
