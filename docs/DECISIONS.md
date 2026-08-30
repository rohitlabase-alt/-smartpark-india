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

---

## Change log of decisions (reverse chronological)

| Date | Decision | Change | Why | Modules affected | Migration impact |
|---|---|---|---|---|---|
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