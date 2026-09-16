/**
 * SQL data access for parking sessions (docs/DATABASE.md §2.13).
 * Converts confirmed reservations into operational parking sessions with
 * entry/exit lifecycle and slot occupancy management.
 *
 * Ownership is enforced in SQL (docs/SECURITY.md §5, IDOR resistance): a
 * session can only ever be resolved by the user who owns the reservation or
 * the verified operator who owns the facility. Misses surface as 404.
 */
import type { Pool, PoolClient } from "pg";
import { createHash, randomBytes } from "node:crypto";
import type { ParkingSession, ParkingSessionStatus } from "@smartpark/shared";
import { conflict } from "../../http/errors.js";

export interface ParkingSessionRow {
  id: number;
  reservationId: number;
  facilityId: number;
  slotId: number;
  userId: number;
  entryAt: Date;
  exitAt: Date | null;
  status: ParkingSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface ParkingSessionResult {
  id: string;
  reservation_id: string;
  facility_id: string;
  slot_id: string;
  user_id: string;
  entry_at: Date;
  exit_at: Date | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** Anything that can run a parameterized query (Pool or PoolClient). */
type Queryable = Pick<Pool, "query">;

function mapSession(row: ParkingSessionResult): ParkingSessionRow {
  return {
    id: Number(row.id),
    reservationId: Number(row.reservation_id),
    facilityId: Number(row.facility_id),
    slotId: Number(row.slot_id),
    userId: Number(row.user_id),
    entryAt: row.entry_at,
    exitAt: row.exit_at,
    status: row.status as ParkingSessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSessionDto(row: ParkingSessionRow): ParkingSession {
  return {
    id: row.id,
    reservationId: row.reservationId,
    facilityId: row.facilityId,
    slotId: row.slotId,
    userId: row.userId,
    entryAt: row.entryAt.toISOString(),
    exitAt: row.exitAt ? row.exitAt.toISOString() : null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id, reservation_id, facility_id, slot_id, user_id,
  entry_at, exit_at, status, created_at, updated_at`;

/** Same columns but table-qualified for queries that join other tables. */
const SELECT_COLUMNS_QUALIFIED = `
  s.id, s.reservation_id, s.facility_id, s.slot_id, s.user_id,
  s.entry_at, s.exit_at, s.status, s.created_at, s.updated_at`;

/**
 * Looks up a reservation for entry by code, enforcing ownership: the caller
 * must be the reservation owner (user) or the verified operator who owns the
 * facility. Row-locked (FOR UPDATE OF r) so concurrent entry requests
 * serialize on the same reservation and cannot both observe the pre-entry state.
 *
 * Also returns the reservation's time window + stored parking-pass digest —
 * the token-path entry honors these (TOKEN_NOT_YET_VALID / TOKEN_EXPIRED)
 * while the reference path intentionally does not (existing tests use
 * historical windows, docs/API_SPEC.md §2 parking-sessions).
 */
export async function findReservationForEntry(
  client: PoolClient,
  code: string,
  userId: number,
  operatorId: number | null,
): Promise<EntryReservationResult | undefined> {
  const { rows } = await client.query<{
    id: string;
    user_id: string;
    facility_id: string;
    slot_id: string | null;
    state: string;
    starts_at: Date;
    ends_at: Date;
    verification_token_hash: string | null;
  }>(
    `SELECT r.id, r.user_id, r.facility_id, r.slot_id, r.state, r.starts_at, r.ends_at,
            r.verification_token_hash
     FROM reservations r
     LEFT JOIN parking_facilities f ON f.id = r.facility_id AND f.deleted_at IS NULL
     WHERE r.reservation_code = $1
       AND r.deleted_at IS NULL
       AND (
         r.user_id = $2
         OR ($3::bigint IS NOT NULL AND f.operator_id = $3)
       )
     FOR UPDATE OF r`,
    [code, userId, operatorId],
  );
  if (!rows[0]) return undefined;
  return {
    id: Number(rows[0].id),
    userId: Number(rows[0].user_id),
    facilityId: Number(rows[0].facility_id),
    slotId: rows[0].slot_id === null ? null : Number(rows[0].slot_id),
    state: rows[0].state as string,
    startsAt: rows[0].starts_at,
    endsAt: rows[0].ends_at,
    verificationTokenHash: rows[0].verification_token_hash,
  };
}

export interface EntryReservationResult {
  id: number;
  userId: number;
  facilityId: number;
  slotId: number | null;
  state: string;
  startsAt: Date;
  endsAt: Date;
  verificationTokenHash: string | null;
}

/**
 * Looks up a reservation by its parking-pass digest (SHA-256), enforcing the
 * same SQL ownership as every other access path. The unique partial index on
 * (verification_token_hash) makes this a fast, list-free probe and prevents
 * token enumeration: a parallel attacker cannot distinguish an unknown digest
 * from another user's reservation (both surface as the same 404 from the
 * caller). Row-locked for the entry transaction.
 */
export async function findReservationByTokenHash(
  client: PoolClient,
  tokenHash: string,
  userId: number,
  operatorId: number | null,
): Promise<EntryReservationResult | undefined> {
  const { rows } = await client.query<{
    id: string;
    user_id: string;
    facility_id: string;
    slot_id: string | null;
    state: string;
    starts_at: Date;
    ends_at: Date;
    verification_token_hash: string | null;
  }>(
    `SELECT r.id, r.user_id, r.facility_id, r.slot_id, r.state, r.starts_at, r.ends_at,
            r.verification_token_hash
     FROM reservations r
     LEFT JOIN parking_facilities f ON f.id = r.facility_id AND f.deleted_at IS NULL
     WHERE r.verification_token_hash = $1
       AND r.deleted_at IS NULL
       AND (
         r.user_id = $2
         OR ($3::bigint IS NOT NULL AND f.operator_id = $3)
       )
     FOR UPDATE OF r`,
    [tokenHash, userId, operatorId],
  );
  if (!rows[0]) return undefined;
  return {
    id: Number(rows[0].id),
    userId: Number(rows[0].user_id),
    facilityId: Number(rows[0].facility_id),
    slotId: rows[0].slot_id === null ? null : Number(rows[0].slot_id),
    state: rows[0].state as string,
    startsAt: rows[0].starts_at,
    endsAt: rows[0].ends_at,
    verificationTokenHash: rows[0].verification_token_hash,
  };
}

/**
 * Looks up a session by id, enforcing ownership: the caller must be the
 * reservation owner or the facility operator. Ownership is enforced in SQL
 * (reservation → facility → operator). Returns undefined on any miss, which
 * the caller surfaces as 404 so unrelated users cannot distinguish a
 * nonexistent session from someone else's (docs/SECURITY.md §5).
 *
 * With `lock = true` the row is FOR UPDATE locked (used inside a transaction
 * for exit) so concurrent exit requests serialize.
 */
export async function findSessionForAccess(
  target: Queryable,
  sessionId: number,
  userId: number,
  operatorId: number | null,
  lock = false,
): Promise<ParkingSessionRow | undefined> {
  const { rows } = await target.query<ParkingSessionResult>(
    `SELECT ${SELECT_COLUMNS_QUALIFIED}
     FROM parking_sessions s
     LEFT JOIN parking_facilities f ON f.id = s.facility_id AND f.deleted_at IS NULL
     WHERE s.id = $1
       AND (
         s.user_id = $2
         OR ($3::bigint IS NOT NULL AND f.operator_id = $3)
       )
     ${lock ? "FOR UPDATE OF s" : ""}`,
    [sessionId, userId, operatorId],
  );
  return rows[0] ? mapSession(rows[0]) : undefined;
}

/**
 * Looks up the most recent session for a reservation by its booking code,
 * enforcing the same ownership the other access paths use: the caller must be
 * the reservation owner or the facility operator. Used by the user "active
 * session" resume path and the operator by-reference check (Phase 9 Block 2).
 * a reservation with no session yet yields undefined, which the caller
 * surfaces as 404 SESSION_NOT_FOUND (no existence disclosure).
 */
export async function findSessionByReservationForAccess(
  target: Queryable,
  reservationCode: string,
  userId: number,
  operatorId: number | null,
): Promise<ParkingSessionRow | undefined> {
  const { rows } = await target.query<ParkingSessionResult>(
    `SELECT ${SELECT_COLUMNS_QUALIFIED}
     FROM parking_sessions s
     JOIN reservations r ON r.id = s.reservation_id AND r.deleted_at IS NULL
     LEFT JOIN parking_facilities f ON f.id = s.facility_id AND f.deleted_at IS NULL
     WHERE r.reservation_code = $1
       AND (
         r.user_id = $2
         OR ($3::bigint IS NOT NULL AND f.operator_id = $3)
       )
     ORDER BY s.entry_at DESC, s.id DESC
     LIMIT 1`,
    [reservationCode, userId, operatorId],
  );
  return rows[0] ? mapSession(rows[0]) : undefined;
}

/**
 * Lists sessions across an operator's facilities, newest entry first. Powers
 * the operator "active parking sessions" panel (Phase 9 Block 2); the caller
 * (sessionsService.listSessionsForOperator) already verified the operator.
 */
export async function listSessionsForOperator(
  target: Queryable,
  operatorId: number,
): Promise<ParkingSessionRow[]> {
  const { rows } = await target.query<ParkingSessionResult>(
    `SELECT ${SELECT_COLUMNS_QUALIFIED}
     FROM parking_sessions s
     JOIN parking_facilities f ON f.id = s.facility_id AND f.deleted_at IS NULL
     WHERE f.operator_id = $1
     ORDER BY s.entry_at DESC, s.id DESC`,
    [operatorId],
  );
  return rows.map(mapSession);
}

/**
 * Maps the two race-relevant 23505 unique violations on active parking sessions
 * to the documented deterministic 409s (docs/API_SPEC.md §2 parking-sessions).
 * The partial unique indexes (active_reservation / active_slot) are the primary
 * concurrency guard; any other violation rethrows as an internal error.
 */
function mapSessionInsertViolation(err: unknown): never {
  if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
    const constraint = (err as { constraint?: string }).constraint;
    if (constraint === "parking_sessions_active_reservation_idx") {
      throw conflict(
        "SESSION_ALREADY_ACTIVE",
        "A parking session is already active for this reservation",
      );
    }
    if (constraint === "parking_sessions_active_slot_idx") {
      throw conflict("SLOT_OCCUPIED", "This parking slot is already occupied");
    }
    if (constraint === "parking_sessions_entry_token_hash_idx") {
      throw conflict("ENTRY_TOKEN_CONFLICT", "This entry token has already been used");
    }
  }
  throw err;
}

/**
 * Inserts a parking session on the given client. The entry_token_hash is the
 * SHA-256 digest of a high-entropy bearer token — the raw token is never
 * stored at rest (docs/DATABASE.md §2.13, docs/SECURITY.md). Concurrent
 * double-entry is resolved by the DB unique indexes, mapped to clean 409s.
 */
export async function insertSession(
  client: PoolClient,
  input: {
    reservationId: number;
    facilityId: number;
    slotId: number;
    userId: number;
    entryTokenHash: string;
  },
): Promise<ParkingSessionRow> {
  try {
    const { rows } = await client.query<ParkingSessionResult>(
      `INSERT INTO parking_sessions
         (reservation_id, facility_id, slot_id, user_id, entry_token_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
       RETURNING ${SELECT_COLUMNS}`,
      [input.reservationId, input.facilityId, input.slotId, input.userId, input.entryTokenHash],
    );
    return mapSession(rows[0]!);
  } catch (err) {
    mapSessionInsertViolation(err);
  }
}

/**
 * Marks a parking session COMPLETED on the given client. Only transitions an
 * ACTIVE session, so a duplicate exit request or an already-completed session
 * is a no-op (the caller decides the error contract from the row returned).
 */
export async function completeSession(
  client: PoolClient,
  sessionId: number,
): Promise<ParkingSessionRow | undefined> {
  const { rows } = await client.query<ParkingSessionResult>(
    `UPDATE parking_sessions
     SET status = 'COMPLETED', exit_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE'
     RETURNING ${SELECT_COLUMNS}`,
    [sessionId],
  );
  return rows[0] ? mapSession(rows[0]) : undefined;
}

/**
 * Marks a parking slot OCCUPIED on the given client. Race-safe: the guarded
 * UPDATE only succeeds when the slot is currently AVAILABLE or RESERVED, so
 * two concurrent entries cannot both occupy the same slot.
 */
export async function occupySlot(
  client: PoolClient,
  slotId: number,
  facilityId: number,
): Promise<{ status: string } | undefined> {
  const { rows } = await client.query(
    `UPDATE parking_slots
     SET status = 'OCCUPIED', updated_at = now()
     WHERE id = $1 AND facility_id = $2 AND deleted_at IS NULL
       AND status IN ('AVAILABLE', 'RESERVED')
     RETURNING status`,
    [slotId, facilityId],
  );
  return rows[0] ? { status: rows[0].status as string } : undefined;
}

/**
 * Releases a parking slot back to AVAILABLE on the given client. Only
 * transitions a currently OCCUPIED slot, preserving any operator-set status
 * (e.g. MAINTENANCE) that may have been applied while the session was active.
 */
export async function releaseSlot(
  client: PoolClient,
  slotId: number,
  facilityId: number,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE parking_slots
     SET status = 'AVAILABLE', updated_at = now()
     WHERE id = $1 AND facility_id = $2 AND deleted_at IS NULL
       AND status = 'OCCUPIED'`,
    [slotId, facilityId],
  );
  return (rowCount ?? 0) > 0;
}

/** Reads a slot's current operational status on the given client. */
export async function currentSlotStatus(
  client: PoolClient,
  slotId: number,
): Promise<string | undefined> {
  const { rows } = await client.query<{ status: string }>(
    `SELECT status FROM parking_slots WHERE id = $1 AND deleted_at IS NULL`,
    [slotId],
  );
  return rows[0]?.status;
}

/**
 * Checks for an existing ACTIVE session for a reservation (defense-in-depth;
 * the partial unique index on active sessions is the primary guard).
 */
export async function hasActiveSessionForReservation(
  client: PoolClient,
  reservationId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM parking_sessions WHERE reservation_id = $1 AND status = 'ACTIVE'`,
    [reservationId],
  );
  return rows.length > 0;
}

/**
 * Checks for an existing ACTIVE session on a slot. Used by the manual
 * occupancy guard (slots.service): an OCCUPIED slot with a live session must
 * not be manually flip-flopped away from OCCUPIED (docs/API_SPEC.md §2 slots).
 */
export async function hasActiveSessionForSlot(
  client: PoolClient,
  slotId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM parking_sessions WHERE slot_id = $1 AND status = 'ACTIVE'`,
    [slotId],
  );
  return rows.length > 0;
}

/**
 * Updates a reservation's lifecycle state on the given client.
 * Kept in this module so the session service owns its state transitions
 * (CONFIRMED → ACTIVE on entry, ACTIVE → COMPLETED on exit).
 */
export async function updateReservationState(
  client: PoolClient,
  reservationId: number,
  state: string,
): Promise<void> {
  await client.query(
    `UPDATE reservations SET state = $1, updated_at = now()
     WHERE id = $2 AND deleted_at IS NULL`,
    [state, reservationId],
  );
}

/**
 * Upserts the availability engine state cache for a slot (docs/DATABASE.md
 * §2.20), mirroring the slot's operational status so the public availability
 * read reflects the session lifecycle.
 */
export async function upsertAvailabilityState(
  client: PoolClient,
  facilityId: number,
  slotId: number,
  slotStatus: string,
): Promise<void> {
  const engineStatus =
    slotStatus === "OCCUPIED"
      ? "OCCUPIED"
      : slotStatus === "RESERVED"
        ? "RESERVED"
        : slotStatus === "AVAILABLE"
          ? "AVAILABLE"
          : "UNKNOWN";
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

/** SHA-256 digest of the raw entry token (only this is stored at rest). */
export function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** High-entropy one-time entry token: `ses_` + 24 random bytes in hex. */
export function generateEntryToken(): string {
  return `ses_${randomBytes(24).toString("hex")}`;
}
