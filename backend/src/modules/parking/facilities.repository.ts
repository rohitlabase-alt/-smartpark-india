/**
 * SQL data access for parking facilities (docs/DATABASE.md §2.6).
 * NUMERIC/BIGINT are normalized from node-postgres string form.
 */
import type {
  AvailabilityMode,
  FacilityType,
  OperatorStatus,
  ParkingFacility,
} from "@smartpark/shared";
import { getPool } from "../../db.js";

export interface FacilityRow {
  id: number;
  parkingId: string;
  name: string;
  description: string | null;
  type: FacilityType;
  country: string;
  state: string | null;
  city: string;
  area: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  operatorId: number;
  capacity: number;
  verificationStatus: OperatorStatus;
  availabilityMode: AvailabilityMode;
  isActive: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FacilityResult {
  id: string;
  parking_id: string;
  name: string;
  description: string | null;
  type: string;
  country: string;
  state: string | null;
  city: string;
  area: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  operator_id: string;
  capacity: number;
  verification_status: string;
  availability_mode: string;
  is_active: boolean;
  is_demo: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapFacility(row: FacilityResult): FacilityRow {
  return {
    id: Number(row.id),
    parkingId: row.parking_id,
    name: row.name,
    description: row.description,
    type: row.type as FacilityType,
    country: row.country,
    state: row.state,
    city: row.city,
    area: row.area,
    address: row.address,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    operatorId: Number(row.operator_id),
    capacity: row.capacity,
    verificationStatus: row.verification_status as OperatorStatus,
    availabilityMode: row.availability_mode as AvailabilityMode,
    isActive: row.is_active,
    isDemo: row.is_demo,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toFacilityDto(row: FacilityRow): ParkingFacility {
  return {
    id: row.id,
    parkingId: row.parkingId,
    name: row.name,
    description: row.description,
    type: row.type,
    country: row.country,
    state: row.state,
    city: row.city,
    area: row.area,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    operatorId: row.operatorId,
    capacity: row.capacity,
    verificationStatus: row.verificationStatus,
    availabilityMode: row.availabilityMode,
    isActive: row.isActive,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id, parking_id, name, description, type, country, state, city, area, address,
  latitude, longitude, operator_id, capacity, verification_status,
  availability_mode, is_active, is_demo, created_at, updated_at`;

export const facilitiesRepository = {
  async create(input: {
    parkingId: string;
    operatorId: number;
    name: string;
    description: string | null;
    type: FacilityType;
    country: string;
    state: string | null;
    city: string;
    area: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    capacity: number;
  }): Promise<FacilityRow> {
    const { rows } = await getPool().query<FacilityResult>(
      `INSERT INTO parking_facilities (
         parking_id, name, description, type, country, state, city, area, address,
         latitude, longitude, operator_id, capacity, verification_status, availability_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDING', 'MANUAL')
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.parkingId,
        input.name,
        input.description,
        input.type,
        input.country,
        input.state,
        input.city,
        input.area,
        input.address,
        input.latitude,
        input.longitude,
        input.operatorId,
        input.capacity,
      ],
    );
    return mapFacility(rows[0]!);
  },

  async findById(id: number): Promise<FacilityRow | undefined> {
    const { rows } = await getPool().query<FacilityResult>(
      `SELECT ${SELECT_COLUMNS} FROM parking_facilities WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? mapFacility(rows[0]) : undefined;
  },

  async listByOperator(operatorId: number): Promise<FacilityRow[]> {
    const { rows } = await getPool().query<FacilityResult>(
      `SELECT ${SELECT_COLUMNS} FROM parking_facilities
       WHERE operator_id = $1 AND deleted_at IS NULL
       ORDER BY id DESC`,
      [operatorId],
    );
    return rows.map(mapFacility);
  },

  /**
   * Partial update: only non-undefined fields are written; null explicitly
   * clears a nullable column. Never touches identity/ownership/verification.
   */
  async update(
    id: number,
    fields: {
      name?: string;
      description?: string | null;
      type?: FacilityType;
      city?: string;
      state?: string | null;
      area?: string | null;
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      capacity?: number;
      isActive?: boolean;
    },
  ): Promise<FacilityRow | undefined> {
    const sets: Array<[string, unknown]> = [];
    const push = (col: string, val: unknown) => sets.push([col, val]);

    if (fields.name !== undefined) push("name", fields.name);
    if (fields.description !== undefined) push("description", fields.description);
    if (fields.type !== undefined) push("type", fields.type);
    if (fields.city !== undefined) push("city", fields.city);
    if (fields.state !== undefined) push("state", fields.state);
    if (fields.area !== undefined) push("area", fields.area);
    if (fields.address !== undefined) push("address", fields.address);
    if (fields.latitude !== undefined) push("latitude", fields.latitude);
    if (fields.longitude !== undefined) push("longitude", fields.longitude);
    if (fields.capacity !== undefined) push("capacity", fields.capacity);
    if (fields.isActive !== undefined) push("is_active", fields.isActive);

    if (sets.length === 0) {
      return undefined;
    }

    const assignments = sets.map(([col], i) => `${col} = $${i + 1}`);
    const values = sets.map(([, val]) => val);
    const { rows } = await getPool().query<FacilityResult>(
      `UPDATE parking_facilities SET ${assignments.join(", ")}, updated_at = now()
       WHERE id = $${values.length + 1} AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [...values, id],
    );
    return rows[0] ? mapFacility(rows[0]) : undefined;
  },

  /** Next value of the per-facility public-id sequence (e.g. PUN-000001). */
  async nextParkingSequence(): Promise<number> {
    const { rows } = await getPool().query<{ n: string }>("SELECT nextval('parking_id_seq') AS n");
    return Number(rows[0]!.n);
  },
};

/**
 * Public parking id like `PUN-000007` — city code (first 3 letters, uppercase)
 * + zero-padded running number. Unique constraint enforces correctness.
 */
export function buildParkingId(city: string, sequence: number): string {
  const prefix =
    city
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3) || "PKG";
  return `${prefix}-${String(sequence).padStart(6, "0")}`;
}
