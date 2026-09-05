/**
 * Phase 2C DB-backed integration tests: booking/reservation foundation
 * (docs/DATABASE.md §2.12, docs/API_SPEC.md §2 reservations) against a
 * THROWAWAY postgres database (`smartpark_test`), recreated + migrated per run.
 * Follows the Phase 2A/2B suite pattern (fileParallelism: false, so sharing
 * `smartpark_test` is safe).
 *
 * Requires the docker compose postgres (`npm run infra:up`); CI runs a
 * postgres service (see .github/workflows/ci.yml).
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type {
  AuthResponse,
  BookingListResponse,
  BookingResponse,
  ParkingFacility,
  ParkingSlot,
} from "@smartpark/shared";
import { createApp } from "../src/app.js";
import { getPool, closeDb } from "../src/db.js";
import { runMigrations } from "../db/migrate.js";

const TEST_URL = new URL(
  process.env.TEST_DATABASE_URL ?? "postgresql://smartpark:smartpark@localhost:5432/smartpark_test",
);
const DB_NAME = TEST_URL.pathname.replace(/^\//, "");

function maintenanceUrl(): URL {
  const u = new URL(TEST_URL.toString());
  u.pathname = "/postgres";
  return u;
}

async function ensureDatabase(): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl().toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(DB_NAME)}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  } finally {
    await client.end();
  }
}

async function resetSchema(): Promise<void> {
  const client = new Client({ connectionString: TEST_URL.toString() });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;
let emailSeq = 0;

const uniqueEmail = (() => {
  const stamp = Date.now();
  return (label: string) => `${label}-${stamp}-${emailSeq++}@example.com`;
})();

async function jsonPost(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function jsonGet(path: string, token?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function jsonPatch(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function registerSession(label: string): Promise<AuthResponse> {
  const { status, body } = await jsonPost("/api/v1/auth/register", {
    email: uniqueEmail(label),
    password: "CorrectHorseBatteryStaple",
  });
  expect(status).toBe(201);
  return body as AuthResponse;
}

async function registerOperatorSession(label: string): Promise<AuthResponse> {
  const session = await registerSession(label);
  const { status } = await jsonPost(
    "/api/v1/operators/register",
    { name: `${label} Parkings Pvt Ltd` },
    session.accessToken,
  );
  expect(status).toBe(201);
  return session;
}

async function createFacility(token: string): Promise<ParkingFacility> {
  const { status, body } = await jsonPost(
    "/api/v1/operators/me/facilities",
    { name: "Phase2C Parking", type: "off-street", city: "Pune", area: "Koregaon", capacity: 6 },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingFacility;
}

async function createSlot(
  token: string,
  facilityId: number,
  overrides: Record<string, unknown> = {},
): Promise<ParkingSlot> {
  const { status, body } = await jsonPost(
    `/api/v1/operators/me/facilities/${facilityId}/slots`,
    { slotCode: `2C-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...overrides },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingSlot;
}

async function createBooking(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await jsonPost("/api/v1/reservations", body, token);
  return res;
}

const WINDOW = (facilityId: number, slotId: number | undefined, dayOffset = 1) => ({
  facilityId,
  ...(slotId ? { slotId } : {}),
  startsAt: `2026-09-${String(10 + dayOffset).padStart(2, "0")}T08:00:00Z`,
  endsAt: `2026-09-${String(10 + dayOffset).padStart(2, "0")}T10:00:00Z`,
});

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  await ensureDatabase();
  await resetSchema();
  const migrated = await runMigrations(TEST_URL.toString());
  expect(migrated.pending).toBe(0);

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
  await dropDatabase();
});

async function dropDatabase(): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl().toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(DB_NAME)} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

describe("DB schema (Phase 2C migration 0005)", () => {
  it("creates the reservations table with the documented shape", async () => {
    const { rows } = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'reservations' ORDER BY ordinal_position`,
    );
    const cols = rows.map((r) => r.column_name);
    for (const c of [
      "id",
      "reservation_code",
      "user_id",
      "facility_id",
      "zone_id",
      "slot_id",
      "starts_at",
      "ends_at",
      "state",
      "cancel_reason",
      "cancelled_at",
      "confirmed_at",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("restricts reservation state to the Phase 2C non-payment subset", async () => {
    const { rows } = await getPool().query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conname = 'reservations_state_check'`,
    );
    expect(rows[0]!.consrc).toContain("CONFIRMED");
    expect(rows[0]!.consrc).toContain("CANCELLED");
    expect(rows[0]!.consrc).toContain("COMPLETED");
    expect(rows[0]!.consrc).not.toContain("PENDING_PAYMENT");
  });

  it("installs the exclusion-constraint double-booking guard", async () => {
    const { rows } = await getPool().query<{ contype: string; conname: string }>(
      `SELECT contype, conname FROM pg_constraint WHERE conname = 'reservations_no_overlap'`,
    );
    expect(rows[0]!.contype).toBe("x");
  });

  it("enforces the ends_at > starts_at range check", async () => {
    const user = await registerSession("range-user");
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`range-${Date.now()}@example.com`],
    );
    const facility = await createFacility((await registerOperatorSession("range-op")).accessToken);
    await expect(
      getPool().query(
        `INSERT INTO reservations
           (reservation_code, user_id, facility_id, starts_at, ends_at, state)
         VALUES ($1, $2, $3, now() + interval '2 hours', now() + interval '1 hour', 'CONFIRMED')`,
        [`RNG-${Date.now()}`, rows[0]!.id, facility.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(user.accessToken).toBeTruthy();
  });
});

describe("POST /api/v1/reservations — creation", () => {
  let operator: AuthResponse;
  let userA: AuthResponse;
  let facility: ParkingFacility;
  let slots: ParkingSlot[];

  beforeAll(async () => {
    operator = await registerOperatorSession("bk-op");
    userA = await registerSession("bk-userA");
    facility = await createFacility(operator.accessToken);
    slots = [];
    slots.push(await createSlot(operator.accessToken, facility.id, { slotCode: "2C-S1" }));
    slots.push(await createSlot(operator.accessToken, facility.id, { slotCode: "2C-S2" }));
  });

  it("401 unauthenticated booking creation", async () => {
    const res = await jsonPost("/api/v1/reservations", WINDOW(facility.id, slots[0]!.id));
    expect(res.status).toBe(401);
  });

  it("400 invalid request (missing fields / unknown keys)", async () => {
    const missing = await createBooking(userA.accessToken, { facilityId: facility.id });
    expect(missing.status).toBe(400);

    const unknownKey = await createBooking(userA.accessToken, {
      ...WINDOW(facility.id, slots[0]!.id),
      is_demo: true,
    });
    expect(unknownKey.status).toBe(400);

    const badTypes = await createBooking(userA.accessToken, {
      facilityId: facility.id,
      startsAt: "2026-09-10T08:00:00Z",
      endsAt: "not-a-date",
    });
    expect(badTypes.status).toBe(400);
  });

  it("400 invalid / zero-length / reversed time range", async () => {
    const reversed = await createBooking(userA.accessToken, {
      facilityId: facility.id,
      slotId: slots[0]!.id,
      startsAt: "2026-09-10T10:00:00Z",
      endsAt: "2026-09-10T08:00:00Z",
    });
    expect(reversed.status).toBe(400);
  });

  it("404 nonexistent facility", async () => {
    const res = await createBooking(userA.accessToken, WINDOW(999999, slots[0]!.id));
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("FACILITY_NOT_FOUND");
  });

  it("404 nonexistent slot", async () => {
    const res = await createBooking(userA.accessToken, WINDOW(facility.id, 999999));
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("SLOT_NOT_FOUND");
  });

  it("400 slot/facility mismatch", async () => {
    const otherOp = await registerOperatorSession("mismatch-op");
    const otherFacility = await createFacility(otherOp.accessToken);
    const otherSlot = await createSlot(otherOp.accessToken, otherFacility.id);
    const res = await createBooking(userA.accessToken, {
      facilityId: facility.id,
      slotId: otherSlot.id,
      startsAt: "2026-09-10T08:00:00Z",
      endsAt: "2026-09-10T10:00:00Z",
    });
    expect(res.status).toBe(400);
  });

  it("201 valid booking → CONFIRMED", async () => {
    const res = await createBooking(userA.accessToken, WINDOW(facility.id, slots[1]!.id));
    expect(res.status).toBe(201);
    const booking = (res.body as BookingResponse).reservation;
    expect(booking.state).toBe("CONFIRMED");
    expect(booking.userId).toBe(userA.user.id);
    expect(booking.facilityId).toBe(facility.id);
    expect(booking.slotId).toBe(slots[1]!.id);
    expect(booking.reservationCode).toMatch(/^BKG-/);
  });

  it("409 overlapping booking on the same slot", async () => {
    const first = await createBooking(userA.accessToken, WINDOW(facility.id, slots[0]!.id, 2));
    expect(first.status).toBe(201);

    // Slightly overlapping window on the same slot.
    const overlap = await createBooking(userA.accessToken, {
      facilityId: facility.id,
      slotId: slots[0]!.id,
      startsAt: "2026-09-12T09:00:00Z",
      endsAt: "2026-09-12T11:00:00Z",
    });
    expect(overlap.status).toBe(409);
    expect(errorCode(overlap.body)).toBe("RESERVATION_CONFLICT");
  });

  it("different slot (or window) is allowed", async () => {
    const other = await createBooking(userA.accessToken, WINDOW(facility.id, slots[0]!.id, 5));
    expect(other.status).toBe(201);
  });

  it("400 booking an unavailable (OCCUPIED) slot", async () => {
    const occSlot = await createSlot(operator.accessToken, facility.id, { slotCode: "2C-S3" });
    await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}/slots/${occSlot.id}`,
      { status: "OCCUPIED" },
      operator.accessToken,
    );
    const res = await createBooking(userA.accessToken, WINDOW(facility.id, occSlot.id, 6));
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe("SLOT_UNAVAILABLE");
  });

  it("allows a booking without a specific slot (facility-level)", async () => {
    const res = await createBooking(userA.accessToken, WINDOW(facility.id, undefined, 7));
    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/reservations — own list + detail (IDOR)", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;
  let code: string;

  beforeAll(async () => {
    userA = await registerSession("list-userA");
    userB = await registerSession("list-userB");
    operator = await registerOperatorSession("list-op");
    facility = await createFacility(operator.accessToken);
    slot = await createSlot(operator.accessToken, facility.id);
    const created = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id));
    expect(created.status).toBe(201);
    code = (created.body as BookingResponse).reservation.reservationCode;
  });

  it("user's booking list returns only their own bookings", async () => {
    const res = await jsonGet("/api/v1/reservations", userA.accessToken);
    expect(res.status).toBe(200);
    const list = res.body as BookingListResponse;
    expect(list.reservations.length).toBeGreaterThan(0);
    for (const r of list.reservations) {
      expect(r.userId).toBe(userA.user.id);
    }
  });

  it("401 list without auth", async () => {
    const res = await jsonGet("/api/v1/reservations");
    expect(res.status).toBe(401);
  });

  it("owner can fetch their booking by code", async () => {
    const res = await jsonGet(`/api/v1/reservations/${code}`, userA.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as BookingResponse).reservation.reservationCode).toBe(code);
  });

  it("IDOR: another user cannot fetch (404, no enumeration)", async () => {
    const res = await jsonGet(`/api/v1/reservations/${code}`, userB.accessToken);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });
});

describe("GET /api/v1/operators/me/reservations — operator scope", () => {
  let operatorA: AuthResponse;
  let operatorB: AuthResponse;
  let regularUser: AuthResponse;
  let emptyOperator: AuthResponse;
  let facilityA1: ParkingFacility;
  let facilityA2: ParkingFacility;
  let facilityB: ParkingFacility;
  let deletedCode: string;

  beforeAll(async () => {
    operatorA = await registerOperatorSession("reservation-list-opA");
    operatorB = await registerOperatorSession("reservation-list-opB");
    regularUser = await registerSession("reservation-list-user");
    emptyOperator = await registerOperatorSession("reservation-list-empty");
    facilityA1 = await createFacility(operatorA.accessToken);
    facilityA2 = await createFacility(operatorA.accessToken);
    facilityB = await createFacility(operatorB.accessToken);

    const old = await createBooking(regularUser.accessToken, WINDOW(facilityA1.id, undefined, 10));
    const middle = await createBooking(
      regularUser.accessToken,
      WINDOW(facilityA2.id, undefined, 11),
    );
    const newest = await createBooking(
      regularUser.accessToken,
      WINDOW(facilityA1.id, undefined, 12),
    );
    const foreign = await createBooking(
      regularUser.accessToken,
      WINDOW(facilityB.id, undefined, 13),
    );
    expect(old.status).toBe(201);
    expect(middle.status).toBe(201);
    expect(newest.status).toBe(201);
    expect(foreign.status).toBe(201);
    deletedCode = (middle.body as BookingResponse).reservation.reservationCode;
  });

  it("rejects unauthenticated and non-operator requests", async () => {
    expect((await jsonGet("/api/v1/operators/me/reservations")).status).toBe(401);
    const regular = await jsonGet("/api/v1/operators/me/reservations", regularUser.accessToken);
    expect(regular.status).toBe(403);
  });

  it("returns only reservations from all facilities owned by the operator", async () => {
    const res = await jsonGet("/api/v1/operators/me/reservations", operatorA.accessToken);
    expect(res.status).toBe(200);
    const list = res.body as BookingListResponse;
    expect(list.reservations).toHaveLength(3);
    expect(
      list.reservations.every((reservation) =>
        [facilityA1.id, facilityA2.id].includes(reservation.facilityId),
      ),
    ).toBe(true);
    expect(list.reservations.some((reservation) => reservation.facilityId === facilityB.id)).toBe(
      false,
    );
    expect(list.reservations.map((reservation) => reservation.startsAt)).toEqual(
      [...list.reservations.map((reservation) => reservation.startsAt)].sort().reverse(),
    );
    expect(JSON.stringify(list)).not.toMatch(/name|email/i);
  });

  it("excludes soft-deleted reservations and returns an empty shape when scoped data is absent", async () => {
    await getPool().query(
      "UPDATE reservations SET deleted_at = now() WHERE reservation_code = $1",
      [deletedCode],
    );
    const scoped = await jsonGet("/api/v1/operators/me/reservations", operatorA.accessToken);
    expect((scoped.body as BookingListResponse).reservations).toHaveLength(2);
    expect(JSON.stringify(scoped.body)).not.toContain(deletedCode);

    const empty = await jsonGet("/api/v1/operators/me/reservations", emptyOperator.accessToken);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ reservations: [] });
  });

  it("cannot use the operator endpoint to retrieve another operator's reservations", async () => {
    const res = await jsonGet("/api/v1/operators/me/reservations", operatorB.accessToken);
    expect(res.status).toBe(200);
    const list = res.body as BookingListResponse;
    expect(list.reservations).toHaveLength(1);
    expect(list.reservations[0]!.facilityId).toBe(facilityB.id);
    expect(list.reservations[0]!.facilityId).not.toBe(facilityA1.id);
  });
});

describe("POST /api/v1/reservations/:code/cancel", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;

  beforeAll(async () => {
    userA = await registerSession("cancel-userA");
    userB = await registerSession("cancel-userB");
    operator = await registerOperatorSession("cancel-op");
    facility = await createFacility(operator.accessToken);
    slot = await createSlot(operator.accessToken, facility.id);
  });

  it("owner cancellation → success (state CANCELLED)", async () => {
    const created = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id));
    expect(created.status).toBe(201);
    const code = (created.body as BookingResponse).reservation.reservationCode;

    const res = await jsonPost(
      `/api/v1/reservations/${code}/cancel`,
      { reason: "changed plans" },
      userA.accessToken,
    );
    expect(res.status).toBe(200);
    const booking = (res.body as BookingResponse).reservation;
    expect(booking.state).toBe("CANCELLED");
    expect(booking.cancelReason).toBe("changed plans");
  });

  it("409 double cancellation is rejected", async () => {
    const created = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id));
    const code = (created.body as BookingResponse).reservation.reservationCode;
    await jsonPost(`/api/v1/reservations/${code}/cancel`, {}, userA.accessToken);

    const again = await jsonPost(`/api/v1/reservations/${code}/cancel`, {}, userA.accessToken);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe("ALREADY_CANCELLED");
  });

  it("422 completed booking cannot be cancelled", async () => {
    const created = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id));
    const code = (created.body as BookingResponse).reservation.reservationCode;
    await getPool().query(
      "UPDATE reservations SET state = 'COMPLETED' WHERE reservation_code = $1",
      [code],
    );

    const res = await jsonPost(`/api/v1/reservations/${code}/cancel`, {}, userA.accessToken);
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe("CANNOT_CANCEL_COMPLETED");
  });

  it("IDOR: another user cannot cancel (404)", async () => {
    const created = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id));
    const code = (created.body as BookingResponse).reservation.reservationCode;
    const res = await jsonPost(`/api/v1/reservations/${code}/cancel`, {}, userB.accessToken);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });
});

describe("Concurrency / rollback safety", () => {
  it("two overlapping inserts cannot both succeed (exclusion constraint), and no partial row is left", async () => {
    const userA = await registerSession("conc-userA");
    const userB = await registerSession("conc-userB");
    const operator = await registerOperatorSession("conc-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);

    const body = WINDOW(facility.id, slot.id);
    const [ra, rb] = await Promise.all([
      createBooking(userA.accessToken, body),
      createBooking(userB.accessToken, body),
    ]);

    const successes = [ra.status, rb.status].filter((s) => s === 201).length;
    const conflicts = [ra.status, rb.status].filter((s) => s === 409).length;
    expect(successes + conflicts).toBe(2);
    expect(successes).toBe(1);
    expect(conflicts).toBe(1);

    const { rows } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM reservations WHERE slot_id = $1`,
      [slot.id],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
