/**
 * Phase 7 DB-backed integration tests: mock payment flow
 * (docs/API_SPEC.md §2 payments, docs/DATABASE.md §2.15/§2.16, migration 0006)
 * against a THROWAWAY postgres database (`smartpark_test`), recreated +
 * migrated per run. Follows the Phase 2A/2B/2C suite pattern
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
  ParkingSlot,
  VerifyPaymentResponse,
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
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
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
    { name: "Phase7 Parking", type: "off-street", city: "Pune", area: "Koregaon", capacity: 6 },
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
    { slotCode: `P7-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...overrides },
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
  idempotencyKey?: string,
): Promise<{ status: number; body: unknown }> {
  return jsonPost(
    "/api/v1/payments/initiate",
    { reservationCode },
    token,
    idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
  );
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

async function createPendingReservation(
  user: AuthResponse,
  facility: ParkingFacility,
  slot: ParkingSlot,
  dayOffset = 1,
): Promise<string> {
  const res = await createBooking(user.accessToken, WINDOW(facility.id, slot.id, dayOffset));
  expect(res.status).toBe(201);
  const booking = (res.body as BookingResponse).reservation;
  expect(booking.state).toBe("PENDING_PAYMENT");
  return booking.reservationCode;
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

describe("DB schema (migration 0006)", () => {
  it("creates payments + transactions + idempotency tables", async () => {
    const { rows } = await getPool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const t of ["payments", "transactions", "payment_idempotency_keys"]) {
      expect(tables).toContain(t);
    }
  });

  it("restricts payment status/transaction kind/status vocabularies", async () => {
    const { rows: paymentChecks } = await getPool().query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conname = 'payments_status_check'`,
    );
    for (const s of ["INITIATED", "PENDING", "SUCCESS", "FAILED", "REFUNDED"]) {
      expect(paymentChecks[0]!.consrc).toContain(s);
    }
    const { rows: kindChecks } = await getPool().query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conname = 'transactions_kind_check'`,
    );
    for (const k of ["CHARGE", "REFUND", "REVERSAL"]) {
      expect(kindChecks[0]!.consrc).toContain(k);
    }
    const { rows: txnChecks } = await getPool().query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conname = 'transactions_status_check'`,
    );
    for (const s of ["SUCCESS", "FAILED"]) {
      expect(txnChecks[0]!.consrc).toContain(s);
    }
  });

  it("keeps the exclusion-constraint double-booking guard for PENDING_PAYMENT", async () => {
    const { rows } = await getPool().query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conname = 'reservations_no_overlap'`,
    );
    expect(rows[0]!.consrc).toContain("PENDING_PAYMENT");
    expect(rows[0]!.consrc).toContain("CONFIRMED");
    expect(rows[0]!.consrc).toContain("ACTIVE");
  });
});

describe("reservation creation for the payment lifecycle", () => {
  let user: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slots: ParkingSlot[];

  beforeAll(async () => {
    user = await registerSession("pay-user");
    operator = await registerVerifiedOperatorSession("pay-op");
    facility = await createFacility(operator.accessToken);
    slots = [];
    slots.push(await createSlot(operator.accessToken, facility.id, { slotCode: "P7-S1" }));
    slots.push(await createSlot(operator.accessToken, facility.id, { slotCode: "P7-S2" }));
  });

  it("creates a PENDING_PAYMENT reservation with amount + INITIATED payment status", async () => {
    const res = await createBooking(user.accessToken, WINDOW(facility.id, slots[0]!.id, 1));
    expect(res.status).toBe(201);
    const reservation = (res.body as BookingResponse).reservation;
    expect(reservation.state).toBe("PENDING_PAYMENT");
    expect(reservation.amount).toBe(200); // 2h × default ₹100/h (D-035)
    expect(reservation.paymentStatus).toBe("INITIATED");
    expect(reservation.confirmedAt).toBeNull();
  });

  it("a pending reservation blocks a conflicting booking on the same slot", async () => {
    const pending = await createBooking(user.accessToken, WINDOW(facility.id, slots[0]!.id, 2));
    expect(pending.status).toBe(201);
    const day = String((2 % 28) + 1).padStart(2, "0");
    const overlap = await createBooking(user.accessToken, {
      facilityId: facility.id,
      slotId: slots[0]!.id,
      startsAt: `2026-09-${day}T09:00:00Z`,
      endsAt: `2026-09-${day}T11:00:00Z`,
    });
    expect(overlap.status).toBe(409);
    expect(errorCode(overlap.body)).toBe("RESERVATION_CONFLICT");
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM reservations WHERE slot_id = $1`,
      [slots[0]!.id],
    );
    expect(Number(rows[0]!.n)).toBe(2); // pending + blocked attempt, no extra row leaked
  });

  it("preserves existing reservation validation (404 facility, 400 unknown keys)", async () => {
    const missing = await createBooking(user.accessToken, { facilityId: facility.id });
    expect(missing.status).toBe(400);
    const unknownKey = await createBooking(user.accessToken, {
      ...WINDOW(facility.id, slots[1]!.id, 3),
      is_demo: true,
    });
    expect(unknownKey.status).toBe(400);
  });
});

describe("POST /api/v1/payments/initiate", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;
  let code: string;
  let dayOffset = 10;

  beforeAll(async () => {
    userA = await registerSession("init-A");
    userB = await registerSession("init-B");
    operator = await registerVerifiedOperatorSession("init-op");
    facility = await createFacility(operator.accessToken);
    slot = await createSlot(operator.accessToken, facility.id);
  });

  async function freshCode(): Promise<string> {
    code = await createPendingReservation(userA, facility, slot, dayOffset++);
    return code;
  }

  it("401 unauthenticated", async () => {
    const res = await initiatePayment("", "BKG-X");
    expect(res.status).toBe(401);
  });

  it("400 invalid request body (missing/unknown keys)", async () => {
    const missing = await initiatePayment(userA.accessToken, "");
    expect(missing.status).toBe(400);
    const unknown = await jsonPost(
      "/api/v1/payments/initiate",
      { reservationCode: code, provider: "MOCK" },
      userA.accessToken,
    );
    expect(unknown.status).toBe(400);
  });

  it("404 nonexistent reservation", async () => {
    const res = await initiatePayment(userA.accessToken, "BKG-NOPE123");
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("404 another user's reservation (no existence disclosure)", async () => {
    const fresh = await freshCode();
    const res = await initiatePayment(userB.accessToken, fresh);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("302? no — initiates a mock payment successfully for the owner", async () => {
    const fresh = await freshCode();
    const res = await initiatePayment(userA.accessToken, fresh);
    expect(res.status).toBe(200);
    const { payment } = res.body as InitiatePaymentResponse;
    expect(payment.provider).toBe("MOCK");
    expect(payment.status).toBe("PENDING");
    expect(payment.amount).toBe(200);
    expect(payment.providerTxnId).toMatch(/^MOCK-/);
    expect(payment.providerTxnId).toContain(fresh);

    const { rows } = await getPool().query<{ reservation_id: string }>(
      `SELECT reservation_id FROM payments WHERE id = $1`,
      [payment.id],
    );
    const reservation = await getPool().query<{ state: string; amount: string }>(
      `SELECT state, amount FROM reservations WHERE id = $1`,
      [Number(rows[0]!.reservation_id)],
    );
    expect(reservation.rows[0]!.state).toBe("PENDING_PAYMENT");
    expect(Number(reservation.rows[0]!.amount)).toBe(200);
  });

  it("repeated initiate with the same idempotency key does not duplicate the payment", async () => {
    const fresh = await freshCode();
    const key = "pay-init-key-1";
    const first = await initiatePayment(userA.accessToken, fresh, key);
    expect(first.status).toBe(200);
    const firstPayment = (first.body as InitiatePaymentResponse).payment;

    const again = await initiatePayment(userA.accessToken, fresh, key);
    expect(again.status).toBe(200);
    const secondPayment = (again.body as InitiatePaymentResponse).payment;
    expect(secondPayment.id).toBe(firstPayment.id);
    expect(secondPayment.providerTxnId).toBe(firstPayment.providerTxnId);

    const { rows } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM payments WHERE provider_txn_id = $1`,
      [firstPayment.providerTxnId],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("400 empty Idempotency-Key header", async () => {
    const fresh = await freshCode();
    const res = await initiatePayment(userA.accessToken, fresh, "  ");
    expect(res.status).toBe(400);
  });

  it("teaches nothing: empty-string bearer is rejected", async () => {
    const res = await jsonPost("/api/v1/payments/initiate", { reservationCode: "BKG-X" }, "");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/payments/:txnId/verify", () => {
  let userA: AuthResponse;
  let userB: AuthResponse;
  let operator: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;
  let dayOffset = 30;

  beforeAll(async () => {
    userA = await registerSession("verify-A");
    userB = await registerSession("verify-B");
    operator = await registerVerifiedOperatorSession("verify-op");
    facility = await createFacility(operator.accessToken);
    slot = await createSlot(operator.accessToken, facility.id);
  });

  async function pendingWithPayment(): Promise<{ code: string; txnId: string }> {
    const res = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id, dayOffset++));
    expect(res.status).toBe(201);
    const code = (res.body as BookingResponse).reservation.reservationCode;
    const init = await initiatePayment(userA.accessToken, code);
    expect(init.status).toBe(200);
    const { payment } = init.body as InitiatePaymentResponse;
    return { code, txnId: payment.providerTxnId! };
  }

  it("401 unauthenticated", async () => {
    const res = await verifyPayment("", "MOCK-BKG-X-200");
    expect(res.status).toBe(401);
  });

  it("404 nonexistent txn id", async () => {
    const res = await verifyPayment(userA.accessToken, "MOCK-DOES-NOT-EXIST");
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("PAYMENT_NOT_FOUND");
  });

  it("404 another user's payment txn id (IDOR-safe)", async () => {
    const { txnId } = await pendingWithPayment();
    const res = await verifyPayment(userB.accessToken, txnId);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("PAYMENT_NOT_FOUND");
    const { rows } = await getPool().query<{ status: string }>(
      `SELECT status FROM payments WHERE provider_txn_id = $1`,
      [txnId],
    );
    expect(rows[0]!.status).toBe("PENDING");
  });

  it("successful verification → payment SUCCESS + reservation CONFIRMED + CHARGE transaction", async () => {
    const { code, txnId } = await pendingWithPayment();
    const res = await verifyPayment(userA.accessToken, txnId);
    expect(res.status).toBe(200);
    const { payment, reservation } = res.body as VerifyPaymentResponse;
    expect(payment.status).toBe("SUCCESS");
    expect(payment.amount).toBe(200);
    expect(reservation.state).toBe("CONFIRMED");
    expect(reservation.reservationCode).toBe(code);
    expect(reservation.paymentStatus).toBe("SUCCESS");
    expect(reservation.confirmedAt).toBeTruthy();

    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM payments WHERE provider_txn_id = $1`,
      [txnId],
    );
    const paymentId = Number(rows[0]!.id);
    const txn = await getPool().query<{ kind: string; status: string; amount: string }>(
      `SELECT kind, status, amount FROM transactions WHERE payment_id = $1`,
      [paymentId],
    );
    expect(txn.rows).toHaveLength(1);
    expect(txn.rows[0]!.kind).toBe("CHARGE");
    expect(txn.rows[0]!.status).toBe("SUCCESS");
    expect(Number(txn.rows[0]!.amount)).toBe(200);
  });

  it("repeated successful verification is idempotent (no duplicate charge)", async () => {
    const { txnId } = await pendingWithPayment();
    const first = await verifyPayment(userA.accessToken, txnId);
    expect(first.status).toBe(200);
    const again = await verifyPayment(userA.accessToken, txnId);
    expect(again.status).toBe(200);
    const { payment, reservation } = again.body as VerifyPaymentResponse;
    expect(payment.status).toBe("SUCCESS");
    expect(reservation.state).toBe("CONFIRMED");

    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM payments WHERE provider_txn_id = $1`,
      [txnId],
    );
    const txn = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM transactions WHERE payment_id = $1 AND kind = 'CHARGE'`,
      [Number(rows[0]!.id)],
    );
    expect(Number(txn.rows[0]!.n)).toBe(1);
  });

  it("failed verification → payment FAILED + reservation FAILED (never CONFIRMED)", async () => {
    const booking = await createBooking(
      userA.accessToken,
      WINDOW(facility.id, slot.id, dayOffset++),
    );
    expect(booking.status).toBe(201);
    const reservationCode = (booking.body as BookingResponse).reservation.reservationCode;
    // Simulate a provider-side pending payment whose outcome is deterministically
    // FAILED (MockPaymentProvider failure suffix contract).
    const failedTxnId = `MOCK-${reservationCode}-200__FAIL__`;
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM reservations WHERE reservation_code = $1`,
      [reservationCode],
    );
    await getPool().query(
      `INSERT INTO payments (reservation_id, provider, provider_txn_id, amount, status)
       VALUES ($1, 'MOCK', $2, 200, 'PENDING')`,
      [Number(rows[0]!.id), failedTxnId],
    );

    const res = await verifyPayment(userA.accessToken, failedTxnId);
    expect(res.status).toBe(200);
    const { payment, reservation } = res.body as VerifyPaymentResponse;
    expect(payment.status).toBe("FAILED");
    expect(reservation.state).toBe("FAILED");
    expect(reservation.paymentStatus).not.toBe("SUCCESS");
    expect(reservation.confirmedAt).toBeNull();

    const { rows: paymentRows } = await getPool().query<{ id: string }>(
      `SELECT id FROM payments WHERE provider_txn_id = $1`,
      [failedTxnId],
    );
    const txn = await getPool().query<{ kind: string; status: string }>(
      `SELECT kind, status FROM transactions WHERE payment_id = $1`,
      [Number(paymentRows[0]!.id)],
    );
    expect(txn.rows).toHaveLength(1);
    expect(txn.rows[0]!.kind).toBe("CHARGE");
    expect(txn.rows[0]!.status).toBe("FAILED");

    // The slot is free again — FAILED drops out of the exclusion predicate.
    const freed = await createBooking(userA.accessToken, WINDOW(facility.id, slot.id, dayOffset++));
    expect(freed.status).toBe(201);
  });

  it("repeated failed verification → 409 PAYMENT_ALREADY_FAILED", async () => {
    const booking = await createBooking(
      userA.accessToken,
      WINDOW(facility.id, slot.id, dayOffset++),
    );
    const reservationCode = (booking.body as BookingResponse).reservation.reservationCode;
    const failedTxnId = `MOCK-${reservationCode}-200__FAIL__`;
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM reservations WHERE reservation_code = $1`,
      [reservationCode],
    );
    await getPool().query(
      `INSERT INTO payments (reservation_id, provider, provider_txn_id, amount, status)
       VALUES ($1, 'MOCK', $2, 200, 'PENDING')`,
      [Number(rows[0]!.id), failedTxnId],
    );
    expect((await verifyPayment(userA.accessToken, failedTxnId)).status).toBe(200);
    const again = await verifyPayment(userA.accessToken, failedTxnId);
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe("PAYMENT_ALREADY_FAILED");
  });

  it("409 when the reservation is no longer pending (transaction keeps state consistent)", async () => {
    const { code, txnId } = await pendingWithPayment();
    // Cancel the pending reservation before verification (allowed lifecycle step).
    const cancel = await jsonPost(`/api/v1/reservations/${code}/cancel`, {}, userA.accessToken);
    expect(cancel.status).toBe(200);

    const res = await verifyPayment(userA.accessToken, txnId);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("RESERVATION_NOT_CONFIRMABLE");

    // The whole verification transaction rolled back: payment stays PENDING
    // (never SUCCESS), no CHARGE transaction, reservation stays CANCELLED.
    const { rows } = await getPool().query<{ id: string; status: string }>(
      `SELECT id, status FROM payments WHERE provider_txn_id = $1`,
      [txnId],
    );
    expect(rows[0]!.status).toBe("PENDING");
    const txn = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM transactions WHERE payment_id = $1`,
      [Number(rows[0]!.id)],
    );
    expect(Number(txn.rows[0]!.n)).toBe(0);
    const reservation = await getPool().query<{ state: string }>(
      `SELECT state FROM reservations WHERE reservation_code = $1`,
      [code],
    );
    expect(reservation.rows[0]!.state).toBe("CANCELLED");
  });

  it("409 initiating payment for an already-confirmed reservation", async () => {
    const { txnId } = await pendingWithPayment();
    await verifyPayment(userA.accessToken, txnId);
    const code = (
      await getPool().query<{ reservation_code: string }>(
        `SELECT r.reservation_code FROM reservations r
       JOIN payments p ON p.reservation_id = r.id
       WHERE p.provider_txn_id = $1`,
        [txnId],
      )
    ).rows[0]!.reservation_code;
    const init = await initiatePayment(userA.accessToken, code);
    expect(init.status).toBe(409);
    expect(errorCode(init.body)).toBe("PAYMENT_NOT_PENDING");
  });
});
