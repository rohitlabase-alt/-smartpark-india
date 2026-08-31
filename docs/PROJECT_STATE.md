# SmartPark India — Project State

Last updated: 2026-08-31 (Session 4 — Phase 2A)
Read before every session alongside SESSION_HANDOFF.md, DECISIONS.md, ROADMAP.md.

## Phase Status
```
Phase 0:  COMPLETE
Phase 0A: COMPLETE
Phase 1A: COMPLETE   (workspace foundation)
Phase 1B: COMPLETE   (development infrastructure foundation)
Phase 2A: COMPLETE   (this session — auth/RBAC/user foundation + parking foundation)
Phase 2B: NOT STARTED (slots/zones, manual availability engine, public parking search, cities data APIs)
Phase 2/6: NOT STARTED (documents upload/verify, remaining operator/admin APIs, availability WS)
Application business features: PARTIAL (auth + operator/parking foundation only; no bookings/tokens/payments)
```

## Repository Status
- Baseline docs `bc3264c`, `45eb0e4`, `7bdbe67`; Phase 1A `a8d3d8a`; Phase 1B `819c068`.
- Phase 2A committed this session (`feat: implement Phase 2A auth and parking foundation`).
- Working tree: CLEAN (verified before commit).

## Completed (Phase 2A)
- **Auth + RBAC:** `POST /api/v1/auth/register|login|refresh|logout`, `GET /api/v1/auth/me`. Argon2id hashing (`@node-rs/argon2`), HS256 JWTs via `jose` (pinned alg, minimal payload, 30-min default, `JWT_SECRET` from env — fail-closed when unset), opaque refresh tokens at-rest as SHA-256 digests in `refresh_tokens`, rotation + revocation + IDOR-safe logout. Roles re-read from DB per request; suspensions/soft-deletes enforced immediately.
- **Users:** `users`/`roles`/`user_roles` tables (citext email + unique indexes), seeded `USER`/`PARKING_OPERATOR`/`ADMIN`; public profile contract (`PublicUser`) never includes password material.
- **Parking foundation:** `operators` (one per account, PENDING), `parking_facilities` (generated `PUN-000001`-style ids, ownership FK, active/inactive toggle, PENDING verification), operator self-serve + facility CRUD endpoints; ownership/IDOR guarded server-side.
- **DB:** migrations `0002_phase2a_auth_and_parking_tables.sql` (users/roles/operators/parking_facilities/user_roles/refresh_tokens/`parking_id_seq`) and `0003_wire_documents_fk_constraints.sql` (wires the Phase 1B `documents` FKs per `DATABASE.md` §2.23, ON DELETE RESTRICT).
- **Shared contracts:** `packages/shared` extended with roles/statuses, `PublicUser`, `Operator`, `ParkingFacility`, auth/operator/facility request + auth response types.
- **Quality/testing:** `asyncHandler`, zod `validateBody`, `HttpError` + central handler (incl. `INVALID_JSON`); 42 DB-backed integration tests on a throwaway `smartpark_test` database (recreated per run; real postgres, real argon2, FK/unique integrity). CI now runs a postgres service + `npm run db:migrate`.

## Pending (next logical work)
- **Phase 2B (suggested next):** `parking_zones`/`parking_slots`/`availability_state` + manual availability engine (`@smartpark/iot` `ManualOccupancySource`), availability endpoints (`API_SPEC.md` §3), public `GET /parking` search + `cities`/`states`/`areas` data tables + endpoints, operators `me/facilities` document upload foundation.
- Deferred by design: password reset (needs email/notification), httpOnly-cookie refresh transport (needs frontend session wiring), admin/verifier approval flows (Phase 6), rate limiting + request-ids (noted in API_SPEC §6/ARCHITECTURE §3).
- Infra teardown: `docker compose down` after active work (`npm run infra:up` to restart).

## Known Bugs / Issues
- None blocking. Carried-over quirks: (1) npm blocks esbuild postinstall (allowScripts) — non-fatal; (2) Docker engine reachable only via Windows-side `desktop-linux` context (npipe) — `docker compose` works via that default context. New by design: `npm run test -w @smartpark/api` requires postgres running (`npm run infra:up`) or it fails loudly (DB-backed tests).

## Risks
- `refresh_tokens` table is a schema add not yet mirrored in `DATABASE.md` (D-030 documents it; upstream into DATABASE.md during the availability phase).
- Geospatial index on `parking_facilities` deliberately deferred (DATABASE.md §2.6 allows "or PostGIS if installed").
- Role catalogue: only 3 of the 6 documented roles seeded; the rest land with their phases (gate, operator staff, verifier) — don't add them early.
- Rate limiting (login/register 10/min/IP) still unimplemented — acceptable for foundation, revisit before real-world exposure.

## Commands
`START SESSION` → read this file + SESSION_HANDOFF + DECISIONS + ROADMAP.
`STATUS / TEST / SECURITY REVIEW / ARCHITECTURE REVIEW / HANDOFF / STOP` — see SESSION_HANDOFF.md §8.