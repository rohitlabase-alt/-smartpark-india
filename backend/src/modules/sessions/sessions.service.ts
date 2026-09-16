/**
 * Parking session application logic (docs/API_SPEC.md §2 parking-sessions,
 * docs/DATABASE.md §2.13). Phase 9 Block 1: the entry/exit foundation that
 * turns paid/confirmed reservations into operational parking sessions.
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
 * the facility. Ownership is enforced in SQL; any miss surfaces as 404 so
 * unrelated users cannot distinguish a nonexistent session from another's.
 */
import type { UserRoleCode } from "@smartpark/shared";
import type {
  ParkingSessionEntryResponse,
  ParkingSessionListResponse,
  ParkingSessionResponse,
} from "@smartpark/shared";
import { withTransaction, getPool } from "../../db.js";
import { conflict, notFound } from "../../http/errors.js";
import { operatorsRepository } from "../operators/operators.repository.js";
import { assertVerifiedOperator } from "../operators/operator-verification.js";
import { facilitiesRepository } from "../parking/facilities.repository.js";
import { slotsRepository } from "../parking/slots.repository.js";
import { auditService } from "../audit/audit.service.js";
import {
  completeSession,
  currentSlotStatus,
  findReservationForEntry,
  findSessionByReservationForAccess,
  findSessionForAccess,
  generateEntryToken,
  hasActiveSessionForReservation,
  insertSession,
  listSessionsForOperator,
  occupySlot,
  releaseSlot,
  sha256hex,
  toSessionDto,
  updateReservationState,
  upsertAvailabilityState,
} from "./sessions.repository.js";

/** Entry only applies to reservations with an assigned (bookable) slot. */

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

export const sessionsService = {
  /**
   * Entry: converts a paid/confirmed reservation into an ACTIVE parking
   * session. Atomic transaction — reservation state, slot occupancy,
   * availability cache and audit record commit or roll back together.
   */
  async enterParking(
    userId: number,
    roles: UserRoleCode[],
    reservationCode: string,
  ): Promise<ParkingSessionEntryResponse> {
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
        throw conflict("SLOT_OCCUPIED", "This parking slot is already occupied");
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
        },
      });

      return { session: toSessionDto(session), entryToken };
    });
  },

  /**
   * Exit: completes an ACTIVE parking session and releases the slot.
   * Atomic — session status, slot occupancy, availability cache, reservation
   * state and audit record commit or roll back together.
   */
  async exitParking(
    userId: number,
    roles: UserRoleCode[],
    sessionId: number,
  ): Promise<ParkingSessionResponse> {
    const operatorId = await resolveOperatorId(userId, roles);
    return withTransaction(async (client) => {
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
        },
      });

      return { session: toSessionDto(completed) };
    });
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
};
