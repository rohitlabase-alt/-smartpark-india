/**
 * Payment routes (docs/API_SPEC.md §2 payments). Mounted at /api/v1/payments.
 * All routes require auth; ownership is enforced server-side in the service.
 * The PaymentProvider is injected so tests can substitute a deterministic
 * mock without touching the module wiring.
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/async-handler.js";
import { badRequest } from "../../http/errors.js";
import type { AuthenticatedRequest } from "../../http/context.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { paymentsService } from "./payments.service.js";
import { MockPaymentProvider } from "./providers/mock-payment-provider.js";
import type { PaymentProvider } from "./providers/payment-provider.js";

const initiateSchema = z
  .object({
    reservationCode: z.string().trim().min(1).max(48),
  })
  .strict();

export function buildPaymentsRouter(provider: PaymentProvider = new MockPaymentProvider()): Router {
  const router = Router();

  router.use(requireAuth());

  router.post(
    "/initiate",
    validateBody(initiateSchema),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const idempotencyKey = req.header("Idempotency-Key");
      if (idempotencyKey !== undefined && idempotencyKey.trim().length === 0) {
        throw badRequest("VALIDATION_ERROR", "Idempotency-Key must not be empty");
      }
      const body = req.body as { reservationCode: string };
      res.json(
        await paymentsService.initiate(
          provider,
          req.auth.userId,
          body.reservationCode,
          idempotencyKey?.trim() || undefined,
        ),
      );
    }),
  );

  router.post(
    "/:txnId/verify",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      if (!req.params.txnId || req.params.txnId.trim().length === 0) {
        throw badRequest("VALIDATION_ERROR", "Missing payment transaction id");
      }
      res.json(await paymentsService.verify(provider, req.auth.userId, req.params.txnId));
    }),
  );

  return router;
}
