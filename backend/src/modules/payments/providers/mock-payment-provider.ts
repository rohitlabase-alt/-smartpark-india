/**
 * MockPaymentProvider (docs/ROADMAP.md PHASE 7, docs/DECISIONS.md D-010).
 *
 * A deterministic, testable mock — it never contacts a real external API and
 * never stores any card/bank/credential data (only the reservation reference
 * and amount in the provided fields). Verification succeeds unless the caller
 * opts into a forced failure by using a provider txn id carrying the documented
 * suffix. This lets tests exercise the SUCCESS and FAILED paths without any
 * randomness.
 *
 * Forced-failure contract (test-only, deterministic): a providerTxnId that
 * ends with the documented failure token resolves to FAILED; everything else
 * resolves to SUCCESS. A real provider would return live status here instead.
 */
import type {
  InitiatedPayment,
  PaymentProvider,
  PaymentProviderCode,
  VerificationResult,
} from "./payment-provider.js";

/** Suffix that makes verification deterministically fail (used by tests). */
export const MOCK_FAILURE_SUFFIX = "__FAIL__";

export class MockPaymentProvider implements PaymentProvider {
  readonly code: PaymentProviderCode = "MOCK";

  async initiate(amount: number, reference: string): Promise<InitiatedPayment> {
    // Deterministic provider transaction id: provider + reservation reference
    // + amount, so re-initiation of the same reservation yields the same id
    // (idempotent at the provider layer too).
    const providerTxnId = `MOCK-${reference}-${amount}`;
    return { provider: "MOCK", providerTxnId, status: "PENDING" };
  }

  async verify(providerTxnId: string): Promise<VerificationResult> {
    if (providerTxnId.endsWith(MOCK_FAILURE_SUFFIX)) {
      return { status: "FAILED", reference: providerTxnId };
    }
    return { status: "SUCCESS", reference: providerTxnId };
  }
}
