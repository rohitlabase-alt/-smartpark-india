# SmartPark India — Decisions Log

Status: active
Rule: never overwrite a decision silently (see master prompt §6 change-control, §40). If a decision changes: record old→new, why, affected modules, migration impact.

---

## D-001 — IoT is optional
- **Decision:** The platform must function fully with manual availability updates alone; IoT is one input to the Availability Engine, never a dependency.
- **Rationale:** master prompt §2; de-risks MVP against hardware failure/absence.
- **Status:** ACTIVE.

## D-002 — Monolith-first backend
- **Decision:** V1 = modular monolith (Node/TS/Express). No microservices.
- **Rationale:** small team, fast iteration; microservice complexity is Level 3 (Phase 13).
- **Status:** ACTIVE.

## D-003 — PostgreSQL single instance in V1
- **Decision:** One Postgres DB; read-replicas/caching deferred to Level 3.
- **Rationale:** cost model (§23) + simplicity.
- **Status:** ACTIVE.

## D-004 — Data-driven cities, no hard-coded Pune
- **Decision:** Cities/states/areas are rows; business logic location-agnostic. Demo facilities flagged `is_demo`.
- **Rationale:** multi-city without code duplication; never hard-code Pune business logic.
- **Status:** ACTIVE.

## D-005 — Availability requires freshness metadata
- **Decision:** Every availability value carries source, lastUpdatedAt, confidence (HIGH/MEDIUM_HIGH/MEDIUM/LOW/UNKNOWN) per deterministic rules; UI must display them honestly.
- **Rationale:** trust + liability honesty (master prompt §14, §21).
- **Status:** ACTIVE — rules may be re-measured post-pilot.

## D-006 — Real-time: WebSocket primary, HTTP polling fallback
- **Decision:** WS for live updates; clients fall back to polling endpoint (same payload shape) when WS down.
- **Rationale:** §15.
- **Status:** ACTIVE.

## D-007 — Double-booking guard at database level
- **Decision:** btree_gist exclusion constraint on reservations (slot_id overlap, CONFIRMED/ACTIVE) + row locks in the reserve transaction. Concurrency never handled in app memory only.
- **Rationale:** correctness is non-negotiable (§4, PRD §10).
- **Status:** ACTIVE.

## D-008 — Money as NUMERIC(12,2) INR in V1
- **Decision:** store INR as NUMERIC(12,2) with a helper to avoid float drift; revisit integer-paise if rounding disputes appear.
- **Rationale:** readability; float risk mitigated by helper; revisit documented.
- **Status:** ACTIVE (flagged for revisit at real-payment phase).

## D-009 — Blockchain: versioned V1 contracts, no proxies
- **Decision:** ParkingRegistryV1 / ReservationV1 / ParkingTokenV1 on local Anvil chain; no UUPS/timelock/multisig in V1; no PII on-chain; backend registrar/gate roles.
- **Rationale:** §16–17: security/simplicity; upgrades evaluated later.
- **Status:** ACTIVE.

## D-010 — PaymentProvider abstraction with MockPaymentProvider in V1
- **Decision:** `initiatePayment / verifyPayment / refund` interface; mock impl; states INITIATED/PENDING/SUCCESS/FAILED/REFUNDED; no card data stored.
- **Rationale:** future providers plug in without reservation-logic changes (§22).
- **Status:** ACTIVE.

## D-011 — Map/Geocoding/Routing provider abstractions
- **Decision:** interfaces; free/OSM-based default; map data never authorizes a facility (only Registry can be booked/tokenized).
- **Rationale:** vendor-coupling avoidance (§24).
- **Status:** ACTIVE.

## D-012 — i18n from day one (EN/MR/HI)
- **Decision:** UI text via i18n; other Indian languages addable later.
- **Rationale:** §25.
- **Status:** ACTIVE.

## D-013 — Gate staff restricted permissions
- **Decision:** GATE_STAFF = token verify + entry/exit + override-with-reason only; no facility mutation.
- **Rationale:** least privilege (§18, SECURITY §3).
- **Status:** ACTIVE.

## D-014 — Demo data never official
- **Decision:** DEMO-PUN-xxx facilities flagged `is_demo`; never presented as official/PMC data; no claimed partnerships without authorization.
- **Rationale:** §11, §38 integrity.
- **Status:** ACTIVE.

## D-015 — Phase ordering (hard gates)
- **Decision:** Phase sequence fixed (0→13). Phase 9 (physical IoT) only after software stable; Phase 13 infra only after validation.
- **Rationale:** §36.
- **Status:** ACTIVE.

## D-016 — V1 deployment target is local/dev only
- **Decision:** docker-compose local stack; GitHub Actions free runners; no production hosting in Level 1.
- **Rationale:** cost + "prototype ≠ production" (§38).
- **Status:** ACTIVE.

## D-017 — S3-compatible object storage abstraction (MinIO in V1)
- **Decision:** All large blobs (operator verification documents, parking images) go to an S3-compatible `ObjectStorageProvider` abstraction; DB stores metadata + `storage_key` only. V1 = MinIO in Docker (₹0); AWS S3 / any S3-compatible provider is a config swap, never a code change. Buckets private; access only via short-lived signed URLs; per-type file size/MIME defaults are change-controlled policy values (`ARCHITECTURE.md` §12).
- **Rationale:** Phase 0A requirement; avoids vendor coupling; aligns with zero-cost V1 (`COST_MODEL.md`).
- **Status:** ACTIVE.

## D-018 — Offline Gate Mode: bounded, fail-closed, security-first
- **Decision:** Offline gate acceptance uses a minimal local cache (no PII), a short configurable acceptance window, monotonic/idempotent event queue, bounded cache/queue sizes, and server-authoritative conflict resolution. Default policy values (OFFLINE_ACCEPT_WINDOW=5m, CACHE_TTL=15m, Q sizes, ≤1 entry/token) are **configurable policy defaults**, not code constants; any change is change-controlled. In ambiguity, reject. Implemented only after online verification is stable (`ARCHITECTURE.md` §11).
- **Rationale:** continuity with security intact; security always outranks convenience.
- **Status:** ACTIVE.

## D-019 — Accessibility target: WCAG 2.2 AA principles
- **Decision:** Frontend targets WCAG 2.2 AA principles per `ACCESSIBILITY.md`. This is a development target/checklist; it is NOT a claim of formal WCAG certification or legal conformance.
- **Rationale:** inclusive product; explicit non-claims avoid misleading certification language (§38).
- **Status:** ACTIVE.

## D-020 — Legal documents are DRAFTs requiring professional legal review
- **Decision:** `docs/legal/*` (Privacy Policy, Terms of Service, Refund Policy, Parking Operator Agreement) are development drafts. Every file opens with "DRAFT — REQUIRES PROFESSIONAL LEGAL REVIEW"; they are not approved policies and are not presented as legal advice. Items of legal uncertainty are marked `[LEGAL REVIEW: ...]`.
- **Rationale:** no invented guarantees or legal claims; consistent with `COMPLIANCE.md` §10.
- **Status:** ACTIVE — drafts only; approval gated on counsel review before any real launch.

## D-021 — Document verification lifecycle
- **Decision:** `documents` rows follow `PENDING → UNDER_REVIEW → VERIFIED / REJECTED` (vocabulary aligned with operators/facilities). Operators upload; verifier/admin reviews with required note on reject; binary is deleted only after metadata soft-delete; retention follows `COMPLIANCE.md` §4. Only verified documents support operator/facility verification.
- **Rationale:** verifiable trust chain for operator onboarding without Registry changes.
- **Status:** ACTIVE.

## D-022 — Workspace layout follows documented architecture (frontend/ backend/ shared)
- **Decision:** Repository uses `frontend/` (React+Vite+TS web), `backend/` (Node+TS+Express API), and an additive `packages/shared` (@smartpark/shared) over npm workspaces. This follows the documented architecture (`docs/ARCHITECTURE.md` §3 module layout, Phase 1A branch of `docs/ROADMAP.md`), which is materially different from the bare `apps/web` + `services/api` template in the Phase 1A brief — the documented paths are authoritative (Phase 1A Step 2 rule). `packages/shared` is additive and does not conflict. No microservices; `contracts/`, `iot/`, `tests/`, `scripts/`, `.github/` scaffolded later when their phases start.
- **Rationale:** consistency with existing docs; single developer; lightweight npm workspaces (no lerna/turbo/Nx).
- **Status:** ACTIVE.

## D-023 — Phase 1A toolchain
- **Decision:** Express 4 (TS) for the API per `ARCHITECTURE.md` §3; `tsx` for dev/watch; TypeScript 5.9 (not TS 7 rewrite); Vite 8 + React 18 + `@vitejs/plugin-react` 6 for the web app; Vitest 4 for unit tests (backend + shared; frontend tests deferred); shared package consumed as compiled `dist/` (build-ordered). Latest stable majors chosen to pass `npm audit` (0 vulnerabilities). Tailwind CSS intentionally deferred to Phase 3 (real UI) to keep Phase 1A dependency-light.
- **Rationale:** lightweight, audited, matches documented stack.
- **Status:** ACTIVE.

## D-024 — Local dev infrastructure via docker-compose (pinned images)
- **Decision:** `docker-compose.yml` at repo root runs three services: `postgres` (16.4-alpine), `minio` (S3-compatible object storage, pinned release), `anvil` (dev-only local EVM chain, foundry `v1.7.1` matching local `forge`). Images are PINNED (no `latest`) for reproducibility; named volumes `postgres-data`/`minio-data` survive `docker compose down`; each service has a real healthcheck (anvil probed via a bash `/dev/tcp` JSON-RPC `eth_chainId` round-trip because the foundry image ships no wget/curl). Credentials default to local dev values overridable from `.env`; never for production (D-016, `COST_MODEL.md`).
- **Rationale:** reproducible local stack referenced by `ROADMAP.md` Phase 1B gate "`docker-compose up` boots db+backend+frontend".
- **Status:** ACTIVE — verified end-to-end (pull → up --wait → healthy → migrations → backend `/ready` → down).

## D-025 — SQL-file migrations with a minimal transactional runner
- **Decision:** Migrations are plain versioned SQL files in `backend/db/migrations/` (`NNNN_name.sql`); a tiny runner (`backend/db/migrate.ts`) applies them in filename order inside transactions and records versions in a `schema_migrations` table. No `node-pg-migrate` dependency. Matches `DATABASE.md` conventions ("Migrations as versioned SQL files in `backend/db/migrations/`"). FK constraints to `operators`/`parking_facilities`/`users` are intentionally deferred to Phase 2 migrations alongside those base tables (Phase 1B creates `documents` standalone).
- **Rationale:** zero extra deps, transparent, idempotent; DB work (queries/entities) is a Phase 2 concern.
- **Status:** ACTIVE.

## D-026 — Object-storage scaffold exposes the ARCHITECTURE §12 interface
- **Decision:** The Phase 1B storage abstraction implements the canonical `ObjectStorageProvider` from `ARCHITECTURE.md` §12.2 — `put`, `getObject`, `head`, `getSignedGetUrl`, `getSignedPutUrl?`, `delete` — which covers the required capability set (put/get/delete/signed URLs). Out-of-the-box adapter `S3StorageProvider` (AWS SDK v3) works with MinIO and any S3-compatible provider; force-path-style addressing for self-hosted/minio. Buckets stay private; access only via short-lived signed URLs (§12.5).
- **Rationale:** architecture document is authoritative (same rule as D-022); avoids vendor coupling.
- **Status:** ACTIVE.

## D-027 — IoT foundation is a standalone `iot/` workspace, remains optional
- **Decision:** Occupancy vocabulary (`AVAILABLE`/`OCCUPIED`/`UNKNOWN`; reported `AVAILABLE`/`OCCUPIED`/`ERROR`; device statuses `ONLINE`/`OFFLINE`/`STALE`/`ERROR`) and the ingestion seam `OccupancySource` live in `iot/` (npm workspace `@smartpark/iot`) per `IOT.md` §7. A real `ManualOccupancySource` proves the manual path; Sensor/Camera/Gate adapters implement the same interface later. IoT remains OPTIONAL (`IOT.md` hard rule).
- **Rationale:** scaffolding the seam without making IoT mandatory; single source for the vocabulary used by the availability engine.
- **Status:** ACTIVE.

## D-028 — ESLint (flat) + Prettier, format gating
- **Decision:** ESLint 9 flat config at repo root (`eslint.config.js`, typescript-eslint recommended + react-hooks) drives `npm run lint` (fails CI on any error). Prettier 3 (`.prettierrc` matching code style, `.prettierignore` excluding `docs/`, lockfile, build output) drives `npm run format` / `format:check`. `docs/**` is hand-authored and intentionally excluded from auto-format.
- **Rationale:** single config for all workspaces; CI gate for consistent style; no doc churn.
- **Status:** ACTIVE.

## D-029 — CI: GitHub Actions free runners, single hard gate, no deploy/secrets
- **Decision:** `.github/workflows/ci.yml` runs two jobs — `node` (`npm ci`, then `format:check` → `lint` → `typecheck` → `test` → `build`, running sequentially so any failure stops the gate) and `contracts` (`forge build` + `forge test --root contracts`). No deploy step, no secrets, no Docker services in CI (tests are DB-free). Docs/decisions workflow unchanged.
- **Rationale:** D-016 (free runners, prototype ≠ production); costing and simplicity.
- **Status:** ACTIVE.

## D-030 — Access/refresh session foundation (JWT HS256 + SHA-256 refresh at rest)
- **Decision:** Access tokens are short-lived JWTs signed HS256 via `jose` (alg pinned, minimal payload: `sub` only + `iss`/`aud`/`iat`/`exp`; issuer "SmartPark India API", audience `/api/v1`). Refresh tokens are 32-byte random opaque strings persisted as SHA-256 digests in a new `refresh_tokens` table; every use **rotates** (old row marked `revoked_at`/`replaced_at` — replay-safe) and any session is revocable via `/auth/logout`. Key material comes solely from `JWT_SECRET` env; auth fails closed (500 `AUTH_CONFIG_ERROR`) while it is unset.
- **Rationale:** `SECURITY.md` §6 (30-min access, `alg` pinned, minimal payload, random refresh hashed at rest, rotated, revocable) and `API_SPEC.md` §6. `refresh_tokens` is a schema add — `DATABASE.md` still has no auth-session table; recorded here (open item to upstream into DATABASE.md).
- **Scope:** `POST /auth/register|login|refresh|logout`, `GET /auth/me`. Password reset/forgot (needs email delivery) and httpOnly-cookie refresh transport (needs frontend) are deliberately deferred — logged in the document and CHANGELOG.
- **Status:** ACTIVE.

## D-031 — Argon2id password hashing; Phase 2A tables + documents FK wiring
- **Decision:** Passwords hashed argon2id via `@node-rs/argon2` (memory 19 MiB, iterations 2, parallelism 1 — self-describing `$argon2id$` strings; meets SECURITY.md "argon2id (or bcrypt 12+)"). Chosen for its prebuilt platform binaries — works under the repo's npm `allowScripts` restriction (no postinstall). Migration `0002` adds `users`/`roles`(+USER, PARKING_OPERATOR, ADMIN seeds)/`operators`/`parking_facilities`/`user_roles` per `DATABASE.md` §2 plus `refresh_tokens`; `parking_id_seq` drives public ids like `PUN-000007`. One operator org per owner account (UNIQUE `owner_user_id` — /operators/me semantics). Migration `0003` finally wires the FKs Phase 1B `documents` deferred (operator/parking/uploaded_by/reviewed_by, `ON DELETE RESTRICT` per §2.23).
- **Rationale:** fulfils `DATABASE.md` §2/§5 and D-025's deferral contract; geospatial index intentionally deferred (DATABASE.md allows "or PostGIS if installed").
- **Status:** ACTIVE — verified end-to-end (migrations 0002/0003 applied on dev DB and CI; docs + users live via API).

## D-032 — DB-backed automated tests on a throwaway `smartpark_test` database
- **Decision:** Phase 2A API tests are integration tests against real postgres (`smartpark_test`, recreated + migrated in `beforeAll`, dropped in `afterAll`; vitest `setup.ts` points the app at it and provides a test-only `JWT_SECRET`). CI gains a `postgres:16.4-alpine` service and a `npm run db:migrate` stage (supersedes D-029's "tests are DB-free"). Everything else (health/ready/storage contracts) stays dependency-free.
- **Rationale:** the user-facing requirement that authentication/RBAC/parking behavior is genuinely DB-backed (unique constraints, FK integrity, sessions, real argon2) and migrations apply in CI (`DATABASE.md` §5). Integration tests fail loudly with a "run `npm run infra:up`" signal when no postgres is present locally.
- **Status:** ACTIVE.

## D-033 — Phase 2B slots + manual availability foundation (engine output cache, MANUAL source)
- **Decision:** Add the availability foundation on top of Phase 2A: migration `0004` creates `parking_zones` (`DATABASE.md` §2.7), `parking_slots` (§2.8, authoritative `AVAILABLE/RESERVED/OCCUPIED/OUT_OF_SERVICE/MAINTENANCE/UNKNOWN` vocabulary in a CHECK, globally-unique `slot_code`) and `availability_state` (§2.20 — the normalized output cache the API serves with status/source/confidence CHECKs and a partial unique on `slot_id`). `parking_slots.status` is the source of truth for slot state; the engine cache is derived offline from it. The **manual write path** (operator sets a slot's status → slot table + availability_state upserted together in one transaction, `source=MANUAL`, `confidence=HIGH`) is the only Phase 2B write; a slot created defaults to `AVAILABLE` and seeds its engine row. `availability_state` status uses the four-state vocabulary (`AVAILABLE/OCCUPIED/RESERVED/UNKNOWN`) while the slot table uses the six-state one — the documented difference from the Phase 2B brief's four-state list is resolved in favour of the docs' `parking_slots` vocabulary. Public read `GET /parking/:facilityId/availability` (`API_SPEC.md` §3) serves `totalSlots/availableSlots/isLive/sources/lastUpdatedAt/confidence/disclaimer/slots` deterministically from DB state; non-available operational slots report `UNKNOWN` engine state. `isLive` true only when data exists and confidence HIGH (single-source MANUAL); freshness-window/multi-source policy lands with the availability-engine phase.
- **Deferred (Phase 2C+):** bookings/reservations, tokens/payments, maps/geolocation, IoT ingestion, blockchain, offline gate mode, dashboards, gate staff, notifications, deployment — explicitly NOT implemented here.
- **Rationale:** slots are required before any availability; the `availability_state` output cache decouples the public read from slot writes so later engine sources (IoT/API/reservation) feed one pipeline without API churn; authoritative vocabulary from `DATABASE.md` wins over the brief's four-state list.
- **Status:** ACTIVE — verified end-to-end (migration 0004 applied + idempotent on dev DB and CI; 23 new DB-backed API tests; all 65 api tests pass).

## D-034 — Phase 2C booking/reservation foundation (non-payment subset, immediate CONFIRMED)
- **Decision:** Add the reservation foundation on top of Phase 2B: migration `0005` creates `reservations` (`DATABASE.md` §2.12) on a **non-payment subset**. The `state` CHECK is limited to `CONFIRMED/CANCELLED/COMPLETED` (the §2.12 payment/gate states — `PENDING_PAYMENT`/`ACTIVE`/`EXPIRED`/`FAILED` — land with the payments phase); `amount`/`payment_status` columns exist but are nullable/unused; `vehicle_id` is omitted (no `vehicles` table exists). Because there is **no payment step**, creation immediately inserts a `CONFIRMED` booking (with `confirmed_at`) and does **not** mint tokens/QR codes; the `confirm` endpoint is deferred. The btree_gist exclusion constraint `reservations_no_overlap` on `(slot_id, [starts_at, ends_at))` currently covers `WHERE state = 'CONFIRMED'` and is the primary, race-safe double-booking guard — the authority on overlap, never app memory alone; `'ACTIVE'` is added to the predicate when ACTIVE bookings land. Slot-existence/facility-membership/time validation happens in-request; the app validates slot bookability (allow `AVAILABLE`/`RESERVED`, reject `OCCUPIED`/`OUT_OF_SERVICE`/`MAINTENANCE`/`UNKNOWN`) and `reservations_enabled`, but does **not** flip `parking_slots.status` to `RESERVED` (manual availability stays authoritative). Ownership is enforced server-side (a user may list/detail/cancel only their own bookings; anyone else's → 404, no enumeration).
- **Deferred (payments/tokens phase):** the `confirm` endpoint, payments/refunds, parking tokens, QR codes, gate entry, and the payment/gate reservation states (`PENDING_PAYMENT`/`ACTIVE`/`EXPIRED`/`FAILED`).
- **Rationale:** reservations need to exist before any paid flow; the DB-level exclusion constraint (D-007) is the documented correctness guard; keeping `parking_slots.status` authoritative avoids a silent availability flip; ownership enforced server-side satisfies the IDOR requirement (§5).
- **Status:** ACTIVE — verified end-to-end (migration 0005 applied + idempotent on dev DB and CI; 18 new DB-backed API tests; all 89 api tests pass).

---

## Change log of decisions (reverse chronological)

| Date | Decision | Change | Why | Modules affected | Migration impact |
|---|---|---|---|---|---|
| 2026-08-31 | D-034 | Added — Phase 2C booking foundation (non-payment subset, immediate CONFIRMED) | Phase 2C (reservations/booking) | bookings, reservations, shared | new table (reservations) + btree_gist exclusion |
| 2026-08-31 | D-033 | Added — slots + manual availability foundation (engine output cache, MANUAL source) | Phase 2B (availability) | parking (slots), availability | new tables (parking_zones, parking_slots, availability_state) |
| 2026-08-30 | D-030 | Added — access/refresh session foundation (JWT HS256 + SHA-256 refresh, rotation/revocation) | Phase 2A (auth) | auth, refresh_tokens | new table (refresh_tokens) |
| 2026-08-30 | D-031 | Added — argon2id hashing + Phase 2A tables + documents FK wiring | Phase 2A (auth+parking foundation) | auth, operators, parking, documents | new (0002); FK add (0003) |
| 2026-08-30 | D-032 | Added — DB-backed tests on throwaway `smartpark_test` + postgres service in CI | Phase 2A (quality/CI) | api tests, ci.yml | none (migrations in CI stage) |
| 2026-08-30 | D-001..D-016 | Created (initial) | Session 1 | all | none (greenfield) |
| 2026-08-30 | D-017 | Added — S3-compatible storage abstraction | Phase 0A (document storage) | storage, documents, operators | schema add (documents); MinIO in compose |
| 2026-08-30 | D-018 | Added — Offline Gate Mode | Phase 0A (gate resilience) | gate, tokens, availability | none yet (design contract; Phase 6) |
| 2026-08-30 | D-019 | Added — WCAG 2.2 AA target | Phase 0A (accessibility) | frontend | none |
| 2026-08-30 | D-020 | Added — legal docs are drafts | Phase 0A (legal drafting) | docs/legal | none |
| 2026-08-30 | D-021 | Added — document verification lifecycle | Phase 0A (verification) | documents, admin | schema add (documents) |
| 2026-08-30 | D-022 | Added — workspace layout (frontend/ backend/ packages/shared; npm workspaces) | Phase 1A (foundation) | repo structure | none (new workspaces) |
| 2026-08-30 | D-023 | Added — toolchain (Express4/tsx/TS5.9/Vite8/React18/Vitest4) | Phase 1A (foundation) | web, api, shared | none |
| 2026-08-30 | D-024 | Added — docker-compose dev infra (postgres/minio/anvil, pinned) | Phase 1B (infrastructure) | docker-compose.yml, .env | compose stack |
| 2026-08-30 | D-025 | Added — SQL-file migrations + minimal transactional runner | Phase 1B (DB foundation) | backend/db | runs on postgres |
| 2026-08-30 | D-026 | Added — storage scaffold uses ARCHITECTURE §12 interface (AWS SDK v3) | Phase 1B (storage) | backend/src/storage | none |
| 2026-08-30 | D-027 | Added — IoT seam + vocabulary in `iot/` workspace | Phase 1B (IoT foundation) | iot | none |
| 2026-08-30 | D-028 | Added — ESLint flat + Prettier, format gating | Phase 1B (quality) | eslint.config.js, .prettierrc | none |
| 2026-08-30 | D-029 | Added — CI workflow (node gate + forge), no deploy/secrets | Phase 1B (CI) | .github/workflows | none |

## Open decisions (deferred)
- Real payment provider (Phase 11) — evaluate UPI providers; record in COMPLIANCE register first.
- On-chain network for production (Level 3): L2 EVM candidate list.
- Availability guarantee/liability model (Level 2, draft by counsel).
- Retention windows final numbers (confirm with counsel before production).
- Object-storage provider for Level 3 (S3 vs alternatives) — deferred; abstraction keeps it open.
- Offline mode operator adoption policy (which facilities may enable offline acceptance) — Level 2.