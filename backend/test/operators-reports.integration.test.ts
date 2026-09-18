/**
 * Phase 9 Block B DB-backed integration tests: operator occupancy reports
 * (docs/API_SPEC.md §2 operators — GET /api/v1/operators/me/reports/occupancy,
 * docs/SECURITY.md §5 IDOR resistance) against a THROWAWAY postgres database
 * (`smartpark_test`), recreated + migrated per run. Runs serially with the
 * other DB-backed suites (fileParallelism: false in backend/vitest.config.ts).
 *
 * Intent: prove the report is a read-only, server-scoped aggregate — verified
 * operator only, always scoped to the caller's OWN facilities, with strict
 * period validation, and counts that mirror the real entry/exit/cancel
 * lifecycle (parking_slots.status stays the occupancy source of truth).
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type {
  AuthResponse,
  BookingResponse,
  InitiatePaymentResponse,
  Operator,
  OperatorOccupancyReport,
  ParkingFacility,
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
    { name: `${label} Occupancy Ops Pvt Ltd` },
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

/** Grants PARKING_OPERATOR without an operator org (disclosure test). */
async function registerOperatorRoleOnlySession(label: string): Promise<AuthResponse> {
  const session = await registerSession(label);
  await getPool().query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT u.id, r.id FROM users u JOIN roles r ON r.code = 'PARKING_OPERATOR'
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

async function rejectOperatorSession(label: string): Promise<AuthResponse> {
  const session = await registerOperatorSession(label);
  const me = await jsonGet("/api/v1/operators/me", session.accessToken);
  const operator = me.body as Operator;
  expect(operator.verificationStatus).toBe("PENDING");
  const admin = await registerAdminSession(`${label}-admin`);
  const review = await jsonPost(
    `/api/v1/admin/operators/${operator.id}/review`,
    {},
    admin.accessToken,
  );
  expect(review.status).toBe(200);
  const reject = await jsonPost(
    `/api/v1/admin/operators/${operator.id}/reject`,
    {},
    admin.accessToken,
  );
  expect(reject.status).toBe(200);
  return session;
}

async function createFacility(token: string, name: string): Promise<ParkingFacility> {
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

async function createSlot(token: string, facilityId: number, code: string): Promise<ParkingSlot> {
  const { status, body } = await jsonPost(
    `/api/v1/operators/me/facilities/${facilityId}/slots`,
    { slotCode: code },
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

/** Booking window covering "now" — valid for entry. */
function validWindow(facilityId: number, slotId: number): Record<string, unknown> {
  const now = Date.now();
  return {
    facilityId,
    slotId,
    startsAt: new Date(now - HOUR).toISOString(),
    endsAt: new Date(now + 2 * HOUR).toISOString(),
  };
}

async function confirmReservation(
  user: AuthResponse,
  window: Record<string, unknown>,
): Promise<BookingResponse> {
  const res = await createBooking(user.accessToken, window);
  expect(res.status).toBe(201);
  const booking = res.body as BookingResponse;
  const init = await initiatePayment(user.accessToken, booking.reservation.reservationCode);
  expect(init.status).toBe(200);
  const { payment } = init.body as InitiatePaymentResponse;
  const verify = await verifyPayment(user.accessToken, payment.providerTxnId!);
  expect(verify.status).toBe(200);
  expect((verify.body as BookingResponse).reservation.state).toBe("CONFIRMED");
  return verify.body as BookingResponse;
}

async function enterByReference(token: string, reservationCode: string): Promise<ParkingSession> {
  const { status, body } = await jsonPost(
    "/api/v1/parking-sessions/entry",
    { reservationCode },
    token,
  );
  expect(status).toBe(201);
  return (body as { session: ParkingSession }).session;
}

async function exitParking(token: string, sessionId: number): Promise<{ status: number }> {
  const res = await jsonPost(`/api/v1/parking-sessions/${sessionId}/exit`, {}, token);
  return { status: res.status };
}

async function cancelParking(token: string, sessionId: number): Promise<{ status: number }> {
  const res = await jsonPost(`/api/v1/parking-sessions/${sessionId}/cancel`, {}, token);
  return { status: res.status };
}

function reportOf(body: unknown): OperatorOccupancyReport {
  return body as OperatorOccupancyReport;
}

async function fetchReport(token: string, query = ""): Promise<{ status: number; body: unknown }> {
  return jsonGet(`/api/v1/operators/me/reports/occupancy${query}`, token);
}

/** Fresh scoped setup: verified operator + approved facility + n slots. */
async function makeLot(
  label: string,
  slots: number,
): Promise<{
  operator: AuthResponse;
  driver: AuthResponse;
  facility: ParkingFacility;
  slotList: ParkingSlot[];
  slot: (index: number) => number;
}> {
  const operator = await registerVerifiedOperatorSession(label);
  const driver = await registerSession(`${label}-driver`);
  const facility = await createFacility(operator.accessToken, `${label} Lot`);
  const slotList: ParkingSlot[] = [];
  for (let i = 0; i < slots; i += 1) {
    slotList.push(
      await createSlot(operator.accessToken, facility.id, `${label}-${i}-${Date.now()}`),
    );
  }
  return { operator, driver, facility, slotList, slot: (index) => slotList[index]!.id };
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

describe("occupancy report — access control", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await fetchReport("not-a-token");
    expect(res.status).toBe(401);
  });

  it("rejects a plain USER with 403 FORBIDDEN", async () => {
    const user = await registerSession("occ-user");
    const res = await fetchReport(user.accessToken);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("FORBIDDEN");
  });

  it("rejects PARKING_OPERATOR role with no operator org as 404 (no disclosure)", async () => {
    const roleOnly = await registerOperatorRoleOnlySession("occ-role-only");
    const res = await fetchReport(roleOnly.accessToken);
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("OPERATOR_NOT_FOUND");
  });

  it("rejects a PENDING operator as 403 OPERATOR_NOT_VERIFIED", async () => {
    const pending = await registerOperatorSession("occ-pending");
    const res = await fetchReport(pending.accessToken);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("OPERATOR_NOT_VERIFIED");
  });

  it("rejects a REJECTED operator as 403 OPERATOR_NOT_VERIFIED", async () => {
    const rejected = await rejectOperatorSession("occ-rejected");
    const res = await fetchReport(rejected.accessToken);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("OPERATOR_NOT_VERIFIED");
  });

  it("returns an all-zero, null-bounds report for a verified operator with no data", async () => {
    const operator = await registerVerifiedOperatorSession("occ-empty");
    const res = await fetchReport(operator.accessToken);
    expect(res.status).toBe(200);
    expect(reportOf(res.body)).toEqual({
      start: null,
      end: null,
      totalFacilities: 0,
      totalSlots: 0,
      availableSlots: 0,
      occupiedSlots: 0,
      activeSessions: 0,
      completedSessions: 0,
      cancelledSessions: 0,
    });
  });
});

describe("occupancy report — period validation", () => {
  let operator: AuthResponse;

  beforeAll(async () => {
    operator = await registerVerifiedOperatorSession("occ-validate");
  });

  it("rejects a non-ISO from", async () => {
    const res = await fetchReport(operator.accessToken, "?from=not-a-date");
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-ISO to", async () => {
    const res = await fetchReport(operator.accessToken, "?to=2026-13-99");
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe("VALIDATION_ERROR");
  });

  it("rejects from after to", async () => {
    const res = await fetchReport(
      operator.accessToken,
      "?from=2026-09-16T00:00:00Z&to=2026-09-15T00:00:00Z",
    );
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe("VALIDATION_ERROR");
  });

  it("accepts an explicit in-order period and echoes its bounds", async () => {
    const from = "2026-09-01T00:00:00.000Z";
    const to = "2026-10-01T00:00:00.000Z";
    const res = await fetchReport(
      operator.accessToken,
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(res.status).toBe(200);
    const report = reportOf(res.body);
    expect(report.start).toBe(from);
    expect(report.end).toBe(to);
  });
});

describe("occupancy report — multi-facility aggregation", () => {
  let operator: AuthResponse;
  let north: ParkingFacility;
  let south: ParkingFacility;

  beforeAll(async () => {
    operator = await registerVerifiedOperatorSession("agg-op");
    north = await createFacility(operator.accessToken, "Agg North Lot");
    south = await createFacility(operator.accessToken, "Agg South Lot");
    await createSlot(operator.accessToken, north.id, `AGG-N-${Date.now()}`);
    await createSlot(operator.accessToken, north.id, `AGG-N2-${Date.now()}`);
    await createSlot(operator.accessToken, south.id, `AGG-S-${Date.now()}`);
  });

  it("rolls up facilities and slots across all owned facilities (2 + 3)", async () => {
    const res = await fetchReport(operator.accessToken);
    expect(res.status).toBe(200);
    const report = reportOf(res.body);
    expect(report.totalFacilities).toBe(2);
    expect(report.totalSlots).toBe(3);
    expect(report.availableSlots).toBe(3);
    expect(report.occupiedSlots).toBe(0);
    expect(report.activeSessions).toBe(0);
    expect(report.completedSessions).toBe(0);
    expect(report.cancelledSessions).toBe(0);
    expect(report.start).toBeNull();
    expect(report.end).toBeNull();
  });

  it("a booked-but-not-entered reservation leaves occupancy unchanged", async () => {
    const driver = await registerSession("agg-driver");
    const sl = await createSlot(operator.accessToken, north.id, `AGG-N3-${Date.now()}`);
    await confirmReservation(driver, validWindow(north.id, sl.id));

    const report = reportOf((await fetchReport(operator.accessToken)).body);
    expect(report.totalSlots).toBe(4);
    expect(report.availableSlots).toBe(4);
    expect(report.occupiedSlots).toBe(0);
    expect(report.activeSessions).toBe(0);
  });
});

describe("occupancy report — entry lifecycle counts", () => {
  it("entry occupies the slot and counts an active session", async () => {
    const { operator, driver, slot, facility } = await makeLot("occ-entry", 2);
    const booking = await confirmReservation(driver, validWindow(facility.id, slot(0)));
    const session = await enterByReference(
      operator.accessToken,
      booking.reservation.reservationCode,
    );
    expect(session.status).toBe("ACTIVE");

    const report = reportOf((await fetchReport(operator.accessToken)).body);
    expect(report.totalSlots).toBe(2);
    expect(report.availableSlots).toBe(1);
    expect(report.occupiedSlots).toBe(1);
    expect(report.activeSessions).toBe(1);
    expect(report.completedSessions).toBe(0);
    expect(report.cancelledSessions).toBe(0);
    expect(report.start).not.toBeNull();
    expect(report.end).not.toBeNull();
    expect(report.end! >= report.start!).toBe(true);
  });

  it("a session active at read time stays counted even with a past filter", async () => {
    const { operator, driver, slot, facility } = await makeLot("occ-past-filter", 1);
    const booking = await confirmReservation(driver, validWindow(facility.id, slot(0)));
    await enterByReference(operator.accessToken, booking.reservation.reservationCode);

    const past = "2000-01-01T00:00:00.000Z";
    const report = reportOf(
      (await fetchReport(operator.accessToken, `?from=${encodeURIComponent(past)}`)).body,
    );
    expect(report.activeSessions).toBe(1);
    expect(report.occupiedSlots).toBe(1);
    expect(report.completedSessions).toBe(0);
  });
});

describe("occupancy report — exit lifecycle counts", () => {
  it("exit releases the slot and counts the completion", async () => {
    const { operator, driver, slot, facility } = await makeLot("occ-exit", 2);
    const booking = await confirmReservation(driver, validWindow(facility.id, slot(0)));
    const session = await enterByReference(
      operator.accessToken,
      booking.reservation.reservationCode,
    );
    expect((await exitParking(operator.accessToken, session.id)).status).toBe(200);

    const report = reportOf((await fetchReport(operator.accessToken)).body);
    expect(report.availableSlots).toBe(2);
    expect(report.occupiedSlots).toBe(0);
    expect(report.activeSessions).toBe(0);
    expect(report.completedSessions).toBe(1);
    expect(report.cancelledSessions).toBe(0);
  });

  it("period filters bound completed sessions by exit_at", async () => {
    const { operator, driver, slot, facility } = await makeLot("occ-exit-period", 1);
    const booking = await confirmReservation(driver, validWindow(facility.id, slot(0)));
    const session = await enterByReference(
      operator.accessToken,
      booking.reservation.reservationCode,
    );
    expect((await exitParking(operator.accessToken, session.id)).status).toBe(200);

    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const gone = new Date(Date.now() - 3_600_000).toISOString();

    const futureFrom = reportOf(
      (await fetchReport(operator.accessToken, `?from=${encodeURIComponent(soon)}`)).body,
    );
    expect(futureFrom.completedSessions).toBe(0);

    const pastTo = reportOf(
      (await fetchReport(operator.accessToken, `?to=${encodeURIComponent(gone)}`)).body,
    );
    expect(pastTo.completedSessions).toBe(0);

    const wide = reportOf(
      (
        await fetchReport(
          operator.accessToken,
          `?from=${encodeURIComponent(gone)}&to=${encodeURIComponent(soon)}`,
        )
      ).body,
    );
    expect(wide.completedSessions).toBe(1);
    expect(wide.activeSessions).toBe(0);
  });
});

describe("occupancy report — force-cancel lifecycle counts", () => {
  it("force-cancel releases the slot and counts the cancellation", async () => {
    const { operator, driver, slot, facility } = await makeLot("occ-cancel", 2);
    const booking = await confirmReservation(driver, validWindow(facility.id, slot(0)));
    const session = await enterByReference(
      operator.accessToken,
      booking.reservation.reservationCode,
    );
    expect((await cancelParking(operator.accessToken, session.id)).status).toBe(200);

    const report = reportOf((await fetchReport(operator.accessToken)).body);
    expect(report.availableSlots).toBe(2);
    expect(report.occupiedSlots).toBe(0);
    expect(report.activeSessions).toBe(0);
    expect(report.completedSessions).toBe(0);
    expect(report.cancelledSessions).toBe(1);
  });

  it("cancellations are bounded by the period too", async () => {
    const { operator, driver, slot, facility } = await makeLot("occ-cancel-period", 1);
    const booking = await confirmReservation(driver, validWindow(facility.id, slot(0)));
    const session = await enterByReference(
      operator.accessToken,
      booking.reservation.reservationCode,
    );
    expect((await cancelParking(operator.accessToken, session.id)).status).toBe(200);

    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const gone = new Date(Date.now() - 3_600_000).toISOString();
    const narrow = reportOf(
      (
        await fetchReport(
          operator.accessToken,
          `?from=${encodeURIComponent(gone)}&to=${encodeURIComponent(soon)}`,
        )
      ).body,
    );
    expect(narrow.cancelledSessions).toBe(1);
  });
});

describe("occupancy report — cross-operator isolation", () => {
  it("neither operator can read the other's sessions or slots", async () => {
    const alpha = await makeLot("occ-alpha", 2);
    const beta = await makeLot("occ-beta", 1);

    const alphaBooking = await confirmReservation(
      alpha.driver,
      validWindow(alpha.facility.id, alpha.slot(0)),
    );
    await enterByReference(alpha.operator.accessToken, alphaBooking.reservation.reservationCode);

    const alphaReport = reportOf((await fetchReport(alpha.operator.accessToken)).body);
    expect(alphaReport.totalFacilities).toBe(1);
    expect(alphaReport.totalSlots).toBe(2);
    expect(alphaReport.activeSessions).toBe(1);
    expect(alphaReport.occupiedSlots).toBe(1);

    const betaReport = reportOf((await fetchReport(beta.operator.accessToken)).body);
    expect(betaReport.totalFacilities).toBe(1);
    expect(betaReport.totalSlots).toBe(1);
    expect(betaReport.activeSessions).toBe(0);
    expect(betaReport.occupiedSlots).toBe(0);
    expect(betaReport.availableSlots).toBe(1);
  });
});

describe("occupancy report — soft-deleted facility is excluded", () => {
  it("drops a soft-deleted facility and its slots from every count", async () => {
    const operator = await registerVerifiedOperatorSession("occ-delete");
    const facility = await createFacility(operator.accessToken, "OccSoftDelete Lot");
    await createSlot(operator.accessToken, facility.id, `DEL-${Date.now()}`);

    await getPool().query("UPDATE parking_facilities SET deleted_at = now() WHERE id = $1", [
      facility.id,
    ]);

    const report = reportOf((await fetchReport(operator.accessToken)).body);
    expect(report.totalFacilities).toBe(0);
    expect(report.totalSlots).toBe(0);
    expect(report.availableSlots).toBe(0);
  });
});
