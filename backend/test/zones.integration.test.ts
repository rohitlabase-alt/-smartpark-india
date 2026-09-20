/**
 * Phase 2B DB-backed integration tests: parking slots + manual availability
 * (docs/DATABASE.md §2.8/§2.20, docs/API_SPEC.md §3) against a THROWAWAY
 * postgres database (`smartpark_test`), recreated + migrated per run.
 *
 * Requires the docker compose postgres (`npm run infra:up`); CI runs a
 * postgres service (see .github/workflows/ci.yml).
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

async function dropDatabase(): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl().toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(DB_NAME)} WITH (FORCE)`);
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
  const { status, body } = await jsonPost(
    "/api/v1/operators/register",
    { name: `${label} Parkings Pvt Ltd` },
    session.accessToken,
  );
  expect(status).toBe(201);
  expect((body as Operator).verificationStatus).toBe("PENDING");
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
    {
      name: "Phase2B Parking",
      type: "off-street",
      city: "Pune",
      area: "Viman Nagar",
      capacity: 10,
    },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingFacility;
}

async function createSlot(
  token: string,
  facilityId: number,
  overrides: Record<string, unknown> = {},
) {
  const { status, body } = await jsonPost(
    `/api/v1/operators/me/facilities/${facilityId}/slots`,
    { slotCode: `SP-PUN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...overrides },
    token,
  );
  expect(status).toBe(201);
  return { status, body: body as ParkingSlot };
}

const SLOTS_PATH = (facilityId: number) => `/api/v1/operators/me/facilities/${facilityId}/slots`;

async function approveFacility(adminToken: string, facilityId: number): Promise<void> {
  const review = await jsonPost(`/api/v1/admin/facilities/${facilityId}/review`, {}, adminToken);
  expect(review.status).toBe(200);
  const approve = await jsonPost(`/api/v1/admin/facilities/${facilityId}/approve`, {}, adminToken);
  expect(approve.status).toBe(200);
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

import type { ParkingZone } from "@smartpark/shared";

async function jsonDelete<T = unknown>(
  path: string,
  token?: string,
): Promise<{ status: number; body?: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as T) : undefined };
}

const ZONES_PATH = (facilityId: number) => `/api/v1/operators/me/facilities/${facilityId}/zones`;
const ZONE_PATH = (facilityId: number, zoneId: number) =>
  `/api/v1/operators/me/facilities/${facilityId}/zones/${zoneId}`;

async function createZone(
  token: string,
  facilityId: number,
  overrides: Record<string, unknown> = {},
): Promise<ParkingZone> {
  const { status, body } = await jsonPost(
    ZONES_PATH(facilityId),
    { name: `ZZ-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...overrides },
    token,
  );
  expect(status).toBe(201);
  return body as ParkingZone;
}

/** Fresh verified parkOperator + approved facility — every test isolated. */
async function zoneSession(): Promise<{ operator: AuthResponse; facility: ParkingFacility }> {
  const operator = await registerVerifiedOperatorSession("zone-op");
  const facility = await createFacility(operator.accessToken);
  const admin = await registerAdminSession("zone-admin");
  await approveFacility(admin.accessToken, facility.id);
  return { operator, facility };
}

describe("Zones CRUD (PARKING_OPERATOR only, ownership-enforced) — Phase 10 sessions", () => {
  it("401 unauthenticated zone list", async () => {
    const { facility } = await zoneSession();
    const { status } = await jsonGet(ZONES_PATH(facility.id));
    expect(status).toBe(401);
  });

  it("403 a plain USER (no PARKING_OPERATOR role) cannot create a zone", async () => {
    const { facility } = await zoneSession();
    const user = await registerSession("zone-plain");
    const { status } = await jsonPost(ZONES_PATH(facility.id), { name: "Sneak" }, user.accessToken);
    expect(status).toBe(403);
  });

  it("403 operator cannot create a zone in another operator's facility (IDOR)", async () => {
    const { facility } = await zoneSession();
    const other = await registerVerifiedOperatorSession("zone-other");
    const { status } = await jsonPost(
      ZONES_PATH(facility.id),
      { name: "Intruder" },
      other.accessToken,
    );
    expect(status).toBe(403);
  });

  it("404 a zone id from a different facility is not disclosed (cross-facility 404)", async () => {
    const { operator, facility } = await zoneSession();
    const zone = await createZone(operator.accessToken, facility.id, { name: "A wing" });
    const secondFacility = await createFacility(operator.accessToken);
    const { status } = await jsonPatch(
      ZONE_PATH(secondFacility.id, zone.id),
      { name: "sneak" },
      operator.accessToken,
    );
    expect(status).toBe(404);
  });

  it("404 a nonexistent facility id is not disclosed", async () => {
    const { operator } = await zoneSession();
    const { status } = await jsonPost(
      ZONES_PATH(987654321),
      { name: "Ghost" },
      operator.accessToken,
    );
    expect(status).toBe(404);
  });

  it("201 creates a zone and returns the ParkingZone DTO with car default", async () => {
    const { operator, facility } = await zoneSession();
    const zone = await createZone(operator.accessToken, facility.id, { kind: "car" });
    expect(zone.id).toBeGreaterThan(0);
    expect(zone.facilityId).toBe(facility.id);
    expect(zone.kind).toBe("car");
    expect(zone.isActive).toBe(true);
  });

  it("200 lists the facility's zones — ownership-scoped, others' zones excluded", async () => {
    const { operator, facility } = await zoneSession();
    await createZone(operator.accessToken, facility.id, { name: "A wing" });
    const { status, body } = await jsonGet(ZONES_PATH(facility.id), operator.accessToken);
    expect(status).toBe(200);
    const zones = body as ParkingZone[];
    expect(zones.some((z) => z.name === "A wing")).toBe(true);
  });

  it("200 PATCH renames and deactivates an owned zone", async () => {
    const { operator, facility } = await zoneSession();
    const zone = await createZone(operator.accessToken, facility.id, { name: "A wing" });
    const { status, body } = await jsonPatch(
      ZONE_PATH(facility.id, zone.id),
      { name: "A wing (reduced)", isActive: false },
      operator.accessToken,
    );
    expect(status).toBe(200);
    const updated = body as ParkingZone;
    expect(updated.name).toBe("A wing (reduced)");
    expect(updated.isActive).toBe(false);
  });

  it("204 DELETE removes an empty zone from the list", async () => {
    const { operator, facility } = await zoneSession();
    const zone = await createZone(operator.accessToken, facility.id, { name: "Temp wing" });
    const { status } = await jsonDelete(ZONE_PATH(facility.id, zone.id), operator.accessToken);
    expect(status).toBe(204);
    const { body } = await jsonGet(ZONES_PATH(facility.id), operator.accessToken);
    const zones = body as ParkingZone[];
    expect(zones.some((z) => z.id === zone.id)).toBe(false);
  });
});

describe("Zone delete guard (migration 0012 RESTRICT + service 409 ZONE_IN_USE)", () => {
  async function zoneWithSlot() {
    const { operator, facility } = await zoneSession();
    const zone = await createZone(operator.accessToken, facility.id, { name: "A wing" });
    const { body } = await createSlot(operator.accessToken, facility.id, { zoneId: zone.id });
    const slot = body as ParkingSlot;
    return { operator, facility, zone, slot };
  }

  it("Postgres 23503 (FK RESTRICT) refuses the raw delete of a zone with an assigned slot", async () => {
    const { zone, slot } = await zoneWithSlot();
    await expect(
      getPool().query(`DELETE FROM parking_zones WHERE id = $1`, [zone.id]),
    ).rejects.toMatchObject({ code: "23503" });
    const { rows } = await getPool().query<{ zone_id: string | null }>(
      `SELECT zone_id::text FROM parking_slots WHERE id = $1`,
      [slot.id],
    );
    expect(rows[0]!.zone_id).toBe(String(zone.id));
  });

  it("API 409 ZONE_IN_USE when the zone still has an assigned slot (service guard)", async () => {
    const { operator, facility, zone } = await zoneWithSlot();
    const { status, body } = await jsonDelete<{ error?: { code: string } }>(
      ZONE_PATH(facility.id, zone.id),
      operator.accessToken,
    );
    expect(status).toBe(409);
    expect(body?.error?.code).toBe("ZONE_IN_USE");
    const listed = await jsonGet(ZONES_PATH(facility.id), operator.accessToken);
    expect((listed.body as ParkingZone[]).some((z) => z.id === zone.id)).toBe(true);
  });

  it("204 once the assigned slot is unassigned (PATCH zoneId: null frees the zone)", async () => {
    const { operator, facility, zone, slot } = await zoneWithSlot();
    const unassigned = await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${slot.id}`,
      { zoneId: null },
      operator.accessToken,
    );
    expect(unassigned.status).toBe(200);
    const { rows } = await getPool().query<{ zone_id: string | null }>(
      `SELECT zone_id::text FROM parking_slots WHERE id = $1`,
      [slot.id],
    );
    expect(rows[0]!.zone_id).toBeNull();
    const { status } = await jsonDelete(ZONE_PATH(facility.id, zone.id), operator.accessToken);
    expect(status).toBe(204);
  });
});
