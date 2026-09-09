/**
 * Payment provider abstraction (docs/ROADMAP.md PHASE 7, docs/DECISIONS.md
 * D-010). A provider knows how to initiate a payment and verify its outcome.
 * The domain stores only provider-agnostic state (provider code, provider
 * transaction id, amount, status); all provider-specific detail stays inside
 * the concrete implementation and is hidden behind this interface so a real
 * provider can replace the mock without changing reservation logic.
 */

export type PaymentProviderCode = "MOCK";

/** A provider-side transaction reference issued at initiation. */
export interface InitiatedPayment {
  provider: PaymentProviderCode;
  providerTxnId: string;
  status: "INITIATED" | "PENDING";
}

/** The deterministic result of a verification call. */
export interface VerificationResult {
  status: "SUCCESS" | "FAILED";
  /** Optional provider-supplied reference for the ledger transaction. */
  reference?: string;
}

export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  /** Starts (or reuses) a provider transaction for the given amount. */
  initiate(amount: number, reference: string): Promise<InitiatedPayment>;
  /** Verifies the outcome of an earlier initiate deterministically. */
  verify(providerTxnId: string): Promise<VerificationResult>;
}
