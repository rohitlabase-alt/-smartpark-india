# SmartPark India — Project State

Last updated: 2026-09-06 (Session 7 — Phase 7 mock payment foundation)
Read before every session alongside SESSION_HANDOFF.md, DECISIONS.md, ROADMAP.md.

## Phase Status
```
Phase 0:  COMPLETE
Phase 0A: COMPLETE
Phase 1A: COMPLETE   (workspace foundation)
Phase 1B: COMPLETE   (development infrastructure foundation)
Phase 2A: COMPLETE   (auth/RBAC/user foundation + parking foundation)
Phase 2B: COMPLETE   (parking slots/zones + manual availability foundation)
Phase 2C: COMPLETE   (booking/reservation foundation; superseded by Phase 7 payment lifecycle)
Phase 7:  COMPLETE   (this session — mock payment foundation: PENDING_PAYMENT lifecycle + initiate/verify + idempotency)
Application business features: PARTIAL (auth + operator/parking + slots/manual availability + bookings + mock payments only; no tokens/QR/IoT/refunds)
```

## Repository Status
- Baseline docs `bc3264c`, `45eb0e4`, `7bdbe67`; Phase 1A `a8d3d8a`; Phase 1B `819c068`; Phase 2A `567443a`; Phase 2B `d6c14d7`; Phase 2C `feat: implement Phase 2C booking foundation`.
- Operator cancellation work (backend + frontend) landed in commits `19cb366`/`7579011`/`9fa7b52` (operator reservation management + cancellation).
- Current work (Phase 7 mock payments) is **uncommitted** (per instruction: do not commit/push).

## Completed (Phase 7 — mock payment foundation)
- **Payments (`payments` module, D-035):** under `/api/v1/payments` (auth required, user-owned) —
  - `POST /initiate { reservationCode }` (+ optional `Idempotency-Key`): reservation must be `PENDING_PAYMENT` (`409 PAYMENT_NOT_PENDING`) with a non-null `amount` (`409 PAYMENT_UNAVAILABLE`); creates a `payments` row (provider `MOCK`, deterministic `providerTxnId` `MOCK-<code>-<amount>`, status `PENDING`); with an `Idempotency-Key` the key claim + payment creation are atomic (15 min TTL) and a repeat reuses the existing payment.
  - `POST /:txnId/verify`: one DB transaction; ownership via join to `reservations.user_id` (404 `PAYMENT_NOT_FOUND`, no enumeration); provider SUCCESS → payment `SUCCESS` + reservation `CONFIRMED` (`confirmed_at`, `payment_status='SUCCESS'`) + `CHARGE`/`SUCCESS` transaction; provider FAILED → payment `FAILED` + reservation `FAILED` + `CHARGE`/`FAILED` transaction. Re-verify SUCCESS idempotent; re-verify FAILED → `409 PAYMENT_ALREADY_FAILED`; non-pending reservation → `409 RESERVATION_NOT_CONFIRMABLE` (full rollback). `PaymentProvider` + deterministic `MockPaymentProvider` (failure iff txn id ends with `__FAIL__`, no secrets/external API).
- **Reservation lifecycle rework (`bookings`):** create → `PENDING_PAYMENT` with computed `amount` (from `parking_facilities.pricing` JSONB `hourlyRate`, default ₹100/hr — D-035) and `payment_status='INITIATED'`; `confirmOnPayment`/`markFailed` transitions; customer cancellation allows `PENDING_PAYMENT` + `CONFIRMED` (no refund — D-035).
- **DB:** migration `0006_phase7_mock_payment.sql` — `reservations_state_check` widened to full §2.12 vocabulary; `reservations_no_overlap` rewritten as `WHERE state IN ('PENDING_PAYMENT','CONFIRMED','ACTIVE')` (pending holds the slot; payment-confirm to same slot/window does not self-conflict); `reservations_amount_check` (NULL or `>= 0`); new `payments` (§2.15), `transactions` (§2.16), `payment_idempotency_keys` (§2.17). Applied + idempotent on dev DB and CI.
- **Shared contracts:** `Payment`, `InitiatePaymentRequest/Response`, `VerifyPaymentResponse`, `PAYMENT_STATUSES/PROVIDERS`, transaction kinds/statuses; `Reservation` gains required `amount: number | null` + `paymentStatus: PaymentStatus | null` (frontend fixtures/tests updated).
- **Quality/testing:** 130 api tests (23 new `payments.integration.test.ts` + updated `reservations.integration.test.ts`), all green; full `npm test` green; typecheck/build/lint/prettier clean across all 4 workspaces.

## Previous phases (still true)
- **Phase 2C (D-034):** `reservations` created by migration `0005`; superseded in part by Phase 7 (see Phase 7 rows above). Exclusion constraint + IDOR-safe ownership carried forward.
- **Phase 2B (D-033):** zones/slots/manual-availability foundation; `availability_state` MANUAL-only for now.
- **Phase 2A (D-030/D-031/D-032):** auth/RBAC, Argon2id, JWT sessions, operator/parking + documents foundations, DB-backed test infra.
- Operator reservation management + cancellation (backend + frontend dashboard) landed post-2C under `19cb366`/`7579011`/`9fa7b52`.

## Pending (next logical work)
- **Tokens phase (Phase 2D / roadmap next):** parking tokens/QR codes, gate entry, `POST /reservations/{code}/confirm` (or continue verifying-via-payments), `ACTIVE`/`EXPIRED` reservation transitions, refunds (schema already permits `REFUND`/`REVERSAL`; mock doesn't reverse — D-035), real payment provider.
- Maps/geolocation + cities/states/areas reference data; IoT ingestion → multi-source freshness/`isLive`; blockchain; offline gate mode; dashboards; gate staff; notifications; deployment.
- Deferred by design: `vehicle_id` (no `vehicles` table), zones CRUD management API (tables exist), password reset, httpOnly-cookie refresh, admin/verifier approval flows (Phase 6), rate limiting + request-ids.
- Infra teardown: `docker compose down` after active work (`npm run infra:up` to restart).

## Known Bugs / Issues
- None blocking. Carried-over quirks: (1) npm blocks esbuild postinstall (allowScripts) — non-fatal; (2) Docker engine reachable only via Windows-side `desktop-linux` context. By design: `npm run test -w @smartpark/api` requires postgres running (`npm run infra:up`) or fails loudly.

## Risks
- `refresh_tokens` table is a schema add not yet mirrored in `DATABASE.md` (D-030 documents it; upstream during a later phase).
- Mock payments are deterministic (no real money); a real provider will need external txn-id mapping + webhooks/async verify, which the `PaymentProvider` seam is designed for.
- `availability_state` is MANUAL-only; freshness/confidence/`isLive` semantics tighten when IoT/API/RESERVATION sources land.
- Refunds are explicitly out of scope of the mock (D-035) — cancellation leaves the `CHARGE` as-is; must be addressed before real money moves.

## Commands
`START SESSION` → read this file + SESSION_HANDOFF + DECISIONS + ROADMAP.
`STATUS / TEST / SECURITY REVIEW / ARCHITECTURE REVIEW / HANDOFF / STOP` — see SESSION_HANDOFF.md §8.