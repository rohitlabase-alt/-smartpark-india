/**
 * SQL data access for reservations/bookings (docs/DATABASE.md §2.12).
 * Phase 2C: booking CRUD + lifecycle with DB-level double-booking protection.
 */
import type { PoolClient } from "pg";
import type { Reservation, ReservationState } from "@smartpark/shared";
import { getPool, withTransaction } from "../../db.js";
import { conflict } from "../../http/errors.js";

export interface ReservationRow {
  id: number;
  reservationCode: string;
  userId: number;
  facilityId: number;
  zoneId: number | null;
  slotId: number | null;
  startsAt: Date;
  endsAt: Date;
  state: ReservationState;
  cancelReason: string | null;
  cancelledAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ReservationResult {
  id: string;
  reservation_code: string;
  user_id: string;
  facility_id: string;
  zone_id: string | null;
  slot_id: string | null;
  starts_at: Date;
  ends_at: Date;
  state: string;
  cancel_reason: string | null;
  cancelled_at: Date | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapReservation(row: ReservationResult): ReservationRow {
  return {
    id: Number(row.id),
    reservationCode: row.reservation_code,
    userId: Number(row.user_id),
    facilityId: Number(row.facility_id),
    zoneId: row.zone_id === null ? null : Number(row.zone_id),
    slotId: row.slot_id === null ? null : Number(row.slot_id),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    state: row.state as ReservationState,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toReservationDto(row: ReservationRow): Reservation {
  return {
    id: row.id,
    reservationCode: row.reservationCode,
    userId: row.userId,
    facilityId: row.facilityId,
    zoneId: row.zoneId,
    slotId: row.slotId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    state: row.state,
    cancelReason: row.cancelReason,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id, reservation_code, user_id, facility_id, zone_id, slot_id,
  starts_at, ends_at, state, cancel_reason, cancelled_at, confirmed_at,
  created_at, updated_at`;

const OPERATOR_SELECT_COLUMNS = `
  r.id, r.reservation_code, r.user_id, r.facility_id, r.zone_id, r.slot_id,
  r.starts_at, r.ends_at, r.state, r.cancel_reason, r.cancelled_at, r.confirmed_at,
  r.created_at, r.updated_at`;

/**
 * Maps the btree_gist exclusion-constraint violation (23P01 on
 * reservations_no_overlap) to the documented 409 RESERVATION_CONFLICT; any
 * other error rethrows (API_SPEC.md §1/§2 reservations).
 */
function mapOverlapViolation(err: unknown): never {
  if (
    err &&
    typeof err === "object" &&
    (err as { code?: string }).code === "23P01" &&
    (err as { constraint?: string }).constraint === "reservations_no_overlap"
  ) {
    throw conflict("RESERVATION_CONFLICT", "This slot is already booked for the requested window");
  }
  throw err;
}

export const reservationsRepository = {
  /**
   * Inserts a CONFIRMED reservation on the given transaction. Overlapping
   * CONFIRMED reservations on the same slot are rejected by the database
   * exclusion constraint (docs/DATABASE.md §2.12) — this is the primary,
   * race-safe double-booking guard.
   */
  async create(
    client: PoolClient,
    input: {
      reservationCode: string;
      userId: number;
      facilityId: number;
      slotId: number | null;
      startsAt: Date;
      endsAt: Date;
    },
  ): Promise<ReservationRow> {
    try {
      const { rows } = await client.query<ReservationResult>(
        `INSERT INTO reservations
           (reservation_code, user_id, facility_id, slot_id, starts_at, ends_at, state, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', now())
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.reservationCode,
          input.userId,
          input.facilityId,
          input.slotId,
          input.startsAt,
          input.endsAt,
        ],
      );
      return mapReservation(rows[0]!);
    } catch (err) {
      mapOverlapViolation(err);
    }
  },

  async findById(id: number): Promise<ReservationRow | undefined> {
    const { rows } = await getPool().query<ReservationResult>(
      `SELECT ${SELECT_COLUMNS} FROM reservations WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },

  /** A user's own reservation by its (non-user-controlled) code. */
  async findByCodeForUser(code: string, userId: number): Promise<ReservationRow | undefined> {
    const { rows } = await getPool().query<ReservationResult>(
      `SELECT ${SELECT_COLUMNS} FROM reservations
       WHERE reservation_code = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [code, userId],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },

  /** A user's own reservation history, newest first. */
  async listByUser(userId: number): Promise<ReservationRow[]> {
    const { rows } = await getPool().query<ReservationResult>(
      `SELECT ${SELECT_COLUMNS} FROM reservations
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY starts_at DESC`,
      [userId],
    );
    return rows.map(mapReservation);
  },

  /** Operator-scoped reservation history; facility ownership is enforced in SQL. */
  async listByOperator(operatorId: number): Promise<ReservationRow[]> {
    const { rows } = await getPool().query<ReservationResult>(
      `SELECT ${OPERATOR_SELECT_COLUMNS}
       FROM reservations r
       JOIN parking_facilities f ON f.id = r.facility_id
       WHERE f.operator_id = $1 AND f.deleted_at IS NULL AND r.deleted_at IS NULL
       ORDER BY r.starts_at DESC`,
      [operatorId],
    );
    return rows.map(mapReservation);
  },

  /**
   * Updates a reservation's lifecycle fields on the given transaction.
   * Returns the updated row, or undefined if the id no longer exists.
   */
  async updateState(
    client: PoolClient,
    id: number,
    fields: { state: ReservationState; cancelReason?: string | null; cancelledAt?: Date | null },
  ): Promise<ReservationRow | undefined> {
    const { rows } = await client.query<ReservationResult>(
      `UPDATE reservations
       SET state = $2,
           cancel_reason = $3,
           cancelled_at = $4,
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [id, fields.state, fields.cancelReason ?? null, fields.cancelledAt ?? null],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },
};

export { withTransaction };
