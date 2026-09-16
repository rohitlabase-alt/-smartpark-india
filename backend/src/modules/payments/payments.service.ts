/**
 * Payment application logic (docs/API_SPEC.md §2 payments, docs/PRD.md §9.1,
 * docs/ROADMAP.md PHASE 7). Implements mock initiate/verify against a
 * PaymentProvider, with the reservation remaining PENDING_PAYMENT until a
 * successful verification confirms it. All state changes for verification run
 * inside one DB transaction so payment and reservation can never drift apart.
 *
 * Idempotency (API_SPEC §6): initiate accepts an Idempotency-Key header; the
 * same (user, key, endpoint) reuses the previously created payment instead of
 * creating a duplicate attempt. Verify is idempotent for an already-SUCCESS
 * payment. Ownership is enforced server-side — a payment is only reachable via
 * its provider txn id combined with the caller's user id (404 on miss).
 */
import type { InitiatePaymentResponse, Payment, VerifyPaymentResponse } from "@smartpark/shared";
import { conflict, notFound } from "../../http/errors.js";
import { withTransaction } from "../../db.js";
import { reservationsRepository, toReservationDto } from "../bookings/reservations.repository.js";
import { MockPaymentProvider } from "./providers/mock-payment-provider.js";
import type { PaymentProvider } from "./providers/payment-provider.js";
import { paymentsRepository, toPaymentDto } from "./payments.repository.js";
import { auditService } from "../audit/audit.service.js";

const INITIATE_ENDPOINT = "payments/initiate";

/** The amount charged is always the reservation's stored amount. */
function reservationAmount(reservation: { amount: number | null }): number {
  if (reservation.amount === null) {
    throw conflict("PAYMENT_UNAVAILABLE", "This reservation has no chargeable amount");
  }
  return reservation.amount;
}

export const paymentsService = {
  /**
   * Initiates a mock payment for a PENDING_PAYMENT reservation. Idempotent
   * under the same user + Idempotency-Key: a repeat returns the existing
   * payment, never a duplicate attempt. The provider transaction id is derived
   * deterministically so re-initiation is stable. Creates the payment row
   * inside a transaction alongside its idempotency-key claim.
   */
  async initiate(
    provider: PaymentProvider,
    userId: number,
    reservationCode: string,
    idempotencyKey?: string,
  ): Promise<InitiatePaymentResponse> {
    if (idempotencyKey) {
      const existing = await paymentsRepository.findPaymentByKey(
        userId,
        idempotencyKey,
        INITIATE_ENDPOINT,
      );
      if (existing) {
        return { payment: toPaymentDto(existing) };
      }
    }

    const reservation = await reservationsRepository.findByCodeForUser(reservationCode, userId);
    if (!reservation) {
      throw notFound("BOOKING_NOT_FOUND", "Booking not found");
    }
    if (reservation.state !== "PENDING_PAYMENT") {
      throw conflict(
        "PAYMENT_NOT_PENDING",
        "Payment is only available while the reservation is pending payment",
      );
    }
    const amount = reservationAmount(reservation);

    const initiated = await provider.initiate(amount, reservation.reservationCode);

    return withTransaction(async (client) => {
      const payment = await paymentsRepository.create(client, {
        reservationId: reservation.id,
        provider: initiated.provider,
        providerTxnId: initiated.providerTxnId,
        amount,
        status: initiated.status,
      });
      if (idempotencyKey) {
        await paymentsRepository.claimIdempotencyKey(client, {
          userId,
          key: idempotencyKey,
          endpoint: INITIATE_ENDPOINT,
          paymentId: payment.id,
        });
      }
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "PAYMENT_INITIATED",
        entityType: "PAYMENT",
        entityId: payment.id,
        metadata: { reservationId: reservation.id, amount, provider: initiated.provider },
      });
      return { payment: toPaymentDto(payment) };
    });
  },

  /**
   * Verifies a mock payment by its provider txn id. Runs in one DB transaction:
   * on SUCCESS the payment → SUCCESS, reservation → CONFIRMED (payment_status
   * SUCCESS) and a CHARGE transaction is recorded; on FAILED the payment →
   * FAILED and the reservation is marked FAILED (never CONFIRMED). Repeated
   * verification of an already-SUCCESS payment is idempotent and returns the
   * same confirmed state. Invalid transitions / ownership → standard 4xx.
   */
  async verify(
    provider: PaymentProvider,
    userId: number,
    providerTxnId: string,
  ): Promise<VerifyPaymentResponse> {
    const result = await provider.verify(providerTxnId);

    return withTransaction(async (client) => {
      const owned = await paymentsRepository.findOwnedByProviderTxnId(
        client,
        providerTxnId,
        userId,
      );
      if (!owned) {
        throw notFound("PAYMENT_NOT_FOUND", "Payment not found");
      }
      const { payment } = owned;
      const reservation = await reservationsRepository.findByIdTx(client, payment.reservationId);
      if (!reservation) {
        throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      }

      // Idempotency: an already-SUCCESS payment simply returns the confirmed
      // state (the reservation should already be CONFIRMED).
      if (payment.status === "SUCCESS") {
        return { payment: toPaymentDto(payment), reservation: toReservationDto(reservation) };
      }
      if (payment.status === "FAILED") {
        throw conflict("PAYMENT_ALREADY_FAILED", "This payment already failed");
      }

      if (result.status === "SUCCESS") {
        const updatedPayment = await paymentsRepository.updateStatus(client, payment.id, "SUCCESS");
        const confirmedReservation = await reservationsRepository.confirmOnPayment(
          client,
          reservation.id,
        );
        if (!confirmedReservation || confirmedReservation.state !== "CONFIRMED") {
          throw conflict(
            "RESERVATION_NOT_CONFIRMABLE",
            "The reservation is no longer pending payment",
          );
        }
        await paymentsRepository.insertTransaction(client, {
          paymentId: payment.id,
          kind: "CHARGE",
          amount: payment.amount,
          status: "SUCCESS",
          reference: result.reference ?? null,
        });
        await auditService.createEvent(client, {
          actorUserId: userId,
          action: "PAYMENT_VERIFIED",
          entityType: "PAYMENT",
          entityId: payment.id,
          metadata: { reservationId: reservation.id, amount: payment.amount, result: "SUCCESS" },
        });
        const finalPayment = updatedPayment ?? payment;
        return {
          payment: toPaymentDto(finalPayment),
          reservation: toReservationDto(confirmedReservation),
        };
      }

      // FAILED: payment FAILED + reservation FAILED (not CONFIRMED).
      const updatedPayment =
        (await paymentsRepository.updateStatus(client, payment.id, "FAILED")) ?? payment;
      await reservationsRepository.markFailed(client, reservation.id);
      await paymentsRepository.insertTransaction(client, {
        paymentId: payment.id,
        kind: "CHARGE",
        amount: payment.amount,
        status: "FAILED",
        reference: result.reference ?? null,
      });
      await auditService.createEvent(client, {
        actorUserId: userId,
        action: "PAYMENT_VERIFIED",
        entityType: "PAYMENT",
        entityId: payment.id,
        metadata: { reservationId: reservation.id, amount: payment.amount, result: "FAILED" },
      });
      const failedReservation =
        (await reservationsRepository.findByIdTx(client, reservation.id)) ?? reservation;
      return {
        payment: toPaymentDto(updatedPayment),
        reservation: toReservationDto(failedReservation),
      };
    });
  },
};

export { MockPaymentProvider };
export type { Payment, PaymentProvider };
