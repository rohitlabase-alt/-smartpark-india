# SmartPark India — Project State

Last updated: 2026-08-31 (Session 5 — Phase 2B)
Read before every session alongside SESSION_HANDOFF.md, DECISIONS.md, ROADMAP.md.

## Phase Status
```
Phase 0:  COMPLETE
Phase 0A: COMPLETE
Phase 1A: COMPLETE   (workspace foundation)
Phase 1B: COMPLETE   (development infrastructure foundation)
Phase 2A: COMPLETE   (auth/RBAC/user foundation + parking foundation)
Phase 2B: COMPLETE   (this session — parking slots/zones + manual availability foundation)
Phase 2/6: NOT STARTED (documents upload/verify, remaining operator/admin APIs, availability WS)
Application business features: PARTIAL (auth + operator/parking + slots/manual availability only; no bookings/tokens/payments/IoT)
```

## Repository Status
- Baseline docs `bc3264c`, `45eb0e4`, `7bdbe67`; Phase 1A `a8d3d8a`; Phase 1B `819c068`.
- Phase 2A committed `567443a` (`feat: implement Phase 2A auth and parking foundation`).
- Phase 2B committed this session (`feat: implement Phase 2B parking availability foundation`).
- Working tree: CLEAN (verified before/after commit).

## Completed (Phase 2B)
- **Parking slots (`parking/slots`):** operator slot management under `/api/v1/operators/me/facilities/:facilityId/slots` — `POST` create (uppercase `slot_code`, default `AVAILABLE`, `209 DUPLICATE_SLOT_CODE`), `GET` own-facility list, `PATCH /:slotId` status/vehicle-type/reservations. Auth + `PARKING_OPERATOR` required; ownership enforced server-side (`assertFacilityOwnership` → 403 IDOR); strict zod schemas reject unknown keys; route params guarded (`Number.isInteger` → 404).
- **Manual availability (`availability`):** public `GET /api/v1/parking/:facilityId/availability` per `API_SPEC.md` §3 — `facilityId/totalSlots/availableSlots/isLive/sources/lastUpdatedAt/confidence/disclaimer/slots`, served deterministically from `availability_state`, only for active/verified facilities, soft-deleted slots excluded. Setting a slot's status updates the slot row + engine cache (`source=MANUAL`, `confidence=HIGH`) in one transaction; created slots seed their engine row; operational non-available statuses report `UNKNOWN` engine state.
- **DB:** migration `0004_phase2b_availability_foundation.sql` — `parking_zones` (§2.7), `parking_slots` (§2.8, six-state status CHECK + unique `slot_code`), `availability_state` (§2.20, four-state engine status + source/confidence CHECKs + partial unique `slot_id`). Applied + idempotent on dev DB and CI.
- **Shared contracts:** `packages/shared` grows `PARKING_SLOT_STATUSES`, `AVAILABILITY_STATES/SOURCES/CONFIDENCES`, `ParkingSlot`, `AvailabilitySummary`, `FacilityAvailabilityResponse`, `CreateSlotRequest`, `UpdateSlotRequest`.
- **Quality/testing:** 23 new DB-backed tests in `availability.integration.test.ts` (migration vocabularies, slot RBAC, create/dup/validation, list scoping, PATCH status + engine sync, public read totals/isLive/confidence, empty + soft-delete cases). Both DB-backed suites run serially (`fileParallelism: false`) to avoid clobbering the shared `smartpark_test`. 65 api tests pass (42 existing + 23 new).

## Pending (next logical work)
- **Phase 2C / next:** booking/reservation system, tokens/payments (QR), maps/geolocation, IoT ingestion (`@smartpark/iot` sources → `availability_state`), blockchain, offline gate mode, dashboards, gate staff, notifications, deployment. The availability-engine phase introduces multi-source confidence/freshness-window so `isLive` reflects real-time freshness.
- Within Phase 2B deferred by design: zones CRUD (tables exist; management API later), freshness-window `isLive` policy (single MANUAL source always HIGH → `isLive` tied to having data).
- Deferred by design (from 2A): password reset (needs email), httpOnly-cookie refresh transport (needs frontend), admin/verifier approval flows (Phase 6), rate limiting + request-ids (API_SPEC §6/ARCHITECTURE §3).
- Infra teardown: `docker compose down` after active work (`npm run infra:up` to restart).

## Known Bugs / Issues
- None blocking. Carried-over quirks: (1) npm blocks esbuild postinstall (allowScripts) — non-fatal; (2) Docker engine reachable only via Windows-side `desktop-linux` context — `docker compose` works via that default context. By design: `npm run test -w @smartpark/api` requires postgres running (`npm run infra:up`) or fails loudly.

## Risks
- `refresh_tokens` table is a schema add not yet mirrored in `DATABASE.md` (D-030 documents it; upstream into DATABASE.md during the availability phase).
- Geospatial index on `parking_facilities` deliberately deferred (DATABASE.md §2.6 allows "or PostGIS if installed").
- Role catalogue: only 3 of the 6 documented roles seeded; the rest land with their phases (gate, operator staff, verifier) — don't add them early.
- `availability_state` is currently MANUAL-only; the freshness/confidence/`isLive` semantics will be tightened when IoT/API/RESERVATION sources land (source constraint already permits them).

## Commands
`START SESSION` → read this file + SESSION_HANDOFF + DECISIONS + ROADMAP.
`STATUS / TEST / SECURITY REVIEW / ARCHITECTURE REVIEW / HANDOFF / STOP` — see SESSION_HANDOFF.md §8.
