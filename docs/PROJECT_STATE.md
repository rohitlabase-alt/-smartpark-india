# SmartPark India — Project State

Last updated: 2026-08-31 (Session 6 — Phase 2C)
Read before every session alongside SESSION_HANDOFF.md, DECISIONS.md, ROADMAP.md.

## Phase Status
```
Phase 0:  COMPLETE
Phase 0A: COMPLETE
Phase 1A: COMPLETE   (workspace foundation)
Phase 1B: COMPLETE   (development infrastructure foundation)
Phase 2A: COMPLETE   (auth/RBAC/user foundation + parking foundation)
Phase 2B: COMPLETE   (parking slots/zones + manual availability foundation)
Phase 2C: COMPLETE   (this session — booking/reservation foundation, non-payment subset)
Phase 2/6: NOT STARTED (documents upload/verify, remaining operator/admin APIs, availability WS, payments/tokens)
Application business features: PARTIAL (auth + operator/parking + slots/manual availability + bookings only; no payments/tokens/QR/IoT)
```

## Repository Status
- Baseline docs `bc3264c`, `45eb0e4`, `7bdbe67`; Phase 1A `a8d3d8a`; Phase 1B `819c068`; Phase 2A `567443a`.
- Phase 2B committed `d6c14d7` (`feat: implement Phase 2B parking availability foundation`).
- Phase 2C committed this session (`feat: implement Phase 2C booking foundation`).
- Working tree: CLEAN (verified before/after commit).

## Completed (Phase 2C)
- **Bookings/reservations (`bookings`):** under `/api/v1/reservations` (auth required, user-owned) — `GET /` own history, `POST /` create (validates facility exists+active, slot exists+belongs to facility+`reservations_enabled`+bookable status `AVAILABLE`/`RESERVED`, valid future range; inserts an immediately-`CONFIRMED` booking with `confirmed_at` and a generated `BKG-` code), `GET /:code` own detail, `POST /:code/cancel` (owner-only, transactional, lifecycle-guarded). Ownership enforced server-side (list/detail/cancel only own bookings; anyone else's → `404 BOOKING_NOT_FOUND`, no enumeration). Strict zod schemas reject unknown keys. Booking does **not** flip `parking_slots.status` to RESERVED (manual availability stays authoritative).
- **Double-booking guard (primary, race-safe):** btree_gist exclusion constraint `reservations_no_overlap` on `(slot_id, [starts_at, ends_at))` for `state='CONFIRMED'`; violations → `409 RESERVATION_CONFLICT` (`23P01`). Cross-cutting `unprocessable` (422) `HttpError` helper added for invalid state transitions.
- **DB:** migration `0005_phase2c_booking_foundation.sql` — `reservations` (§2.12 non-payment subset, D-034) with `state` CHECK (`CONFIRMED/CANCELLED/COMPLETED`), nullable `amount`/`payment_status` (unused), `ends_at > starts_at` CHECK, indexes, and the partial btree_gist exclusion. Applied + idempotent on dev DB and CI.
- **Shared contracts:** `packages/shared` grows `RESERVATION_STATES`, `ReservationState`, `BookingStatus`, `Reservation`, `CreateBookingRequest`, `BookingResponse`, `BookingListResponse`.
- **Quality/testing:** 18 new DB-backed tests in `reservations.integration.test.ts` (migration schema/vocabulary/exclusion/range; creation 401/400/404/mismatch/201/409-overlap/400-occupied/facility-level; own list + detail; IDOR 404; cancel owner/409-repeat/422-completed/404-other; concurrency exactly-one-success). Runs serially with prior DB suites. All 89 api tests pass (71 existing + 18 new).

## Pending (next logical work)
- **Phase 2D / next:** tokens/payments (QR/TTL, `confirm` endpoint, remaining reservation states `ACTIVE`/`EXPIRED`/`FAILED`, `amount`/`payment_status`), maps/geolocation, IoT ingestion, blockchain, offline gate mode, dashboards, gate staff, notifications, deployment. The availability-engine phase introduces multi-source confidence/freshness-window for real `isLive`.
- Deferred by design from 2C: `confirm` endpoint, payments/refunds, parking tokens, QR codes, gate entry, payment/gate reservation states, `vehicle_id` (no `vehicles` table), `amount`/`payment_status` usage.
- Deferred by design from 2B: zones CRUD (tables exist; management API later), freshness-window `isLive` policy.
- Deferred by design from 2A: password reset (needs email), httpOnly-cookie refresh (needs frontend), admin/verifier approval flows (Phase 6), rate limiting + request-ids (API_SPEC §6/ARCHITECTURE §3).
- Infra teardown: `docker compose down` after active work (`npm run infra:up` to restart).

## Known Bugs / Issues
- None blocking. Carried-over quirks: (1) npm blocks esbuild postinstall (allowScripts) — non-fatal; (2) Docker engine reachable only via Windows-side `desktop-linux` context. By design: `npm run test -w @smartpark/api` requires postgres running (`npm run infra:up`) or fails loudly.

## Risks
- `refresh_tokens` table is a schema add not yet mirrored in `DATABASE.md` (D-030 documents it; upstream during a later phase).
- Geospatial index on `parking_facilities` deliberately deferred (DATABASE.md §2.6).
- Role catalogue: only 3 of the 6 documented roles seeded; the rest land with their phases.
- `availability_state` is MANUAL-only; freshness/confidence/`isLive` semantics tighten when IoT/API/RESERVATION sources land.
- `reservations` exclusion predicate currently covers `state='CONFIRMED'` only; `'ACTIVE'` is added when ACTIVE bookings land (D-034).

## Commands
`START SESSION` → read this file + SESSION_HANDOFF + DECISIONS + ROADMAP.
`STATUS / TEST / SECURITY REVIEW / ARCHITECTURE REVIEW / HANDOFF / STOP` — see SESSION_HANDOFF.md §8.
