/**
 * Phase 2A DB-backed integration tests: authentication, RBAC, operators and
 * parking facility workflow against a THROWAWAY postgres database
 * (`smartpark_test`), recreated from scratch on every run (migrations
 * applied in beforeAll, DB dropped in afterAll).
 *
 * Requires the docker compose postgres (`npm run infra:up`). CI runs a
 * postgres service for this file (see .github/workflows/ci.yml).
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { AuthResponse, Operator, ParkingFacility, PublicUser } from "@smartpark/shared";
import { createApp } from "../src/app.js";
import { getPool, closeDb } from "../src/db.js";
import { runMigrations } from "../db/migrate.js";
import { hashRefreshToken } from "../src/modules/auth/tokens.js";

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

async function dropDatabase(): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl().toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(DB_NAME)} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

// Fresh schema every run even if a previous run left the DB behind.
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

async function registerSession(label: string) {
  const { status, body } = await jsonPost("/api/v1/auth/register", {
    email: uniqueEmail(label),
    password: "CorrectHorseBatteryStaple",
  });
  expect(status).toBe(201);
  return body as AuthResponse;
}

async function registerOperatorSession(label: string): Promise<AuthResponse> {
  const session = await registerSession(label);
  const { status, body } = await jsonPost(
    "/api/v1/operators/register",
    { name: `${label} Parkings Pvt Ltd` },
    session.accessToken,
  );
  expect(status).toBe(201);
  expect((body as Operator).verificationStatus).toBe("PENDING");
  return session;
}

async function createFacility(token: string, overrides: Record<string, unknown> = {}) {
  const { status, body } = await jsonPost(
    "/api/v1/operators/me/facilities",
    {
      name: "Central Plaza Parking",
      type: "off-street",
      city: "Pune",
      state: "Maharashtra",
      area: "Koregaon Park",
      latitude: 18.5362,
      longitude: 73.8942,
      capacity: 40,
      ...overrides,
    },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingFacility;
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

describe("DB schema (Phase 2A migrations)", () => {
  it("seeds exactly the Phase 2A role catalogue", async () => {
    const { rows } = await getPool().query<{ code: string }>(
      "SELECT code FROM roles ORDER BY code",
    );
    expect(rows.map((r) => r.code)).toEqual(["ADMIN", "PARKING_OPERATOR", "USER"]);
  });

  it("wires the deferred documents FKs to base tables (0003)", async () => {
    const { rows } = await getPool().query<{ constraint_name: string }>(
      `SELECT tc.constraint_name
       FROM information_schema.table_constraints tc
       WHERE tc.table_name = 'documents' AND tc.constraint_type = 'FOREIGN KEY'
       ORDER BY tc.constraint_name`,
    );
    expect(rows.map((r) => r.constraint_name).sort()).toEqual([
      "documents_operator_id_fkey",
      "documents_parking_id_fkey",
      "documents_reviewed_by_fkey",
      "documents_uploaded_by_fkey",
    ]);
  });
});

describe("POST /api/v1/auth/register", () => {
  it("201 returns session + safe public user (never password material)", async () => {
    const session = await registerSession("reg");
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(session.expiresInSeconds).toBeGreaterThan(0);
    expect(session.user.email).toContain("reg-");
    expect(session.user.roles).toContain("USER");
    const serialized = JSON.stringify(session);
    expect(serialized).not.toMatch(/password_hash|passwordHash|argon2/i);
  });

  it("stores an argon2id hash, not the plaintext", async () => {
    const email = uniqueEmail("hash");
    await jsonPost("/api/v1/auth/register", {
      email,
      password: "SuperSecret123!",
    });
    const { rows } = await getPool().query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0]!.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(rows[0]!.password_hash).not.toContain("SuperSecret123!");
  });

  it("409 DUPLICATE_EMAIL on re-registration", async () => {
    const email = uniqueEmail("dup");
    const first = await jsonPost("/api/v1/auth/register", {
      email,
      password: "CorrectHorseBatteryStaple",
    });
    expect(first.status).toBe(201);
    const second = await jsonPost("/api/v1/auth/register", {
      email,
      password: "AnotherPass123!",
    });
    expect(second.status).toBe(409);
    expect((second.body as { error: { code: string } }).error.code).toBe("DUPLICATE_EMAIL");
  });

  it("400 VALIDATION_ERROR for malformed input", async () => {
    const badEmail = await jsonPost("/api/v1/auth/register", {
      email: "not-an-email",
      password: "CorrectHorseBatteryStaple",
    });
    expect(badEmail.status).toBe(400);
    expect((badEmail.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");

    const shortPw = await jsonPost("/api/v1/auth/register", {
      email: uniqueEmail("shortpw"),
      password: "short",
    });
    expect(shortPw.status).toBe(400);

    const badPhone = await jsonPost("/api/v1/auth/register", {
      email: uniqueEmail("badphone"),
      password: "CorrectHorseBatteryStaple",
      phone: "123456",
    });
    expect(badPhone.status).toBe(400);
  });

  it("400 INVALID_JSON for a malformed body", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("200 issues a session for valid credentials", async () => {
    const email = uniqueEmail("login");
    const password = "CorrectHorseBatteryStaple";
    await jsonPost("/api/v1/auth/register", { email, password });
    const res = await jsonPost("/api/v1/auth/login", { email, password });
    expect(res.status).toBe(200);
    const session = res.body as AuthResponse;
    expect(session.user.email.toLowerCase()).toBe(email);
    expect(session.accessToken).toBeTruthy();
  });

  it("401 INVALID_CREDENTIALS for wrong password (same code as unknown email)", async () => {
    const email = uniqueEmail("wrongpw");
    await jsonPost("/api/v1/auth/register", { email, password: "CorrectHorseBatteryStaple" });

    const wrongPw = await jsonPost("/api/v1/auth/login", { email, password: "WrongPass" });
    expect(wrongPw.status).toBe(401);
    expect((wrongPw.body as { error: { code: string } }).error.code).toBe("INVALID_CREDENTIALS");

    const unknown = await jsonPost("/api/v1/auth/login", {
      email: "nobody@example.com",
      password: "Whatever",
    });
    expect(unknown.status).toBe(401);
    expect((unknown.body as { error: { code: string } }).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("401 ACCOUNT_INACTIVE for a suspended user", async () => {
    const email = uniqueEmail("suspended");
    await jsonPost("/api/v1/auth/register", { email, password: "CorrectHorseBatteryStaple" });
    await getPool().query("UPDATE users SET status = 'SUSPENDED' WHERE email = $1", [email]);

    const res = await jsonPost("/api/v1/auth/login", {
      email,
      password: "CorrectHorseBatteryStaple",
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("ACCOUNT_INACTIVE");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("401 without / with a bad token", async () => {
    const none = await jsonGet("/api/v1/auth/me");
    expect(none.status).toBe(401);

    const garbage = await jsonGet("/api/v1/auth/me", "not.a.jwt");
    expect(garbage.status).toBe(401);
  });

  it("200 returns the fresh profile for a valid token", async () => {
    const session = await registerSession("me");
    const res = await jsonGet("/api/v1/auth/me", session.accessToken);
    expect(res.status).toBe(200);
    const me = res.body as PublicUser;
    expect(me.id).toBe(session.user.id);
    expect(me.roles).toEqual(["USER"]);
  });

  it("403 ACCOUNT_INACTIVE for a suspended user holding a valid token", async () => {
    const session = await registerSession("suspended-me");
    await getPool().query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [session.user.id]);
    const res = await jsonGet("/api/v1/auth/me", session.accessToken);
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("401 UNKNOWN_USER for a soft-deleted account", async () => {
    const session = await registerSession("deleted-me");
    await getPool().query("UPDATE users SET deleted_at = now() WHERE id = $1", [session.user.id]);
    const res = await jsonGet("/api/v1/auth/me", session.accessToken);
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("UNKNOWN_USER");
  });
});

describe("POST /api/v1/auth/refresh & logout (session rotation)", () => {
  it("rotates the refresh token; a used token cannot be replayed", async () => {
    const session = await registerSession("rotate");

    const first = await jsonPost("/api/v1/auth/refresh", {
      refreshToken: session.refreshToken,
    });
    expect(first.status).toBe(200);
    const rotated = first.body as AuthResponse;
    expect(rotated.refreshToken).not.toBe(session.refreshToken);

    const replay = await jsonPost("/api/v1/auth/refresh", {
      refreshToken: session.refreshToken,
    });
    expect(replay.status).toBe(401);
    expect((replay.body as { error: { code: string } }).error.code).toBe("REFRESH_TOKEN_INVALID");
  });

  it("401 REFRESH_TOKEN_INVALID for a junk token", async () => {
    const res = await jsonPost("/api/v1/auth/refresh", { refreshToken: "garbage" });
    expect(res.status).toBe(401);
  });

  it("401 REFRESH_TOKEN_EXPIRED for an expired token", async () => {
    const session = await registerSession("expired-rt");
    const hash = hashRefreshToken(session.refreshToken);
    await getPool().query(
      "UPDATE refresh_tokens SET expires_at = now() - interval '1 hour' WHERE token_hash = $1",
      [hash],
    );
    const res = await jsonPost("/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("REFRESH_TOKEN_EXPIRED");
  });

  it("logout revokes the refresh token", async () => {
    const session = await registerSession("logout");
    const out = await jsonPost(
      "/api/v1/auth/logout",
      { refreshToken: session.refreshToken },
      session.accessToken,
    );
    expect(out.status).toBe(204);

    const reuse = await jsonPost("/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it("user A logout cannot revoke user B's refresh token (IDOR)", async () => {
    const a = await registerSession("idor-a");
    const b = await registerSession("idor-b");

    await jsonPost("/api/v1/auth/logout", { refreshToken: b.refreshToken }, a.accessToken);

    const stillValid = await jsonPost("/api/v1/auth/refresh", { refreshToken: b.refreshToken });
    expect(stillValid.status).toBe(200);
  });
});

describe("Operator registration + RBAC", () => {
  it("403 FORBIDDEN for non-operators hitting operator endpoints", async () => {
    const session = await registerSession("plain-user");

    const opsMe = await jsonGet("/api/v1/operators/me", session.accessToken);
    expect(opsMe.status).toBe(403);

    const createFacility = await jsonPost(
      "/api/v1/operators/me/facilities",
      { name: "x", type: "public", city: "Pune", capacity: 5 },
      session.accessToken,
    );
    expect(createFacility.status).toBe(403);
  });

  it("401 for unauthenticated operator calls", async () => {
    const res = await jsonGet("/api/v1/operators/me");
    expect(res.status).toBe(401);
  });

  it("operator registration grants PARKING_OPERATOR and returns the org", async () => {
    const session = await registerSession("op");
    const res = await jsonPost(
      "/api/v1/operators/register",
      { name: "Koregaon Parking Co", businessType: "private", registrationNumber: "ABC-123" },
      session.accessToken,
    );
    expect(res.status).toBe(201);
    const operator = res.body as Operator;
    expect(operator.id).toBeGreaterThan(0);
    expect(operator.verificationStatus).toBe("PENDING");

    const me = await jsonGet("/api/v1/auth/me", session.accessToken);
    expect((me.body as PublicUser).roles).toContain("PARKING_OPERATOR");
  });

  it("409 OPERATOR_EXISTS for a second registration from the same account", async () => {
    const session = await registerSession("op2");
    await jsonPost("/api/v1/operators/register", { name: "First Co" }, session.accessToken);
    const second = await jsonPost(
      "/api/v1/operators/register",
      { name: "Second Co" },
      session.accessToken,
    );
    expect(second.status).toBe(409);
    expect((second.body as { error: { code: string } }).error.code).toBe("OPERATOR_EXISTS");
  });

  it("GET /operators/me returns the owned org", async () => {
    const session = await registerOperatorSession("op-me");
    const res = await jsonGet("/api/v1/operators/me", session.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as Operator).name).toContain("op-me");
  });
});

describe("Parking facility CRUD (owned by the operator)", () => {
  it("creates a facility with a generated parking id and PENDING verification", async () => {
    const session = await registerOperatorSession("fac-create");

    const facility: ParkingFacility = await createFacility(session.accessToken);
    expect(facility.parkingId).toMatch(/^PUN-\d{6}$/);
    expect(facility.operatorId).toBeGreaterThan(0);
    expect(facility.isActive).toBe(true);
    expect(facility.verificationStatus).toBe("PENDING");
    expect(facility.availabilityMode).toBe("MANUAL");
    expect(facility.capacity).toBe(40);
    expect(facility.country).toBe("India");
  });

  it("lists own facilities", async () => {
    const session = await registerOperatorSession("fac-list");
    await createFacility(session.accessToken, { name: "Alpha Lot" });
    await createFacility(session.accessToken, { name: "Beta Lot" });

    const res = await jsonGet("/api/v1/operators/me/facilities", session.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as ParkingFacility[]).map((f) => f.name)).toEqual(["Beta Lot", "Alpha Lot"]);
  });

  it("400 VALIDATION_ERROR for invalid facility input", async () => {
    const session = await registerOperatorSession("fac-invalid");
    const missingCity = await jsonPost(
      "/api/v1/operators/me/facilities",
      { name: "X", type: "public", capacity: 5 },
      session.accessToken,
    );
    expect(missingCity.status).toBe(400);

    const badLat = await jsonPost(
      "/api/v1/operators/me/facilities",
      { name: "X", type: "public", city: "Pune", capacity: 5, latitude: 95 },
      session.accessToken,
    );
    expect(badLat.status).toBe(400);

    const unknownType = await jsonPost(
      "/api/v1/operators/me/facilities",
      { name: "X", type: "spaceship", city: "Pune", capacity: 5 },
      session.accessToken,
    );
    expect(unknownType.status).toBe(400);
  });

  it("operator can patch own facility (incl. activation toggle)", async () => {
    const session = await registerOperatorSession("fac-patch");
    const facility = await createFacility(session.accessToken, { capacity: 40 });

    const patch = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}`,
      {
        isActive: false,
        name: "Renamed Lot",
        description: "Updated facility description",
        capacity: 60,
      },
      session.accessToken,
    );
    expect(patch.status).toBe(200);
    const updated = patch.body as ParkingFacility;
    expect(updated.isActive).toBe(false);
    expect(updated.name).toBe("Renamed Lot");
    expect(updated.description).toBe("Updated facility description");
    expect(updated.capacity).toBe(60);
  });

  it("400 VALIDATION_ERROR for unknown keys or bad values on PATCH", async () => {
    const session = await registerOperatorSession("fac-patch-bad");
    const facility = await createFacility(session.accessToken);

    const unknownKey = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}`,
      { is_demo: true, parking_id: "HACK-000001" },
      session.accessToken,
    );
    expect(unknownKey.status).toBe(400);

    const zeroCapacity = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}`,
      { capacity: 0 },
      session.accessToken,
    );
    expect(zeroCapacity.status).toBe(400);
  });

  it("404 for missing / non-numeric facility ids", async () => {
    const session = await registerOperatorSession("fac-missing");
    const missing = await jsonPatch(
      "/api/v1/operators/me/facilities/999999",
      { isActive: false },
      session.accessToken,
    );
    expect(missing.status).toBe(404);

    const nonNumeric = await jsonPatch(
      "/api/v1/operators/me/facilities/abc",
      { isActive: false },
      session.accessToken,
    );
    expect(nonNumeric.status).toBe(404);
  });

  it("403 FORBIDDEN when patching another operator's facility (ownership)", async () => {
    const owner = await registerOperatorSession("fac-owner");
    const intruder = await registerOperatorSession("fac-intruder");

    const facility = await createFacility(owner.accessToken);
    await createFacility(intruder.accessToken);

    const res = await jsonPatch(
      `/api/v1/operators/me/facilities/${facility.id}`,
      { isActive: false },
      intruder.accessToken,
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });
});

describe("documents FK integrity (0003 wiring)", () => {
  let facility: ParkingFacility;
  let session: AuthResponse;

  beforeAll(async () => {
    session = await registerOperatorSession("fac-doc");
    facility = await createFacility(session.accessToken);
  });

  it("accepts a document linked to a real operator/facility/user", async () => {
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO documents (document_id, operator_id, parking_id, uploaded_by, storage_key, document_type, mime_type, file_size, verification_status)
       VALUES ('DOC-TEST-1', $1, $2, $3, 'test/doc.png', 'parking_image', 'image/png', 100, 'PENDING')
       RETURNING id`,
      [facility.operatorId, facility.id, session.user.id],
    );
    expect(rows[0]!.id).toBeTruthy();
  });

  it("rejects a document referencing an unknown operator (FK 23503)", async () => {
    await expect(
      getPool().query(
        `INSERT INTO documents (document_id, operator_id, uploaded_by, storage_key, document_type, mime_type, file_size, verification_status)
         VALUES ('DOC-TEST-BAD', 999999999, $1, 'test/bad.png', 'id_proof', 'image/png', 100, 'PENDING')`,
        [session.user.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
