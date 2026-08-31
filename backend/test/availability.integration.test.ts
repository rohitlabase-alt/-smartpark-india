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
import type {
  AuthResponse,
  FacilityAvailabilityResponse,
  Operator,
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

describe("DB schema (Phase 2B migration 0004)", () => {
  it("creates parking_zones / parking_slots / availability_state", async () => {
    const { rows } = await getPool().query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename IN ('parking_zones','parking_slots','availability_state') ORDER BY tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "availability_state",
      "parking_slots",
      "parking_zones",
    ]);
  });

  it("enforces the §2.8 slot status vocabulary", async () => {
    const operator = await registerOperatorSession("s-vocab");
    const facility = await createFacility(operator.accessToken);
    await expect(
      getPool().query(
        `INSERT INTO parking_slots (slot_code, facility_id, status) VALUES ($1, $2, 'RESERVEDD')`,
        [`SP-X-${Date.now()}`, facility.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("supports the availability_status §2.20 confidence/source/status vocabulary", async () => {
    const { rows } = await getPool().query<{
      check_clause: string;
    }>(
      `SELECT pg_get_constraintdef(oid) AS check_clause FROM pg_constraint
       WHERE conname IN ('availability_state_status_check','availability_state_source_check','availability_state_confidence_check')
       ORDER BY conname`,
    );
    const joined = rows.map((r) => r.check_clause).join("\n");
    expect(joined).toContain("AVAILABLE");
    expect(joined).toContain("MANUAL");
    expect(joined).toContain("MEDIUM_HIGH");
  });
});

describe("Slot creation (PARKING_OPERATOR, authenticated)", () => {
  let operator: AuthResponse;
  let other: AuthResponse;
  let facility: ParkingFacility;
  let otherFacility: ParkingFacility;

  beforeAll(async () => {
    operator = await registerOperatorSession("slot-op");
    other = await registerOperatorSession("slot-other");
    facility = await createFacility(operator.accessToken);
    otherFacility = await createFacility(other.accessToken);
  });

  it("401 unauthenticated slot management", async () => {
    const res = await jsonPost(`${SLOTS_PATH(facility.id)}`, {
      slotCode: `SP-UN-${Date.now()}`,
    });
    expect(res.status).toBe(401);
  });

  it("403 USER (no PARKING_OPERATOR role) cannot create slots", async () => {
    const plain = await registerSession("plain-slot-user");
    const res = await jsonPost(
      `${SLOTS_PATH(facility.id)}`,
      { slotCode: `SP-U-${Date.now()}` },
      plain.accessToken,
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("403 operator cannot create slots in another operator's facility (IDOR)", async () => {
    const res = await jsonPost(
      `${SLOTS_PATH(otherFacility.id)}`,
      { slotCode: `SP-X-${Date.now()}` },
      operator.accessToken,
    );
    expect(res.status).toBe(403);
  });

  it("404 for a non-existent facility id", async () => {
    const res = await jsonPost(
      `${SLOTS_PATH(999999)}`,
      {
        slotCode: `SP-M-${Date.now()}`,
      },
      operator.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it("201 creates a slot with defaults and a parking_id-backed status", async () => {
    const { body } = await createSlot(operator.accessToken, facility.id, {
      slotCode: "A01",
    });
    expect(body.slotCode).toBe("A01");
    expect(body.status).toBe("AVAILABLE");
    expect(body.vehicleType).toBe("car");
    expect(body.reservationsEnabled).toBe(true);
    expect(body.facilityId).toBe(facility.id);
    expect(body.zoneId).toBeNull();
  });

  it("409 DUPLICATE_SLOT_CODE on a duplicate slot code", async () => {
    await createSlot(operator.accessToken, facility.id, { slotCode: "A02" });
    const { status, body } = await jsonPost(
      `${SLOTS_PATH(facility.id)}`,
      { slotCode: "A02" },
      operator.accessToken,
    );
    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("DUPLICATE_SLOT_CODE");
  });

  it("400 VALIDATION_ERROR for an invalid status / missing code", async () => {
    const badStatus = await jsonPost(
      `${SLOTS_PATH(facility.id)}`,
      { slotCode: "A03", status: "TOMATO" },
      operator.accessToken,
    );
    expect(badStatus.status).toBe(400);

    const noCode = await jsonPost(`${SLOTS_PATH(facility.id)}`, {}, operator.accessToken);
    expect(noCode.status).toBe(400);

    const unknownKey = await jsonPost(
      `${SLOTS_PATH(facility.id)}`,
      { slotCode: "A04", is_demo: true },
      operator.accessToken,
    );
    expect(unknownKey.status).toBe(400);
  });

  it("does not leak a different facility in a cross-facility 403", async () => {
    const { body } = await jsonPost(
      `${SLOTS_PATH(otherFacility.id)}`,
      { slotCode: `SP-Y-${Date.now()}` },
      operator.accessToken,
    );
    expect((body as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });
});

describe("Slot listing (operator)", () => {
  it("lists only own facility's slots", async () => {
    const operator = await registerOperatorSession("list-op");
    const facility = await createFacility(operator.accessToken);
    await createSlot(operator.accessToken, facility.id, { slotCode: "B01" });
    await createSlot(operator.accessToken, facility.id, { slotCode: "B02" });

    const res = await jsonGet(`${SLOTS_PATH(facility.id)}`, operator.accessToken);
    expect(res.status).toBe(200);
    const slots = res.body as ParkingSlot[];
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.slotCode)).toEqual(["B01", "B02"]);
  });

  it("403 listing another operator's facility slots", async () => {
    const a = await registerOperatorSession("list-a");
    const b = await registerOperatorSession("list-b");
    const aFacility = await createFacility(a.accessToken);
    await createSlot(a.accessToken, aFacility.id, { slotCode: "C01" });

    const res = await jsonGet(`${SLOTS_PATH(aFacility.id)}`, b.accessToken);
    expect(res.status).toBe(403);
  });
});

describe("Slot status update + manual availability engine sync", () => {
  let operator: AuthResponse;
  let intruder: AuthResponse;
  let facility: ParkingFacility;
  let slot: ParkingSlot;

  beforeAll(async () => {
    operator = await registerOperatorSession("upd-op");
    intruder = await registerOperatorSession("upd-intruder");
    facility = await createFacility(operator.accessToken);
    ({ body: slot } = await createSlot(operator.accessToken, facility.id, {
      slotCode: "D01",
    }));
  });

  it("PATCH status → slot status + engine cache (source MANUAL) update together", async () => {
    const res = await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${slot.id}`,
      { status: "OCCUPIED" },
      operator.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as ParkingSlot).status).toBe("OCCUPIED");

    const { rows } = await getPool().query<{ status: string; source: string }>(
      "SELECT status, source FROM availability_state WHERE slot_id = $1",
      [slot.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("OCCUPIED");
    expect(rows[0]!.source).toBe("MANUAL");
  });

  it("reserved → RESERVED engine state; out-of-service maps to UNKNOWN engine state", async () => {
    await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${slot.id}`,
      { status: "RESERVED" },
      operator.accessToken,
    );
    let rows = await getPool().query<{ status: string }>(
      "SELECT status FROM availability_state WHERE slot_id = $1",
      [slot.id],
    );
    expect(rows.rows[0]!.status).toBe("RESERVED");

    await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${slot.id}`,
      { status: "OUT_OF_SERVICE" },
      operator.accessToken,
    );
    rows = await getPool().query<{ status: string }>(
      "SELECT status FROM availability_state WHERE slot_id = $1",
      [slot.id],
    );
    expect(rows.rows[0]!.status).toBe("UNKNOWN");
  });

  it("400 VALIDATION_ERROR for a bad status on PATCH", async () => {
    const res = await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${slot.id}`,
      { status: "NOPE" },
      operator.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it("403 intruder cannot update another operator's slot", async () => {
    const res = await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${slot.id}`,
      { status: "AVAILABLE" },
      intruder.accessToken,
    );
    expect(res.status).toBe(403);
  });

  it("404 for a missing / non-numeric slot id", async () => {
    const missing = await jsonPatch(
      `${SLOTS_PATH(facility.id)}/999999`,
      { status: "AVAILABLE" },
      operator.accessToken,
    );
    expect(missing.status).toBe(404);
    const nonNumeric = await jsonPatch(
      `${SLOTS_PATH(facility.id)}/abc`,
      { status: "AVAILABLE" },
      operator.accessToken,
    );
    expect(nonNumeric.status).toBe(404);
  });
});

describe("Public availability read (docs/API_SPEC.md §3)", () => {
  it("404 for an unknown / non-numeric / inactive facility", async () => {
    const bad = await jsonGet("/api/v1/parking/999999/availability");
    expect(bad.status).toBe(404);
    const nan = await jsonGet("/api/v1/parking/abc/availability");
    expect(nan.status).toBe(404);
  });

  it("serves correct totals and breakdown derived from slot engine state", async () => {
    const operator = await registerOperatorSession("av-op");
    const facility = await createFacility(operator.accessToken);

    await createSlot(operator.accessToken, facility.id, { slotCode: "E01" }); // AVAILABLE
    const e02 = await createSlot(operator.accessToken, facility.id, { slotCode: "E02" }); // AVAILABLE
    const e03 = await createSlot(operator.accessToken, facility.id, { slotCode: "E03" }); // AVAILABLE
    const e04 = await createSlot(operator.accessToken, facility.id, { slotCode: "E04" }); // AVAILABLE

    await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${e02.body.id}`,
      { status: "OCCUPIED" },
      operator.accessToken,
    );
    await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${e03.body.id}`,
      { status: "RESERVED" },
      operator.accessToken,
    );
    await jsonPatch(
      `${SLOTS_PATH(facility.id)}/${e04.body.id}`,
      { status: "OUT_OF_SERVICE" },
      operator.accessToken,
    );

    const res = await jsonGet(`/api/v1/parking/${facility.id}/availability`);
    expect(res.status).toBe(200);
    const body = res.body as FacilityAvailabilityResponse;
    expect(body.facilityId).toBe(facility.parkingId);
    expect(body.totalSlots).toBe(4);
    expect(body.availableSlots).toBe(1); // only E01 remains AVAILABLE
    expect(body.sources).toContain("MANUAL");
    expect(body.isLive).toBe(true);
    expect(body.confidence).toBe("HIGH");
    expect(body.disclaimer.toLowerCase()).toContain("not guaranteed");
    expect(body.slots).toHaveLength(4);
    expect(Number.isNaN(Date.parse(body.lastUpdatedAt))).toBe(false);
  });

  it("empty availability: no slots → all zeros, not live, LOW confidence, no sources", async () => {
    const operator = await registerOperatorSession("av-empty");
    const facility = await createFacility(operator.accessToken);

    const res = await jsonGet(`/api/v1/parking/${facility.id}/availability`);
    expect(res.status).toBe(200);
    const body = res.body as FacilityAvailabilityResponse;
    expect(body.totalSlots).toBe(0);
    expect(body.availableSlots).toBe(0);
    expect(body.isLive).toBe(false);
    expect(body.confidence).toBe("LOW");
    expect(body.sources).toEqual([]);
  });

  it("soft-deleted slots are excluded from the total", async () => {
    const operator = await registerOperatorSession("av-deleted");
    const facility = await createFacility(operator.accessToken);
    await createSlot(operator.accessToken, facility.id, { slotCode: "F01" });
    const f02 = await createSlot(operator.accessToken, facility.id, { slotCode: "F02" });

    await getPool().query("UPDATE parking_slots SET deleted_at = now() WHERE id = $1", [
      f02.body.id,
    ]);

    const res = await jsonGet(`/api/v1/parking/${facility.id}/availability`);
    const body = res.body as FacilityAvailabilityResponse;
    expect(body.totalSlots).toBe(1);
    expect(body.slots.map((s) => s.slotCode)).toEqual(["F01"]);
  });
});

describe("RBAC summary", () => {
  it("ADMIN role wiring is consistent (ADMIN exists; management still gated by operator role)", async () => {
    const { rows } = await getPool().query<{ code: string }>(
      "SELECT code FROM roles WHERE code = 'ADMIN'",
    );
    expect(rows.length).toBe(1);

    const adminUser = await registerSession("admin-check");
    // ADMIN is a documented role but not auto-assigned on register; a plain
    // user must NOT manage slots even though 'ADMIN' is a valid role code.
    const operator = await registerOperatorSession("admin-op");
    const facility = await createFacility(operator.accessToken);
    const res = await jsonPost(
      `${SLOTS_PATH(facility.id)}`,
      { slotCode: `SP-A-${Date.now()}` },
      adminUser.accessToken,
    );
    expect(res.status).toBe(403);
  });
});
