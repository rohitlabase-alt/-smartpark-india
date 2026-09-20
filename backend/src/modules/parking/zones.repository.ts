/**
 * SQL data access for parking zones (docs/DATABASE.md §2.7). Zone grouping was
 * created in Phase 2B (parking_zones) without an API; Phase 10 adds the
 * operator CRUD so society/any facility can organise slots into areas. A zone
 * is deleted hard (no deleted_at column) but only when no parking slot still
 * references it — the service enforces the guard before DELETE.
 */
import type { PoolClient } from "pg";
import type { ParkingZone } from "@smartpark/shared";
import { getPool, withTransaction } from "../../db.js";

export interface ZoneRow {
  id: number;
  facilityId: number;
  name: string;
  kind: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ZoneResult {
  id: string;
  facility_id: string;
  name: string;
  kind: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapZone(row: ZoneResult): ZoneRow {
  return {
    id: Number(row.id),
    facilityId: Number(row.facility_id),
    name: row.name,
    kind: row.kind,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toZoneDto(row: ZoneRow): ParkingZone {
  return {
    id: row.id,
    facilityId: row.facilityId,
    name: row.name,
    kind: row.kind,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SELECT_COLUMNS = "id, facility_id, name, kind, is_active, created_at, updated_at";

export const zonesRepository = {
  async create(
    input: { facilityId: number; name: string; kind: string },
    client?: PoolClient,
  ): Promise<ZoneRow> {
    const target = client ?? getPool();
    const { rows } = await target.query<ZoneResult>(
      `INSERT INTO parking_zones (facility_id, name, kind)
       VALUES ($1, $2, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [input.facilityId, input.name, input.kind],
    );
    return mapZone(rows[0]!);
  },

  async findById(id: number): Promise<ZoneRow | undefined> {
    const { rows } = await getPool().query<ZoneResult>(
      `SELECT ${SELECT_COLUMNS} FROM parking_zones WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapZone(rows[0]) : undefined;
  },

  async listByFacility(facilityId: number): Promise<ZoneRow[]> {
    const { rows } = await getPool().query<ZoneResult>(
      `SELECT ${SELECT_COLUMNS} FROM parking_zones
       WHERE facility_id = $1
       ORDER BY id ASC`,
      [facilityId],
    );
    return rows.map(mapZone);
  },

  /**
   * Partial update of a zone's own mutable fields (name/kind/is_active).
   * identity/facility ownership are never changed.
   */
  async update(
    id: number,
    fields: { name?: string; kind?: string; isActive?: boolean },
    client?: PoolClient,
  ): Promise<ZoneRow | undefined> {
    const sets: Array<[string, unknown]> = [];
    if (fields.name !== undefined) sets.push(["name", fields.name]);
    if (fields.kind !== undefined) sets.push(["kind", fields.kind]);
    if (fields.isActive !== undefined) sets.push(["is_active", fields.isActive]);

    if (sets.length === 0) {
      return undefined;
    }
    const target = client ?? getPool();
    const assignments = sets.map(([col], i) => `${col} = $${i + 1}`);
    const values = sets.map(([, val]) => val);
    const { rows } = await target.query<ZoneResult>(
      `UPDATE parking_zones SET ${assignments.join(", ")}, updated_at = now()
       WHERE id = $${values.length + 1}
       RETURNING ${SELECT_COLUMNS}`,
      [...values, id],
    );
    return rows[0] ? mapZone(rows[0]) : undefined;
  },

  async delete(id: number, client?: PoolClient): Promise<boolean> {
    const target = client ?? getPool();
    const { rowCount } = await target.query<ZoneResult>(`DELETE FROM parking_zones WHERE id = $1`, [
      id,
    ]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Number of non-deleted slots still assigned to the zone (delete guard).
   * Accepts an optional PoolClient so callers inside withTransaction() run the
   * count and the subsequent zone DELETE on the SAME connection/snapshot —
   * otherwise a slot (re)assigned between the two statements (TOCTOU) would be
   * silently detached. Postgres still backstops this with the RESTRICT action
   * wired in migration 0012 (the 23503 it raises maps back to ZONE_IN_USE), so
   * this guard is an optimisation/fast-path, not the source of truth.
   */
  async countSlotsInZone(zoneId: number, client?: PoolClient): Promise<number> {
    const target = client ?? getPool();
    const { rows } = await target.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM parking_slots
       WHERE zone_id = $1 AND deleted_at IS NULL`,
      [zoneId],
    );
    return Number(rows[0]!.n);
  },
};

export { withTransaction };
