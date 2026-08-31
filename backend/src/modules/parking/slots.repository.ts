/**
 * SQL data access for parking slots + the availability_state engine cache
 * (docs/DATABASE.md §2.8/§2.20).
 */
import type { PoolClient } from "pg";
import type { AvailabilityState, ParkingSlot, ParkingSlotStatus } from "@smartpark/shared";
import { getPool, withTransaction } from "../../db.js";
import { conflict } from "../../http/errors.js";

export interface SlotRow {
  id: number;
  slotCode: string;
  facilityId: number;
  zoneId: number | null;
  vehicleType: string;
  status: ParkingSlotStatus;
  reservationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SlotResult {
  id: string;
  slot_code: string;
  facility_id: string;
  zone_id: string | null;
  vehicle_type: string;
  status: string;
  reservations_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapSlot(row: SlotResult): SlotRow {
  return {
    id: Number(row.id),
    slotCode: row.slot_code,
    facilityId: Number(row.facility_id),
    zoneId: row.zone_id === null ? null : Number(row.zone_id),
    vehicleType: row.vehicle_type,
    status: row.status as ParkingSlotStatus,
    reservationsEnabled: row.reservations_enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toSlotDto(row: SlotRow): ParkingSlot {
  return {
    id: row.id,
    slotCode: row.slotCode,
    facilityId: row.facilityId,
    zoneId: row.zoneId,
    vehicleType: row.vehicleType,
    status: row.status,
    reservationsEnabled: row.reservationsEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id, slot_code, facility_id, zone_id, vehicle_type, status,
  reservations_enabled, created_at, updated_at`;

/** Maps a 23505 unique violation on slot_code to a 409 (API_SPEC style). */
function mapSlotCodeViolation(err: unknown): never {
  if (
    err &&
    typeof err === "object" &&
    (err as { code?: string }).code === "23505" &&
    (err as { constraint?: string }).constraint === "parking_slots_slot_code_idx"
  ) {
    throw conflict("DUPLICATE_SLOT_CODE", "A slot with this code already exists");
  }
  throw err;
}

/** Maps a slot's operational status onto the engine vocabulary (§2.20). */
export function toEngineState(slotStatus: ParkingSlotStatus): AvailabilityState {
  if (slotStatus === "OCCUPIED") return "OCCUPIED";
  if (slotStatus === "RESERVED") return "RESERVED";
  if (slotStatus === "AVAILABLE") return "AVAILABLE";
  return "UNKNOWN"; // OUT_OF_SERVICE / MAINTENANCE / UNKNOWN are not available
}

export const slotsRepository = {
  async create(input: {
    slotCode: string;
    facilityId: number;
    status: ParkingSlotStatus;
    vehicleType: string;
    reservationsEnabled: boolean;
  }): Promise<SlotRow> {
    try {
      return await withTransaction(async (client) => {
        const { rows } = await client.query<SlotResult>(
          `INSERT INTO parking_slots (slot_code, facility_id, status, vehicle_type, reservations_enabled)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${SELECT_COLUMNS}`,
          [
            input.slotCode,
            input.facilityId,
            input.status,
            input.vehicleType,
            input.reservationsEnabled,
          ],
        );
        const slot = mapSlot(rows[0]!);
        // Seed the engine output cache so newly created (default AVAILABLE)
        // slots are counted in the public availability read (docs/DATABASE.md
        // §2.20) — keeps availability_state in sync on create, not just update.
        await upsertEngineState(client, slot.facilityId, slot.id, slot.status);
        return slot;
      });
    } catch (err) {
      mapSlotCodeViolation(err);
    }
  },

  async findById(id: number): Promise<SlotRow | undefined> {
    const { rows } = await getPool().query<SlotResult>(
      `SELECT ${SELECT_COLUMNS} FROM parking_slots WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? mapSlot(rows[0]) : undefined;
  },

  async listByFacility(facilityId: number): Promise<SlotRow[]> {
    const { rows } = await getPool().query<SlotResult>(
      `SELECT ${SELECT_COLUMNS} FROM parking_slots
       WHERE facility_id = $1 AND deleted_at IS NULL
       ORDER BY id ASC`,
      [facilityId],
    );
    return rows.map(mapSlot);
  },

  /**
   * Partial update of mutable slot fields + syncs the availability_state
   * engine cache row for the slot in one transaction (source=MANUAL).
   */
  async update(
    id: number,
    fields: { vehicleType?: string; status?: ParkingSlotStatus; reservationsEnabled?: boolean },
  ): Promise<SlotRow | undefined> {
    const sets: Array<[string, unknown]> = [];
    if (fields.vehicleType !== undefined) sets.push(["vehicle_type", fields.vehicleType]);
    if (fields.status !== undefined) sets.push(["status", fields.status]);
    if (fields.reservationsEnabled !== undefined)
      sets.push(["reservations_enabled", fields.reservationsEnabled]);

    if (sets.length === 0) {
      return undefined;
    }

    return withTransaction(async (client) => {
      const assignments = sets.map(([col], i) => `${col} = $${i + 1}`);
      const values = sets.map(([, val]) => val);
      const { rows } = await client.query<SlotResult>(
        `UPDATE parking_slots SET ${assignments.join(", ")}, updated_at = now()
         WHERE id = $${values.length + 1} AND deleted_at IS NULL
         RETURNING ${SELECT_COLUMNS}`,
        [...values, id],
      );
      if (!rows[0]) return undefined;
      const slot = mapSlot(rows[0]);

      // Mirror the slot's operational status into the engine output cache
      // (docs/DATABASE.md §2.20) with source=MANUAL.
      await upsertEngineState(client, slot.facilityId, slot.id, slot.status);

      return slot;
    });
  },
};

/** Upserts the normalized engine cache row for one slot (docs/DATABASE.md §2.20). */
export async function upsertEngineState(
  client: PoolClient,
  facilityId: number,
  slotId: number,
  slotStatus: ParkingSlotStatus,
): Promise<void> {
  const engineStatus = toEngineState(slotStatus);
  await client.query(
    `INSERT INTO availability_state (facility_id, slot_id, status, source, confidence, last_updated_at)
     VALUES ($1, $2, $3, 'MANUAL', 'HIGH', now())
     ON CONFLICT (slot_id) WHERE slot_id IS NOT NULL
     DO UPDATE SET
       status = EXCLUDED.status,
       source = 'MANUAL',
       confidence = 'HIGH',
       last_updated_at = now(),
       updated_at = now()`,
    [facilityId, slotId, engineStatus],
  );
}

/** Counts engine state per facility (used to build the availability summary). */
export async function countAvailabilityByFacility(facilityId: number): Promise<{
  counts: Record<AvailabilityState, number>;
  lastUpdatedAt: Date | null;
}> {
  const { rows } = await getPool().query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n
     FROM availability_state
     WHERE facility_id = $1 AND slot_id IS NOT NULL
     GROUP BY status`,
    [facilityId],
  );
  const counts: Record<AvailabilityState, number> = {
    AVAILABLE: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    UNKNOWN: 0,
  };
  for (const row of rows) {
    const key = row.status as AvailabilityState;
    if (key in counts) counts[key] = Number(row.n);
  }
  let lastUpdatedAt: Date | null = null;
  if (rows.length > 0) {
    const { rows: latest } = await getPool().query<{ last_updated_at: Date }>(
      `SELECT MAX(last_updated_at) AS last_updated_at
       FROM availability_state
       WHERE facility_id = $1 AND slot_id IS NOT NULL`,
      [facilityId],
    );
    lastUpdatedAt = latest[0]?.last_updated_at ?? null;
  }
  return { counts, lastUpdatedAt };
}

/** Returns a facility's non-deleted slots for the public read. */
export async function listActiveSlotsByFacility(facilityId: number): Promise<SlotRow[]> {
  const { rows } = await getPool().query<SlotResult>(
    `SELECT ${SELECT_COLUMNS} FROM parking_slots
     WHERE facility_id = $1 AND deleted_at IS NULL
     ORDER BY id ASC`,
    [facilityId],
  );
  return rows.map(mapSlot);
}
