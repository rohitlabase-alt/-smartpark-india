/**
 * Phase 9 Block 1 DB-backed integration tests: parking session entry/exit
 * lifecycle (docs/DATABASE.md §2.13, docs/API_SPEC.md §2 parking-sessions)
 * against a THROWAWAY postgres database (`smartpark_test`), recreated +
 * migrated per run. Follows the Phase 7 payments-suite pattern
 * (fileParallelism: false, so sharing `smartpark_test` is safe).
 *
 * Requires the docker compose postgres (`npm run infra:up`); CI runs a
 * postgres service (see .github/workflows/ci.yml).
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type {
  AuthResponse,
  BookingResponse,
  InitiatePaymentResponse,
  Operator,
  ParkingFacility,
  ParkingSession,
  ParkingSessionResponse,
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
    { name: "Phase9 Parking", type: "off-street", city: "Pune", area: "Koregaon", capacity: 6 },
    token,
  );
  expect(status).toBe(201);
  const facility = body as ParkingFacility;
  const admin = await registerAdminSession(`${facility.parkingId}-approval`);
  const review = await jsonPost(
    `/api/v1/admin/facilities/${facility.id}/review`,
    {},
    admin.accessToken,
  );
  expect(review.status).toBe(200);
  const approve = await jsonPost(
    `/api/v1/admin/facilities/${facility.id}/approve`,
    {},
    admin.accessToken,
  );
  expect(approve.status).toBe(200);
  return facility;
}

async function createSlot(
  token: string,
  facilityId: number,
  overrides: Record<string, unknown> = {},
): Promise<ParkingSlot> {
  const { status, body } = await jsonPost(
    `/api/v1/operators/me/facilities/${facilityId}/slots`,
    { slotCode: `P9-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...overrides },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingSlot;
}

const WINDOW = (facilityId: number, slotId: number | undefined, dayOffset = 1) => {
  const day = String((dayOffset % 28) + 1).padStart(2, "0");
  return {
    facilityId,
    ...(slotId ? { slotId } : {}),
    startsAt: `2026-09-${day}T08:00:00Z`,
    endsAt: `2026-09-${day}T10:00:00Z`,
  };
};

async function createBooking(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return jsonPost("/api/v1/reservations", body, token);
}

async function initiatePayment(
  token: string,
  reservationCode: string,
): Promise<{ status: number; body: unknown }> {
  return jsonPost("/api/v1/payments/initiate", { reservationCode }, token);
}

async function verifyPayment(
  token: string,
  txnId: string,
): Promise<{ status: number; body: unknown }> {
  return jsonPost(`/api/v1/payments/${encodeURIComponent(txnId)}/verify`, {}, token);
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

/** Create + pay for a reservation, returning a CONFIRMED reservation. */
async function createConfirmedReservation(
  user: AuthResponse,
  facility: ParkingFacility,
  slot: ParkingSlot,
  dayOffset: number,
): Promise<BookingResponse> {
  const res = await createBooking(user.accessToken, WINDOW(facility.id, slot.id, dayOffset));
  expect(res.status).toBe(201);
  const booking = res.body as BookingResponse;
  expect(booking.reservation.state).toBe("PENDING_PAYMENT");

  const init = await initiatePayment(user.accessToken, booking.reservation.reservationCode);
  expect(init.status).toBe(200);
  const { payment } = init.body as InitiatePaymentResponse;

  const verify = await verifyPayment(user.accessToken, payment.providerTxnId!);
  expect(verify.status).toBe(200);
  expect((verify.body as BookingResponse).reservation.state).toBe("CONFIRMED");
  return verify.body as BookingResponse;
}

async function enterParking(
  token: string,
  reservationCode: string,
): Promise<{ status: number; body: unknown }> {
  return jsonPost("/api/v1/parking-sessions/entry", { reservationCode }, token);
}

async function exitParking(
  token: string,
  sessionId: number,
): Promise<{ status: number; body: unknown }> {
  return jsonPost(`/api/v1/parking-sessions/${sessionId}/exit`, {}, token);
}

function sessionBody(body: unknown): ParkingSession {
  return (body as { session: ParkingSession }).session;
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
  const client = new Client({ connectionString: maintenanceUrl().toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(DB_NAME)} WITH (FORCE)`);
  } finally {
    await client.end();
  }
});

describe("0009 parking-sessions schema", () => {
  it("creates the parking_sessions table with FKs + status checks", async () => {
    const { rows } = await getPool().query<{ constraint_name: string }>(
      `SELECT conname AS constraint_name
       FROM pg_constraint
       WHERE conrelid = 'parking_sessions'::regclass`,
    );
    const names = rows.map((r) => r.constraint_name);
    expect(names).toContain("parking_sessions_status_check");

    const checks = await getPool().query<{ conname: string; consrc: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'parking_sessions'::regclass AND contype = 'c'`,
    );
    const statusCheck = checks.rows.find((r) => r.conname === "parking_sessions_status_check");
    expect(statusCheck).toBeDefined();
    expect(statusCheck!.consrc).toContain("ACTIVE");
    expect(statusCheck!.consrc).toContain("COMPLETED");
    expect(statusCheck!.consrc).toContain("CANCELLED");
  });

  it("indexes entry_token_hash, active-reservation and active-slot uniqueness", async () => {
    const { rows } = await getPool().query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'parking_sessions'`,
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain("parking_sessions_entry_token_hash_idx");
    expect(names).toContain("parking_sessions_active_reservation_idx");
    expect(names).toContain("parking_sessions_active_slot_idx");
    expect(names).toContain("parking_sessions_facility_status_idx");
  });

  it("allows multiple completed sessions per reservation but one active", async () => {
    const { rows } = await getPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'parking_sessions'`,
    );
    const activeRes = rows.find((r) => r.indexdef.includes("active_reservation_idx"));
    expect(activeRes!.indexdef).toContain("WHERE ((status)::text = 'ACTIVE'::text)");
    const activeSlot = rows.find((r) => r.indexdef.includes("active_slot_idx"));
    expect(activeSlot!.indexdef).toContain("WHERE ((status)::text = 'ACTIVE'::text)");
  });
});

describe("POST /api/v1/parking-sessions/entry", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;
  let dayOffset = 60;

  beforeAll(async () => {
    userA = await registerSession("entry-A");
    userB = await registerSession("entry-B");
    operator = await registerVerifiedOperatorSession("entry-op");
    facility = await createFacility(operator.accessToken);
    slot = await createSlot(operator.accessToken, facility.id);
  });

  function freshConfirmed(): Promise<BookingResponse> {
    return createConfirmedBase(userA, facility, operator.accessToken, dayOffset++);
  }

  async function createConfirmedBase(
    user: AuthResponse,
    fac: ParkingFacility,
    operatorToken: string,
    offset: number,
  ): Promise<BookingResponse> {
    const freshSlot = await createSlot(operatorToken, fac.id);
    return createConfirmedReservation(user, fac, freshSlot, offset);
  }

  it("401 unauthenticated", async () => {
    const res = await enterParking("", "BKG-X");
    expect(res.status).toBe(401);
  });

  it("400 invalid request body (missing/unknown keys)", async () => {
    const missing = await jsonPost("/api/v1/parking-sessions/entry", {}, userA.accessToken);
    expect(missing.status).toBe(400);
    const unknown = await jsonPost(
      "/api/v1/parking-sessions/entry",
      { reservationCode: "BKG-X", unexpected: true },
      userA.accessToken,
    );
    expect(unknown.status).toBe(400);
  });

  it("404 nonexistent reservation code", async () => {
    const res = await enterParking(userA.accessToken, "BKG-NOT-A-REAL-CODE");
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("404 another user's reservation (no existence disclosure)", async () => {
    const confirmed = await freshConfirmed();
    const res = await enterParking(userB.accessToken, confirmed.reservation.reservationCode);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("409 a pending (unpaid) reservation cannot be entered", async () => {
    const res = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id, dayOffset++));
    expect(res.status).toBe(201);
    const { reservationCode } = (res.body as BookingResponse).reservation;
    const entry = await enterParking(userA.accessToken, reservationCode);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("RESERVATION_NOT_ENTRYABLE");
  });

  it("successful entry: session ACTIVE, reservation ACTIVE, slot OCCUPIED, token minted", async () => {
    const confirmed = await freshConfirmed();
    const code = confirmed.reservation.reservationCode;
    const facilityId = confirmed.reservation.facilityId;
    const slotId = confirmed.reservation.slotId!;
    const reservationId = confirmed.reservation.id;

    // Slot + availability state are AVAILABLE before entry.
    const before = await getPool().query<{ status: string }>(
      `SELECT status FROM parking_slots WHERE id = $1`,
      [slotId],
    );
    expect(before.rows[0]!.status).toBe("AVAILABLE");

    const res = await enterParking(userA.accessToken, code);
    expect(res.status).toBe(201);
    const body = res.body as { session: ParkingSession; entryToken: string };
    expect(body.session.reservationId).toBe(reservationId);
    expect(body.session.facilityId).toBe(facilityId);
    expect(body.session.slotId).toBe(slotId);
    expect(body.session.userId).toBe(userA.user.id);
    expect(body.session.status).toBe("ACTIVE");
    expect(body.session.exitAt).toBeNull();
    expect(body.entryToken).toMatch(/^ses_[0-9a-f]{48}$/);

    const { rows } = await getPool().query<{ state: string; slot: string }>(
      `SELECT r.state AS state,
              (SELECT s.status FROM parking_slots s WHERE s.id = $2) AS slot
       FROM reservations r WHERE r.id = $1`,
      [reservationId, slotId],
    );
    expect(rows[0]!.state).toBe("ACTIVE");
    expect(rows[0]!.slot).toBe("OCCUPIED");

    // Availability engine cache mirrors the occupied slot.
    const avail = await getPool().query<{ status: string }>(
      `SELECT status FROM availability_state WHERE slot_id = $1`,
      [slotId],
    );
    expect(avail.rows[0]!.status).toBe("OCCUPIED");

    // The raw entry token is never stored at rest — only its SHA-256 hash.
    const tokenHash = await getPool().query<{ entry_token_hash: string }>(
      `SELECT entry_token_hash FROM parking_sessions WHERE id = $1`,
      [body.session.id],
    );
    expect(tokenHash.rows[0]!.entry_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash.rows[0]!.entry_token_hash).not.toContain("ses_");
    expect(tokenHash.rows[0]!.entry_token_hash).not.toBe(body.entryToken);
  });

  it("entry token hash is the SHA-256 of the returned token", async () => {
    const confirmed = await freshConfirmed();
    const res = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    const { session, entryToken } = res.body as { session: ParkingSession; entryToken: string };
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(entryToken).digest("hex");
    const { rows } = await getPool().query<{ entry_token_hash: string }>(
      `SELECT entry_token_hash FROM parking_sessions WHERE id = $1`,
      [session.id],
    );
    expect(rows[0]!.entry_token_hash).toBe(expected);
  });

  it("double entry on the same reservation → 409", async () => {
    const confirmed = await freshConfirmed();
    const code = confirmed.reservation.reservationCode;
    const first = await enterParking(userA.accessToken, code);
    expect(first.status).toBe(201);
    const again = await enterParking(userA.accessToken, code);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe("SESSION_ALREADY_ACTIVE");

    const { rows } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM parking_sessions
       WHERE reservation_id = $1 AND status = 'ACTIVE'`,
      [confirmed.reservation.id],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("409 when the reservation's slot is already occupied (operator-set)", async () => {
    const confirmed = await freshConfirmed();
    const slotId = confirmed.reservation.slotId!;
    const occupied = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}/slots/${slotId}`,
      { status: "OCCUPIED" },
      operator.accessToken,
    );
    expect(occupied.status).toBe(200);

    const res = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("SLOT_OCCUPIED");
  });

  it("a VERIFIED operator can enter a customer reservation in their facility", async () => {
    const confirmed = await freshConfirmed();
    const res = await enterParking(operator.accessToken, confirmed.reservation.reservationCode);
    expect(res.status).toBe(201);
    const { session } = res.body as { session: ParkingSession };
    expect(session.userId).toBe(userA.user.id);
    expect(session.status).toBe("ACTIVE");
  });

  it("entry is blocked when the facility is not verified/active", async () => {
    const coldOperator = await registerVerifiedOperatorSession("entry-cold-op");
    const coldFacility = await createFacility(coldOperator.accessToken);
    const coldSlot = await createSlot(coldOperator.accessToken, coldFacility.id);
    const confirmed = await createConfirmedReservation(userA, coldFacility, coldSlot, dayOffset++);
    await jsonPost(
      `/api/v1/admin/facilities/${coldFacility.id}/deactivate`,
      {},
      (await registerAdminSession("entry-cold-admin")).accessToken,
    );
    const res = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("FACILITY_NOT_ENTRYABLE");
  });
});

describe("GET /api/v1/parking-sessions/:id", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let dayOffset = 120;

  beforeAll(async () => {
    userA = await registerSession("read-A");
    userB = await registerSession("read-B");
    operator = await registerVerifiedOperatorSession("read-op");
    facility = await createFacility(operator.accessToken);
  });

  async function freshActiveSession(): Promise<{ session: ParkingSession; code: string }> {
    const freshSlot = await createSlot(operator.accessToken, facility.id);
    const confirmed = await createConfirmedReservation(userA, facility, freshSlot, dayOffset++);
    const entry = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    expect(entry.status).toBe(201);
    return { session: sessionBody(entry.body), code: confirmed.reservation.reservationCode };
  }

  it("401 unauthenticated", async () => {
    const res = await jsonGet("/api/v1/parking-sessions/1");
    expect(res.status).toBe(401);
  });

  it("404 nonexistent session id + non-numeric id", async () => {
    const missing = await jsonGet("/api/v1/parking-sessions/999999", userA.accessToken);
    expect(missing.status).toBe(404);
    expect(errorCode(missing.body)).toBe("SESSION_NOT_FOUND");
    const invalid = await jsonGet("/api/v1/parking-sessions/not-a-number", userA.accessToken);
    expect(invalid.status).toBe(404);
    expect(errorCode(invalid.body)).toBe("SESSION_NOT_FOUND");
  });

  it("404 another user's session (IDOR-safe)", async () => {
    const { session } = await freshActiveSession();
    const res = await jsonGet(`/api/v1/parking-sessions/${session.id}`, userB.accessToken);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("SESSION_NOT_FOUND");
  });

  it("owner can read their active session (entry token is NOT returned)", async () => {
    const { session } = await freshActiveSession();
    const res = await jsonGet(`/api/v1/parking-sessions/${session.id}`, userA.accessToken);
    expect(res.status).toBe(200);
    const body = res.body as { session: ParkingSession };
    expect(body.session.id).toBe(session.id);
    expect(body.session.status).toBe("ACTIVE");
    expect(Object.keys(body)).not.toContain("entryToken");
  });

  it("the facility operator can read the session", async () => {
    const { session } = await freshActiveSession();
    const res = await jsonGet(`/api/v1/parking-sessions/${session.id}`, operator.accessToken);
    expect(res.status).toBe(200);
    expect(sessionBody(res.body).id).toBe(session.id);
  });
});

describe("POST /api/v1/parking-sessions/:id/exit", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let dayOffset = 180;

  beforeAll(async () => {
    userA = await registerSession("exit-A");
    userB = await registerSession("exit-B");
    operator = await registerVerifiedOperatorSession("exit-op");
    facility = await createFacility(operator.accessToken);
  });

  async function freshActiveSession(): Promise<ParkingSession> {
    const freshSlot = await createSlot(operator.accessToken, facility.id);
    const confirmed = await createConfirmedReservation(userA, facility, freshSlot, dayOffset++);
    const entry = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    expect(entry.status).toBe(201);
    return sessionBody(entry.body);
  }

  it("401 unauthenticated", async () => {
    const res = await exitParking("", 1);
    expect(res.status).toBe(401);
  });

  it("404 nonexistent session id + non-numeric id", async () => {
    const missing = await exitParking(userA.accessToken, 999999);
    expect(missing.status).toBe(404);
    expect(errorCode(missing.body)).toBe("SESSION_NOT_FOUND");
    const invalid = await jsonPost("/api/v1/parking-sessions/abc/exit", {}, userA.accessToken);
    expect(invalid.status).toBe(404);
  });

  it("404 another user's session (IDOR-safe)", async () => {
    const session = await freshActiveSession();
    const res = await exitParking(userB.accessToken, session.id);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("SESSION_NOT_FOUND");
  });

  it("successful exit: session COMPLETED, slot AVAILABLE, reservation COMPLETED", async () => {
    const session = await freshActiveSession();
    const res = await exitParking(userA.accessToken, session.id);
    expect(res.status).toBe(200);
    const completed = sessionBody(res.body);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.exitAt).toBeTruthy();

    const { rows } = await getPool().query<{ state: string }>(
      `SELECT state FROM reservations WHERE id = $1`,
      [session.reservationId],
    );
    expect(rows[0]!.state).toBe("COMPLETED");

    const slotRow = await getPool().query<{ status: string }>(
      `SELECT status FROM parking_slots WHERE id = $1`,
      [session.slotId],
    );
    expect(slotRow.rows[0]!.status).toBe("AVAILABLE");

    const avail = await getPool().query<{ status: string }>(
      `SELECT status FROM availability_state WHERE slot_id = $1`,
      [session.slotId],
    );
    expect(avail.rows[0]!.status).toBe("AVAILABLE");
  });

  it("exiting the same session again → 409 SESSION_NOT_ACTIVE", async () => {
    const session = await freshActiveSession();
    const first = await exitParking(userA.accessToken, session.id);
    expect(first.status).toBe(200);
    const again = await exitParking(userA.accessToken, session.id);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe("SESSION_NOT_ACTIVE");
  });

  it("a VERIFIED operator can exit a customer's active session", async () => {
    const session = await freshActiveSession();
    const res = await exitParking(operator.accessToken, session.id);
    expect(res.status).toBe(200);
    expect(sessionBody(res.body).status).toBe("COMPLETED");
  });
});

describe("parking session audit trail", () => {
  let userA: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;
  let dayOffset = 240;

  beforeAll(async () => {
    userA = await registerSession("audit-A");
    operator = await registerVerifiedOperatorSession("audit-op");
    facility = await createFacility(operator.accessToken);
    slot = await createSlot(operator.accessToken, facility.id);
  });

  it("records PARKING_SESSION_ENTRY and PARKING_SESSION_EXIT with the session id", async () => {
    const confirmed = await createConfirmedReservation(userA, facility, slot, dayOffset++);
    const entry = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    expect(entry.status).toBe(201);
    const { session } = entry.body as { session: ParkingSession };

    const entryAudit = await getPool().query<{
      action: string;
      entity_type: string;
      entity_id: string;
    }>(
      `SELECT action, entity_type, entity_id FROM audit_events
       WHERE entity_type = 'PARKING_SESSION' AND entity_id = $1 AND action = 'PARKING_SESSION_ENTRY'`,
      [session.id],
    );
    expect(entryAudit.rows).toHaveLength(1);
    expect(entryAudit.rows[0]!.entity_id).toBe(String(session.id));

    const exit = await exitParking(userA.accessToken, session.id);
    expect(exit.status).toBe(200);

    const exitAudit = await getPool().query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE entity_type = 'PARKING_SESSION' AND entity_id = $1 AND action = 'PARKING_SESSION_EXIT'`,
      [session.id],
    );
    expect(exitAudit.rows).toHaveLength(1);
  });

  it("entry metadata never contains the entry token (sanitized)", async () => {
    const confirmed = await createConfirmedReservation(userA, facility, slot, dayOffset++);
    const entry = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    const { session, entryToken } = entry.body as { session: ParkingSession; entryToken: string };
    const { rows } = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE entity_type = 'PARKING_SESSION' AND entity_id = $1 AND action = 'PARKING_SESSION_ENTRY'`,
      [session.id],
    );
    const metadata = rows[0]!.metadata;
    expect(JSON.stringify(metadata)).not.toContain(entryToken);
    expect(metadata).not.toHaveProperty("entryToken");
    expect(metadata).not.toHaveProperty("entryTokenHash");
    expect(metadata.reservationId).toBe(session.reservationId);
    expect(metadata.slotId).toBe(session.slotId);
  });
});

describe("GET /api/v1/parking-sessions/by-reservation/:code", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let dayOffset = 300;

  beforeAll(async () => {
    userA = await registerSession("byres-A");
    userB = await registerSession("byres-B");
    operator = await registerVerifiedOperatorSession("byres-op");
    facility = await createFacility(operator.accessToken);
  });

  async function freshActiveSession(): Promise<{ session: ParkingSession; code: string }> {
    const freshSlot = await createSlot(operator.accessToken, facility.id);
    const confirmed = await createConfirmedReservation(userA, facility, freshSlot, dayOffset++);
    const entry = await enterParking(userA.accessToken, confirmed.reservation.reservationCode);
    expect(entry.status).toBe(201);
    return { session: sessionBody(entry.body), code: confirmed.reservation.reservationCode };
  }

  it("401 unauthenticated", async () => {
    const res = await jsonGet("/api/v1/parking-sessions/by-reservation/BKG-X");
    expect(res.status).toBe(401);
  });

  it("404 unknown reservation code", async () => {
    const res = await jsonGet(
      "/api/v1/parking-sessions/by-reservation/BKG-NOT-REAL",
      userA.accessToken,
    );
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("SESSION_NOT_FOUND");
  });

  it("404 another user's reservation (no existence disclosure)", async () => {
    const { code } = await freshActiveSession();
    const res = await jsonGet(`/api/v1/parking-sessions/by-reservation/${code}`, userB.accessToken);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("SESSION_NOT_FOUND");
  });

  it("404 a reservation with no session yet", async () => {
    const confirmed = await createConfirmedReservation(
      userA,
      facility,
      await createSlot(operator.accessToken, facility.id),
      dayOffset++,
    );
    const res = await jsonGet(
      `/api/v1/parking-sessions/by-reservation/${confirmed.reservation.reservationCode}`,
      userA.accessToken,
    );
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("SESSION_NOT_FOUND");
  });

  it("owner resumes their active session by code (entry token is NOT returned)", async () => {
    const { session, code } = await freshActiveSession();
    const res = await jsonGet(`/api/v1/parking-sessions/by-reservation/${code}`, userA.accessToken);
    expect(res.status).toBe(200);
    const body = res.body as ParkingSessionResponse;
    expect(body.session.id).toBe(session.id);
    expect(body.session.status).toBe("ACTIVE");
    expect(Object.keys(body)).not.toContain("entryToken");
  });

  it("the facility operator can look up a customer session by code", async () => {
    const { session, code } = await freshActiveSession();
    const res = await jsonGet(
      `/api/v1/parking-sessions/by-reservation/${code}`,
      operator.accessToken,
    );
    expect(res.status).toBe(200);
    expect(sessionBody(res.body).id).toBe(session.id);
  });
});

describe("GET /api/v1/operators/me/sessions", () => {
  let operator: AuthResponse;
  let otherOperator: AuthResponse;
  let facility: ParkingFacility;
  let otherFacility: ParkingFacility;
  let dayOffset = 360;

  beforeAll(async () => {
    operator = await registerVerifiedOperatorSession("sesslist-op");
    otherOperator = await registerVerifiedOperatorSession("sesslist-other-op");
    facility = await createFacility(operator.accessToken);
    otherFacility = await createFacility(otherOperator.accessToken);
  });

  it("401 unauthenticated", async () => {
    const res = await jsonGet("/api/v1/operators/me/sessions");
    expect(res.status).toBe(401);
  });

  it("403 for a plain user (no operator role)", async () => {
    const user = await registerSession("sesslist-user");
    const res = await jsonGet("/api/v1/operators/me/sessions", user.accessToken);
    expect(res.status).toBe(403);
  });

  it("403 OPERATOR_NOT_VERIFIED for a pending operator", async () => {
    const pending = await registerOperatorSession("sesslist-pending");
    const res = await jsonGet("/api/v1/operators/me/sessions", pending.accessToken);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("OPERATOR_NOT_VERIFIED");
  });

  it("empty list before any session exists", async () => {
    const res = await jsonGet("/api/v1/operators/me/sessions", operator.accessToken);
    expect(res.status).toBe(200);
    const body = res.body as { sessions: ParkingSession[] };
    expect(body.sessions).toEqual([]);
  });

  it("verified operator sees active + completed sessions across their facilities, newest first", async () => {
    const firstSlot = await createSlot(operator.accessToken, facility.id);
    const userOne = await registerSession("sesslist-userA");
    const bookingOne = await createConfirmedReservation(userOne, facility, firstSlot, dayOffset++);
    const entryOne = await enterParking(
      userOne.accessToken,
      bookingOne.reservation.reservationCode,
    );
    expect(entryOne.status).toBe(201);
    const sessionOne = sessionBody(entryOne.body);

    const secondSlot = await createSlot(operator.accessToken, facility.id);
    const userTwo = await registerSession("sesslist-userB");
    const bookingTwo = await createConfirmedReservation(userTwo, facility, secondSlot, dayOffset++);
    const entryTwo = await enterParking(
      userTwo.accessToken,
      bookingTwo.reservation.reservationCode,
    );
    expect(entryTwo.status).toBe(201);
    const sessionTwo = sessionBody(entryTwo.body);

    const list = await jsonGet("/api/v1/operators/me/sessions", operator.accessToken);
    expect(list.status).toBe(200);
    const ids = (list.body as { sessions: ParkingSession[] }).sessions.map((s) => s.id);
    expect(ids).toContain(sessionOne.id);
    expect(ids).toContain(sessionTwo.id);
    expect(ids.indexOf(sessionTwo.id)).toBeLessThan(ids.indexOf(sessionOne.id));

    await exitParking(operator.accessToken, sessionOne.id);
    const afterExit = await jsonGet("/api/v1/operators/me/sessions", operator.accessToken);
    const reloaded = (afterExit.body as { sessions: ParkingSession[] }).sessions.find(
      (s) => s.id === sessionOne.id,
    );
    expect(reloaded!.status).toBe("COMPLETED");
  });

  it("does not leak sessions from another operator's facilities", async () => {
    const otherSlot = await createSlot(otherOperator.accessToken, otherFacility.id);
    const customer = await registerSession("sesslist-customer");
    const booking = await createConfirmedReservation(
      customer,
      otherFacility,
      otherSlot,
      dayOffset++,
    );
    const entry = await enterParking(customer.accessToken, booking.reservation.reservationCode);
    expect(entry.status).toBe(201);
    const session = sessionBody(entry.body);

    const list = await jsonGet("/api/v1/operators/me/sessions", operator.accessToken);
    const ids = (list.body as { sessions: ParkingSession[] }).sessions.map((s) => s.id);
    expect(ids).not.toContain(session.id);
  });
});
