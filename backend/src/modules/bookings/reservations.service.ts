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
import type { FacilityRow } from "../parking/facilities.repository.js";
import { facilitiesRepository } from "../parking/facilities.repository.js";
import { slotsRepository } from "../parking/slots.repository.js";
import { reservationsRepository, toReservationDto } from "./reservations.repository.js";
import { auditService } from "../audit/audit.service.js";

/** Slot statuses a booking may occupy (docs/DATABASE.md §2.8). */
const BOOKABLE_SLOT_STATUSES = new Set(["AVAILABLE", "RESERVED"]);

/**
 * Documented fallback hourly rate (INR) when a facility's `pricing` JSONB has
 * no usable `hourlyRate`. Phase 7 activates pricing (docs/DECISIONS.md D-035);
 * the JSONB contract mirrors `pricing_rules` §2.9 as `{ hourlyRate }`. A fixed,
 * documented fallback keeps the mock flow deterministic without a pricing
 * engine and without silently inventing per-facility business rules.
 */
export const DEFAULT_MOCK_HOURLY_RATE = 100;

/**
 * Reads an hourly rate (INR/hour) from a facility's `pricing` JSONB. Expected
 * documented shape (D-035): `{ "hourlyRate": <positive number> }`. Returns a
 * positive finite number, or the documented default when absent/invalid.
 */
export function readHourlyRate(pricing: unknown): number {
  if (
    pricing &&
    typeof pricing === "object" &&
    "hourlyRate" in pricing &&
    typeof (pricing as { hourlyRate: unknown }).hourlyRate === "number"
  ) {
    const rate = (pricing as { hourlyRate: number }).hourlyRate;
    if (Number.isFinite(rate) && rate > 0) {
      return rate;
    }
  }
  return DEFAULT_MOCK_HOURLY_RATE;
}

/**
 * Reservation amount (INR), hours-based from the facility's hourlyRate
 * (docs/DATABASE.md §2.9/§2.12). Hours are fractional-real duration rounded up
 * to a whole hour (minimum 1); the result is rounded to 2 decimals to avoid
 * float drift (docs/DECISIONS.md D-008).
 */
export function calculateReservationAmount(
  facility: FacilityRow,
  startsAt: Date,
  endsAt: Date,
): number {
  const hours = Math.max(1, Math.ceil((endsAt.getTime() - startsAt.getTime()) / 3_600_000));
  const rate = readHourlyRate(facility.pricing);
  return Math.round(hours * rate * 100) / 100;
}

function generateReservationCode(): string {
  return `BKG-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export const bookingsService = {
  /**
   * Creates a PENDING_PAYMENT reservation for the authenticated user inside a
   * single transaction. The DB exclusion constraint on (slot_id, [starts_at,
   * ends_at)) — now covering PENDING_PAYMENT/CONFIRMED/ACTIVE — is the primary
   * double-booking guard and the authority on overlap; it also protects the
   * slot while payment is pending. The amount is derived hours-based from the
   * facility's pricing (D-035).
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
    if (!facility || !facility.isActive || facility.verificationStatus !== "VERIFIED") {
      throw notFound("FACILITY_NOT_FOUND", "Parking facility not found");
    }

    const amount = calculateReservationAmount(facility, startsAt, endsAt);

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
        amount,
      });
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "RESERVATION_CREATED",
        entityType: "RESERVATION",
        entityId: created.id,
        metadata: { facilityId: facility.id, slotId, amount },
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
   * PENDING_PAYMENT and CONFIRMED bookings can be cancelled; CANCELLED is a
   * 409 repeat and COMPLETED is non-cancellable (422). No live refund path in
   * the mock: a successful payment's CHARGE transaction is never reversed by
   * cancellation here (docs/DECISIONS.md D-035 documents this).
   */
  async cancelBooking(userId: number, code: string, reason?: string): Promise<BookingResponse> {
    return withTransaction(async (client) => {
      const existing = await reservationsRepository.findByCodeForUserTx(client, code, userId);
      if (!existing) {
        throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      }
      if (existing.state === "CANCELLED") {
        throw conflict("ALREADY_CANCELLED", "This booking is already cancelled");
      }
      if (existing.state === "COMPLETED") {
        throw unprocessable("CANNOT_CANCEL_COMPLETED", "Completed bookings cannot be cancelled");
      }
      if (existing.state !== "PENDING_PAYMENT" && existing.state !== "CONFIRMED") {
        throw conflict("CANNOT_CANCEL", "This booking cannot be cancelled in its current state");
      }
      const updated = await reservationsRepository.updateState(client, existing.id, {
        state: "CANCELLED",
        cancelReason: reason?.trim() || null,
        cancelledAt: new Date(),
      });
      if (!updated) {
        throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      }
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "RESERVATION_CANCELLED",
        entityType: "RESERVATION",
        entityId: existing.id,
        metadata: {
          facilityId: existing.facilityId,
          previousState: existing.state,
          cancelledBy: "CUSTOMER",
        },
      });
      return { reservation: toReservationDto(updated) };
    });
  },
};

export type { BookingListResponse, BookingResponse, Reservation };
