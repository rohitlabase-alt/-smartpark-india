/**
 * Phase 8, Part 1 DB-backed integration tests: admin operator verification
 * workflow (docs/API_SPEC.md §2 admin) and the assertVerifiedOperator gate on
 * operational operator actions. THROWAWAY postgres (`smartpark_test`) is
 * recreated + migrated per run; runs serially with the other DB-backed suites
 * (fileParallelism: false in backend/vitest.config.ts).
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { AuthResponse, Operator, ParkingFacility, ParkingSlot } from "@smartpark/shared";
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

async function dropDatabase(): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl().toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(DB_NAME)} WITH (FORCE)`);
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

async function jsonGet(path: string, token?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
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

/** Registers a fresh operator org (PENDING) and returns its owner + operator. */
async function registerOperator(
  label: string,
): Promise<{ session: AuthResponse; operator: Operator }> {
  const session = await registerSession(label);
  const { status, body } = await jsonPost(
    "/api/v1/operators/register",
    { name: `${label} Parkings Pvt Ltd`, businessType: "private" },
    session.accessToken,
  );
  expect(status).toBe(201);
  return { session, operator: body as Operator };
}

const FACILITY_BODY = {
  name: "Admin Test Parking",
  type: "off-street",
  city: "Pune",
  state: "Maharashtra",
  area: "MG Road",
  capacity: 10,
};

async function createFacility(token: string): Promise<ParkingFacility> {
  const { status, body } = await jsonPost("/api/v1/operators/me/facilities", FACILITY_BODY, token);
  expect(status).toBe(201);
  return body as ParkingFacility;
}

async function createSlot(token: string, facilityId: number): Promise<ParkingSlot> {
  const { status, body } = await jsonPost(
    `/api/v1/operators/me/facilities/${facilityId}/slots`,
    { slotCode: `ADM-${Date.now()}-${emailSeq++}` },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingSlot;
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

describe("GET /api/v1/admin/operators", () => {
  it("401 unauthenticated", async () => {
    const res = await jsonGet("/api/v1/admin/operators");
    expect(res.status).toBe(401);
  });

  it("403 for an authenticated non-admin (USER)", async () => {
    const user = await registerSession("list-non-admin");
    const res = await jsonGet("/api/v1/admin/operators", user.accessToken);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("FORBIDDEN");
  });

  it("lists PENDING operators by default with safe fields only", async () => {
    const admin = await registerAdminSession("list-admin");
    const { operator: first } = await registerOperator("list-a");
    await registerOperator("list-b");
    await registerOperator("list-c");

    const res = await jsonGet("/api/v1/admin/operators", admin.accessToken);
    expect(res.status).toBe(200);
    const { operators } = res.body as { operators: Operator[] };
    expect(operators.length).toBe(3);
    expect(operators.map((o) => o.id)).toContain(first.id);
    for (const operator of operators) {
      expect(operator.verificationStatus).toBe("PENDING");
      expect(Object.keys(operator).sort()).toEqual([
        "businessType",
        "createdAt",
        "id",
        "name",
        "registrationNumber",
        "verificationStatus",
      ]);
    }
    expect(JSON.stringify(operators)).not.toMatch(/email|password|token|hash/i);
  });

  it("filters by an explicit status", async () => {
    const admin = await registerAdminSession("filter-admin");
    const { operator: pending } = await registerOperator("filter-a");
    const { operator: underReview } = await registerOperator("filter-b");
    const { operator: verified } = await registerOperator("filter-c");
    const { operator: rejected } = await registerOperator("filter-d");

    expect(
      (await jsonPost(`/api/v1/admin/operators/${underReview.id}/review`, {}, admin.accessToken))
        .status,
    ).toBe(200);
    expect(
      (await jsonPost(`/api/v1/admin/operators/${verified.id}/review`, {}, admin.accessToken))
        .status,
    ).toBe(200);
    expect(
      (await jsonPost(`/api/v1/admin/operators/${verified.id}/approve`, {}, admin.accessToken))
        .status,
    ).toBe(200);
    expect(
      (await jsonPost(`/api/v1/admin/operators/${rejected.id}/review`, {}, admin.accessToken))
        .status,
    ).toBe(200);
    expect(
      (await jsonPost(`/api/v1/admin/operators/${rejected.id}/reject`, {}, admin.accessToken))
        .status,
    ).toBe(200);

    const matches = async (status: string, id: number) => {
      const { body } = await jsonGet(`/api/v1/admin/operators?status=${status}`, admin.accessToken);
      const list = body as { operators: Operator[] };
      return list.operators.some((o) => o.id === id);
    };
    expect(await matches("PENDING", pending.id)).toBe(true);
    expect(await matches("UNDER_REVIEW", underReview.id)).toBe(true);
    expect(await matches("VERIFIED", verified.id)).toBe(true);
    expect(await matches("REJECTED", rejected.id)).toBe(true);
  });

  it("400 for an invalid status filter", async () => {
    const admin = await registerAdminSession("filter-bad-admin");
    const res = await jsonGet("/api/v1/admin/operators?status=HACKED", admin.accessToken);
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/admin/operators/:id/review", () => {
  it("401 unauthenticated and 403 non-admin", async () => {
    const { operator } = await registerOperator("review-gate");
    expect(
      (await jsonPost(`/api/v1/admin/operators/${operator.id}/review`, {}, undefined)).status,
    ).toBe(401);
    const user = await registerSession("review-non-admin");
    expect(
      (await jsonPost(`/api/v1/admin/operators/${operator.id}/review`, {}, user.accessToken))
        .status,
    ).toBe(403);
  });

  it("PENDING -> UNDER_REVIEW works", async () => {
    const admin = await registerAdminSession("review-admin");
    const { operator } = await registerOperator("review-ok");
    const res = await jsonPost(
      `/api/v1/admin/operators/${operator.id}/review`,
      {},
      admin.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as Operator).verificationStatus).toBe("UNDER_REVIEW");
  });

  it("409 for a repeat review and for reviewing an already-final operator", async () => {
    const admin = await registerAdminSession("review-conflict-admin");
    const { operator: underReview } = await registerOperator("review-repeat");
    const { operator: verified } = await registerOperator("review-verified");

    await jsonPost(`/api/v1/admin/operators/${underReview.id}/review`, {}, admin.accessToken);
    const repeat = await jsonPost(
      `/api/v1/admin/operators/${underReview.id}/review`,
      {},
      admin.accessToken,
    );
    expect(repeat.status).toBe(409);
    expect(errorCode(repeat.body)).toBe("OPERATOR_STATUS_CONFLICT");

    await jsonPost(`/api/v1/admin/operators/${verified.id}/review`, {}, admin.accessToken);
    await jsonPost(`/api/v1/admin/operators/${verified.id}/approve`, {}, admin.accessToken);
    const onVerified = await jsonPost(
      `/api/v1/admin/operators/${verified.id}/review`,
      {},
      admin.accessToken,
    );
    expect(onVerified.status).toBe(409);
    expect(errorCode(onVerified.body)).toBe("OPERATOR_STATUS_CONFLICT");
  });

  it("404 for nonexistent and non-numeric operator ids", async () => {
    const admin = await registerAdminSession("review-404-admin");
    expect(
      (await jsonPost("/api/v1/admin/operators/999999/review", {}, admin.accessToken)).status,
    ).toBe(404);
    expect(
      (await jsonPost("/api/v1/admin/operators/abc/review", {}, admin.accessToken)).status,
    ).toBe(404);
  });
});

describe("POST /api/v1/admin/operators/:id/approve", () => {
  it("401 unauthenticated and 403 non-admin", async () => {
    const { operator } = await registerOperator("approve-gate");
    expect(
      (await jsonPost(`/api/v1/admin/operators/${operator.id}/approve`, {}, undefined)).status,
    ).toBe(401);
    const user = await registerSession("approve-non-admin");
    expect(
      (await jsonPost(`/api/v1/admin/operators/${operator.id}/approve`, {}, user.accessToken))
        .status,
    ).toBe(403);
  });

  it("409 approving a PENDING operator that was never reviewed", async () => {
    const admin = await registerAdminSession("approve-pending-admin");
    const { operator } = await registerOperator("approve-direct");
    const res = await jsonPost(
      `/api/v1/admin/operators/${operator.id}/approve`,
      {},
      admin.accessToken,
    );
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("OPERATOR_STATUS_CONFLICT");
  });

  it("UNDER_REVIEW -> VERIFIED records approved_by and approved_at", async () => {
    const admin = await registerAdminSession("approve-admin");
    const { operator } = await registerOperator("approve-ok");
    await jsonPost(`/api/v1/admin/operators/${operator.id}/review`, {}, admin.accessToken);

    const res = await jsonPost(
      `/api/v1/admin/operators/${operator.id}/approve`,
      {},
      admin.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as Operator).verificationStatus).toBe("VERIFIED");

    const { rows } = await getPool().query<{
      approved_by: string | null;
      approved_at: Date | null;
      updated_at: Date;
    }>(`SELECT approved_by, approved_at, updated_at FROM operators WHERE id = $1`, [operator.id]);
    expect(Number(rows[0]!.approved_by)).toBe(admin.user.id);
    expect(rows[0]!.approved_at).not.toBeNull();
    expect(rows[0]!.updated_at).not.toBeNull();
  });

  it("409 REJECTED -> VERIFIED is not allowed", async () => {
    const admin = await registerAdminSession("approve-rejected-admin");
    const { operator } = await registerOperator("approve-rejected");
    await jsonPost(`/api/v1/admin/operators/${operator.id}/review`, {}, admin.accessToken);
    await jsonPost(`/api/v1/admin/operators/${operator.id}/reject`, {}, admin.accessToken);

    const res = await jsonPost(
      `/api/v1/admin/operators/${operator.id}/approve`,
      {},
      admin.accessToken,
    );
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("OPERATOR_STATUS_CONFLICT");
  });
});

describe("POST /api/v1/admin/operators/:id/reject", () => {
  it("401 unauthenticated and 403 non-admin", async () => {
    const { operator } = await registerOperator("reject-gate");
    expect(
      (await jsonPost(`/api/v1/admin/operators/${operator.id}/reject`, {}, undefined)).status,
    ).toBe(401);
    const user = await registerSession("reject-non-admin");
    expect(
      (await jsonPost(`/api/v1/admin/operators/${operator.id}/reject`, {}, user.accessToken))
        .status,
    ).toBe(403);
  });

  it("UNDER_REVIEW -> REJECTED works and does not touch approved_by/approved_at", async () => {
    const admin = await registerAdminSession("reject-admin");
    const { operator } = await registerOperator("reject-ok");
    await jsonPost(`/api/v1/admin/operators/${operator.id}/review`, {}, admin.accessToken);

    const res = await jsonPost(
      `/api/v1/admin/operators/${operator.id}/reject`,
      {},
      admin.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as Operator).verificationStatus).toBe("REJECTED");

    const { rows } = await getPool().query<{
      approved_by: string | null;
      approved_at: Date | null;
    }>(`SELECT approved_by, approved_at FROM operators WHERE id = $1`, [operator.id]);
    expect(rows[0]!.approved_by).toBeNull();
    expect(rows[0]!.approved_at).toBeNull();
  });

  it("409 rejecting a PENDING operator and a VERIFIED operator", async () => {
    const admin = await registerAdminSession("reject-conflict-admin");
    const { operator: pending } = await registerOperator("reject-pending");
    const { operator: verified } = await registerOperator("reject-verified");

    const onPending = await jsonPost(
      `/api/v1/admin/operators/${pending.id}/reject`,
      {},
      admin.accessToken,
    );
    expect(onPending.status).toBe(409);
    expect(errorCode(onPending.body)).toBe("OPERATOR_STATUS_CONFLICT");

    await jsonPost(`/api/v1/admin/operators/${verified.id}/review`, {}, admin.accessToken);
    await jsonPost(`/api/v1/admin/operators/${verified.id}/approve`, {}, admin.accessToken);
    const onVerified = await jsonPost(
      `/api/v1/admin/operators/${verified.id}/reject`,
      {},
      admin.accessToken,
    );
    expect(onVerified.status).toBe(409);
    expect(errorCode(onVerified.body)).toBe("OPERATOR_STATUS_CONFLICT");
  });
});

describe("assertVerifiedOperator gate (facilities + slots + operator operations)", () => {
  it("PENDING operator cannot create, list or patch facilities (403)", async () => {
    const { session } = await registerOperator("gate-pending-fac");
    const create = await jsonPost(
      "/api/v1/operators/me/facilities",
      FACILITY_BODY,
      session.accessToken,
    );
    expect(create.status).toBe(403);
    expect(errorCode(create.body)).toBe("OPERATOR_NOT_VERIFIED");

    const list = await jsonGet("/api/v1/operators/me/facilities", session.accessToken);
    expect(list.status).toBe(403);
    expect(errorCode(list.body)).toBe("OPERATOR_NOT_VERIFIED");

    const patch = await jsonPatch(
      "/api/v1/operators/me/facilities/1",
      { name: "X" },
      session.accessToken,
    );
    expect(patch.status).toBe(403);
    expect(errorCode(patch.body)).toBe("OPERATOR_NOT_VERIFIED");
  });

  it("UNDER_REVIEW and REJECTED operators cannot create facilities (403)", async () => {
    const admin = await registerAdminSession("gate-mid-admin");
    const { session: underSession, operator: underReview } = await registerOperator("gate-under");
    await jsonPost(`/api/v1/admin/operators/${underReview.id}/review`, {}, admin.accessToken);
    expect(
      (await jsonPost("/api/v1/operators/me/facilities", FACILITY_BODY, underSession.accessToken))
        .status,
    ).toBe(403);

    const { session: rejectedSession, operator: rejected } =
      await registerOperator("gate-rejected");
    await jsonPost(`/api/v1/admin/operators/${rejected.id}/review`, {}, admin.accessToken);
    await jsonPost(`/api/v1/admin/operators/${rejected.id}/reject`, {}, admin.accessToken);
    expect(
      (
        await jsonPost(
          "/api/v1/operators/me/facilities",
          FACILITY_BODY,
          rejectedSession.accessToken,
        )
      ).status,
    ).toBe(403);
  });

  it("PENDING operator cannot create, list or update slots (403)", async () => {
    const { session } = await registerOperator("gate-pending-slot");
    const create = await jsonPost(
      "/api/v1/operators/me/facilities/1/slots",
      { slotCode: "GATE-01" },
      session.accessToken,
    );
    expect(create.status).toBe(403);
    expect(errorCode(create.body)).toBe("OPERATOR_NOT_VERIFIED");

    const update = await jsonPatch(
      "/api/v1/operators/me/facilities/1/slots/1",
      { status: "MAINTENANCE" },
      session.accessToken,
    );
    expect(update.status).toBe(403);
    expect(errorCode(update.body)).toBe("OPERATOR_NOT_VERIFIED");

    const list = await jsonGet("/api/v1/operators/me/facilities/1/slots", session.accessToken);
    expect(list.status).toBe(403);
    expect(errorCode(list.body)).toBe("OPERATOR_NOT_VERIFIED");
  });

  it("VERIFIED operator can create a facility and manage slots", async () => {
    const admin = await registerAdminSession("gate-verified-admin");
    const { session, operator } = await registerOperator("gate-verified");
    await jsonPost(`/api/v1/admin/operators/${operator.id}/review`, {}, admin.accessToken);
    await jsonPost(`/api/v1/admin/operators/${operator.id}/approve`, {}, admin.accessToken);

    const facility = await createFacility(session.accessToken);
    expect(facility.verificationStatus).toBe("PENDING"); // facility verification is untouched (Phase 8 Part 1)

    const slot = await createSlot(session.accessToken, facility.id);
    expect(slot.facilityId).toBe(facility.id);

    const list = await jsonGet(
      `/api/v1/operators/me/facilities/${facility.id}/slots`,
      session.accessToken,
    );
    expect(list.status).toBe(200);
    expect((list.body as ParkingSlot[]).map((s) => s.id)).toContain(slot.id);

    const patch = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}/slots/${slot.id}`,
      { status: "MAINTENANCE" },
      session.accessToken,
    );
    expect(patch.status).toBe(200);
    expect((patch.body as ParkingSlot).status).toBe("MAINTENANCE");
  });

  it("registration and getOwnOperator stay open for PENDING operators", async () => {
    const { session, operator } = await registerOperator("gate-open");
    expect(operator.verificationStatus).toBe("PENDING");
    const me = await jsonGet("/api/v1/operators/me", session.accessToken);
    expect(me.status).toBe(200);
    expect((me.body as Operator).id).toBe(operator.id);
  });

  it("IDOR protections stay intact for verified operators", async () => {
    const admin = await registerAdminSession("gate-idor-admin");
    const a = await registerOperator("idor-a");
    const b = await registerOperator("idor-b");
    for (const { operator } of [a, b]) {
      await jsonPost(`/api/v1/admin/operators/${operator.id}/review`, {}, admin.accessToken);
      await jsonPost(`/api/v1/admin/operators/${operator.id}/approve`, {}, admin.accessToken);
    }
    const facilityA = await createFacility(a.session.accessToken);
    await createSlot(a.session.accessToken, facilityA.id);

    const patch = await jsonPatch(
      `/api/v1/operators/me/facilities/${facilityA.id}`,
      { name: "Hijacked" },
      b.session.accessToken,
    );
    expect(patch.status).toBe(403);
    expect(errorCode(patch.body)).toBe("FORBIDDEN");
  });
});
