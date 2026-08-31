/**
 * Booking application logic (docs/API_SPEC.md §2 reservations, docs/PRD.md §10).
 * Phase 2C: authenticated booking CRUD + lifecycle (CONFIRMED → CANCELLED /
 * COMPLETED), slot-existence/facility/time validation, and DB-level
 * double-booking protection. Ownership is enforced server-side (docs/SECURITY.md
 * §5 IDOR resistance).
 *
 * Payments, tokens, QR/gate and the paid reservation states are out of scope:
 * a created booking is immediately CONFIRMED (no payment step in this phase)
 * and does not mint tokens.
 */
import { randomBytes } from "node:crypto";
import type {
  BookingListResponse,
  BookingResponse,
  CreateBookingRequest,
  Reservation,
} from "@smartpark/shared";
import { badRequest, conflict, notFound, unprocessable } from "../../http/errors.js";
import { withTransaction } from "../../db.js";
import { facilitiesRepository } from "../parking/facilities.repository.js";
import { slotsRepository } from "../parking/slots.repository.js";
import { reservationsRepository, toReservationDto } from "./reservations.repository.js";

/** Slot statuses a booking may occupy (docs/DATABASE.md §2.8). */
const BOOKABLE_SLOT_STATUSES = new Set(["AVAILABLE", "RESERVED"]);

function generateReservationCode(): string {
  return `BKG-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export const bookingsService = {
  /**
   * Creates a CONFIRMED booking for the authenticated user inside a single
   * transaction. The DB exclusion constraint on (slot_id, [starts_at, ends_at))
   * is the primary double-booking guard and is the authority on overlap.
   */
  async createBooking(userId: number, input: CreateBookingRequest): Promise<BookingResponse> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw badRequest("VALIDATION_ERROR", "startsAt/endsAt must be valid ISO-8601 timestamps");
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw badRequest("VALIDATION_ERROR", "endsAt must be after startsAt");
    }

    const facility = await facilitiesRepository.findById(input.facilityId);
    if (!facility || !facility.isActive) {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }

    return withTransaction(async (client) => {
      let slotId: number | null = null;
      if (input.slotId !== undefined) {
        const slot = await slotsRepository.findById(input.slotId);
        if (!slot) {
          throw notFound("SLOT_NOT_FOUND", "Parking slot not found");
        }
        if (slot.facilityId !== facility.id) {
          throw badRequest("VALIDATION_ERROR", "Slot does not belong to the given facility");
        }
        if (!slot.reservationsEnabled) {
          throw badRequest("VALIDATION_ERROR", "This slot does not accept reservations");
        }
        if (!BOOKABLE_SLOT_STATUSES.has(slot.status)) {
          throw badRequest("SLOT_UNAVAILABLE", "This slot is not available for the requested time");
        }
        slotId = slot.id;
      }

      const created = await reservationsRepository.create(client, {
        reservationCode: generateReservationCode(),
        userId,
        facilityId: facility.id,
        slotId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      });
      return { reservation: toReservationDto(created) };
    });
  },

  async listBookings(userId: number): Promise<BookingListResponse> {
    const rows = await reservationsRepository.listByUser(userId);
    return { reservations: rows.map(toReservationDto) };
  },

  /** A user may only retrieve their own booking (IDOR-safe, 404 on miss). */
  async getBooking(userId: number, code: string): Promise<BookingResponse> {
    const row = await reservationsRepository.findByCodeForUser(code, userId);
    if (!row) {
      throw notFound("BOOKING_NOT_FOUND", "Booking not found");
    }
    return { reservation: toReservationDto(row) };
  },

  /**
   * Cancels a booking the caller owns. Transactional; guards lifecycle state:
   * only CONFIRMED bookings can be cancelled (CANCELLED and COMPLETED are not
   * cancellable). No refund/payment logic in Phase 2C.
   */
  async cancelBooking(userId: number, code: string, reason?: string): Promise<BookingResponse> {
    return withTransaction(async (client) => {
      const existing = await reservationsRepository.findByCodeForUser(code, userId);
      if (!existing) {
        throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      }
      if (existing.state === "CANCELLED") {
        throw conflict("ALREADY_CANCELLED", "This booking is already cancelled");
      }
      if (existing.state === "COMPLETED") {
        throw unprocessable("CANNOT_CANCEL_COMPLETED", "Completed bookings cannot be cancelled");
      }
      const updated = await reservationsRepository.updateState(client, existing.id, {
        state: "CANCELLED",
        cancelReason: reason?.trim() || null,
        cancelledAt: new Date(),
      });
      if (!updated) {
        throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      }
      return { reservation: toReservationDto(updated) };
    });
  },
};

export type { BookingListResponse, BookingResponse, Reservation };
