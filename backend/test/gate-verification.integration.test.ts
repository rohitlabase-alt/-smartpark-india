/**
 * Phase 9 Block 3 DB-backed integration tests: parking-pass verification-token
 * (gate) entry/exit and slot-occupancy control (docs/API_SPEC.md §2
 * parking-sessions, docs/DATABASE.md §2.12/2.13, docs/SECURITY.md §5/§6)
 * against a THROWAWAY postgres database (`smartpark_test`), recreated +
 * migrated per run. Runs serially with the other DB-backed suites
 * (fileParallelism: false in backend/vitest.config.ts).
 *
 * Requires the docker compose postgres (`npm run infra:up`); CI runs a
 * postgres service (see .github/workflows/ci.yml).
 *
 * Intent: prove that the parking-pass token is a deterministically-signed,
 * hash-at-rest gate credential whose entry, exit, occupancy, access-control,
 * concurrency, rollback and audit behaviors are deterministic and database
 * backed — and that only its SHA-256 digest is ever persisted/audited.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomBytes } from "node:crypto";
import type {
  AuthResponse,
  BookingResponse,
  InitiatePaymentResponse,
  Operator,
  ParkingFacility,
  ParkingPassResponse,
  ParkingSession,
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
    { name: `${label} GateOps Pvt Ltd` },
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

async function createFacility(
  token: string,
  name = "Phase9 Gate Parking",
): Promise<ParkingFacility> {
  const { status, body } = await jsonPost(
    "/api/v1/operators/me/facilities",
    { name, type: "off-street", city: "Pune", area: "Koregaon", capacity: 6 },
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
    { slotCode: `GV-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...overrides },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingSlot;
}

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

const HOUR = 3_600_000;

/** Booking window covering "now" — valid for gate-token entry. */
function validWindow(facilityId: number, slotId: number): Record<string, unknown> {
  const now = Date.now();
  return {
    facilityId,
    slotId,
    startsAt: new Date(now - HOUR).toISOString(),
    endsAt: new Date(now + 2 * HOUR).toISOString(),
  };
}

/** Booking window entirely in the future — pass not yet valid at the gate. */
function futureWindow(facilityId: number, slotId: number): Record<string, unknown> {
  const now = Date.now();
  return {
    facilityId,
    slotId,
    startsAt: new Date(now + HOUR).toISOString(),
    endsAt: new Date(now + 3 * HOUR).toISOString(),
  };
}

/** Booking window already finished — pass is expired at the gate. */
function pastWindow(facilityId: number, slotId: number): Record<string, unknown> {
  const now = Date.now();
  return {
    facilityId,
    slotId,
    startsAt: new Date(now - 3 * HOUR).toISOString(),
    endsAt: new Date(now - HOUR).toISOString(),
  };
}

async function confirmReservation(
  user: AuthResponse,
  window: Record<string, unknown>,
): Promise<BookingResponse> {
  const res = await createBooking(user.accessToken, window);
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

const passPath = (code: string) =>
  `/api/v1/parking-sessions/by-reservation/${encodeURIComponent(code)}/pass`;

async function getPass(
  token: string,
  reservationCode: string,
): Promise<{ status: number; body: unknown }> {
  return jsonGet(passPath(reservationCode), token);
}

async function enterByToken(token: string, authToken: string) {
  return jsonPost("/api/v1/parking-sessions/entry", { verificationToken: token }, authToken);
}

async function enterByReference(token: string, reservationCode: string) {
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

const sha256hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const randomHex = (bytes: number) => randomBytes(bytes).toString("hex").toUpperCase();
const PASS_PREFIX = "ppk_";

async function hashFor(reservationId: number): Promise<string | null> {
  const { rows } = await getPool().query<{ hash: string | null }>(
    "SELECT verification_token_hash AS hash FROM reservations WHERE id = $1",
    [reservationId],
  );
  return rows[0]?.hash ?? null;
}

async function clearHash(reservationId: number): Promise<void> {
  await getPool().query("UPDATE reservations SET verification_token_hash = NULL WHERE id = $1", [
    reservationId,
  ]);
}

/** Directly insert a CONFIRMED reservation (for facilities that cannot accept bookings). */
async function insertConfirmedReservation(
  userId: number,
  facilityId: number,
  slotId: number,
  window: { start: number; end: number },
): Promise<{ id: number; code: string }> {
  // The pass-token `sub` claim asserts BKG-<12 uppercase hex> — a digest-format
  // guard — so directly-inserted codes must match that exact shape.
  const code = `BKG-${randomHex(6)}`;
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO reservations
       (reservation_code, user_id, facility_id, slot_id, starts_at, ends_at, state,
        amount, payment_status, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', 100, 'SUCCESS', now())
     RETURNING id`,
    [code, userId, facilityId, slotId, new Date(window.start), new Date(window.end)],
  );
  return { id: Number(rows[0]!.id), code };
}

async function lastAuditRequest(): Promise<{ action: string; metadata: Record<string, unknown> }> {
  const { rows } = await getPool().query<{
    action: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT action, metadata::jsonb AS metadata
     FROM audit_events
     ORDER BY id DESC
     LIMIT 1`,
  );
  expect(rows.length).toBe(1);
  return { action: rows[0]!.action, metadata: rows[0]!.metadata };
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

describe("0010 parking-pass token schema (migration)", () => {
  it("adds verification_token_hash with a partial unique index", async () => {
    const col = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'reservations' AND column_name = 'verification_token_hash'
         AND data_type = 'character varying' AND character_maximum_length = 64`,
    );
    expect(col.rows).toHaveLength(1);

    const idx = await getPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'reservations' AND indexname = 'reservations_verification_token_hash_idx'`,
    );
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0]!.indexdef).toContain("UNIQUE");
    expect(idx.rows[0]!.indexdef).toContain("WHERE (verification_token_hash IS NOT NULL)");
  });
});

describe("parking-pass issuance (deterministic, hash-at-rest)", () => {
  let user: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;

  beforeAll(async () => {
    user = await registerSession("pass-issue");
    operator = await registerVerifiedOperatorSession("pass-op");
    facility = await createFacility(operator.accessToken);
  });

  it("payment confirmation stores only a sha256 digest, never the raw token", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));

    const { body } = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (body as ParkingPassResponse).verificationToken;
    expect(token.startsWith(PASS_PREFIX)).toBe(true);

    const stored = await hashFor(booking.reservation.id);
    expect(stored).toBe(sha256hex(token));
    expect(stored).not.toContain("ppk");
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the pass is deterministic — repeated reads return the identical token", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));

    const first = await getPass(user.accessToken, booking.reservation.reservationCode);
    const second = await getPass(user.accessToken, booking.reservation.reservationCode);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const t1 = (first.body as ParkingPassResponse).verificationToken;
    const t2 = (second.body as ParkingPassResponse).verificationToken;
    expect(t1).toBe(t2);
    // Deterministic across the whole app process too: same code, same end time
    // in this window range -> identical signature payload.
    expect(t1.length).toBeGreaterThan(20);
  });

  it("lazily backfills the digest for pre-token confirmations (pass read)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const before = await getPass(user.accessToken, booking.reservation.reservationCode);
    expect(before.status).toBe(200);
    const token = (before.body as ParkingPassResponse).verificationToken;

    await clearHash(booking.reservation.id);
    expect(await hashFor(booking.reservation.id)).toBeNull();

    const after = await getPass(user.accessToken, booking.reservation.reservationCode);
    expect(after.status).toBe(200);
    expect((after.body as ParkingPassResponse).verificationToken).toBe(token);
    expect(await hashFor(booking.reservation.id)).toBe(sha256hex(token));
  });

  it("entering by token backfills the digest for pre-token confirmations (entry path)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    await clearHash(booking.reservation.id);
    expect(await hashFor(booking.reservation.id)).toBeNull();

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(201);
    expect(await hashFor(booking.reservation.id)).toBe(sha256hex(token));
  });
});

describe("pass read API access control", () => {
  let owner: AuthResponse;
  let operator: AuthResponse;
  let otherOperator: AuthResponse;
  let intruder: AuthResponse;
  let facility: ParkingFacility;
  let booking: BookingResponse;
  let code: string;

  beforeAll(async () => {
    owner = await registerSession("pass-owner");
    intruder = await registerSession("pass-intruder");
    operator = await registerVerifiedOperatorSession("pass-op");
    otherOperator = await registerVerifiedOperatorSession("pass-other-op");
    facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);
    booking = await confirmReservation(owner, validWindow(facility.id, slot.id));
    code = booking.reservation.reservationCode;
  });

  it("the reservation owner can read the pass", async () => {
    const res = await getPass(owner.accessToken, code);
    expect(res.status).toBe(200);
    expect((res.body as ParkingPassResponse).verificationToken.startsWith(PASS_PREFIX)).toBe(true);
  });

  it("a VERIFIED operator of the facility can read the pass", async () => {
    const res = await getPass(operator.accessToken, code);
    expect(res.status).toBe(200);
  });

  it("an unrelated user sees a 404 (no existence disclosure)", async () => {
    const res = await getPass(intruder.accessToken, code);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("an operator of another facility sees a 404", async () => {
    const res = await getPass(otherOperator.accessToken, code);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("a completed reservation no longer yields a pass (409 RESERVATION_NOT_ENTRYABLE)", async () => {
    const entry = await enterByReference(owner.accessToken, code);
    expect(entry.status).toBe(201);
    const session = sessionBody(entry.body);
    expect((await exitParking(owner.accessToken, session.id)).status).toBe(200);

    const res = await getPass(owner.accessToken, code);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("RESERVATION_NOT_ENTRYABLE");
  });

  it("an unknown code yields a 404", async () => {
    const res = await getPass(owner.accessToken, "BKG-NOTREAL00000");
    expect(res.status).toBe(404);
  });
});

describe("gate token entry", () => {
  let user: AuthResponse;
  let operator: AuthResponse;
  let intruder: AuthResponse;
  let otherOperator: AuthResponse;
  let facility: ParkingFacility;

  beforeAll(async () => {
    user = await registerSession("gate-owner");
    intruder = await registerSession("gate-intruder");
    operator = await registerVerifiedOperatorSession("gate-op");
    otherOperator = await registerVerifiedOperatorSession("gate-other-op");
    facility = await createFacility(operator.accessToken);
  });

  it("a valid pass entry creates an ACTIVE session, occupies the slot, and audits gate-token", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(201);
    const { session, entryToken } = entry.body as {
      session: ParkingSession;
      entryToken: string;
    };
    expect(session.status).toBe("ACTIVE");
    expect(session.reservationId).toBe(booking.reservation.id);
    expect(session.facilityId).toBe(facility.id);
    expect(entryToken).toBeDefined();

    const slotRow = await getPool().query<{ status: string }>(
      "SELECT status FROM parking_slots WHERE id = $1",
      [slot.id],
    );
    expect(slotRow.rows[0]!.status).toBe("OCCUPIED");

    const resRow = await getPool().query<{ state: string }>(
      "SELECT state FROM reservations WHERE id = $1",
      [booking.reservation.id],
    );
    expect(resRow.rows[0]!.state).toBe("ACTIVE");

    const audits = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE action = 'PARKING_SESSION_ENTRY' AND entity_type = 'PARKING_SESSION'
         AND entity_id = $1`,
      [session.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]!.metadata.verification).toBe("gate-token");
    expect(audits.rows[0]!.metadata.enteredBy).toBe("CUSTOMER");
  });

  it("a token with an invalid signature is rejected with INVALID_TOKEN", async () => {
    const res = await enterByToken(`${PASS_PREFIX}not-a-real-signature`, user.accessToken);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("INVALID_TOKEN");
  });

  it("a malformed (non-ppk) credential is rejected with INVALID_TOKEN", async () => {
    const res = await enterByToken("garbage-not-a-token", user.accessToken);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("INVALID_TOKEN");
  });

  it("entry schema rejects zero or two credentials (400 VALIDATION_ERROR)", async () => {
    const none = await jsonPost("/api/v1/parking-sessions/entry", {}, user.accessToken);
    expect(none.status).toBe(400);
    expect(errorCode(none.body)).toBe("VALIDATION_ERROR");

    const both = await jsonPost(
      "/api/v1/parking-sessions/entry",
      { reservationCode: "BKG-ABC", verificationToken: "ppk_x" },
      user.accessToken,
    );
    expect(both.status).toBe(400);
    expect(errorCode(both.body)).toBe("VALIDATION_ERROR");

    const unknown = await jsonPost(
      "/api/v1/parking-sessions/entry",
      { reservationCode: "BKG-ABC", unexpected: 1 },
      user.accessToken,
    );
    expect(unknown.status).toBe(400);
    expect(errorCode(unknown.body)).toBe("VALIDATION_ERROR");
  });

  it("an already-entered token is rejected with SESSION_ALREADY_ACTIVE", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    expect((await enterByToken(token, user.accessToken)).status).toBe(201);
    const again = await enterByToken(token, user.accessToken);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe("SESSION_ALREADY_ACTIVE");
  });

  it("a token for a finished window is rejected with TOKEN_EXPIRED", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, pastWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("TOKEN_EXPIRED");

    const audits = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE action = 'GATE_ENTRY_REJECTED' AND metadata->>'reason' = 'TOKEN_EXPIRED'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows[0]!.metadata)).not.toContain(token);
  });

  it("a token whose window has not started is rejected with TOKEN_NOT_YET_VALID", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, futureWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("TOKEN_NOT_YET_VALID");
    expect(await hashFor(booking.reservation.id)).toBe(sha256hex(token));
  });

  it("a VERIFIED facility operator can enter a customer's booking by token", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, operator.accessToken);
    expect(entry.status).toBe(201);

    const audits = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE action = 'PARKING_SESSION_ENTRY' AND entity_type = 'PARKING_SESSION'
         AND entity_id = $1`,
      [sessionBody(entry.body).id],
    );
    expect(audits.rows[0]!.metadata.enteredBy).toBe("OPERATOR");
    expect(audits.rows[0]!.metadata.verification).toBe("gate-token");
  });

  it("an unrelated user cannot enter with someone else's token (404 BOOKING_NOT_FOUND)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, intruder.accessToken);
    expect(entry.status).toBe(404);
    expect(errorCode(entry.body)).toBe("BOOKING_NOT_FOUND");

    const audits = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE action = 'GATE_ENTRY_REJECTED' AND metadata->>'reason' = 'BOOKING_NOT_FOUND'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows[0]!.metadata)).not.toContain(token);
    expect(audits.rows[0]!.metadata).not.toHaveProperty("verificationToken");
  });

  it("an operator of another facility cannot enter (404 BOOKING_NOT_FOUND)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, otherOperator.accessToken);
    expect(entry.status).toBe(404);
    expect(errorCode(entry.body)).toBe("BOOKING_NOT_FOUND");
  });
});

describe("gate token entry — facility state", () => {
  let user: AuthResponse;
  let operator: AuthResponse;
  let admin: AuthResponse;
  let facility: ParkingFacility;

  beforeAll(async () => {
    user = await registerSession("gfac-owner");
    operator = await registerVerifiedOperatorSession("gfac-op");
    admin = await registerAdminSession("gfac-admin");
    facility = await createFacility(operator.accessToken);
  });

  it("a deactivated facility rejects gate entry (FACILITY_NOT_ENTRYABLE)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const deactive = await jsonPost(
      `/api/v1/admin/facilities/${facility.id}/deactivate`,
      {},
      admin.accessToken,
    );
    expect(deactive.status).toBe(200);

    try {
      const entry = await enterByToken(token, user.accessToken);
      expect(entry.status).toBe(409);
      expect(errorCode(entry.body)).toBe("FACILITY_NOT_ENTRYABLE");
      const state = await getPool().query<{ state: string }>(
        "SELECT state FROM reservations WHERE id = $1",
        [booking.reservation.id],
      );
      expect(state.rows[0]!.state).toBe("CONFIRMED");
    } finally {
      await jsonPost(`/api/v1/admin/facilities/${facility.id}/activate`, {}, admin.accessToken);
    }
  });

  it("a rejected facility rejects gate entry (FACILITY_NOT_ENTRYABLE)", async () => {
    const rejected = (
      await jsonPost(
        "/api/v1/operators/me/facilities",
        { name: "Rejected Gate", type: "off-street", city: "Pune", area: "Viman", capacity: 3 },
        operator.accessToken,
      )
    ).body as ParkingFacility;
    expect(rejected.id).toBeDefined();
    const review = await jsonPost(
      `/api/v1/admin/facilities/${rejected.id}/review`,
      {},
      admin.accessToken,
    );
    expect(review.status).toBe(200);
    const reject = await jsonPost(
      `/api/v1/admin/facilities/${rejected.id}/reject`,
      {},
      admin.accessToken,
    );
    expect(reject.status).toBe(200);

    const slot = await createSlot(operator.accessToken, rejected.id);
    const direct = await insertConfirmedReservation(user.user.id, rejected.id, slot.id, {
      start: Date.now() - HOUR,
      end: Date.now() + HOUR,
    });
    const passRes = await getPass(user.accessToken, direct.code);
    expect(passRes.status).toBe(200);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("FACILITY_NOT_ENTRYABLE");
  });

  it("a pending (unreviewed) facility rejects gate entry (FACILITY_NOT_ENTRYABLE)", async () => {
    const pending = (
      await jsonPost(
        "/api/v1/operators/me/facilities",
        { name: "Pending Gate", type: "off-street", city: "Pune", area: "Hinjewadi", capacity: 3 },
        operator.accessToken,
      )
    ).body as ParkingFacility;
    expect(pending.id).toBeDefined();
    const slot = await createSlot(operator.accessToken, pending.id);
    const direct = await insertConfirmedReservation(user.user.id, pending.id, slot.id, {
      start: Date.now() - HOUR,
      end: Date.now() + HOUR,
    });
    const passRes = await getPass(user.accessToken, direct.code);
    expect(passRes.status).toBe(200);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("FACILITY_NOT_ENTRYABLE");
  });
});

describe("gate token entry — slot state", () => {
  let user: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;

  beforeAll(async () => {
    user = await registerSession("gslo-owner");
    operator = await registerVerifiedOperatorSession("gslo-op");
    facility = await createFacility(operator.accessToken);
  });

  it("an out-of-service slot rejects gate entry (SLOT_UNAVAILABLE)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    expect(
      (
        await jsonPatch(
          `/api/v1/operators/me/facilities/${facility.id}/slots/${slot.id}`,
          { status: "OUT_OF_SERVICE" },
          operator.accessToken,
        )
      ).status,
    ).toBe(200);

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("SLOT_UNAVAILABLE");
  });

  it("an already-occupied slot rejects gate entry (SLOT_OCCUPIED)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    expect(
      (
        await jsonPatch(
          `/api/v1/operators/me/facilities/${facility.id}/slots/${slot.id}`,
          { status: "OCCUPIED" },
          operator.accessToken,
        )
      ).status,
    ).toBe(200);

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("SLOT_OCCUPIED");
  });

  it("a slot with reservations disabled rejects gate entry (SLOT_NOT_ENTRYABLE)", async () => {
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const disabled = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}/slots/${slot.id}`,
      { reservationsEnabled: false },
      operator.accessToken,
    );
    expect(disabled.status).toBe(200);

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("SLOT_NOT_ENTRYABLE");
  });
});

describe("concurrent gate entry", () => {
  it("two simultaneous entries with the same token → exactly one 201, one 409 SESSION_ALREADY_ACTIVE", async () => {
    const user = await registerSession("conc-owner");
    const operator = await registerVerifiedOperatorSession("conc-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const [a, b] = await Promise.all([
      enterByToken(token, user.accessToken),
      enterByToken(token, user.accessToken),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = a.status === 409 ? a : b;
    expect(errorCode(rejected.body)).toBe("SESSION_ALREADY_ACTIVE");

    const rows = await getPool().query<{ id: string }>(
      "SELECT id FROM parking_sessions WHERE reservation_id = $1",
      [booking.reservation.id],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("two different bookings for the same slot race for entry → one 201, one 409 SLOT_OCCUPIED", async () => {
    const userA = await registerSession("conc-owner-a");
    const userB = await registerSession("conc-owner-b");
    const operator = await registerVerifiedOperatorSession("conc-slot-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);

    const now = Date.now();
    // Two CONFIRMED bookings on the SAME slot need non-overlapping windows,
    // so one booking's window cannot cover "now". Entries therefore go through
    // the reservationCode path (window checks are token-path-only); both share
    // the same transactional runEntry and the guarded occupy UPDATE, so the
    // slot contention + partial unique index are still what is under test.
    const bookingA = await confirmReservation(userA, {
      facilityId: facility.id,
      slotId: slot.id,
      startsAt: new Date(now - HOUR).toISOString(),
      endsAt: new Date(now + 2 * HOUR).toISOString(),
    });
    const bookingB = await confirmReservation(userB, {
      facilityId: facility.id,
      slotId: slot.id,
      startsAt: new Date(now + 3 * HOUR).toISOString(),
      endsAt: new Date(now + 5 * HOUR).toISOString(),
    });

    const [a, b] = await Promise.all([
      enterByReference(userA.accessToken, bookingA.reservation.reservationCode),
      enterByReference(userB.accessToken, bookingB.reservation.reservationCode),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = a.status === 409 ? a : b;
    expect(errorCode(rejected.body)).toBe("SLOT_OCCUPIED");

    const rows = await getPool().query<{ id: string }>(
      `SELECT id FROM parking_sessions WHERE slot_id = $1 AND status = 'ACTIVE'`,
      [slot.id],
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("gate exit after token entry", () => {
  it("exit completes the session and releases the slot", async () => {
    const user = await registerSession("gexit-owner");
    const operator = await registerVerifiedOperatorSession("gexit-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(201);
    const session = sessionBody(entry.body);

    const exit = await exitParking(user.accessToken, session.id);
    expect(exit.status).toBe(200);
    expect(sessionBody(exit.body).status).toBe("COMPLETED");

    const slotRow = await getPool().query<{ status: string }>(
      "SELECT status FROM parking_slots WHERE id = $1",
      [slot.id],
    );
    expect(slotRow.rows[0]!.status).toBe("AVAILABLE");

    const avail = await getPool().query<{ status: string }>(
      "SELECT status FROM availability_state WHERE slot_id = $1",
      [slot.id],
    );
    expect(avail.rows[0]!.status).toBe("AVAILABLE");

    const resRow = await getPool().query<{ state: string }>(
      "SELECT state FROM reservations WHERE id = $1",
      [booking.reservation.id],
    );
    expect(resRow.rows[0]!.state).toBe("COMPLETED");

    const audits = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE action = 'PARKING_SESSION_EXIT' AND entity_type = 'PARKING_SESSION'
         AND entity_id = $1`,
      [session.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]!.metadata.slotReleased).toBe(true);
  });

  it("a duplicate exit is rejected with 409 SESSION_NOT_ACTIVE and audited as GATE_EXIT_REJECTED", async () => {
    const user = await registerSession("gexit-dup");
    const operator = await registerVerifiedOperatorSession("gexit-dup-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(201);
    const session = sessionBody(entry.body);

    expect((await exitParking(user.accessToken, session.id)).status).toBe(200);
    const again = await exitParking(user.accessToken, session.id);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe("SESSION_NOT_ACTIVE");

    const audits = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE action = 'GATE_EXIT_REJECTED' AND metadata->>'reason' = 'SESSION_NOT_ACTIVE'
         AND entity_id = $1`,
      [session.id],
    );
    expect(audits.rows).toHaveLength(1);
  });

  it("an operator of another facility cannot exit a session (404 SESSION_NOT_FOUND)", async () => {
    const user = await registerSession("gexit-other");
    const operator = await registerVerifiedOperatorSession("gexit-op2");
    const otherOperator = await registerVerifiedOperatorSession("gexit-other-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(201);
    const session = sessionBody(entry.body);

    const exit = await exitParking(otherOperator.accessToken, session.id);
    expect(exit.status).toBe(404);
    expect(errorCode(exit.body)).toBe("SESSION_NOT_FOUND");
  });
});

describe("manual occupancy guard (operator slot edits)", () => {
  it("an operator cannot flip an ACTIVE session's slot away from OCCUPIED (SLOT_IN_USE)", async () => {
    const user = await registerSession("mslo-owner");
    const operator = await registerVerifiedOperatorSession("mslo-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);
    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(201);
    const session = sessionBody(entry.body);

    const flip = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}/slots/${slot.id}`,
      { status: "AVAILABLE" },
      operator.accessToken,
    );
    expect(flip.status).toBe(409);
    expect(errorCode(flip.body)).toBe("SLOT_IN_USE");

    const slotRow = await getPool().query<{ status: string }>(
      "SELECT status FROM parking_slots WHERE id = $1",
      [slot.id],
    );
    expect(slotRow.rows[0]!.status).toBe("OCCUPIED");

    const sessions = await getPool().query<{ status: string }>(
      "SELECT status FROM parking_sessions WHERE id = $1",
      [session.id],
    );
    expect(sessions.rows[0]!.status).toBe("ACTIVE");
  });
});

describe("mid-entry failure rolls back the whole transaction", () => {
  it("a PK/unique conflict after occupy leaves reservation + slot untouched", async () => {
    const user = await registerSession("roll-owner");
    const operator = await registerVerifiedOperatorSession("roll-op");
    const facility = await createFacility(operator.accessToken);
    const slot = await createSlot(operator.accessToken, facility.id);

    const booking = await confirmReservation(user, validWindow(facility.id, slot.id));
    const passRes = await getPass(user.accessToken, booking.reservation.reservationCode);
    const token = (passRes.body as ParkingPassResponse).verificationToken;

    // A synthetic ACTIVE session claims this slot (and its own reservation),
    // so the second entry fails on the partial unique index AFTER occupy.
    const other = await insertConfirmedReservation(user.user.id, facility.id, slot.id, {
      start: Date.now() + 24 * HOUR,
      end: Date.now() + 30 * HOUR,
    });
    await getPool().query(
      `INSERT INTO parking_sessions
         (reservation_id, facility_id, slot_id, user_id, entry_token_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [other.id, facility.id, slot.id, user.user.id, sha256hex("fake-entry-token")],
    );

    const entry = await enterByToken(token, user.accessToken);
    expect(entry.status).toBe(409);
    expect(errorCode(entry.body)).toBe("SLOT_OCCUPIED");

    const slotRow = await getPool().query<{ status: string }>(
      "SELECT status FROM parking_slots WHERE id = $1",
      [slot.id],
    );
    expect(slotRow.rows[0]!.status).toBe("AVAILABLE");

    const resRow = await getPool().query<{ state: string }>(
      "SELECT state FROM reservations WHERE id = $1",
      [booking.reservation.id],
    );
    expect(resRow.rows[0]!.state).toBe("CONFIRMED");

    const reservations = await getPool().query<{ id: string }>(
      "SELECT id FROM parking_sessions WHERE reservation_id = $1",
      [booking.reservation.id],
    );
    expect(reservations.rows).toHaveLength(0);

    const audits = await getPool().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata::jsonb AS metadata FROM audit_events
       WHERE action = 'GATE_ENTRY_REJECTED' AND metadata->>'reason' = 'SLOT_OCCUPIED'
         AND actor_user_id = $1 ORDER BY id DESC LIMIT 1`,
      [user.user.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows[0]!.metadata)).not.toContain(token);

    const entryAudits = await getPool().query<{ id: string }>(
      `SELECT id FROM audit_events
       WHERE action = 'PARKING_SESSION_ENTRY' AND metadata->>'reservationId' = $1`,
      [booking.reservation.id],
    );
    expect(entryAudits.rows).toHaveLength(0);
  });
});

describe("gate rejection audit trail", () => {
  it("invalid-token scans are recorded (reason only, never the token)", async () => {
    const user = await registerSession("gaudit-user");
    const res = await enterByToken(`${PASS_PREFIX}bad-signature`, user.accessToken);
    expect(res.status).toBe(409);

    const audit = await lastAuditRequest(res.body);
    expect(audit.action).toBe("GATE_ENTRY_REJECTED");
    expect(audit.metadata.reason).toBe("INVALID_TOKEN");
    expect(JSON.stringify(audit.metadata)).not.toMatch(new RegExp(PASS_PREFIX));
  });
});
