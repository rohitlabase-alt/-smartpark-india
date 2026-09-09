# SmartPark India — Session Handoff

Prepared at end of **Session 7** (2026-09-06) — Phase 7 (Mock Payment Foundation).

---

## 1. What was completed
- **Phase 7 mock payment foundation is COMPLETE** (D-035): reservations now model "held but unpaid" (`PENDING_PAYMENT`) and only become `CONFIRMED` after a successful mock payment verification.
- **Payments (`payments/`, D-035) under `/api/v1/payments` (user-authenticated, user-owned):**
  - `POST /initiate` — body `{ reservationCode }` (+ optional `Idempotency-Key` header). Rechecks the reservation belongs to the caller, is `PENDING_PAYMENT` (`409 PAYMENT_NOT_PENDING` on already-confirmed/failed/etc.), and has a non-null `amount` (`409 PAYMENT_UNAVAILABLE`). Creates a `payments` row: provider `MOCK`, deterministic `providerTxnId` `MOCK-<code>-<amount>`, status `PENDING`, amount = reservation's stored `amount`. With an `Idempotency-Key` the key claim + payment creation are atomic (15 min TTL); a repeat with the same `(user, key, endpoint)` returns the existing payment (no duplicate attempt). Missing/unknown keys, unknown fields, empty/whitespace `Idempotency-Key` → `400`.
  - `POST /:txnId/verify` — the **entire** verification runs in one DB transaction (payment + reservation both `FOR UPDATE`): ownership via join `reservations.user_id` (any miss → `404 PAYMENT_NOT_FOUND`, no IDOR enumeration). `MockPaymentProvider.verify` returns FAILED iff the txn id ends with `__FAIL__`. On SUCCESS: payment → `SUCCESS`, reservation → `CONFIRMED` (`confirmed_at`, `payment_status='SUCCESS'`), one `CHARGE`/`SUCCESS` transaction. On FAILED: payment → `FAILED`, reservation → `FAILED` (never `CONFIRMED`), one `CHARGE`/`FAILED` transaction. Re-verifying a SUCCESS payment is idempotent (returns current state, still one `CHARGE`); re-verifying FAILED → `409 PAYMENT_ALREADY_FAILED`; verifying when the reservation is no longer pending → `409 RESERVATION_NOT_CONFIRMABLE` (whole verification rolls back — payment stays `PENDING`, reservation untouched).
  - `PaymentProvider` interface + deterministic `MockPaymentProvider` (no cards/secrets/external API; `MOCK_FAILURE_SUFFIX = "__FAIL__"`). `app.ts` mounts `app.use("/api/v1/payments", buildPaymentsRouter())` (new `MockPaymentProvider()` default for determinism).
- **Reservation lifecycle rework (`bookings/`):**
  - `create` computes `amount` from the facility `pricing` JSONB `hourlyRate` (default ₹100/hr, D-035), inserts `PENDING_PAYMENT` with `payment_status='INITIATED'`, computes `amount` = `round(ceil(hours)×rate,2)`, `hours = max(1, ceil((ends−starts)/3600000))`.
  - New `confirmOnPayment` (PENDING_PAYMENT→CONFIRMED + `payment_status='SUCCESS'` + `confirmed_at`) and `markFailed`.
  - Customer `cancelBooking` now allows `PENDING_PAYMENT` + `CONFIRMED` (still `409 ALREADY_CANCELLED` on repeat, `422 CANNOT_CANCEL_COMPLETED` on completed, `409 CANNOT_CANCEL` otherwise). **No refund** in the mock (D-035) — cancel does not reverse the `CHARGE`. Operator cancel path unchanged and still passes integrations.
- **Migration `0006_phase7_mock_payment.sql`:** drops/re-adds `reservations_state_check` with the full vocabulary; rewrites `reservations_no_overlap` (btree_gist) to `WHERE state IN ('PENDING_PAYMENT','CONFIRMED','ACTIVE')` (pending holds the slot; CONFIRM on the same slot/window does not self-conflict); adds `reservations_amount_check`; creates `payments` (§2.15), `transactions` (§2.16), `payment_idempotency_keys` (§2.17). Applied + idempotent on dev DB and CI.
- **Shared contracts:** `Payment`, `InitiatePaymentRequest/Response`, `VerifyPaymentResponse`, `PAYMENT_STATUSES/PAYMENT_PROVIDERS/PAYMENT_TRANSACTION_KINDS/PAYMENT_TRANSACTION_STATUSES`; `Reservation` gains required `amount: number | null` and `paymentStatus: PaymentStatus | null` (frontend event fixtures/tests updated in `frontend/src/api/*.test.ts` + `OperatorDashboard.test.tsx`).
- **Tests (130 api total, +23 Phase 7, DB-backed):** `payments.integration.test.ts` (migration 0006 schema/vocabularies/exclusion predicates; creation → PENDING_PAYMENT with `amount`/`INITIATED`; pending blocks conflicting booking; initiate 401/400/404s/200-shape/idempotency; verify 401/404s/SUCCESS→CONFIRMED+CHARGE/idempotent re-verify/failed `__FAIL__` (+ direct SQL row) → FAILED + CHARGE-FAILED + slot freed/409 `PAYMENT_ALREADY_FAILED`/409 `RESERVATION_NOT_CONFIRMABLE` + full rollback/409 `PAYMENT_NOT_PENDING`). `reservations.integration.test.ts` updated for the lifecycle (create → PENDING_PAYMENT with amount/INITIATED; schema-vocab test now asserts the full vocabulary; operator-cancel-failure row stays `PENDING_PAYMENT`).
- Docs: DECISIONS D-035 (+ change log row); API_SPEC reservations + payments IMPLEMENTED; DATABASE §2.12/§2.15/§2.16/§2.17 (and §2.17–2.24 renumber), §3 integrity; CHANGELOG Session 7; PROJECT_STATE rewritten; SESSION_HANDOFF (this file).

## 2. Files created
- `backend/db/migrations/0006_phase7_mock_payment.sql`
- `backend/src/modules/payments/`: `payments.routes.ts`, `payments.service.ts`, `payments.repository.ts`, `providers/payment-provider.ts`, `providers/mock-payment-provider.ts`
- `backend/test/payments.integration.test.ts`

## 3. Files modified
- `packages/shared/src/index.ts` (payment contracts + `Reservation.amount`/`paymentStatus`)
- `backend/src/app.ts` (mount `/api/v1/payments` router)
- `backend/src/modules/bookings/`: `reservations.repository.ts`, `reservations.service.ts` (PENDING_PAYMENT lifecycle, amount, confirm/markFailed, cancellation)
- `backend/src/modules/parking/facilities.repository.ts` (`pricing` JSONB surfaced for amount calc)
- `backend/test/reservations.integration.test.ts` (PENDING_PAYMENT lifecycle expectations)
- `frontend/src/api/reservations.test.ts`, `frontend/src/api/operators.test.ts`, `frontend/src/OperatorDashboard.test.tsx` (fixture `amount`/`paymentStatus`)
- `docs/`: `DECISIONS.md` (D-035), `API_SPEC.md`, `DATABASE.md` (§2.12/§2.15–2.17 + renumber), `ARCHITECTURE.md` (section refs), `CHANGELOG.md`, `PROJECT_STATE.md`, `SESSION_HANDOFF.md`

## 4. Important architectural decisions (see DECISIONS.md)
- **D-035** Phase 7 mock payment foundation — see `DECISIONS.md` §D-035: PENDING_PAYMENT lifecycle (create holds money/state; CONFIRMED only after verified payment); amount from `parking_facilities.pricing` JSONB `{ "hourlyRate": <positive number> }` with `DEFAULT_MOCK_HOURLY_RATE = 100` INR fallback (`amount = round(ceil(hours)×rate,2)`); exclusion predicate widened to PENDING_PAYMENT/CONFIRMED/ACTIVE; deterministic `MockPaymentProvider` (failure iff txn id ends `__FAIL__`); initiate idempotent under `Idempotency-Key` (15 min TTL); verify fully atomic in one DB transaction; server-side ownership 404 (no IDOR); **no refunds** in the mock (cancel leaves the CHARGE; `REFUND`/`REVERSAL` kinds exist in schema but are unused).

## 5. Quality checks (executed, not assumed)
- `npm run lint` → clean. `npx prettier --write` on changed files (JS/TS) → clean. `npm run typecheck` → clean (all 4 workspaces). `npm run build` → green (all workspaces).
- `npm test` → **350/350** (shared 3 · api 130 · iot 3 · web 214). DB-backed suites serialized against recreated `smartpark_test` (payments suite added to the same lifecycle).
- `npm run infra:up` → postgres/minio/anvil healthy; `npm run db:migrate` applied 0006 to the dev DB (idempotent on re-run); `npm run check:infra` → 3/3 PASS.

## Known issues
- esbuild postinstall blocked by npm `allowScripts` (carried from Phase 1A) — non-fatal.
- Docker host quirk: engine reached via Windows-side `desktop-linux` context (npipe); no WSL-mounted docker.sock. Just use `npm run infra:*`.
- By design: `npm run test -w @smartpark/api` requires postgres (`npm run infra:up`) — integration tests fail loudly (clear guidance) rather than silently skip.
- By design: DB-backed suites run serially (`fileParallelism: false`) so all can safely drop/recreate `smartpark_test`; a future suite must keep the same DB lifecycle or use a distinct DB.
- Mock payment amounts are derived from `pricing.hourlyRate` JSONB only when present; facilities without pricing fall back to ₹100/hr (D-035).

## 6. Git state
- Phase 7 work is **uncommitted** (per instruction: do not commit/push). Prior phase commits: Phase 2C `feat: implement Phase 2C booking foundation`; operator work `19cb366`/`7579011`/`9fa7b52` on `master`. Working tree contains the Phase 7 diff only. No `.env`, no real credentials, no keys committed.

---

## Session 7 follow-up (2026-09-08) — browser "reservations response incomplete or malformed" + `/parking/100/availability`

### Root cause (bad browser report, reproduced & fixed)
- Manual browser test on dev showed `The reservations response was incomplete or malformed.` (`frontend/src/api/reservations.ts` `fetchReservations`). The current API output is NOT defective: a live reproduction of the exact browser flow (real frontend `createReservation`/`fetchReservations`/`getReservation` + raw fetch for initiate/verify against the running dev backend + dev DB, through the real `isReservation` validator and the served `@smartpark/shared/dist`) passes the whole lifecycle, with `PENDING_PAYMENT`/`CONFIRMED` DTOs carrying all 16 fields.
- Actual cause: frontend consumes `@smartpark/shared` as the **built** `packages/shared/dist` (runtime `RESERVATION_STATES`). The dev Vite server was started directly (`frontend/node_modules/.bin/vite`), bypassing the root `predev` (`npm run build -w @smartpark/shared`). During the Phase 7 window the backend began returning `PENDING_PAYMENT` reservations while the served dist still lacked that state in `RESERVATION_STATES` → `isReservation` rejected every new booking (evidence: dev DB row `id=5` is `PENDING_PAYMENT` with `created_at` before the Sep-6 dist rebuild).
- The `/api/v1/parking/100/availability` request: **no code path generates it** — the availability screen's facility-ID field is free text (`frontend/src/App.tsx`). Dev DB facilities are IDs 1–3; the tester typed "100". No seed/schema changes.

### Fixes shipped (all uncommitted)
- Backend `reservations.integration.test.ts` (+3 DB-backed): exhaustive 16-field DTO-shape helper mirroring the frontend validator + runtime `RESERVATION_STATES`/`PAYMENT_STATUSES` membership, asserted for `POST /` and every `GET /` row, plus a full lifecycle test (create → list → detail → initiate → verify → re-fetch) asserting a complete valid DTO at every step.
- Frontend `src/api/reservations.ts`: `isReservation` **strengthened** to also require non-optional `amount` (finite number) and `paymentStatus` (in `PAYMENT_STATUSES`) — per the shared `Reservation` contract; validator behaviour otherwise unchanged.
- Frontend `src/api/reservations.test.ts` (+8): accepts `PENDING_PAYMENT` with `amount`/`paymentStatus` for list/create/detail (the exact former failure vector); rejects missing/non-finite `amount`, missing/invalid `paymentStatus`, and out-of-vocabulary states.
- `frontend/src/Reservations.test.tsx` fixtures: added `amount`/`paymentStatus` (they traverse the real validator).
- `frontend/package.json`: added `predev: npm run build -w @smartpark/shared` so scripted frontend dev launches rebuild the shared contract first (root `npm run dev` already did; direct `.bin/vite` is now the unsupported bypass).

### Follow-up verification
- Full suite now **361**: shared 3 · api 134 · iot 3 · web 221 = **361**; then `npm run typecheck`, `npm run build`, `npm run lint`, `npm run format:check` all clean; `npm run db:migrate` idempotent.
- Live browser-equivalent reproduction pass recorded in `frontend/src/live-browser-repro.test.ts` output (temporary diagnostic — deleted after capture; captured bodies validated: create `PENDING_PAYMENT`/Rs 200/`INITIATED`, detail, initiate `MOCK-…-200`, verify → `CONFIRMED`/`SUCCESS`, re-fetch).
- No headless browser tooling exists in this environment (no playwright/puppeteer); the strongest available browser-equivalent is the above live run of the real frontend module graph against the running dev stack.

## Pending work / exact next phase
**Tokens phase (do not begin without a new instruction):**
1. Parking tokens/QR codes + gate entry (`tokens` module), `POST /reservations/{code}/confirm` (or keep payment-verify as the confirm path), driving reservations to `ACTIVE`/`EXPIRED`.
2. Refunds via `REFUND`/`REVERSAL` transactions — currently schema-permitted but unused (mock never reverses; D-035).
3. Real payment provider behind the `PaymentProvider` seam (webhooks/async verify, external txn ids), pricing engine behind the `hourlyRate` JSONB.
4. Player-next: maps/geolocation + reference data; IoT ingestion → multi-source freshness/`isLive`; blockchain; offline gate mode; dashboards; gate staff; notifications; deployment; rate limiting + request-ids (API_SPEC §6 / ARCHITECTURE §3).

## Session commands
- `START SESSION` / `CONTINUE` / `STATUS` / `TEST` / `SECURITY REVIEW` / `ARCHITECTURE REVIEW` / `HANDOFF` / `STOP`.