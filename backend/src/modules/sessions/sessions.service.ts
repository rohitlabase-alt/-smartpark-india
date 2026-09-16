/**
 * Parking session application logic (docs/API_SPEC.md §2 parking-sessions,
 * docs/DATABASE.md §2.13). Phase 9 Block 1: the entry/exit foundation; Phase
 * 9 Block 3: gate verification — booking-reference and parking-pass token
 * entry, deterministic pass issuance, and rejection auditing.
 *
 * Lifecycle (docs/ROADMAP.md PHASE 9):
 *   RESERVATION (CONFIRMED) --entry--> SESSION (ACTIVE) --exit--> SESSION (COMPLETED)
 *
 * Operational effects (all inside one transaction with an audit record):
 *   - reservation state:  CONFIRMED -> ACTIVE (entry), ACTIVE -> COMPLETED (exit)
 *   - slot status:        AVAILABLE/RESERVED -> OCCUPIED (entry), OCCUPIED -> AVAILABLE (exit)
 *   - availability cache: mirrored to match the slot's operational status
 *
 * Authorization (docs/SECURITY.md §5, IDOR resistance): a session can be
 * entered/exited/read by the reservation owner OR a VERIFIED operator who owns
 * the facility. The parking-pass token alone is never enough — ownership is
 * always enforced in SQL, so unrelated users cannot distinguish a nonexistent
 * reservation from someone else's (both surface as 404). Admins have no
 * session-impersonation path; the platform admin surface is separate.
 *
 * Concurrency: entry serializes on the reservation row lock (FOR UPDATE),
 * the guarded slot UPDATE (AVAILABLE/RESERVED -> OCCUPIED), and the partial
 * unique indexes on ACTIVE sessions. Postgres 23505 violations on those
 * indexes are mapped to deterministic 409s — never a JavaScript-only guard.
 *
 * Token-path time windows (TOKEN_NOT_YET_VALID / TOKEN_EXPIRED) are enforced
 * ONLY for verification-token entry. The reservationCode path intentionally
 * does not enforce time windows because existing suites use historical test
 * dates (docs/API_SPEC.md §2 parking-sessions).
 */
import type { UserRoleCode } from "@smartpark/shared";
import type {
  ParkingPassResponse,
  ParkingSessionEntryRequest,
  ParkingSessionEntryResponse,
  ParkingSessionListResponse,
  ParkingSessionResponse,
} from "@smartpark/shared";
import { withTransaction, getPool } from "../../db.js";
import { conflict, HttpError, notFound } from "../../http/errors.js";
import type { PoolClient } from "pg";
import { operatorsRepository } from "../operators/operators.repository.js";
import { assertVerifiedOperator } from "../operators/operator-verification.js";
import { facilitiesRepository } from "../parking/facilities.repository.js";
import { slotsRepository } from "../parking/slots.repository.js";
import { reservationsRepository } from "../bookings/reservations.repository.js";
import { auditService } from "../audit/audit.service.js";
import {
  hashParkingPassToken,
  signParkingPassToken,
  verifyParkingPassToken,
} from "./pass-token.js";
import {
  cancelSession,
  completeSession,
  currentSlotStatus,
  findReservationByTokenHash,
  findReservationForEntry,
  findSessionByReservationForAccess,
  findSessionForAccess,
  findSessionForOperator,
  generateEntryToken,
  hasActiveSessionForReservation,
  insertSession,
  listSessionsForOperator,
  lockReservationForUpdate,
  occupySlot,
  releaseSlot,
  sha256hex,
  toSessionDto,
  updateReservationState,
  upsertAvailabilityState,
  type EntryReservationResult,
} from "./sessions.repository.js";

function isTokenCredential(
  credential: ParkingSessionEntryRequest,
): credential is { verificationToken: string } {
  return "verificationToken" in credential;
}

/**
 * Resolves a caller's VERIFIED operator id for session operations. A caller
 * with the PARKING_OPERATOR role but an unverified/missing org resolves to
 * null — the owner path may still apply, and the SQL ownership join then
 * simply has no operator branch (no existence disclosure).
 */
async function resolveOperatorId(userId: number, roles: UserRoleCode[]): Promise<number | null> {
  if (!roles.includes("PARKING_OPERATOR")) return null;
  const operator = await operatorsRepository.findByOwnerUser(userId);
  if (!operator || operator.verificationStatus !== "VERIFIED") return null;
  return operator.id;
}

/**
 * Verifies the facility is VERIFIED + ACTIVE and the reservation's slot exists,
 * belongs to that facility, and accepts reservations. Returns the slot id.
 */
async function assertEntryableSlot(reservation: {
  facilityId: number;
  slotId: number | null;
}): Promise<number> {
  if (reservation.slotId === null) {
    throw conflict("SLOT_NOT_ASSIGNED", "This reservation has no assigned parking slot");
  }
  const facility = await facilitiesRepository.findById(reservation.facilityId);
  if (!facility || facility.verificationStatus !== "VERIFIED" || !facility.isActive) {
    throw conflict("FACILITY_NOT_ENTRYABLE", "This facility is not accepting vehicles");
  }
  const slot = await slotsRepository.findById(reservation.slotId);
  if (!slot || slot.facilityId !== reservation.facilityId) {
    throw conflict("SLOT_NOT_FOUND", "The assigned parking slot no longer exists");
  }
  if (!slot.reservationsEnabled) {
    throw conflict("SLOT_NOT_ENTRYABLE", "The assigned parking slot is not accepting vehicles");
  }
  return slot.id;
}

/** Token-path window enforcement (reference path intentionally skips this). */
function assertPassWindow(reservation: { startsAt: Date; endsAt: Date }): void {
  const now = Date.now();
  if (reservation.startsAt.getTime() > now) {
    throw conflict("TOKEN_NOT_YET_VALID", "This parking pass is not valid yet");
  }
  if (reservation.endsAt.getTime() <= now) {
    throw conflict("TOKEN_EXPIRED", "This parking pass has expired");
  }
}

export const sessionsService = {
  /**
   * Entry: converts a paid/confirmed reservation into an ACTIVE parking
   * session. Accepts exactly ONE credential — a booking reference or a
   * parking-pass verification token (the schema enforces the exclusive-or).
   * Atomic transaction — reservation state, slot occupancy, availability
   * cache and audit record commit or roll back together.
   *
   * Token path: verifies the JWT signature/scope/expiry, hashes the supplied
   * token, looks the reservation up BY HASH (ownership-scoped), then runs the
   * same entry transaction. Token-path rejections are written as
   * GATE_ENTRY_REJECTED in a SEPARATE transaction because the business
   * transaction rolls back when the request throws.
   */
  async enterParking(
    userId: number,
    roles: UserRoleCode[],
    credential: ParkingSessionEntryRequest,
  ): Promise<ParkingSessionEntryResponse> {
    const operatorId = await resolveOperatorId(userId, roles);
    if (isTokenCredential(credential)) {
      return this.enterByToken(userId, operatorId, credential.verificationToken);
    }
    return this.enterByReference(userId, operatorId, credential.reservationCode);
  },

  /** Reference-entry path: unchanged business behavior (+ verification flag). */
  async enterByReference(
    userId: number,
    operatorId: number | null,
    reservationCode: string,
  ): Promise<ParkingSessionEntryResponse> {
    return withTransaction(async (client) => {
      const reservation = await findReservationForEntry(
        client,
        reservationCode,
        userId,
        operatorId,
      );
      if (!reservation) {
        throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      }
      return this.runEntry(client, userId, operatorId, reservation, "reservation-code");
    });
  },

  /** Token-entry path: verify → hash-lookup → legacy backfill → entry. */
  async enterByToken(
    userId: number,
    operatorId: number | null,
    token: string,
  ): Promise<ParkingSessionEntryResponse> {
    try {
      return await withTransaction(async (client) => {
        const { reservationCode } = await verifyParkingPassToken(token);
        const tokenHash = hashParkingPassToken(token);

        // Primary lookup is by the token digest — fast, ownership-scoped probe
        // that never compares raw tokens (docs/SECURITY.md).
        const byHash = await findReservationByTokenHash(client, tokenHash, userId, operatorId);
        let reservation = byHash;

        if (!reservation) {
          // Pre-migration confirmations stored no digest. The deterministic
          // token lets us fall back to the ownership-scoped code lookup and
          // verify/backfill the stored hash — an attacker without a valid
          // signature can never reach this branch (no enumeration).
          const byCode = await findReservationForEntry(client, reservationCode, userId, operatorId);
          if (!byCode) {
            throw notFound("BOOKING_NOT_FOUND", "Booking not found");
          }
          if (byCode.verificationTokenHash !== null && byCode.verificationTokenHash !== tokenHash) {
            throw conflict("INVALID_TOKEN", "This parking pass is invalid");
          }
          if (byCode.verificationTokenHash === null) {
            await reservationsRepository.persistVerificationTokenHash(client, byCode.id, tokenHash);
          }
          reservation = byCode;
        }

        assertPassWindow(reservation);
        return this.runEntry(client, userId, operatorId, reservation, "gate-token");
      });
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        await this.auditGateRejection("GATE_ENTRY_REJECTED", userId, err);
      }
      throw err;
    }
  },

  /**
   * Shared transactional entry steps. `verification` records HOW the caller
   * proved the booking ("gate-token" vs "reservation-code") in the audit
   * metadata. Slot contention is mapped: an OCCUPIED slot yields
   * SLOT_OCCUPIED, any other unusable slot SLOT_UNAVAILABLE.
   */
  async runEntry(
    client: PoolClient,
    userId: number,
    operatorId: number | null,
    reservation: EntryReservationResult,
    verification: "gate-token" | "reservation-code",
  ): Promise<ParkingSessionEntryResponse> {
    if (await hasActiveSessionForReservation(client, reservation.id)) {
      throw conflict(
        "SESSION_ALREADY_ACTIVE",
        "A parking session is already active for this reservation",
      );
    }
    if (reservation.state !== "CONFIRMED") {
      throw conflict(
        "RESERVATION_NOT_ENTRYABLE",
        `Reservation is not ready for entry (current state: ${reservation.state})`,
      );
    }

    const slotId = await assertEntryableSlot(reservation);
    if (!(await occupySlot(client, slotId, reservation.facilityId))) {
      const status = await currentSlotStatus(client, slotId);
      if (status === "OCCUPIED") {
        throw conflict("SLOT_OCCUPIED", "This parking slot is already occupied");
      }
      throw conflict("SLOT_UNAVAILABLE", "This parking slot is not currently available for entry");
    }

    await updateReservationState(client, reservation.id, "ACTIVE");

    const entryToken = generateEntryToken();
    const session = await insertSession(client, {
      reservationId: reservation.id,
      facilityId: reservation.facilityId,
      slotId,
      userId: reservation.userId,
      entryTokenHash: sha256hex(entryToken),
    });

    await upsertAvailabilityState(client, reservation.facilityId, slotId, "OCCUPIED");

    await auditService.createEvent(client, {
      actorUserId: userId,
      action: "PARKING_SESSION_ENTRY",
      entityType: "PARKING_SESSION",
      entityId: session.id,
      metadata: {
        facilityId: reservation.facilityId,
        slotId,
        reservationId: reservation.id,
        enteredBy: operatorId !== null ? "OPERATOR" : "CUSTOMER",
        verification,
      },
    });

    return { session: toSessionDto(session), entryToken };
  },

  /**
   * Writes a gate rejection audit in its OWN transaction. The business entry
   * transaction has rolled back when this is called, so the audit commits
   * independently. Metadata carries only the reason — never tokens, digests,
   * passwords or secrets (auditService.sanitizeMetadata enforces this).
   */
  async auditGateRejection(
    action: "GATE_ENTRY_REJECTED" | "GATE_EXIT_REJECTED",
    userId: number,
    cause: HttpError,
    entityId?: number,
  ): Promise<void> {
    await withTransaction(async (client) => {
      await auditService.createEvent(client, {
        actorUserId: userId,
        action,
        entityType: action === "GATE_EXIT_REJECTED" ? "PARKING_SESSION" : "RESERVATION",
        entityId,
        metadata: { reason: cause.code },
      });
    });
  },

  /**
   * Exit: completes an ACTIVE parking session and releases the slot.
   * Atomic — session status, slot occupancy, availability cache, reservation
   * state and audit record commit or roll back together. Duplicate or foreign
   * exits stay deterministic (409 SESSION_NOT_ACTIVE / 404 SESSION_NOT_FOUND);
   * the duplicate-exit conflict is additionally recorded as GATE_EXIT_REJECTED.
   */
  async exitParking(
    userId: number,
    roles: UserRoleCode[],
    sessionId: number,
  ): Promise<ParkingSessionResponse> {
    const operatorId = await resolveOperatorId(userId, roles);
    try {
      return await withTransaction(async (client) => {
        const session = await findSessionForAccess(client, sessionId, userId, operatorId, true);
        if (!session) {
          throw notFound("SESSION_NOT_FOUND", "Parking session not found");
        }
        if (session.status !== "ACTIVE") {
          throw conflict("SESSION_NOT_ACTIVE", "This parking session is not active");
        }

        const released = await releaseSlot(client, session.slotId, session.facilityId);
        const finalSlotStatus = released
          ? "AVAILABLE"
          : ((await currentSlotStatus(client, session.slotId)) ?? "AVAILABLE");

        const completed = await completeSession(client, session.id);
        if (!completed) {
          throw conflict("SESSION_NOT_ACTIVE", "This parking session is not active");
        }

        await updateReservationState(client, session.reservationId, "COMPLETED");
        await upsertAvailabilityState(client, session.facilityId, session.slotId, finalSlotStatus);

        await auditService.createEvent(client, {
          actorUserId: userId,
          action: "PARKING_SESSION_EXIT",
          entityType: "PARKING_SESSION",
          entityId: session.id,
          metadata: {
            facilityId: session.facilityId,
            slotId: session.slotId,
            reservationId: session.reservationId,
            exitedBy: operatorId !== null ? "OPERATOR" : "CUSTOMER",
            slotReleased: released,
          },
        });

        return { session: toSessionDto(completed) };
      });
    } catch (err) {
      if (err instanceof HttpError && err.code === "SESSION_NOT_ACTIVE") {
        await this.auditGateRejection("GATE_EXIT_REJECTED", userId, err, sessionId);
      }
      throw err;
    }
  },

  /**
   * Read: a session by id, access-checked (owner or facility operator). The
   * entry token is never returned — it is a one-time bearer credential.
   */
  async getSession(
    userId: number,
    roles: UserRoleCode[],
    sessionId: number,
  ): Promise<ParkingSessionResponse> {
    const operatorId = await resolveOperatorId(userId, roles);
    const session = await findSessionForAccess(getPool(), sessionId, userId, operatorId);
    if (!session) {
      throw notFound("SESSION_NOT_FOUND", "Parking session not found");
    }
    return { session: toSessionDto(session) };
  },

  /**
   * Read: the most recent session for a booking code, access-checked (owner or
   * facility operator). Lets a user resume their active session — and exit it —
   * after a reload, and lets an operator confirm a vehicle's on-site state by
   * reference (Phase 9 Block 2). A reservation the caller cannot access is
   * indistinguishable from a nonexistent one (404, no existence disclosure).
   */
  async getSessionByReservation(
    userId: number,
    roles: UserRoleCode[],
    reservationCode: string,
  ): Promise<ParkingSessionResponse> {
    const operatorId = await resolveOperatorId(userId, roles);
    const session = await findSessionByReservationForAccess(
      getPool(),
      reservationCode,
      userId,
      operatorId,
    );
    if (!session) {
      throw notFound("SESSION_NOT_FOUND", "No parking session found for this reservation");
    }
    return { session: toSessionDto(session) };
  },

  /**
   * Read: the parking-pass verification token for a confirmed reservation.
   * Access: reservation owner or a VERIFIED operator of its facility (same SQL
   * ownership as every other access path — unrelated users get 404). The token
   * is deterministic, so this never "regenerates" a different pass; if the
   * stored digest is missing (pre-migration confirmation) it is backfilled
   * from the same deterministic value. The raw token is never logged or audited.
   */
  async getParkingPass(
    userId: number,
    roles: UserRoleCode[],
    reservationCode: string,
  ): Promise<ParkingPassResponse> {
    const operatorId = await resolveOperatorId(userId, roles);
    return withTransaction(async (client) => {
      const reservation = await findReservationForEntry(
        client,
        reservationCode,
        userId,
        operatorId,
      );
      if (!reservation) {
        throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      }
      if (reservation.state !== "CONFIRMED") {
        throw conflict(
          "RESERVATION_NOT_ENTRYABLE",
          `Reservation is not ready for entry (current state: ${reservation.state})`,
        );
      }
      if (reservation.verificationTokenHash === null) {
        const backfillToken = await signParkingPassToken(reservationCode, reservation.endsAt);
        await reservationsRepository.persistVerificationTokenHash(
          client,
          reservation.id,
          hashParkingPassToken(backfillToken),
        );
      }
      const verificationToken = await signParkingPassToken(reservationCode, reservation.endsAt);
      return { verificationToken };
    });
  },

  /**
   * Read: sessions across the caller's VERIFIED operator facilities (newest
   * entry first). Backs the operator "active parking sessions" panel; exit
   * still goes through the access-checked /:id/exit path. Shares the facility
   * gate (403 OPERATOR_NOT_VERIFIED) with the other operator actions.
   */
  async listSessionsForOperator(userId: number): Promise<ParkingSessionListResponse> {
    const operator = await assertVerifiedOperator(userId);
    const sessions = await listSessionsForOperator(getPool(), operator.id);
    return { sessions: sessions.map(toSessionDto) };
  },

  /**
   * Force-exit / session cancellation (Phase 9 Block 4.2). Ends an ACTIVE
   * parking session for the operator-cancellation path reserved by D-037:
   * the session becomes CANCELLED, its slot is released to AVAILABLE, the
   * reservation transitions ACTIVE → CANCELLED (D-035: no refunds in the
   * mock), the availability cache is re-mirrored and a PARKING_SESSION_CANCELLED
   * audit record is written — all in one transaction.
   *
   * Authorization: ONLY a VERIFIED operator of the session's facility may
   * force-cancel (route gates PARKING_OPERATOR + assertVerifiedOperator; the
   * facility scope is derived server-side in SQL — a frontend facility_id is
   * never accepted). An operator of another facility or the reservation owner
   * gets 404 (no existence disclosure).
   *
   * Concurrency: the session row is FOR UPDATE locked first, then the
   * reservation row, then the slot via the guarded release; the guarded
   * session transition (WHERE status = 'ACTIVE') means exactly one of a normal
   * exit and a force-cancel can win — the loser still reads
   * SESSION_NOT_ACTIVE and its transaction rolls back unchanged. A repeated
   * force-cancel on a COMPLETED/CANCELLED session returns 409 SESSION_NOT_ACTIVE.
   */
  async cancelParkingSession(
    userId: number,
    sessionId: number,
    reason?: string,
  ): Promise<ParkingSessionResponse> {
    const operator = await assertVerifiedOperator(userId);
    return withTransaction(async (client) => {
      const session = await findSessionForOperator(client, sessionId, operator.id);
      if (!session) {
        throw notFound("SESSION_NOT_FOUND", "Parking session not found");
      }
      if (session.status !== "ACTIVE") {
        throw conflict("SESSION_NOT_ACTIVE", "This parking session is not active");
      }

      const reservationState = await lockReservationForUpdate(client, session.reservationId);
      if (reservationState !== "ACTIVE") {
        throw conflict("SESSION_NOT_ACTIVE", "This parking session is not active");
      }

      const released = await releaseSlot(client, session.slotId, session.facilityId);
      const finalSlotStatus = released
        ? "AVAILABLE"
        : ((await currentSlotStatus(client, session.slotId)) ?? "AVAILABLE");

      const cancelled = await cancelSession(client, session.id);
      if (!cancelled) {
        throw conflict("SESSION_NOT_ACTIVE", "This parking session is not active");
      }

      await reservationsRepository.updateState(client, session.reservationId, {
        state: "CANCELLED",
        cancelReason: reason?.trim() || null,
        cancelledAt: new Date(),
      });
      await upsertAvailabilityState(client, session.facilityId, session.slotId, finalSlotStatus);

      const trimmedReason = reason?.trim();
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "PARKING_SESSION_CANCELLED",
        entityType: "PARKING_SESSION",
        entityId: session.id,
        metadata: {
          facilityId: session.facilityId,
          slotId: session.slotId,
          reservationId: session.reservationId,
          cancelledBy: "OPERATOR",
          ...(trimmedReason ? { reason: trimmedReason } : {}),
          slotReleased: released,
        },
      });

      return { session: toSessionDto(cancelled) };
    });
  },
};
