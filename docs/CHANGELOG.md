# SmartPark India — Changelog

Format: date — summary — refs. Chronological, newest last.

## 2026-08-30 — Session 3 (Phase 1B — development infrastructure foundation)
- **Added:**
  - `docker-compose.yml` — postgres:16.4-alpine, MinIO (pinned release), anvil (foundry v1.7.1); pinned images, named volumes, real healthchecks (anvil via bash `/dev/tcp` `eth_chainId` round-trip since the image has no wget/curl), env overridable from `.env`.
  - Backend DB + storage foundation (`backend/`): `db/migrations/0001_create_documents.sql` (verbatim `DATABASE.md` §2.23, standalone w/o FKs — added in Phase 2 alongside base tables), minimal transactional migration runner (`db/migrate.ts`, `schema_migrations`), lazy `pg` pool + `GET /ready` (503 when postgres down; `/health` stays dependency-free), provider-agnostic `ObjectStorageProvider` per `ARCHITECTURE.md` §12 (AWS SDK v3 `S3StorageProvider` for MinIO/S3), `scripts/check-infra.ts` (postgres/minio/anvil reachability), dotenv loading from repo-root `.env`.
  - `iot/` workspace `@smartpark/iot` — occupancy vocabulary (`AVAILABLE/OCCUPIED/UNKNOWN`, reported `AVAILABLE/OCCUPIED/ERROR`), `OccupancySource` seam, real `ManualOccupancySource`; IoT remains optional per `IOT.md`.
  - `contracts/` Foundry scaffold — `foundry.toml` (solc 0.8.27), `src/DevPlaceholder.sol`, dependency-free `test/DevPlaceholder.t.sol` (3 tests), `script/` README placeholder (forge-std deferred to contracts phase).
  - Tooling: ESLint 9 flat config + `npm run lint`, Prettier 3 (`.prettierrc`, `.prettierignore`, `format`/`format:check`), CI `.github/workflows/ci.yml` (node gate: format:check→lint→typecheck→test→build; contracts job: forge build/test; no deploy/secrets).
  - Root scripts: `infra:up/down/ps/logs`, `db:migrate`, `check:infra`; `.env.example` extended with `API_PORT`/`MINIO_*`/`ANVIL_*`/`POSTGRES_*`; `.gitignore` covers contracts artifacts.
- **Decisions:** D-024 (pinned docker-compose dev infra), D-025 (SQL-file migrations + minimal runner), D-026 (storage per ARCHITECTURE §12, AWS SDK v3), D-027 (IoT seam in `iot/`, optional), D-028 (ESLint/Prettier gating), D-029 (CI: node gate + forge, no deploy/secrets).
- **Verification (all run, all passed):** `npm install` (0 vulns) · `npm run lint` · `npm run format:check` · `npm run typecheck` · `npm test` (15/15: shared 3, api 9, iot 3) · `npm run build` · `docker compose config` (clean) · `docker compose up -d --wait` → postgres/minio/anvil all healthy · `npm run db:migrate` (applied; idempotent) · `npm run check:infra` → 3/3 PASS · `forge build` (solc 0.8.27) + `forge test` (3/3 pass) · compiled API: `GET /health` 200 JSON, `GET /ready` 200 `{"status":"ready","services":{"postgres":"ok"}}`, unknown route 404 JSON · `docker compose down` clean.
- **Known issues:** esbuild postinstall blocked by npm allowScripts (carried over, non-fatal). Docker host quirk on this machine: engine reachable via the Windows-side `desktop-linux` context (npipe), not a WSL-mounted socket.
- **Refs:** decisions D-024..D-029.

## 2026-08-30 — Session 2 (Phase 1A — workspace foundation)
- **Added:** npm workspaces monorepo (root `package.json`, `.gitignore`, `.env.example`).
  - `frontend/` — React 18 + Vite 8 + TypeScript placeholder app (`SmartPark India / Pune MVP / Workspace Foundation`), responsive plain-CSS page.
  - `backend/` — Express 4 + TypeScript API foundation: `GET /health` (200 JSON), JSON 404 + central error middleware; no business logic, no DB dependency.
  - `packages/shared` — `@smartpark/shared` constants + `HealthResponse`/`ApiError` contracts (consumed by web + api).
  - Vitest 4 unit tests (shared 3, backend 3); run via root `npm test`.
  - README workspace guide (install/dev/build/test).
- **Toolchain decisions:** D-022 (documented `frontend/`/`backend/` layout + additive shared pkg over npm workspaces), D-023 (Express4/tsx/TS5.9/Vite8/React18/Vitest4; Tailwind deferred to Phase 3; latest stable majors → 0 `npm audit` vulnerabilities).
- **Verification (all run, all passed):** `npm install` (0 vulns) · `npm run build` (shared+api+web green; web bundle 141 kB) · `npm run test` (6/6 pass) · `GET /health` on compiled server → 200 JSON · unknown route → 404 JSON · Vite dev server serves index page.
- **Known issues:** esbuild postinstall blocked by npm allowScripts (non-fatal — platform binary from optional deps works; all builds/tests/dev verified).
- **Refs:** decisions D-022, D-023.

## 2026-08-30 — Session 1b (Phase 0A — documentation completion)
- **Added:**
  - `docs/legal/PRIVACY_POLICY_DRAFT.md`, `docs/legal/TERMS_OF_SERVICE_DRAFT.md`, `docs/legal/REFUND_POLICY_DRAFT.md`, `docs/legal/PARKING_OPERATOR_AGREEMENT_DRAFT.md` — all marked DRAFT — REQUIRES PROFESSIONAL LEGAL REVIEW; aligned with PRD/COMPLIANCE/payment/liability/operator models.
  - `docs/ACCESSIBILITY.md` — WCAG 2.2 AA development checklist (non-certification).
- **Modified:**
  - `docs/ARCHITECTURE.md` — added §11 Offline Gate Mode (online/offline flow, token caching limits as configurable policy, sync + idempotency + conflict matrix, security-first) and §12 Document Storage (S3-compatible abstraction, MinIO local, upload flow, key generation, signed URLs, type/size validation, malware-scan-as-future, retention, audit); renumbered later sections 13–16; phase header now 0/0A.
  - `docs/DATABASE.md` — added `documents` table (§2.23) with constraints, indexes, lifecycle; ER + index + privacy notes updated.
  - `docs/API_SPEC.md` — added `documents` endpoints (upload/list/verify/reject + signed-URL access), authz rules, rate limits, implementation-phase marker (Phase 2/6); phase header 0A.
  - `docs/PRD.md` — §15 added "Accessibility: WCAG 2.2 AA principles" + pointer.
  - `docs/COMPLIANCE.md` — inventory/retention/vendor rows for verification documents; corrected ARCHITECTURE cross-ref (§14 → §4–5).
  - `docs/COST_MODEL.md` — storage line updated (MinIO local in V1, S3 at scale).
  - `docs/ROADMAP.md` — Phase 2 (documents) & Phase 6 (offline gate) scoped.
  - `docs/DECISIONS.md` — added D-017..D-021 + change-log rows + open decisions.
  - `README.md` — doc index now includes ACCESSIBILITY + docs/legal.
- **Consistency check:** cross-document review performed; two stale section references corrected (COMPLIANCE, PROJECT_STATE); no contradictions requiring architectural reversal. IoT and blockchain remain optional; city expansion remains data-driven (no core rewrite).
- **Tests executed:** none (documentation-only phase).

## 2026-08-30 — Session 1 (Phase 0)
- **Added:** Phase 0 product + architecture documentation set (no application code):
  - `README.md` — project overview + doc index.
  - `docs/PRD.md` — product requirements, personas, V1 cut-line, flows.
  - `docs/ARCHITECTURE.md` — system/availability/real-time/IoT/India-scale architecture.
  - `docs/DATABASE.md` — PostgreSQL schema, ER diagram, integrity rules.
  - `docs/API_SPEC.md` — REST v1 + WebSocket/fallback + contracts.
  - `docs/BLOCKCHAIN.md` — Solidity/Foundry V1 contracts, no-PII rule.
  - `docs/SECURITY.md` — threat model + controls + per-feature checklist.
  - `docs/COMPLIANCE.md` — India DPDP-aware design + retention/deletion/workflows.
  - `docs/COST_MODEL.md` — V1 zero-cost baseline + decision rules.
  - `docs/IOT.md` — IoT-optional strategy, device security, telemetry contract.
  - `docs/ROADMAP.md` — Levels + Phases 0–13 + milestones.
  - `docs/DECISIONS.md` — D-001..D-016 decision log.
  - `docs/PROJECT_STATE.md` / `docs/SESSION_HANDOFF.md` — session state.
- **Tests executed:** none (no code yet; documentation-only session per prompt §39).
- **Refs:** decisions D-001..D-016.