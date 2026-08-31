# SmartPark India — Session Handoff

Prepared at end of **Session 6** (2026-08-31) — Phase 2C (Booking/Reservation Foundation).

---

## 1. What was completed
- **Phase 2C is COMPLETE** (booking/reservation foundation, non-payment subset per D-034). Not Phase 2B — this session builds on the (already complete) Phase 2A/2B.
- **Bookings/reservations (`bookings/`, D-034):** under `/api/v1/reservations` (user-authenticated, user-owned):
  - `GET /` — own reservation history. `POST /` — create: validates facility exists+`isActive`, validates slot exists, belongs to that facility, `reservations_enabled` true, and a bookable status (`AVAILABLE`/`RESERVED`; rejects `OCCUPIED`/`OUT_OF_SERVICE`/`MAINTENANCE`/`UNKNOWN`), and a valid future range (`endsAt > startsAt`, valid ISO timestamps). Inserts an immediately-`CONFIRMED` booking (with `confirmed_at`) and a generated `BKG-` code. `GET /:code` — own detail. `POST /:code/cancel` — owner-only, transactional, lifecycle-guarded (`409 ALREADY_CANCELLED` on repeat, `422 CANNOT_CANCEL_COMPLETED` on a completed booking, `404 BOOKING_NOT_FOUND` if the caller doesn't own it).
  - Ownership is enforced server-side: a user may list/detail/cancel only their own bookings; anyone else's → `404 BOOKING_NOT_FOUND` (no enumeration, IDOR-safe). Strict zod schemas reject unknown keys; route-param guards present. `booking` does **not** flip `parking_slots.status` to RESERVED (manual availability stays authoritative).
- **Double-booking guard (primary, race-safe):** btree_gist exclusion constraint `reservations_no_overlap` on `(slot_id, [starts_at, ends_at))` restricted to `state='CONFIRMED'` — the DB is the authority on overlap (D-007), never app memory alone. Violations (`23P01` on that constraint) map to `409 RESERVATION_CONFLICT`.
- **Migration:** `0005_phase2c_booking_foundation.sql` — `reservations` (§2.12 minus `vehicle_id`; `amount`/`payment_status` present but nullable/unused; `state` CHECK `CONFIRMED/CANCELLED/COMPLETED`; `ends_at > starts_at` CHECK; indexes; partial btree_gist exclusion via `CREATE EXTENSION IF NOT EXISTS btree_gist` + idempotent `DO $$ ... IF NOT EXISTS` guard). Applied + idempotent on dev DB and CI.
- **Cross-cutting:** `packages/shared` grows `RESERVATION_STATES`, `ReservationState`, `BookingStatus`, `Reservation`, `CreateBookingRequest`, `BookingResponse`, `BookingListResponse`. `errors.ts` gains an `unprocessable` (422) `HttpError` helper (API_SPEC §1 422).
- **Tests (D-032 + 2C):** `reservations.integration.test.ts` — 18 DB-backed API tests (migration schema/state-vocabulary/exclusion-constraint/range-check; creation 401/400-invalid+unknown-key+reversed-time/404-facility/404-slot/400-mismatch/201-CONFIRMED-shape/409-overlap/another-slot-allowed/400-`SLOT_UNAVAILABLE`-occupied/facility-level; own list + detail; IDOR 404; cancel owner-success/409-repeat/422-completed/404-other; concurrency two-overlapping-inserts → exactly one succeeds, one row persisted). Runs serially with the Phase 2A/2B suites (shared `smartpark_test`).
- **CI:** unchanged job remains valid — postgres service + `npm run db:migrate` (0005 applies there too); API tests run against `smartpark_test`.
- Docs: DECISIONS D-034 (+ change log row); API_SPEC reservations marked IMPLEMENTED (create/list/detail/cancel) with deferred confirm/tokens/payments noted; DATABASE §2.12 D-034 note; CHANGELOG Session 6; PROJECT_STATE rewritten; SESSION_HANDOFF (this file).

## 2. Files created
- `backend/db/migrations/0005_phase2c_booking_foundation.sql`
- `backend/src/modules/bookings/`: `reservations.repository.ts`, `reservations.service.ts`, `reservations.routes.ts`
- `backend/test/reservations.integration.test.ts`

## 3. Files modified
- `packages/shared/src/index.ts` (reservation/booking contracts)
- `backend/src/app.ts` (mount `/api/v1/reservations` router)
- `backend/src/http/errors.ts` (`unprocessable` 422 helper)
- `docs/`: `DECISIONS.md` (D-034), `API_SPEC.md`, `DATABASE.md` (§2.12), `CHANGELOG.md`, `PROJECT_STATE.md`, `SESSION_HANDOFF.md`

## 4. Important architectural decisions (see DECISIONS.md)
- **D-034** Phase 2C booking/reservation foundation — non-payment subset of `DATABASE.md` §2.12: `state` CHECK limited to `CONFIRMED/CANCELLED/COMPLETED` (payment/gate states land with payments); `amount`/`payment_status` present but unused; `vehicle_id` omitted; creation immediately `CONFIRMED` (no payment step, no `confirm` endpoint, no tokens/QR). The btree_gist exclusion constraint covers `state='CONFIRMED'` (`'ACTIVE'` added later) and is the primary race-safe double-booking guard. Booking validates slot bookability but does **not** flip `parking_slots.status`; ownership enforced server-side (IDOR-safe).

## 5. Quality checks (executed, not assumed)
- `npm run lint` → clean. `npm run format:check` → all files Prettier-clean. `npm run typecheck` → clean (all 4 workspaces). `npm run build` → green (all workspaces).
- `npm run test` → **95/95 pass** (shared 3, api 89 [71 existing + 18 new], iot 3), API tests DB-backed against recreated `smartpark_test` (suites serialized).
- `npm run infra:up` → postgres/minio/anvil all **healthy**; `npm run db:migrate` applied 0005 to the dev DB (0 pending, idempotent on re-run); `npm run check:infra` → 3/3 PASS (postgres/minio/anvil).

## Known issues
- esbuild postinstall blocked by npm `allowScripts` (carried from Phase 1A) — non-fatal.
- Docker host quirk: engine reached via Windows-side `desktop-linux` context (npipe); no WSL-mounted docker.sock. Just use `npm run infra:*`.
- By design: `npm run test -w @smartpark/api` requires postgres (`npm run infra:up`) — integration tests fail loudly (clear guidance) rather than silently skip.
- By design: DB-backed suites run serially (`fileParallelism: false`) so all can safely drop/recreate `smartpark_test`; a future suite must keep the same DB lifecycle or use a distinct DB.

## 6. Git state
- Commit: `feat: implement Phase 2C booking foundation` on `master` (new commit; Phase 2A `567443a`, Phase 2B `d6c14d7` untouched). Working tree clean. No `.env`, no real credentials, no keys committed.

## Pending work / exact next phase
**Phase 2D — NOT started (do not begin without a new instruction):**
1. Payment/token flow: `POST /reservations/{code}/confirm`, payments/refunds, parking tokens, QR codes, gate entry; surface remaining reservation states (`PENDING_PAYMENT`/`ACTIVE`/`EXPIRED`/`FAILED`), use `amount`/`payment_status`; add `'ACTIVE'` to the `reservations_no_overlap` predicate.
2. Maps/geolocation for public `GET /parking` search; `cities`/`states`/`areas` reference data.
3. IoT ingestion (`@smartpark/iot` sources → `availability_state`), multi-source confidence/freshness window → real `isLive`.
4. Blockchain, offline gate mode, dashboards, gate staff, notifications, deployment.
5. Upstream the `refresh_tokens` table into `DATABASE.md`; optional geospatial index (carried from 2A).
6. Rate limiting (login/register 10/min/IP) + request-id middleware (API_SPEC §6 / ARCHITECTURE §3).

## Session commands
- `START SESSION` / `CONTINUE` / `STATUS` / `TEST` / `SECURITY REVIEW` / `ARCHITECTURE REVIEW` / `HANDOFF` / `STOP`.
