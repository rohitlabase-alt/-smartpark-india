# SmartPark India — Refund Policy (DRAFT)

**DRAFT — REQUIRES PROFESSIONAL LEGAL REVIEW**

This is a development-stage draft written by the engineering/product team. It is **not** an approved policy and **not legal advice**. It must be reviewed, revised, and approved by qualified Indian legal counsel before any real commercial launch.

Status: DRAFT v0.1
Last updated: 2026-08-30
Product: SmartPark India (Pune MVP prototype)

---

## 1. Purpose

This draft refund policy governs refunds associated with parking reservations. In the current version, all "payments" are **mock payments** (`docs/ARCHITECTURE.md` §7) — no real money is exchanged, so "refund" refers to the simulated refund lifecycle in the platform. This policy will need a full redraft with provider-specific rules when real payments are introduced.

Consistent with:
- Payment states: `INITIATED / PENDING / SUCCESS / FAILED / REFUNDED` (`docs/DATABASE.md` §2.15).
- Transactions ledger kinds: `charge / refund / reversal` (`docs/DATABASE.md` §2.16).
- Reservation lifecycle and cancellation rules (`docs/PRD.md` §10).

## 2. When a Refund Applies (Draft)

| Scenario | Intended outcome (draft) |
|---|---|
| User cancels before entry / before the reservation window begins | Full refund (mock) |
| Reservation expires without entry (no-show) | No refund (draft) — unless the operator/facility or platform caused the failure |
| Cancelled by the operator or the platform (facility unavailable, system error) | Full refund (draft) |
| Entry already approved, user cancels | No refund (draft); the right to park was used |
| Payment failed | No charge was successful; nothing to refund |
| Duplicate charge (idempotency/anomaly detected) | Reversal to correct state (draft) |

> [LEGAL REVIEW: no-show and late-cancellation refund rules; consumer-protection expectations and any cooling-off/right-to-cancel requirements for paid parking services.]

## 3. Refund Amount

- Refunds are made for the amount actually paid for the reservation (draft).
- Partial refunds are only intended where a partial service was delivered and a partial refund is expressly agreed and recorded (e.g., operator-initiated partial service). [LEGAL REVIEW: partial-refund terms.]

## 4. Refund Timing (Draft)

- In the mock-payment version, refunds transition to `REFUNDED` immediately/synchronously (simulated).
- For real payments, timing will follow the payment provider's reversal windows and must be disclosed to users. [LEGAL REVIEW: mandatory timelines for crediting refunds.]

## 5. How to Request a Refund

- In-app: users cancel a reservation through the cancellation flow (`docs/API_SPEC.md` — `POST /reservations/{code}/cancel`), after which the refund lifecycle runs.
- For operator/platform-initiated cancellations, refunds are raised automatically (draft).
- Disputes/escalations: platform support path. [LEGAL REVIEW: grievance mechanism requirements.]

## 6. Refund Records & Reconciliation

- Every refund is recorded as a `refund` transaction linked to its payment (`docs/DATABASE.md` §2.16) and is auditable (append-only audit logs, `docs/DATABASE.md` §2.22).
- Users can see payment/refund status against their reservation history.

## 7. Edge / Exceptional Cases (Draft)

- Expired token at gate: policy in §2 (no-show) applies unless attributable to the platform/operator.
- Manual gate override: recorded with reason (`docs/API_SPEC.md` gate endpoints); override does not itself trigger a refund.
- System/duplicate anomalies: corrected via reversals to keep financial state consistent.

> [LEGAL REVIEW: force majeure, operator insolvency, and provider failure scenarios.]

## 8. Contact for Queries

[LEGAL REVIEW: designate refund/notice contact and grievance mechanism.]

---

This document is a **DRAFT** for development purposes. Do not publish or present it as an approved policy without professional legal review. It deliberately does not invent monetary penalties, fees, or guarantees.