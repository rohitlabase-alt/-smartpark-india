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
import {
  PAYMENT_STATUSES,
  RESERVATION_STATES,
  type AuthResponse,
  type BookingListResponse,
  type BookingResponse,
  type Operator,
  type ParkingFacility,
  type ParkingSlot,
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

async function registerAdminSession(label: string): Promise<AuthResponse> {
  const session = await registerSession(label);
  await getPool().query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT u.id, r.id FROM users u JOIN roles r ON r.code = 'ADMIN'
     WHERE u.email = $1
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [session.user.email],
  );
  return session;
}

/** Registers an operator (PENDING) and moves it through review to VERIFIED. */
async function registerVerifiedOperatorSession(label: string): Promise<AuthResponse> {
  const session = await registerOperatorSession(label);
  const me = await jsonGet("/api/v1/operators/me", session.accessToken);
  const operator = me.body as Operator;
  const admin = await registerAdminSession(`${label}-admin`);
  const review = await jsonPost(
    `/api/v1/admin/operators/${operator.id}/review`,
    {},
    admin.accessToken,
  );
  expect(review.status).toBe(200);
  const approve = await jsonPost(
    `/api/v1/admin/operators/${operator.id}/approve`,
    {},
    admin.accessToken,
  );
  expect(approve.status).toBe(200);
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

async function approveFacility(adminToken: string, facilityId: number): Promise<void> {
  const review = await jsonPost(`/api/v1/admin/facilities/${facilityId}/review`, {}, adminToken);
  expect(review.status).toBe(200);
  const approve = await jsonPost(`/api/v1/admin/facilities/${facilityId}/approve`, {}, adminToken);
  expect(approve.status).toBe(200);
}

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

  it("restricts reservation state to the documented lifecycle vocabulary", async () => {
    const { rows } = await getPool().query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conname = 'reservations_state_check'`,
    );
    expect(rows[0]!.consrc).toContain("PENDING_PAYMENT");
    expect(rows[0]!.consrc).toContain("CONFIRMED");
    expect(rows[0]!.consrc).toContain("CANCELLED");
    expect(rows[0]!.consrc).toContain("COMPLETED");
    expect(rows[0]!.consrc).toContain("ACTIVE");
    expect(rows[0]!.consrc).toContain("EXPIRED");
    expect(rows[0]!.consrc).toContain("FAILED");
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
    const facility = await createFacility(
      (await registerVerifiedOperatorSession("range-op")).accessToken,
    );
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
    operator = await registerVerifiedOperatorSession("bk-op");
    userA = await registerSession("bk-userA");
    facility = await createFacility(operator.accessToken);
    const admin = await registerAdminSession("bk-admin");
    await approveFacility(admin.accessToken, facility.id);
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
    const otherOp = await registerVerifiedOperatorSession("mismatch-op");
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

  it("201 valid booking → PENDING_PAYMENT with amount + INITIATED payment status", async () => {
    const res = await createBooking(userA.accessToken, WINDOW(facility.id, slots[1]!.id));
    expect(res.status).toBe(201);
    const booking = (res.body as BookingResponse).reservation;
    expect(booking.state).toBe("PENDING_PAYMENT");
    expect(booking.userId).toBe(userA.user.id);
    expect(booking.facilityId).toBe(facility.id);
    expect(booking.slotId).toBe(slots[1]!.id);
    expect(booking.reservationCode).toMatch(/^BKG-/);
    expect(booking.amount).toBe(200);
    expect(booking.paymentStatus).toBe("INITIATED");
    expect(booking.confirmedAt).toBeNull();
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
    operator = await registerVerifiedOperatorSession("list-op");
    facility = await createFacility(operator.accessToken);
    const admin = await registerAdminSession("list-admin");
    await approveFacility(admin.accessToken, facility.id);
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

describe("Phase 7 regression — complete reservation response shape + lifecycle (bug: 'reservations response was incomplete or malformed')", () => {
  let user: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;
  let dayOffset = 14; // WINDOW maps 10+offset → Sept day; stay valid (≤ day 28)

  /**
   * Mirrors the FRONTEND validator's requirements (frontend/src/api/reservations.ts)
   * against the COMPLETE 16-field response contract shared by every reservations
   * endpoint. A stale @smartpark/shared build or a partial DTO here must fail.
   */
  function expectReservationShape(r: unknown): void {
    expect(r).toBeDefined();
    expect(r).toBeTypeOf("object");
    const reservation = r as Record<string, unknown>;
    expect(reservation.id).toBeTypeOf("number");
    expect(reservation.reservationCode).toBeTypeOf("string");
    expect(reservation.userId).toBeTypeOf("number");
    expect(reservation.facilityId).toBeTypeOf("number");
    expect(reservation.zoneId === null || typeof reservation.zoneId === "number").toBe(true);
    expect(reservation.slotId).toBeTypeOf("number");
    expect(reservation.startsAt).toBeTypeOf("string");
    expect(reservation.endsAt).toBeTypeOf("string");
    expect(RESERVATION_STATES).toContain(reservation.state);
    expect(
      reservation.amount === null ||
        (typeof reservation.amount === "number" && Number.isFinite(reservation.amount)),
    ).toBe(true);
    expect(
      reservation.paymentStatus === null ||
        (typeof reservation.paymentStatus === "string" &&
          PAYMENT_STATUSES.includes(reservation.paymentStatus)),
    ).toBe(true);
    expect(reservation.cancelReason === null || typeof reservation.cancelReason === "string").toBe(
      true,
    );
    expect(reservation.cancelledAt === null || typeof reservation.cancelledAt === "string").toBe(
      true,
    );
    expect(reservation.confirmedAt === null || typeof reservation.confirmedAt === "string").toBe(
      true,
    );
    expect(reservation.createdAt).toBeTypeOf("string");
    expect(reservation.updatedAt).toBeTypeOf("string");
  }

  beforeAll(async () => {
    user = await registerSession("shape-user");
    operator = await registerVerifiedOperatorSession("shape-op");
    facility = await createFacility(operator.accessToken);
    const admin = await registerAdminSession("shape-admin");
    await approveFacility(admin.accessToken, facility.id);
    slot = await createSlot(operator.accessToken, facility.id);
  });

  async function createPending(): Promise<BookingResponse["reservation"]> {
    const res = await createBooking(user.accessToken, WINDOW(facility.id, slot.id, dayOffset++));
    expect(res.status).toBe(201);
    const reservation = (res.body as BookingResponse).reservation;
    expectReservationShape(reservation);
    return reservation;
  }

  async function payToConfirmed(code: string): Promise<void> {
    const initiated = await jsonPost(
      "/api/v1/payments/initiate",
      { reservationCode: code },
      user.accessToken,
    );
    expect(initiated.status).toBe(200);
    const providerTxnId = (initiated.body as { payment: { providerTxnId: string } }).payment
      .providerTxnId;
    const verified = await jsonPost(
      `/api/v1/payments/${encodeURIComponent(providerTxnId)}/verify`,
      {},
      user.accessToken,
    );
    expect(verified.status).toBe(200);
    const verifiedReservation = (verified.body as { reservation: BookingResponse["reservation"] })
      .reservation;
    expectReservationShape(verifiedReservation);
    expect(verifiedReservation.state).toBe("CONFIRMED");
    expect(verifiedReservation.paymentStatus).toBe("SUCCESS");
  }

  it("POST /api/v1/reservations returns the complete 16-field reservation DTO", async () => {
    const reservation = await createPending();
    expect(reservation.state).toBe("PENDING_PAYMENT");
    expect(reservation.amount).toBeGreaterThan(0);
    expect(reservation.paymentStatus).toBe("INITIATED");
    expect(reservation.confirmedAt).toBeNull();
  });

  it("GET /api/v1/reservations returns every reservation as a complete 16-field DTO", async () => {
    for (let i = 0; i < 2; i += 1) await createPending();
    const res = await jsonGet("/api/v1/reservations", user.accessToken);
    expect(res.status).toBe(200);
    const list = res.body as BookingListResponse;
    expect(list.reservations.length).toBeGreaterThan(0);
    for (const r of list.reservations) {
      expectReservationShape(r);
      expect(r.state).toBe("PENDING_PAYMENT");
      expect(r.amount).toBeGreaterThan(0);
      expect(r.paymentStatus).toBe("INITIATED");
    }
  });

  it("every response stays a complete, valid DTO across the full lifecycle (create → list → detail → initiate → verify → re-fetch)", async () => {
    const reservation = await createPending();
    const code = reservation.reservationCode;

    const listed = await jsonGet("/api/v1/reservations", user.accessToken);
    expect(listed.status).toBe(200);
    const row = (listed.body as BookingListResponse).reservations.find(
      (r) => r.reservationCode === code,
    );
    expect(row).toBeDefined();
    expectReservationShape(row!);

    const detailRes = await jsonGet(`/api/v1/reservations/${code}`, user.accessToken);
    expect(detailRes.status).toBe(200);
    const detail = (detailRes.body as BookingResponse).reservation;
    expectReservationShape(detail);
    expect(detail.state).toBe("PENDING_PAYMENT");

    await payToConfirmed(code);

    const afterDetail = await jsonGet(`/api/v1/reservations/${code}`, user.accessToken);
    expect(afterDetail.status).toBe(200);
    const after = (afterDetail.body as BookingResponse).reservation;
    expectReservationShape(after);
    expect(after.state).toBe("CONFIRMED");
    expect(after.paymentStatus).toBe("SUCCESS");
    expect(after.confirmedAt).toBeTypeOf("string");

    const afterList = await jsonGet("/api/v1/reservations", user.accessToken);
    const afterRow = (afterList.body as BookingListResponse).reservations.find(
      (r) => r.reservationCode === code,
    );
    expectReservationShape(afterRow!);
    expect(afterRow!.state).toBe("CONFIRMED");
    expect(afterRow!.paymentStatus).toBe("SUCCESS");
  });

  it("legacy pre-payment rows (amount/payment_status NULL) still surface as complete, valid DTOs with nulls (not 'malformed')", async () => {
    await getPool().query(
      `INSERT INTO reservations (reservation_code, user_id, facility_id, slot_id, starts_at, ends_at, state, amount, payment_status, cancel_reason, cancelled_at, confirmed_at)
       VALUES ('BKG-LEGACYNULL', $1, $2, $3, '2026-08-01T08:00:00Z', '2026-08-01T10:00:00Z', 'CANCELLED', NULL, NULL, 'no-show', '2026-08-01T12:00:00Z', '2026-08-01T08:00:00Z')`,
      [user.user.id, facility.id, slot.id],
    );
    const res = await jsonGet("/api/v1/reservations", user.accessToken);
    expect(res.status).toBe(200);
    const legacy = (res.body as BookingListResponse).reservations.find(
      (r) => r.reservationCode === "BKG-LEGACYNULL",
    );
    expect(legacy).toBeDefined();
    expectReservationShape(legacy!);
    expect(legacy!.amount).toBeNull();
    expect(legacy!.paymentStatus).toBeNull();
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
    operatorA = await registerVerifiedOperatorSession("reservation-list-opA");
    operatorB = await registerVerifiedOperatorSession("reservation-list-opB");
    regularUser = await registerSession("reservation-list-user");
    emptyOperator = await registerVerifiedOperatorSession("reservation-list-empty");
    facilityA1 = await createFacility(operatorA.accessToken);
    facilityA2 = await createFacility(operatorA.accessToken);
    facilityB = await createFacility(operatorB.accessToken);
    const admin = await registerAdminSession("reservation-list-admin");
    await approveFacility(admin.accessToken, facilityA1.id);
    await approveFacility(admin.accessToken, facilityA2.id);
    await approveFacility(admin.accessToken, facilityB.id);

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
    operator = await registerVerifiedOperatorSession("cancel-op");
    facility = await createFacility(operator.accessToken);
    const admin = await registerAdminSession("cancel-admin");
    await approveFacility(admin.accessToken, facility.id);
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

describe("POST /api/v1/operators/me/reservations/:reservationCode/cancel", () => {
  let operatorA: AuthResponse;
  let operatorB: AuthResponse;
  let regularUser: AuthResponse;
  let facilityA1: ParkingFacility;
  let facilityA2: ParkingFacility;
  let facilityB: ParkingFacility;
  let facilityA1Slot: ParkingSlot;

  beforeAll(async () => {
    operatorA = await registerVerifiedOperatorSession("op-cancel-A");
    operatorB = await registerVerifiedOperatorSession("op-cancel-B");
    regularUser = await registerSession("op-cancel-user");
    facilityA1 = await createFacility(operatorA.accessToken);
    facilityA2 = await createFacility(operatorA.accessToken);
    facilityB = await createFacility(operatorB.accessToken);
    const admin = await registerAdminSession("op-cancel-admin");
    await approveFacility(admin.accessToken, facilityA1.id);
    await approveFacility(admin.accessToken, facilityA2.id);
    await approveFacility(admin.accessToken, facilityB.id);
    facilityA1Slot = await createSlot(operatorA.accessToken, facilityA1.id, {
      slotCode: "OPC-S1",
    });
  });

  async function makeBooking(
    facilityId: number,
    dayOffset: number,
    slotId?: number,
  ): Promise<string> {
    const created = await createBooking(
      regularUser.accessToken,
      WINDOW(facilityId, slotId, dayOffset),
    );
    expect(created.status).toBe(201);
    return (created.body as BookingResponse).reservation.reservationCode;
  }

  function cancelEndpoint(code: string): string {
    return `/api/v1/operators/me/reservations/${code}/cancel`;
  }

  async function payToConfirmed(code: string): Promise<void> {
    const initiated = await jsonPost(
      "/api/v1/payments/initiate",
      { reservationCode: code },
      regularUser.accessToken,
    );
    expect(initiated.status).toBe(200);
    const providerTxnId = (initiated.body as { payment: { providerTxnId: string } }).payment
      .providerTxnId;
    const verified = await jsonPost(
      `/api/v1/payments/${encodeURIComponent(providerTxnId)}/verify`,
      {},
      regularUser.accessToken,
    );
    expect(verified.status).toBe(200);
    expect((verified.body as BookingResponse).reservation.state).toBe("CONFIRMED");
  }

  it("rejects unauthenticated requests", async () => {
    const code = await makeBooking(facilityA1.id, 14);
    const res = await jsonPost(cancelEndpoint(code), {});
    expect(res.status).toBe(401);
  });

  it("rejects a regular (non-operator) user with 403", async () => {
    const code = await makeBooking(facilityA1.id, 14);
    const res = await jsonPost(cancelEndpoint(code), {}, regularUser.accessToken);
    expect(res.status).toBe(403);
  });

  it("cancels a CONFIRMED booking in the operator's own facility and persists it", async () => {
    const code = await makeBooking(facilityA1.id, 15);
    const res = await jsonPost(
      cancelEndpoint(code),
      { reason: "operator override" },
      operatorA.accessToken,
    );
    expect(res.status).toBe(200);
    const reservation = (res.body as BookingResponse).reservation;
    expect(reservation.reservationCode).toBe(code);
    expect(reservation.state).toBe("CANCELLED");
    expect(reservation.cancelReason).toBe("operator override");
    expect(reservation.cancelledAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/name|email/i);

    const { rows } = await getPool().query<{
      state: string;
      cancel_reason: string | null;
      cancelled_at: Date | null;
    }>(`SELECT state, cancel_reason, cancelled_at FROM reservations WHERE reservation_code = $1`, [
      code,
    ]);
    expect(rows[0]!.state).toBe("CANCELLED");
    expect(rows[0]!.cancel_reason).toBe("operator override");
    expect(rows[0]!.cancelled_at).toBeTruthy();
  });

  it("trims a padded cancellation reason", async () => {
    const code = await makeBooking(facilityA1.id, 15);
    const res = await jsonPost(
      cancelEndpoint(code),
      { reason: "  venue closed  " },
      operatorA.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as BookingResponse).reservation.cancelReason).toBe("venue closed");
  });

  it("stores null for an empty or whitespace-only reason", async () => {
    const code = await makeBooking(facilityA1.id, 16);
    const res = await jsonPost(cancelEndpoint(code), { reason: "   " }, operatorA.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as BookingResponse).reservation.cancelReason).toBeNull();
  });

  it("cancels bookings across every facility the operator owns", async () => {
    const codeA1 = await makeBooking(facilityA1.id, 16);
    const codeA2 = await makeBooking(facilityA2.id, 17);
    const rA1 = await jsonPost(cancelEndpoint(codeA1), {}, operatorA.accessToken);
    const rA2 = await jsonPost(cancelEndpoint(codeA2), {}, operatorA.accessToken);
    expect(rA1.status).toBe(200);
    expect(rA2.status).toBe(200);
    expect((rA1.body as BookingResponse).reservation.state).toBe("CANCELLED");
    expect((rA2.body as BookingResponse).reservation.state).toBe("CANCELLED");
  });

  it("cannot cancel another operator's reservation (404, no existence disclosure)", async () => {
    const code = await makeBooking(facilityB.id, 17);
    const res = await jsonPost(cancelEndpoint(code), { reason: "sneaky" }, operatorA.accessToken);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
    const { rows } = await getPool().query<{ state: string }>(
      `SELECT state FROM reservations WHERE reservation_code = $1`,
      [code],
    );
    expect(rows[0]!.state).toBe("PENDING_PAYMENT");
  });

  it("404 for a code that does not belong to any of the operator's facilities", async () => {
    const res = await jsonPost(cancelEndpoint("BKG-NOPE123"), {}, operatorA.accessToken);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("409 double cancellation by the same operator", async () => {
    const code = await makeBooking(facilityA1.id, 18);
    const first = await jsonPost(cancelEndpoint(code), {}, operatorA.accessToken);
    expect(first.status).toBe(200);
    const again = await jsonPost(cancelEndpoint(code), {}, operatorA.accessToken);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe("ALREADY_CANCELLED");
  });

  it("422 completed booking cannot be cancelled", async () => {
    const code = await makeBooking(facilityA1.id, 19);
    await getPool().query(
      "UPDATE reservations SET state = 'COMPLETED' WHERE reservation_code = $1",
      [code],
    );
    const res = await jsonPost(cancelEndpoint(code), {}, operatorA.accessToken);
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe("CANNOT_CANCEL_COMPLETED");
  });

  it("409 cannot cancel a reservation with an ACTIVE session (lifecycle guard)", async () => {
    const code = await makeBooking(facilityA1.id, 18, facilityA1Slot.id);
    await payToConfirmed(code);
    const entered = await jsonPost(
      "/api/v1/parking-sessions/entry",
      { reservationCode: code },
      regularUser.accessToken,
    );
    expect(entered.status).toBe(201);

    const res = await jsonPost(
      cancelEndpoint(code),
      { reason: "mid-session" },
      operatorA.accessToken,
    );
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("CANNOT_CANCEL");

    const { rows } = await getPool().query<{
      reservation_state: string;
      session_status: string;
      slot_status: string;
    }>(
      `SELECT r.state AS reservation_state, ps.status AS session_status, sl.status AS slot_status
       FROM parking_sessions ps
       JOIN reservations r ON r.id = ps.reservation_id
       JOIN parking_slots sl ON sl.id = ps.slot_id
       WHERE r.reservation_code = $1`,
      [code],
    );
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.reservation_state).toBe("ACTIVE");
    expect(rows[0]!.session_status).toBe("ACTIVE");
    expect(rows[0]!.slot_status).toBe("OCCUPIED");
  });

  it("409 cannot cancel a FAILED reservation", async () => {
    const code = await makeBooking(facilityA1.id, 19);
    await getPool().query("UPDATE reservations SET state = 'FAILED' WHERE reservation_code = $1", [
      code,
    ]);
    const res = await jsonPost(cancelEndpoint(code), {}, operatorA.accessToken);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("CANNOT_CANCEL");
  });

  it("customer cancellation endpoint is unaffected", async () => {
    const code = await makeBooking(facilityA1.id, 20);
    const res = await jsonPost(`/api/v1/reservations/${code}/cancel`, {}, regularUser.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as BookingResponse).reservation.state).toBe("CANCELLED");
  });

  it("concurrent cancels yield exactly one success (race-safe)", async () => {
    const code = await makeBooking(facilityA1.id, 14);
    const [a, b] = await Promise.all([
      jsonPost(cancelEndpoint(code), {}, operatorA.accessToken),
      jsonPost(cancelEndpoint(code), {}, operatorA.accessToken),
    ]);
    const successes = [a.status, b.status].filter((s) => s === 200).length;
    const conflicts = [a.status, b.status].filter((s) => s === 409).length;
    expect(successes + conflicts).toBe(2);
    expect(successes).toBe(1);
    expect(conflicts).toBe(1);
    const { rows } = await getPool().query<{ state: string }>(
      `SELECT state FROM reservations WHERE reservation_code = $1`,
      [code],
    );
    expect(rows[0]!.state).toBe("CANCELLED");
  });
});

describe("Concurrency / rollback safety", () => {
  it("two overlapping inserts cannot both succeed (exclusion constraint), and no partial row is left", async () => {
    const userA = await registerSession("conc-userA");
    const userB = await registerSession("conc-userB");
    const operator = await registerVerifiedOperatorSession("conc-op");
    const facility = await createFacility(operator.accessToken);
    const admin = await registerAdminSession("conc-admin");
    await approveFacility(admin.accessToken, facility.id);
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

describe("Facility verification gating (booking creation)", () => {
  it("rejects booking for a PENDING facility and succeeds after admin approval", async () => {
    const operator = await registerVerifiedOperatorSession("verify-gate-book-op");
    const user = await registerSession("verify-gate-book-user");
    const facility = await createFacility(operator.accessToken);
    expect(facility.verificationStatus).toBe("PENDING");
    const slot = await createSlot(operator.accessToken, facility.id);

    const admin = await registerAdminSession("verify-gate-book-admin");

    const before = await createBooking(user.accessToken, WINDOW(facility.id, slot.id));
    expect(before.status).toBe(404);
    expect(errorCode(before.body)).toBe("FACILITY_NOT_FOUND");

    await approveFacility(admin.accessToken, facility.id);

    const after = await createBooking(user.accessToken, WINDOW(facility.id, slot.id));
    expect(after.status).toBe(201);
    expect((after.body as BookingResponse).reservation.state).toBe("PENDING_PAYMENT");
  });

  it("rejects booking for a REJECTED facility", async () => {
    const operator = await registerVerifiedOperatorSession("verify-gate-book-rejected-op");
    const user = await registerSession("verify-gate-book-rejected-user");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);

    const admin = await registerAdminSession("verify-gate-book-rejected-admin");
    const review = await jsonPost(
      `/api/v1/admin/facilities/${facility.id}/review`,
      {},
      admin.accessToken,
    );
    expect(review.status).toBe(200);
    const reject = await jsonPost(
      `/api/v1/admin/facilities/${facility.id}/reject`,
      {},
      admin.accessToken,
    );
    expect(reject.status).toBe(200);

    const res = await createBooking(user.accessToken, WINDOW(facility.id, slot.id));
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("FACILITY_NOT_FOUND");
  });
});
