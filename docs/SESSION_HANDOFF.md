# SmartPark India — Session Handoff

Prepared at end of **Session 4** (2026-08-31) — Phase 2A (Authentication, RBAC, User Foundation, Parking Foundation).

---

## 1. What was completed
- **Auth (D-030):** `POST /api/v1/auth/register|login|refresh|logout`, `GET /api/v1/auth/me`.
  - Passwords: argon2id via `@node-rs/argon2` (prebuilt — no npm install-script friction under allowScripts). Hashes never logged/returned.
  - Access tokens: HS256 JWTs via `jose`, pinned alg/iss/aud, minimal payload (`sub` only), default 30 min. `JWT_SECRET` from env; auth fails closed (500 `AUTH_CONFIG_ERROR`) while unset.
  - Refresh tokens: 32-byte random, stored as SHA-256 digests in `refresh_tokens`, rotated every use (replay-safe), revocable; logout only revokes the caller's own session.
- **RBAC (server-side only):** `requireAuth` + `requireRole`, roles re-read from DB per request → suspension/soft-delete take effect immediately. Roles seeded: `USER`, `PARKING_OPERATOR`, `ADMIN`.
- **Users:** `users`/`roles`/`user_roles`; `PublicUser` safe-profile contract in `packages/shared` (no password material).
- **Parking foundation (D-031):** `operators` (self-serve `POST /operators/register`, one org/account, PENDING), `parking_facilities` (`GET|POST /operators/me/facilities`, `PATCH .../:id`, generated `PUN-000007`, ownership checks → 403 for IDOR, strict zod schemas that reject unknown keys, active/inactive toggle).
- **Migrations:** `0002_phase2a_auth_and_parking_tables.sql` (users/roles+seeds/operators/parking_facilities/user_roles/refresh_tokens/`parking_id_seq`), `0003_wire_documents_fk_constraints.sql` (the FKs Phase 1B `documents` deferred: operator/parking/uploaded_by/reviewed_by, ON DELETE RESTRICT).
- **Cross-cutting:** `asyncHandler`, zod `validateBody` → 400 with flattened issues, `HttpError` + central `errorHandler` (incl. `INVALID_JSON`), `db.ts` `withTransaction`, `runMigrations()` exported.
- **Tests (D-032):** 42 DB-backed API tests on a throwaway `smartpark_test` DB (created+migrated in beforeAll, dropped in afterAll) covering register (shape/dup/validation/argon2), login (ok/401/no-enumeration/suspended), me (401/403/401-deleted), refresh rotation+replay+expiry+logout+IDOR, operators RBAC, facilities CRUD+ownership, documents FK 23503.
- **CI:** node job now runs a `postgres:16.4-alpine` service + `npm run db:migrate`; API tests run against `smartpark_test` (supersedes D-029's "tests are DB-free").
- Docs: DECISIONS D-030..D-032 (+ change log rows); CHANGELOG Session 4; PROJECT_STATE rewritten; README endpoint + JWT_SECRET notes; SESSION_HANDOFF (this file).

## 2. Files created
- `backend/db/migrations/0002_phase2a_auth_and_parking_tables.sql`, `0003_wire_documents_fk_constraints.sql`
- `backend/src/http/`: `errors.ts`, `async-handler.ts`, `context.ts`, `error-handler.ts`
- `backend/src/middleware/`: `auth.ts`, `rbac.ts` (in auth.ts), `validate.ts`
- `backend/src/modules/auth/`: `auth.repository.ts`, `auth.service.ts`, `auth.routes.ts`, `password.ts`, `tokens.ts`
- `backend/src/modules/operators/`: `operators.repository.ts`, `operators.service.ts`, `operators.routes.ts`
- `backend/src/modules/parking/`: `facilities.repository.ts`, `facilities.service.ts`
- `backend/test/setup.ts`, `backend/test/auth-parking.integration.test.ts`

## 3. Files modified
- `packages/shared/src/index.ts` (roles/statuses/PublicUser/Operator/ParkingFacility/auth contracts)
- `backend/src/`: `app.ts` (mount `/api/v1/{auth,operators}`), `config.ts` (auth block + duration parser), `db.ts` (`withTransaction`), `db/migrate.ts` (export `runMigrations`)
- `backend/package.json` (+ `@node-rs/argon2`, `jose`, `zod`), `backend/vitest.config.ts` (setupFiles/timeouts)
- `.env.example`, local `.env` (JWT vars), `.github/workflows/ci.yml` (postgres service + migrate stage)
- `docs/`: `DECISIONS.md` (D-030..D-032), `CHANGELOG.md`, `PROJECT_STATE.md`, `SESSION_HANDOFF.md`, `README.md`

## 4. Important architectural decisions (see DECISIONS.md)
- **D-030** JWT HS256 access + SHA-256-hashed opaque refresh (rotation/revocation, fail-closed on missing `JWT_SECRET`); `refresh_tokens` table added (upstream to DATABASE.md later).
- **D-031** argon2id via `@node-rs/argon2`; Phase 2A tables + `0003` documents FK wiring; one operator/account; geospatial index deferred.
- **D-032** DB-backed integration tests on throwaway `smartpark_test` + postgres service in CI (replaces D-029's DB-free tests).

## 5. Quality checks (executed, not assumed)
- `npm install` → success; `npm audit` → **0 vulnerabilities**.
- `npm run lint` → clean. `npm run format:check` → all files Prettier-clean. `npm run typecheck` → clean (all 4 workspaces). `npm run build` → green.
- `npm run test` → **48/48 pass** (shared 3, api 42, iot 3), API tests DB-backed against recreated `smartpark_test`.
- `docker compose up -d --wait` → postgres/minio/anvil all **healthy**; `npm run db:migrate` applied 0002+0003 to the dev DB (skip 0001, idempotent); `npm run check:infra` → 3/3 PASS.
- Live compiled API: `GET /health` → 200, `GET /ready` → 200 `{"status":"ready","services":{"postgres":"ok"}}`. (Endpoint matrices verified by the automated DB-backed suite.)
- `docker compose down` not run at end because it is cheap to bring back up; volumes retained.

## Known issues
- esbuild postinstall blocked by npm `allowScripts` (carried from Phase 1A) — non-fatal.
- Docker host quirk: engine reached via Windows-side `desktop-linux` context (npipe); no WSL-mounted docker.sock. Just use `npm run infra:*`.
- By design: `npm run test` for the API now requires postgres (`npm run infra:up`) — integration tests fail loudly (clear "run npm run infra:up" guidance) rather than silently skip.
- Live-server `curl` smoke of the compiled API on this machine is awkward because the dev tool reaps long-running background children; the compiled API was still verified via `/health`,`/ready` and the full DB-backed endpoint suite instead.

## 6. Git state
- Commit: `feat: implement Phase 2A auth and parking foundation` on `master`. Working tree clean. No `.env`, no real credentials, no keys committed (`.env` gitignored; `.env.example` carries placeholders + a `JWT_SECRET=` that must be filled locally).

## Pending work / exact next phase
**Phase 2B — Availability foundation + public data (starts from Phase 2A; Phase 1B infra stays):**
1. `parking_zones` / `parking_slots` / `availability_state` (`DATABASE.md` §2.7/2.8/2.20) + manual availability engine wiring `@smartpark/iot` `ManualOccupancySource`; slot CRUD for operators.
2. Public `GET /parking` family (`API_SPEC.md` §2 parking + §3 availability contract — isLive/confidence/freshness/disclaimer), facility detail/slots.
3. `states`/`cities`/`areas` reference tables (`DATABASE.md` §2.5) + public `GET /cities`/`/cities/{id}/areas`; park `parking_facilities.city` strings onto city rows.
4. Upstream the `refresh_tokens` table into `DATABASE.md`; add geospatial index optional.
5. Rate limiting (login/register 10/min/IP) + request-id middleware (API_SPEC §6 / ARCHITECTURE §3) if not moved to Phase 3.
6. Keep tests DB-backed; extend CI if new services (WS hub stub) are introduced. Do NOT skip the handoff update at end of Phase 2B.

## Session commands
- `START SESSION` / `CONTINUE` / `STATUS` / `TEST` / `SECURITY REVIEW` / `ARCHITECTURE REVIEW` / `HANDOFF` / `STOP`.