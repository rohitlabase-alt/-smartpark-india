/**
 * Operator application logic (docs/API_SPEC.md §2 operators).
 * Registration is self-serve foundation: the authenticated user becomes the
 * owner of a PENDING operator org and gains the PARKING_OPERATOR role.
 * Admin verification/approval lands in a later phase.
 */
import type {
  BookingListResponse,
  BookingResponse,
  Operator,
  OperatorRegisterRequest,
} from "@smartpark/shared";
import { conflict, notFound, unprocessable } from "../../http/errors.js";
import { assignRole } from "../auth/auth.repository.js";
import { withTransaction } from "../../db.js";
import { operatorsRepository, toOperatorDto } from "./operators.repository.js";
import { reservationsRepository, toReservationDto } from "../bookings/reservations.repository.js";

export const operatorsService = {
  async registerOperator(userId: number, input: OperatorRegisterRequest): Promise<Operator> {
    const operator = await withTransaction(async (client) => {
      const created = await operatorsRepository.create({
        ownerUserId: userId,
        name: input.name.trim(),
        businessType: input.businessType?.trim() ?? null,
        registrationNumber: input.registrationNumber?.trim() ?? null,
      });
      await assignRole(userId, "PARKING_OPERATOR", client);
      return created;
    });
    return toOperatorDto(operator);
  },

  async getOwnOperator(userId: number): Promise<Operator> {
    const operator = await operatorsRepository.findByOwnerUser(userId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
    }
    return toOperatorDto(operator);
  },

  async listOperatorReservations(userId: number): Promise<BookingListResponse> {
    const operator = await operatorsRepository.findByOwnerUser(userId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
    }
    const rows = await reservationsRepository.listByOperator(operator.id);
    return { reservations: rows.map(toReservationDto) };
  },

  /**
   * Cancels a reservation in one of the operator's own facilities by code.
   * Transactional and race-safe: ownership is enforced in SQL (never fetched
   * by id and trusted), the row is locked for the duration, and the lifecycle
   * guards mirror customer cancellation in Phase 2C. A reservation that is not
   * in an operator-owned facility surfaces as 404 (no existence disclosure).
   */
  async cancelOperatorReservation(
    userId: number,
    code: string,
    reason?: string,
  ): Promise<BookingResponse> {
    const operator = await operatorsRepository.findByOwnerUser(userId);
    if (!operator) {
      throw notFound("OPERATOR_NOT_FOUND", "No parking operator registered for this account");
    }
    return withTransaction(async (client) => {
      const existing = await reservationsRepository.findByCodeForOperator(
        code,
        operator.id,
        client,
      );
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
