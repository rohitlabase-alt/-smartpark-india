/**
 * SQL data access for reservations/bookings (docs/DATABASE.md §2.12).
 * Phase 2C: booking CRUD + lifecycle with DB-level double-booking protection.
 */
import type { PoolClient } from "pg";
import type { PaymentStatus, Reservation, ReservationState } from "@smartpark/shared";
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
  amount: number | null;
  paymentStatus: PaymentStatus | null;
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
  amount: string | null;
  payment_status: string | null;
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
    amount: row.amount === null ? null : Number(row.amount),
    paymentStatus: (row.payment_status as PaymentStatus | null) ?? null,
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
    amount: row.amount,
    paymentStatus: row.paymentStatus,
    cancelReason: row.cancelReason,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id, reservation_code, user_id, facility_id, zone_id, slot_id,
  starts_at, ends_at, state, amount, payment_status, cancel_reason,
  cancelled_at, confirmed_at, created_at, updated_at`;

const OPERATOR_SELECT_COLUMNS = `
  r.id, r.reservation_code, r.user_id, r.facility_id, r.zone_id, r.slot_id,
  r.starts_at, r.ends_at, r.state, r.amount, r.payment_status, r.cancel_reason,
  r.cancelled_at, r.confirmed_at, r.created_at, r.updated_at`;

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
   * Inserts a PENDING_PAYMENT reservation on the given transaction, carrying
   * the computed amount and a pre-payment payment_status ('INITIATED'). The
   * DB exclusion constraint (docs/DATABASE.md §2.12) blocks any overlapping
   * PENDING_PAYMENT/CONFIRMED/ACTIVE reservation on the same slot — this is
   * the primary, race-safe double-booking guard and also protects the slot
   * while payment is pending.
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
      amount: number;
    },
  ): Promise<ReservationRow> {
    try {
      const { rows } = await client.query<ReservationResult>(
        `INSERT INTO reservations
           (reservation_code, user_id, facility_id, slot_id, starts_at, ends_at,
            state, amount, payment_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_PAYMENT', $7, 'INITIATED')
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.reservationCode,
          input.userId,
          input.facilityId,
          input.slotId,
          input.startsAt,
          input.endsAt,
          input.amount,
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

  /** A user's own reservation code lookup on a transaction, row-locked. */
  async findByCodeForUserTx(
    client: PoolClient,
    code: string,
    userId: number,
  ): Promise<ReservationRow | undefined> {
    const { rows } = await client.query<ReservationResult>(
      `SELECT ${SELECT_COLUMNS} FROM reservations
       WHERE reservation_code = $1 AND user_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
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
   * Operator-scoped reservation lookup by its (non-user-controlled) code for a
   * cancellation transaction. Ownership is enforced in SQL (reservation →
   * facility → operator, docs/SECURITY.md §5 IDOR): an operator can only ever
   * resolve reservations in facilities they own, and a miss surfaces as 404.
   * The row is locked (FOR UPDATE OF r) so concurrent cancellation requests
   * serialize and cannot both observe the pre-cancellation state.
   */
  async findByCodeForOperator(
    code: string,
    operatorId: number,
    client: PoolClient,
  ): Promise<ReservationRow | undefined> {
    const { rows } = await client.query<ReservationResult>(
      `SELECT ${OPERATOR_SELECT_COLUMNS}
       FROM reservations r
       JOIN parking_facilities f ON f.id = r.facility_id
       WHERE r.reservation_code = $1
         AND f.operator_id = $2
         AND f.deleted_at IS NULL
         AND r.deleted_at IS NULL
       FOR UPDATE OF r`,
      [code, operatorId],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },

  /**
   * Updates a reservation's lifecycle fields on the given transaction. Only
   * provided fields are written (null explicitly clears a nullable column);
   * omitted fields are left untouched. Returns the updated row, or undefined
   * if the id no longer exists.
   */
  async updateState(
    client: PoolClient,
    id: number,
    fields: {
      state: ReservationState;
      paymentStatus?: PaymentStatus | null;
      cancelReason?: string | null;
      cancelledAt?: Date | null;
      confirmedAt?: Date | null;
    },
  ): Promise<ReservationRow | undefined> {
    const sets: Array<[string, unknown]> = [["state", fields.state]];
    if (fields.paymentStatus !== undefined) sets.push(["payment_status", fields.paymentStatus]);
    if (fields.cancelReason !== undefined) sets.push(["cancel_reason", fields.cancelReason]);
    if (fields.cancelledAt !== undefined) sets.push(["cancelled_at", fields.cancelledAt]);
    if (fields.confirmedAt !== undefined) sets.push(["confirmed_at", fields.confirmedAt]);
    const assignments = sets.map(([col], i) => `${col} = $${i + 1}`);
    const values = sets.map(([, val]) => val);
    const { rows } = await client.query<ReservationResult>(
      `UPDATE reservations SET ${assignments.join(", ")}, updated_at = now()
       WHERE id = $${values.length + 1} AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [...values, id],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },

  /**
   * Confirms a PENDING_PAYMENT reservation on payment success (Phase 7):
   * state → CONFIRMED, payment_status → SUCCESS, confirmed_at set. The row is
   * row-locked (FOR UPDATE) so concurrent verifies serialize; the guards are
   * re-checked after the lock so a stale read cannot double-confirm.
   */
  async confirmOnPayment(client: PoolClient, id: number): Promise<ReservationRow | undefined> {
    const existing = await this.findByIdTx(client, id);
    if (!existing) return undefined;
    if (existing.state !== "PENDING_PAYMENT") return existing;
    const { rows } = await client.query<ReservationResult>(
      `UPDATE reservations
       SET state = 'CONFIRMED',
           payment_status = 'SUCCESS',
           confirmed_at = now(),
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [id],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },

  /** Row-locked reservation lookup by numeric id on a transaction. */
  async findByIdTx(client: PoolClient, id: number): Promise<ReservationRow | undefined> {
    const { rows } = await client.query<ReservationResult>(
      `SELECT ${SELECT_COLUMNS} FROM reservations
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [id],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },

  /** Marks a reservation as FAILED on the given transaction. */
  async markFailed(client: PoolClient, id: number): Promise<ReservationRow | undefined> {
    const { rows } = await client.query<ReservationResult>(
      `UPDATE reservations
       SET state = 'FAILED',
           updated_at = now()
       WHERE id = $1 AND state = 'PENDING_PAYMENT' AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [id],
    );
    return rows[0] ? mapReservation(rows[0]) : undefined;
  },
};

export { withTransaction };
