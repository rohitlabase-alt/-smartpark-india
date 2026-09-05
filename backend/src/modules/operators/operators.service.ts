/**
 * Operator application logic (docs/API_SPEC.md §2 operators).
 * Registration is self-serve foundation: the authenticated user becomes the
 * owner of a PENDING operator org and gains the PARKING_OPERATOR role.
 * Admin verification/approval lands in a later phase.
 */
import type { BookingListResponse, Operator, OperatorRegisterRequest } from "@smartpark/shared";
import { notFound } from "../../http/errors.js";
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
};
