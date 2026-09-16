/**
 * Phase 8, Part 4 DB-backed integration tests: the audit trail (docs/
 * DATABASE.md §2.23, migration 0008), the admin audit API (GET
 * /api/v1/admin/audit-events), the platform dashboard (GET
 * /api/v1/admin/platform-summary — aggregate counts, no PII), and the audit
 * events emitted across admin/operator/user workflows. THROWAWAY postgres
 * (`smartpark_test`) is recreated + migrated per run; runs serially with the
 * other DB-backed suites (fileParallelism: false in backend/vitest.config.ts).
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type {
  AuditEvent,
  AuditEventAction,
  AuthResponse,
  BookingResponse,
  InitiatePaymentResponse,
  Operator,
  ParkingFacility,
  ParkingSlot,
  PlatformSummary,
} from "@smartpark/shared";
import { createApp } from "../src/app.js";
import { getPool, closeDb } from "../src/db.js";
import { runMigrations } from "../db/migrate.js";
import { sanitizeMetadata } from "../src/modules/audit/audit.service.js";

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

async function jsonPatch(
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

async function registerSession(label: string): Promise<AuthResponse> {
  const { status, body } = await jsonPost("/api/v1/auth/register", {
    email: uniqueEmail(label),
    password: "CorrectHorseBatteryStaple",
  });
  expect(status).toBe(201);
  return body as AuthResponse;
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

async function registerOperatorSession(label: string): Promise<AuthResponse> {
  const session = await registerSession(label);
  const { status } = await jsonPost(
    "/api/v1/operators/register",
    { name: `${label} Parkings Pvt Ltd`, businessType: "private" },
    session.accessToken,
  );
  expect(status).toBe(201);
  return session;
}

/** Returns { operator } by re-reading /operators/me. */
async function ownOperator(token: string): Promise<Operator> {
  const { status, body } = await jsonGet("/api/v1/operators/me", token);
  expect(status).toBe(200);
  return body as Operator;
}

async function adminOperatorTransition(
  admin: AuthResponse,
  operatorId: number,
  action: "review" | "approve" | "reject",
): Promise<number> {
  return jsonPost(`/api/v1/admin/operators/${operatorId}/${action}`, {}, admin.accessToken).then(
    (r) => r.status,
  );
}

/** Registers + reviews + approves an operator, returns owner session. */
async function registerVerifiedOperator(label: string): Promise<AuthResponse> {
  const session = await registerOperatorSession(label);
  const operator = await ownOperator(session.accessToken);
  const admin = await registerAdminSession(`${label}-adm`);
  expect(await adminOperatorTransition(admin, operator.id, "review")).toBe(200);
  expect(await adminOperatorTransition(admin, operator.id, "approve")).toBe(200);
  return session;
}

async function createFacility(token: string, label: string): Promise<ParkingFacility> {
  const { status, body } = await jsonPost(
    "/api/v1/operators/me/facilities",
    { name: `${label} Parking`, type: "off-street", city: "Pune", area: "MG Road", capacity: 6 },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingFacility;
}

async function createVerifiedFacility(
  label: string,
): Promise<{ admin: AuthResponse; facility: ParkingFacility; operator: AuthResponse }> {
  const operator = await registerVerifiedOperator(label);
  const facility = await createFacility(operator.accessToken, label);
  const admin = await registerAdminSession(`${label}-facadm`);
  expect(
    (await jsonPost(`/api/v1/admin/facilities/${facility.id}/review`, {}, admin.accessToken))
      .status,
  ).toBe(200);
  expect(
    (await jsonPost(`/api/v1/admin/facilities/${facility.id}/approve`, {}, admin.accessToken))
      .status,
  ).toBe(200);
  return { admin, facility, operator };
}

async function createSlot(token: string, facilityId: number, label: string): Promise<ParkingSlot> {
  const { status, body } = await jsonPost(
    `/api/v1/operators/me/facilities/${facilityId}/slots`,
    { slotCode: `${label}-${emailSeq++}` },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingSlot;
}

const WINDOW = (facilityId: number, slotId: number, dayOffset = 1) => {
  const day = String((dayOffset % 28) + 1).padStart(2, "0");
  return {
    facilityId,
    slotId,
    startsAt: `2026-09-${day}T08:00:00Z`,
    endsAt: `2026-09-${day}T10:00:00Z`,
  };
};

async function createBooking(token: string, body: Record<string, unknown>): Promise<string> {
  const res = await jsonPost("/api/v1/reservations", body, token);
  expect(res.status).toBe(201);
  return (res.body as BookingResponse).reservation.reservationCode;
}

async function auditList(
  token: string,
  filters: string,
): Promise<{ events: AuditEvent[]; page: number; limit: number; total: number }> {
  const res = await jsonGet(`/api/v1/admin/audit-events${filters}`, token);
  expect(res.status).toBe(200);
  return res.body as { events: AuditEvent[]; page: number; limit: number; total: number };
}

async function auditCountFor(admin: AuthResponse, action: AuditEventAction): Promise<AuditEvent[]> {
  return (await auditList(admin.accessToken, `?action=${action}&limit=100`)).events;
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

describe("DB schema (migration 0008)", () => {
  it("creates audit_events with the documented append-only shape", async () => {
    const { rows } = await getPool().query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'audit_events' ORDER BY ordinal_position`,
    );
    const cols = rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`);
    expect(cols).toContain("id:bigint:NO");
    expect(cols).toContain("actor_user_id:bigint:YES");
    expect(cols).toContain("action:character varying:NO");
    expect(cols).toContain("entity_type:character varying:NO");
    expect(cols).toContain("entity_id:bigint:YES");
    expect(cols).toContain("metadata:jsonb:NO");
    expect(cols).toContain("created_at:timestamp with time zone:NO");
    // Append-only: no updated_at, no deleted_at.
    expect(rows.some((r) => r.column_name === "updated_at")).toBe(false);
    expect(rows.some((r) => r.column_name === "deleted_at")).toBe(false);
  });

  it("foreign keys actor_user_id to users with ON DELETE SET NULL", async () => {
    const { rows } = await getPool().query<{ fk: string }>(
      `SELECT pg_get_constraintdef(oid) AS fk FROM pg_constraint
       WHERE conname = 'audit_events_actor_user_id_fkey'`,
    );
    expect(rows[0]!.fk).toContain("REFERENCES users(id)");
    expect(rows[0]!.fk).toContain("ON DELETE SET NULL");
  });

  it("has the four documented indexes", async () => {
    const { rows } = await getPool().query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'audit_events'`,
    );
    const indexes = rows.map((r) => r.indexname);
    expect(indexes).toContain("audit_events_created_at_idx");
    expect(indexes).toContain("audit_events_actor_created_idx");
    expect(indexes).toContain("audit_events_entity_idx");
    expect(indexes).toContain("audit_events_action_created_idx");
  });
});

describe("GET /api/v1/admin/audit-events", () => {
  it("401 unauthenticated and 403 for a non-admin (USER)", async () => {
    const res = await jsonGet("/api/v1/admin/audit-events");
    expect(res.status).toBe(401);
    const user = await registerSession("audit-403");
    const res2 = await jsonGet("/api/v1/admin/audit-events", user.accessToken);
    expect(res2.status).toBe(403);
    expect(errorCode(res2.body)).toBe("FORBIDDEN");
  });

  it("400 for invalid filter values", async () => {
    const admin = await registerAdminSession("audit-bad");
    const cases = [
      "?action=NOT_A_REAL_ACTION",
      "?entityType=UNKNOWN",
      "?actorUserId=abc",
      "?page=0",
      "?limit=not-a-number",
      "?from=not-a-date",
      "?to=2026-13-99",
    ];
    for (const suffix of cases) {
      const res = await jsonGet(`/api/v1/admin/audit-events${suffix}`, admin.accessToken);
      expect(res.status).toBe(400);
      expect(errorCode(res.body)).toBe("VALIDATION_ERROR");
    }
  });

  it("returns the newest events first with deterministic ordering + pagination", async () => {
    const admin = await registerAdminSession("audit-pages");
    // Drive a burst of events by creating several operators.
    for (let i = 0; i < 5; i += 1) {
      await registerOperatorSession(`audit-p${i}`);
    }

    const page1 = await auditList(
      admin.accessToken,
      "?entityType=OPERATOR&action=OPERATOR_REGISTERED&limit=2&page=1",
    );
    const page2 = await auditList(
      admin.accessToken,
      "?entityType=OPERATOR&action=OPERATOR_REGISTERED&limit=2&page=2",
    );
    expect(page1.events.length).toBe(2);
    expect(page2.events.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    const ids = [...page1.events, ...page2.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBeGreaterThan(ids[1]);
    expect(ids[1]).toBeGreaterThan(ids[2]);
  });

  it("filters by action, entityType, entityId and actorUserId", async () => {
    const admin = await registerAdminSession("audit-filters");
    const operatorOwner = await registerOperatorSession("audit-filters-op");
    const operator = await ownOperator(operatorOwner.accessToken);

    // All four operator registration events share the same entityId/owner.
    const byAction = await auditCountFor(admin, "OPERATOR_REGISTERED");
    expect(byAction.every((e) => e.action === "OPERATOR_REGISTERED")).toBe(true);

    const byEntity = await auditList(
      admin.accessToken,
      `?entityType=OPERATOR&entityId=${operator.id}&action=OPERATOR_REGISTERED`,
    );
    expect(byEntity.events.every((e) => e.entityId === operator.id)).toBe(true);

    const byActor = await auditList(
      admin.accessToken,
      `?actorUserId=${operatorOwner.user.id}&action=OPERATOR_REGISTERED`,
    );
    expect(byActor.events.every((e) => e.actorUserId === operatorOwner.user.id)).toBe(true);

    const combination = await auditList(
      admin.accessToken,
      `?entityType=OPERATOR&entityId=${operator.id}&actorUserId=${operatorOwner.user.id}`,
    );
    expect(combination.events.length).toBe(1);
    expect(combination.events[0]!.entityType).toBe("OPERATOR");
    expect(combination.events[0]!.actorEmail).toBe(operatorOwner.user.email);
  });

  it("filters by a from/to timestamp window", async () => {
    const admin = await registerAdminSession("audit-dates");
    const operatorOwner = await registerOperatorSession("audit-date-op");
    const operator = await ownOperator(operatorOwner.accessToken);
    const before = new Date(Date.now() - 60_000).toISOString();
    const after = new Date(Date.now() + 60_000).toISOString();

    const res = await auditList(
      admin.accessToken,
      `?entityType=OPERATOR&entityId=${operator.id}&from=${encodeURIComponent(before)}&to=${encodeURIComponent(after)}`,
    );
    expect(res.events.length).toBe(1);
    for (const event of res.events) {
      expect(event.createdAt >= before).toBe(true);
      expect(event.createdAt <= after).toBe(true);
    }
  });
});

describe("audit events are created by the workflows", () => {
  it("operator registration emits OPERATOR_REGISTERED (actor = owner)", async () => {
    const admin = await registerAdminSession("wf-reg-admin");
    const owner = await registerOperatorSession("wf-reg");
    const operator = await ownOperator(owner.accessToken);

    const events = await auditCountFor(admin, "OPERATOR_REGISTERED");
    const mine = events.filter((e) => e.entityType === "OPERATOR" && e.entityId === operator.id);
    expect(mine.length).toBe(1);
    expect(mine[0]!.actorUserId).toBe(owner.user.id);
    expect(mine[0]!.actorEmail).toBe(owner.user.email);
    expect(mine[0]!.metadata.operatorName).toBe("wf-reg Parkings Pvt Ltd");
  });

  it("admin operator transitions emit REVIEWED/APPROVED/REJECTED with the admin as actor", async () => {
    const admin = await registerAdminSession("wf-op-admin");
    const owner = await registerOperatorSession("wf-op-review");
    const operator = await ownOperator(owner.accessToken);

    expect(await adminOperatorTransition(admin, operator.id, "review")).toBe(200);
    expect(await adminOperatorTransition(admin, operator.id, "approve")).toBe(200);
    const reviewed = (await auditCountFor(admin, "OPERATOR_REVIEWED")).find(
      (e) => e.entityId === operator.id,
    );
    expect(reviewed).toBeDefined();
    expect(reviewed!.actorUserId).toBe(admin.user.id);
    expect(reviewed!.metadata.fromStatus).toBe("PENDING");
    expect(reviewed!.metadata.toStatus).toBe("UNDER_REVIEW");
    const approved = (await auditCountFor(admin, "OPERATOR_APPROVED")).find(
      (e) => e.entityId === operator.id,
    );
    expect(approved).toBeDefined();
    expect(approved!.actorUserId).toBe(admin.user.id);
    expect(approved!.metadata.toStatus).toBe("VERIFIED");

    const rejectedOperator = await registerOperatorSession("wf-op-reject");
    const rejectedOp = await ownOperator(rejectedOperator.accessToken);
    expect(await adminOperatorTransition(admin, rejectedOp.id, "review")).toBe(200);
    expect(await adminOperatorTransition(admin, rejectedOp.id, "reject")).toBe(200);
    const rejected = (await auditCountFor(admin, "OPERATOR_REJECTED")).find(
      (e) => e.entityId === rejectedOp.id,
    );
    expect(rejected).toBeDefined();
    expect(rejected!.metadata.toStatus).toBe("REJECTED");
  });

  it("facility create + update emit FACILITY_CREATED / FACILITY_UPDATED", async () => {
    const admin = await registerAdminSession("wf-fac-admin");
    const operator = await registerVerifiedOperator("wf-fac");
    const facility = await createFacility(operator.accessToken, "wf-fac");

    const created = (await auditCountFor(admin, "FACILITY_CREATED")).find(
      (e) => e.entityId === facility.id,
    );
    expect(created).toBeDefined();
    expect(created!.actorUserId).toBe(operator.user.id);
    expect(created!.metadata.facilityName).toBe("wf-fac Parking");

    const patch = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}`,
      { name: "Renamed Facility" },
      operator.accessToken,
    );
    expect(patch.status).toBe(200);
    const updated = (await auditCountFor(admin, "FACILITY_UPDATED")).find(
      (e) => e.entityId === facility.id,
    );
    expect(updated).toBeDefined();
    expect(updated!.metadata.updatedFields).toContain("name");
  });

  it("admin facility transitions emit FACILITY_REVIEWED/APPROVED/REJECTED and ACTIVE toggles", async () => {
    const { admin, facility, operator } = await createVerifiedFacility("wf-facadmin");
    // createVerifiedFacility already did review+approve:
    const reviewed = (await auditCountFor(admin, "FACILITY_REVIEWED")).some(
      (e) => e.entityId === facility.id && e.actorUserId === admin.user.id,
    );
    const approved = (await auditCountFor(admin, "FACILITY_APPROVED")).some(
      (e) => e.entityId === facility.id && e.actorUserId === admin.user.id,
    );
    expect(reviewed).toBe(true);
    expect(approved).toBe(true);

    const deactivate = await jsonPost(
      `/api/v1/admin/facilities/${facility.id}/deactivate`,
      {},
      admin.accessToken,
    );
    expect(deactivate.status).toBe(200);
    const activate = await jsonPost(
      `/api/v1/admin/facilities/${facility.id}/activate`,
      {},
      admin.accessToken,
    );
    expect(activate.status).toBe(200);

    const deactivated = (await auditCountFor(admin, "FACILITY_DEACTIVATED")).find(
      (e) => e.entityId === facility.id,
    );
    expect(deactivated).toBeDefined();
    expect(deactivated!.metadata.active).toBe(false);
    const activated = (await auditCountFor(admin, "FACILITY_ACTIVATED")).find(
      (e) => e.entityId === facility.id,
    );
    expect(activated).toBeDefined();
    expect(activated!.metadata.active).toBe(true);

    expect(operator.accessToken.length).toBeGreaterThan(0);
  });

  it("slot create + update emit SLOT_CREATED / SLOT_UPDATED", async () => {
    const { admin, facility, operator } = await createVerifiedFacility("wf-slot");
    const slot = await createSlot(operator.accessToken, facility.id, "wf-slot");

    const created = (await auditCountFor(admin, "SLOT_CREATED")).find(
      (e) => e.entityId === slot.id,
    );
    expect(created).toBeDefined();
    expect(created!.metadata.facilityId).toBe(facility.id);

    const patch = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}/slots/${slot.id}`,
      { status: "MAINTENANCE" },
      operator.accessToken,
    );
    expect(patch.status).toBe(200);
    const updated = (await auditCountFor(admin, "SLOT_UPDATED")).find(
      (e) => e.entityId === slot.id,
    );
    expect(updated).toBeDefined();
    expect(updated!.metadata.facilityId).toBe(facility.id);
    expect(updated!.metadata.updatedFields).toContain("status");
  });

  it("reservation create + customer cancel emit RESERVATION_CREATED / RESERVATION_CANCELLED", async () => {
    const admin = await registerAdminSession("wf-booking-admin");
    const user = await registerSession("wf-booking-user");
    const { facility, operator } = await createVerifiedFacility("wf-booking");
    const slot = await createSlot(operator.accessToken, facility.id, "wf-booking");

    const code = await createBooking(user.accessToken, WINDOW(facility.id, slot.id, 1));
    const created = (await auditCountFor(admin, "RESERVATION_CREATED"))
      .filter((e) => e.actorUserId === user.user.id)
      .sort((a, b) => b.id - a.id)[0]!;
    expect(created.entityType).toBe("RESERVATION");
    expect(created.metadata.facilityId).toBe(facility.id);
    expect(created.metadata.amount).toBeGreaterThan(0);

    const cancel = await jsonPost(
      `/api/v1/reservations/${code}/cancel`,
      { reason: "Plans changed" },
      user.accessToken,
    );
    expect(cancel.status).toBe(200);
    const cancelled = (await auditCountFor(admin, "RESERVATION_CANCELLED"))
      .filter((e) => e.actorUserId === user.user.id)
      .sort((a, b) => b.id - a.id)[0]!;
    expect(cancelled.entityId).toBe(created.entityId);
    expect(cancelled.metadata.previousState).toBe("PENDING_PAYMENT");
    expect(cancelled.metadata.cancelledBy).toBe("CUSTOMER");
  });

  it("operator-initiated cancellation marks cancelledBy=OPERATOR", async () => {
    const admin = await registerAdminSession("wf-opcancel-admin");
    const operator = await registerVerifiedOperator("wf-opcancel");
    const user = await registerSession("wf-opcancel-user");
    const facility = await createFacility(operator.accessToken, "wf-opcancel");
    const facilityAdmin = await registerAdminSession("wf-opcancel-facadm");
    expect(
      (
        await jsonPost(
          `/api/v1/admin/facilities/${facility.id}/review`,
          {},
          facilityAdmin.accessToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await jsonPost(
          `/api/v1/admin/facilities/${facility.id}/approve`,
          {},
          facilityAdmin.accessToken,
        )
      ).status,
    ).toBe(200);
    const slot = await createSlot(operator.accessToken, facility.id, "wf-opcancel");
    const code = await createBooking(user.accessToken, WINDOW(facility.id, slot.id, 2));

    const cancel = await jsonPost(
      `/api/v1/operators/me/reservations/${code}/cancel`,
      {},
      operator.accessToken,
    );
    expect(cancel.status).toBe(200);
    const cancelled = (await auditCountFor(admin, "RESERVATION_CANCELLED")).find(
      (e) => e.entityType === "RESERVATION" && e.metadata.cancelledBy === "OPERATOR",
    );
    expect(cancelled).toBeDefined();
    expect(cancelled!.actorUserId).toBe(operator.user.id);
  });

  it("payment initiate + verify emit PAYMENT_INITIATED / PAYMENT_VERIFIED", async () => {
    const admin = await registerAdminSession("wf-pay-admin");
    const user = await registerSession("wf-pay-user");
    const { facility, operator } = await createVerifiedFacility("wf-pay");
    const slot = await createSlot(operator.accessToken, facility.id, "wf-pay");
    const code = await createBooking(user.accessToken, WINDOW(facility.id, slot.id, 3));

    const initiated = await jsonPost(
      "/api/v1/payments/initiate",
      { reservationCode: code },
      user.accessToken,
    );
    expect(initiated.status).toBe(200);
    const payment = (initiated.body as InitiatePaymentResponse).payment;

    const payInitiated = (await auditCountFor(admin, "PAYMENT_INITIATED"))
      .filter((e) => e.actorUserId === user.user.id)
      .sort((a, b) => b.id - a.id)[0]!;
    expect(payInitiated.entityId).toBe(payment.id);
    expect(payInitiated.metadata.reservationId).toBeDefined();
    expect(payInitiated.metadata.amount).toBeGreaterThan(0);
    // Provider transaction ids must not be persisted in audit metadata.
    expect(JSON.stringify(payInitiated.metadata)).not.toContain(payment.providerTxnId);

    const verified = await jsonPost(
      `/api/v1/payments/${encodeURIComponent(payment.providerTxnId)}/verify`,
      {},
      user.accessToken,
    );
    expect(verified.status).toBe(200);
    const payVerified = (await auditCountFor(admin, "PAYMENT_VERIFIED"))
      .filter((e) => e.entityId === payment.id)
      .sort((a, b) => b.id - a.id)[0]!;
    expect(payVerified.metadata.result).toBe("SUCCESS");
    expect(payVerified.actorUserId).toBe(user.user.id);
  });
});

describe("same-transaction audit (rollback keeps the trail consistent)", () => {
  it("a failed transition does not leave behind an audit event", async () => {
    const admin = await registerAdminSession("rollback-admin");
    const owner = await registerOperatorSession("rollback-op");
    const operator = await ownOperator(owner.accessToken);
    const before = await auditCountFor(admin, "OPERATOR_APPROVED");

    // PENDING → approve is illegal (must be reviewed first) → 409, no event.
    const res = await jsonPost(
      `/api/v1/admin/operators/${operator.id}/approve`,
      {},
      admin.accessToken,
    );
    expect(res.status).toBe(409);
    const after = await auditCountFor(admin, "OPERATOR_APPROVED");
    expect(after.length).toBe(before.length);

    const mine = after.filter((e) => e.entityId === operator.id);
    expect(mine.length).toBe(0);
  });

  it("a repeat review does not duplicate the audit event", async () => {
    const admin = await registerAdminSession("rollback-admin2");
    const owner = await registerOperatorSession("rollback-op2");
    const operator = await ownOperator(owner.accessToken);

    expect(await adminOperatorTransition(admin, operator.id, "review")).toBe(200);
    const repeat = await jsonPost(
      `/api/v1/admin/operators/${operator.id}/review`,
      {},
      admin.accessToken,
    );
    expect(repeat.status).toBe(409);

    const events = (await auditCountFor(admin, "OPERATOR_REVIEWED")).filter(
      (e) => e.entityId === operator.id,
    );
    expect(events.length).toBe(1);
  });
});

describe("metadata sanitization (audit service)", () => {
  it("drops credential-looking keys recursively and keeps plain data", () => {
    const clean = sanitizeMetadata({
      password: "hunter2",
      passwd: "x",
      secretToken: "abc",
      apiKey: "k-123",
      api_key: "k-456",
      privateKey: "pk-1",
      authorization: "Bearer x",
      otp: "123456",
      cvv: "999",
      pin: "1111",
      name: "Megatron Development",
      amount: 1250,
      active: true,
      tags: ["a", "b"],
      nested: {
        token: "nope",
        public: 42,
        inner: { password: "no", label: "ok" },
      },
      complex: { createdAt: new Date() },
      arrayOfObjects: [{ key: "value" }],
      nullValue: null,
    });

    expect(clean.password).toBeUndefined();
    expect(clean.passwd).toBeUndefined();
    expect(clean.secretToken).toBeUndefined();
    expect(clean.apiKey).toBeUndefined();
    expect(clean.api_key).toBeUndefined();
    expect(clean.privateKey).toBeUndefined();
    expect(clean.authorization).toBeUndefined();
    expect(clean.otp).toBeUndefined();
    expect(clean.cvv).toBeUndefined();
    expect(clean.pin).toBeUndefined();
    expect(clean.name).toBe("Megatron Development");
    expect(clean.amount).toBe(1250);
    expect(clean.active).toBe(true);
    expect(clean.tags).toEqual(["a", "b"]);
    expect(clean.nested).toEqual({ public: 42, inner: { label: "ok" } });
    expect(clean.complex).toBeUndefined(); // Date is not a plain object
    expect(clean.arrayOfObjects).toBeUndefined(); // object arrays dropped
    expect(clean.nullValue).toBeNull();
  });

  it("returns {} for non-object input", () => {
    expect(sanitizeMetadata(undefined)).toEqual({});
    expect(sanitizeMetadata("string")).toEqual({});
    expect(sanitizeMetadata(["a"])).toEqual({});
    expect(sanitizeMetadata(null)).toEqual({});
  });
});

describe("GET /api/v1/admin/platform-summary", () => {
  it("401 unauthenticated and 403 for a non-admin", async () => {
    expect((await jsonGet("/api/v1/admin/platform-summary")).status).toBe(401);
    const user = await registerSession("summary-403");
    const res = await jsonGet("/api/v1/admin/platform-summary", user.accessToken);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("FORBIDDEN");
  });

  it("aggregates platform counts with zero-seeded breakdowns and no PII", async () => {
    const admin = await registerAdminSession("summary-admin");
    const emails: string[] = [];
    const visible = await registerSession("summary-email");
    emails.push(visible.user.email);

    const opOwner = await registerOperatorSession("summary-op");
    emails.push(opOwner.user.email);
    const operator = await ownOperator(opOwner.accessToken);
    expect(await adminOperatorTransition(admin, operator.id, "review")).toBe(200);
    expect(await adminOperatorTransition(admin, operator.id, "approve")).toBe(200);
    const facility = await createFacility(opOwner.accessToken, "summary");
    const facilityAdmin = await registerAdminSession("summary-facadm");
    expect(
      (
        await jsonPost(
          `/api/v1/admin/facilities/${facility.id}/review`,
          {},
          facilityAdmin.accessToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await jsonPost(
          `/api/v1/admin/facilities/${facility.id}/approve`,
          {},
          facilityAdmin.accessToken,
        )
      ).status,
    ).toBe(200);
    const slot = await createSlot(opOwner.accessToken, facility.id, "summary");
    const user = await registerSession("summary-booking");
    emails.push(user.user.email);
    await createBooking(user.accessToken, WINDOW(facility.id, slot.id, 4));

    const res = await jsonGet("/api/v1/admin/platform-summary", admin.accessToken);
    expect(res.status).toBe(200);
    const summary = res.body as PlatformSummary;

    const { rows: users } = await getPool().query<{ total: string }>(
      "SELECT count(*)::text AS total FROM users WHERE deleted_at IS NULL",
    );
    expect(summary.users).toBe(Number(users[0]!.total));

    expect(summary.operators).toBeGreaterThanOrEqual(1);
    expect(summary.operatorsByStatus.PENDING).toBeGreaterThanOrEqual(0);
    expect(summary.operatorsByStatus.VERIFIED).toBeGreaterThanOrEqual(1);
    expect(summary.operatorsByStatus).toHaveProperty("REJECTED");
    expect(summary.operatorsByStatus).toHaveProperty("SUSPENDED");

    expect(summary.facilities).toBeGreaterThanOrEqual(1);
    expect(summary.facilitiesByStatus.VERIFIED).toBeGreaterThanOrEqual(1);
    expect(summary.facilitiesByStatus.PENDING).toBeGreaterThanOrEqual(0);

    expect(summary.parkingSlots).toBeGreaterThanOrEqual(1);
    expect(summary.reservations).toBeGreaterThanOrEqual(1);
    expect(summary.reservationsByStatus.PENDING_PAYMENT).toBeGreaterThanOrEqual(1);
    expect(summary.reservationsByStatus).toHaveProperty("COMPLETED");

    expect(summary.activeFacilities).toBeGreaterThanOrEqual(1);
    expect(summary.payments).toBeGreaterThanOrEqual(0);
    expect(summary.paymentsByStatus).toHaveProperty("INITIATED");
    expect(summary.paymentsByStatus).toHaveProperty("REFUNDED");

    expect(summary.recentAuditEvents.length).toBeLessThanOrEqual(10);
    expect(summary.recentAuditEventCount).toBeGreaterThanOrEqual(summary.recentAuditEvents.length);

    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/password|providerTxnId/i);

    // Aggregate fields must expose no user PII. The bounded recentAuditEvents
    // slice intentionally carries actorEmail (admin-only, like the audit API),
    // so we assert PII-freedom on everything except that slice.
    const { recentAuditEvents: _recent, ...aggregates } = summary;
    const aggregateJson = JSON.stringify(aggregates);
    for (const email of emails) {
      expect(aggregateJson).not.toContain(email);
    }
    expect(aggregateJson).not.toMatch(/@[a-z0-9.-]+\.(com|in|org|net)/i);
  });
});

describe("audit trail write-protection", () => {
  it("no public or admin endpoint can create audit events", async () => {
    const admin = await registerAdminSession("write-protect");
    for (const [path, token] of [
      ["/api/v1/admin/audit-events", admin.accessToken],
      ["/api/v1/audit-events", undefined],
      ["/api/v1/audit-events", admin.accessToken],
    ] as const) {
      const res = await jsonPost(path, { action: "OPERATOR_REVIEWED" }, token);
      expect(res.status).toBe(404);
    }
  });
});
