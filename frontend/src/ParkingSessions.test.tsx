import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicParkingFacility, PublicUser } from "@smartpark/shared";
import App from "./App";
import { PassScreen } from "./screens/PassScreen";
import { clearMemorySession, setMemorySession, API_BASE_URL, type AuthSession } from "./api/auth";

const qrcodeMock = vi.hoisted(() => {
  const calls: string[] = [];
  const toDataURL = (text: string): Promise<string> => {
    calls.push(text);
    return Promise.resolve(`data:image/png;base64,${btoa(text)}`);
  };
  return { calls, toDataURL, reset: () => void calls.splice(0) };
});

vi.mock("qrcode", () => ({ toDataURL: qrcodeMock.toDataURL }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const user: PublicUser = {
  id: 7,
  email: "driver@example.com",
  fullName: "Asha Driver",
  phone: null,
  locale: "en",
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: "2026-09-01T10:00:00.000Z",
};

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInSeconds: 1800,
  user,
} satisfies AuthSession;

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

const confirmedReservation = {
  id: 12,
  reservationCode: "BKG-ABC123",
  userId: user.id,
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

const otherConfirmedReservation = {
  ...confirmedReservation,
  id: 15,
  reservationCode: "BKG-OTHER222",
  slotId: 11,
  startsAt: "2026-09-14T08:00:00.000Z",
  endsAt: "2026-09-14T10:00:00.000Z",
};

const activeReservation = {
  ...confirmedReservation,
  id: 16,
  reservationCode: "BKG-ACTIVE999",
  state: "ACTIVE" as const,
};

const pendingReservation = {
  ...confirmedReservation,
  id: 13,
  reservationCode: "BKG-PENDING987",
  slotId: 10,
  state: "PENDING_PAYMENT" as const,
  paymentStatus: "INITIATED" as const,
  confirmedAt: null,
};

const completedReservation = {
  ...confirmedReservation,
  id: 17,
  reservationCode: "BKG-DONE555",
  state: "COMPLETED" as const,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

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

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!button) throw new Error(`No button with text "${text}"`);
  return button;
}

async function renderPass(options: {
  accessToken?: string;
  focusCode?: string;
  reservations?: unknown[];
  handlers?: Array<[string, Handler]>;
  onSignIn?: () => void;
  onFind?: () => void;
}) {
  const reservations = options.reservations ?? [confirmedReservation];
  const fetchMock = routeFetch([
    ["/reservations", () => json({ reservations })],
    ...(options.handlers ?? []),
    ["/parking-sessions/by-reservation", () => json({ verificationToken: "TOK-NOT-REACHED" })],
  ]);
  await act(async () =>
    root.render(
      <PassScreen
        accessToken={options.accessToken ?? "access-token"}
        facilities={[facility]}
        focusCode={options.focusCode}
        onSignIn={options.onSignIn ?? vi.fn()}
        onFind={options.onFind ?? vi.fn()}
      />,
    ),
  );
  await settle();
  return fetchMock;
}

async function renderApp() {
  await act(async () => root.render(<App />));
  await settle();
}

async function clickNav(label: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(
      (entry) => entry.textContent?.includes(label),
    );
    if (!button) throw new Error(`Nav item not found: ${label}`);
    button.click();
  });
  await settle();
}

async function clickButton(label: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (entry) => entry.textContent?.includes(label),
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    button.click();
  });
  await settle();
}

beforeEach(() => {
  clearMemorySession();
  qrcodeMock.reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMemorySession();
  vi.restoreAllMocks();
});

describe("PassScreen", () => {
  it("asks guests to sign in and calls onSignIn", async () => {
    const onSignIn = vi.fn();
    routeFetch();
    await renderPass({ accessToken: "", onSignIn });
    expect(container.textContent).toContain("Sign in to access your digital parking pass.");
    await clickButton("Sign in");
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("loads only passable reservations and renders the pass details", async () => {
    await renderPass({
      reservations: [
        pendingReservation,
        confirmedReservation,
        completedReservation,
        activeReservation,
      ],
    });
    expect(container.textContent).toContain("Shivaji Nagar Public Parking");
    expect(container.textContent).toContain("BKG-ABC123");
    expect(container.textContent).toContain("#9");
    expect(container.textContent).toContain("Paid");
    expect(container.textContent).toContain("₹200");
    expect(container.textContent).not.toContain("BKG-PENDING987");
    expect(container.textContent).not.toContain("BKG-DONE555");
    expect(container.querySelectorAll(".chip").length).toBe(2);
  });

  it("shows a loading notice then an empty state with a Find parking action", async () => {
    let resolveList!: (value: Response) => void;
    const onFind = vi.fn();
    routeFetch([
      [
        "/reservations",
        () =>
          new Promise<Response>((resolve) => {
            resolveList = resolve;
          }),
      ],
    ]);
    await act(async () =>
      root.render(
        <PassScreen
          accessToken="access-token"
          facilities={[facility]}
          onSignIn={vi.fn()}
          onFind={onFind}
        />,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Loading your passes...");

    await act(async () => resolveList(json({ reservations: [] })));
    await settle();
    expect(container.textContent).not.toContain("Loading your passes...");
    expect(container.textContent).toContain(
      "You have no active passes yet. Book a parking spot to get your digital pass.",
    );
    await clickButton("Find parking");
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("shows a load error and retries", async () => {
    let calls = 0;
    routeFetch([
      [
        "/reservations",
        () =>
          calls++ === 0
            ? json({ error: { message: "boom" } }, 503)
            : json({ reservations: [confirmedReservation] }),
      ],
    ]);
    await act(async () =>
      root.render(
        <PassScreen
          accessToken="access-token"
          facilities={[facility]}
          onSignIn={vi.fn()}
          onFind={vi.fn()}
        />,
      ),
    );
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("boom");
    await clickButton("Try again");
    expect(container.textContent).toContain("BKG-ABC123");
    expect(container.textContent).not.toContain('[role="alert"]');
  });

  it("maps a 401 to the session-expired message", async () => {
    routeFetch([["/reservations", () => json({ error: { message: "nope" } }, 401)]]);
    await act(async () =>
      root.render(
        <PassScreen
          accessToken="access-token"
          facilities={[facility]}
          onSignIn={vi.fn()}
          onFind={vi.fn()}
        />,
      ),
    );
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Your session expired. Please sign in again.",
    );
  });

  it("reveals the pass lazily with a Bearer request and renders the token and QR", async () => {
    const fetchMock = await renderPass({
      reservations: [confirmedReservation],
      handlers: [
        [
          "/parking-sessions/by-reservation/BKG-ABC123/pass",
          (_input, init) => {
            expect(init?.headers).toMatchObject({ Authorization: "Bearer access-token" });
            return json({ verificationToken: "ppk_gatetoken1" });
          },
        ],
      ],
    });

    expect(container.querySelector('[aria-label="Parking pass token"]')).toBeNull();
    expect(container.querySelector(".parking-pass-qr")).toBeNull();
    await clickButton("Show parking pass");

    expect(container.querySelector('[aria-label="Parking pass token"]')?.textContent).toBe(
      "ppk_gatetoken1",
    );
    const qr = container.querySelector<HTMLImageElement>(".parking-pass-qr");
    expect(qr?.alt).toBe("Parking pass QR code");
    expect(qr?.src).toBe(`data:image/png;base64,${btoa("ppk_gatetoken1")}`);
    expect(container.textContent).toContain("Verified pass");
    expect(qrcodeMock.calls).toEqual(["ppk_gatetoken1"]);
    expect(urls(fetchMock).filter((url) => url.includes("/pass")).length).toBe(1);
  });

  it("switches between passes and refetches the new code", async () => {
    const fetchMock = await renderPass({
      reservations: [confirmedReservation, otherConfirmedReservation],
      handlers: [
        [
          "/parking-sessions/by-reservation/BKG-ABC123/pass",
          () => json({ verificationToken: "TOK-ONE" }),
        ],
        [
          "/parking-sessions/by-reservation/BKG-OTHER222/pass",
          () => json({ verificationToken: "TOK-TWO" }),
        ],
      ],
    });

    await clickButton("Show parking pass");
    expect(container.querySelector('[aria-label="Parking pass token"]')?.textContent).toBe(
      "TOK-ONE",
    );

    await act(async () => buttonWithText("BKG-OTHER222").click());
    expect(container.querySelector('[aria-label="Parking pass token"]')).toBeNull();
    expect(container.textContent).toContain("BKG-OTHER222");

    await clickButton("Show parking pass");
    expect(container.querySelector('[aria-label="Parking pass token"]')?.textContent).toBe(
      "TOK-TWO",
    );
    const passCalls = urls(fetchMock).filter((url) => url.includes("/by-reservation/"));
    expect(passCalls).toEqual([
      `${API_BASE_URL}/parking-sessions/by-reservation/BKG-ABC123/pass`,
      `${API_BASE_URL}/parking-sessions/by-reservation/BKG-OTHER222/pass`,
    ]);
  });

  it("focuses the passed-in reservation code", async () => {
    const fetchMock = await renderPass({
      reservations: [confirmedReservation, otherConfirmedReservation],
      focusCode: "BKG-OTHER222",
      handlers: [
        [
          "/parking-sessions/by-reservation/BKG-OTHER222/pass",
          () => json({ verificationToken: "TOK-FOCUS" }),
        ],
      ],
    });

    expect(container.querySelector(".chip.selected")?.textContent).toContain("BKG-OTHER222");
    await clickButton("Show parking pass");
    expect(container.querySelector('[aria-label="Parking pass token"]')?.textContent).toBe(
      "TOK-FOCUS",
    );
    expect(urls(fetchMock).some((url) => url.includes("/BKG-OTHER222/pass"))).toBe(true);
  });

  it("shows the server error when the pass cannot be issued", async () => {
    await renderPass({
      reservations: [confirmedReservation],
      handlers: [
        [
          "/parking-sessions/by-reservation/BKG-ABC123/pass",
          () =>
            json({ error: { code: "RESERVATION_NOT_ENTRYABLE", message: "not ready yet" } }, 409),
        ],
      ],
    });
    await clickButton("Show parking pass");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("not ready yet");
    expect(container.textContent).toContain("Show parking pass");
  });

  it("never renders a rendered QR before the reveal or a malformed response", async () => {
    const fetchMock = await renderPass({
      reservations: [confirmedReservation],
      handlers: [
        ["/parking-sessions/by-reservation/BKG-ABC123/pass", () => json({ notExpected: true })],
      ],
    });
    expect(container.querySelector(".parking-pass-qr")).toBeNull();
    await clickButton("Show parking pass");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The parking pass response was incomplete or malformed.",
    );
    expect(container.querySelector(".parking-pass-qr")).toBeNull();
    expect(urls(fetchMock).filter((url) => url.includes("/pass")).length).toBe(1);
  });
});

describe("driver parking sessions in the app shell", () => {
  it("lets an authenticated driver open the Pass tab and reveal the pass", async () => {
    setMemorySession(session);
    const fetchMock = routeFetch([
      ["/auth/me", () => json(user)],
      ["/parking/facilities", () => json({ facilities: [facility] })],
      ["/reservations", () => json({ reservations: [confirmedReservation] })],
      [
        "/parking-sessions/by-reservation/BKG-ABC123/pass",
        () => json({ verificationToken: "ppk_appshell" }),
      ],
    ]);
    await renderApp();

    await clickNav("Pass");
    expect(container.textContent).toContain("Shivaji Nagar Public Parking");
    await clickButton("Show parking pass");
    expect(container.querySelector('[aria-label="Parking pass token"]')?.textContent).toBe(
      "ppk_appshell",
    );
    expect(urls(fetchMock).some((url) => url.includes("/by-reservation/BKG-ABC123/pass"))).toBe(
      true,
    );
  });

  it("opens the pass focused on the booking the driver chooses from Bookings", async () => {
    setMemorySession(session);
    const fetchMock = routeFetch([
      ["/auth/me", () => json(user)],
      ["/parking/facilities", () => json({ facilities: [facility] })],
      [
        "/reservations",
        () => json({ reservations: [confirmedReservation, otherConfirmedReservation] }),
      ],
      [
        "/parking-sessions/by-reservation/BKG-ABC123/pass",
        () => json({ verificationToken: "TOK-VIEW" }),
      ],
    ]);
    await renderApp();

    await clickNav("Bookings");
    await clickButton("View pass");
    expect(container.textContent).toContain("Parking pass");
    expect(container.querySelector(".pass-code")?.textContent).toBe("BKG-ABC123");

    await clickButton("Show parking pass");
    expect(container.querySelector('[aria-label="Parking pass token"]')?.textContent).toBe(
      "TOK-VIEW",
    );
    const passCalls = urls(fetchMock).filter((url) => url.includes("/by-reservation/"));
    expect(passCalls).toEqual([`${API_BASE_URL}/parking-sessions/by-reservation/BKG-ABC123/pass`]);
  });
});
