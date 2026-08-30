# SmartPark India — Project State

Last updated: 2026-08-30 (Session 3 — Phase 1B)
Read before every session alongside SESSION_HANDOFF.md, DECISIONS.md, ROADMAP.md.

## Phase Status
```
Phase 0:  COMPLETE
Phase 0A: COMPLETE
Phase 1A: COMPLETE   (workspace foundation)
Phase 1B: COMPLETE   (development infrastructure foundation — this session)
Phase 2:  NOT STARTED (auth/RBAC/cities/parking registry/slots/availability engine manual/documents APIs)
Application business features: NOT STARTED (auth/parking/tokens/payments)
```

## Repository Status
- Baseline docs committed: `bc3264c`, `45eb0e4`, `7bdbe67`; Phase 1A committed `a8d3d8a`.
- Phase 1B committed this session (`feat: complete development infrastructure foundation`).
- Working tree: CLEAN (verified before commit).

## Completed (Phase 1B)
- `docker-compose.yml`: postgres 16.4-alpine + MinIO (pinned) + anvil (foundry v1.7.1), named volumes, real healthchecks, `.env`-overridable.
- Backend foundation: `backend/db/migrations/` + minimal transactional migration runner (`npm run db:migrate`); lazy `pg` pool + `GET /ready` (503 when postgres down; `/health` stays dependency-free); provider-agnostic `ObjectStorageProvider` (per `ARCHITECTURE.md` §12, AWS SDK v3 adapter for MinIO/S3); `npm run check:infra` (postgres/minio/anvil reachability); dotenv loads repo-root `.env`.
- `iot/` workspace (`@smartpark/iot`): occupancy vocabulary + `OccupancySource` seam + real `ManualOccupancySource`; IoT optional.
- `contracts/` Foundry scaffold: solc 0.8.27, `DevPlaceholder.sol`, dependency-free tests; `forge build`/`forge test` green.
- Tooling: ESLint 9 flat config (`npm run lint`), Prettier 3 (`format`/`format:check`), CI `.github/workflows/ci.yml` (node gate + contracts job; no deploy/secrets).
- Root scripts: `infra:up/down/ps/logs`, `db:migrate`, `check:infra`.
- Docs: DECISIONS D-024..D-029; CHANGELOG, README, SESSION_HANDOFF updated.

## Pending (next logical work)
- **Phase 2:** migrations for core tables (users/cities/parking registry/operators/slots/availability/audit + FK wiring for `documents`), auth + RBAC, availability engine (manual source), basic APIs, audit logs. Contracts/IoT remain optional scaffolds.
- Phase 1B infra removed (`docker compose down`) after verification — start again with `npm run infra:up`.

## Known Bugs / Issues
- None blocking. Two carried-over quirks: (1) npm blocks esbuild's postinstall (allowScripts) — non-fatal, builds/tests verified green; (2) on this dev machine Docker Desktop exposes the engine only via the Windows-side `desktop-linux` context (npipe) — `docker compose` defaults to that context and works.

## Risks
- Migrations for base tables must wire the FKs `documents` currently defers (Phase 2).
- Toolchain majors (Vite 8 / Vitest 4 / TS 5.9 / ESLint 9 / Forge 1.7) are current-stable but newer than Phase 0 docs assumed — D-023/D-029 record the choices.
- Tailwind still deferred to Phase 3.

## Commands
`START SESSION` → read this file + SESSION_HANDOFF + DECISIONS + ROADMAP.
`STATUS / TEST / SECURITY REVIEW / ARCHITECTURE REVIEW / HANDOFF / STOP` — see SESSION_HANDOFF.md §8.