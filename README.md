# SmartPark India

Multi-city, **IoT-optional**, blockchain-enabled smart parking platform. Find → Compare → Reserve → Pay → Digital Token → Verify → Park → Exit.

- **Current phase:** Phase 1B — development infrastructure foundation (see `docs/ROADMAP.md`).
- **First city:** Pune, India (data-driven; designed for multi-city without code fork).

## Repo layout

```
frontend/       React + Vite + TypeScript web app (placeholder app so far)
backend/        Node + TypeScript + Express API (foundation: health/ready, storage, migrations)
packages/shared Shared TS constants/types/API contracts (@smartpark/shared)
contracts/      Solidity + Foundry contracts (toolchain scaffold; anvil dev chain)
iot/            Occupancy vocabulary + source seam (IoT optional) (@smartpark/iot)
docs/           Product & engineering documentation (single source of truth)
tests/          (future) E2E / cross-stack tests
scripts/        (future) Dev utilities + seeds
.github/        CI (format:check → lint → typecheck → test → build + forge)
```

## Workspace — getting started

npm workspaces monorepo. Node >= 20.19 recommended (Node 22 used during setup).

```bash
npm install            # install all workspaces
npm run infra:up       # boot postgres + MinIO + anvil via docker compose (pinned images, healthchecked)
npm run db:migrate     # apply backend/db/migrations/ to the local postgres (idempotent)
npm run check:infra    # verify postgres SELECT 1, MinIO round-trip, anvil eth_chainId
npm run dev            # builds shared, then runs API (:4000) + web (:5173) concurrently
npm run dev:api        # API only (tsx watch)
npm run dev:web        # web only (Vite)
npm run build          # shared → api → web → iot (tsc + vite)
npm run test           # unit tests across workspaces (vitest; 15 so far)
npm run typecheck      # tsc --noEmit across all workspaces
npm run lint           # ESLint 9 (flat config) — CI-gated
npm run format         # Prettier --write
npm run format:check   # Prettier --check — CI-gated
```

- Web app: http://localhost:5173 — SmartPark India placeholder (Pune MVP / Workspace Foundation).
- API: http://localhost:4000/health → `{"status":"ok",...}` (liveness, no dependencies).
- API: http://localhost:4000/ready → `{"status":"ready","services":{...}}` (postgres-backed readiness; 503 when down).
- Contracts: `forge build` / `forge test` from the repo root (`--root contracts` used by CI).
- Environment: copy `.env.example` to `.env` and adjust (ports/creds). Real `.env` is git-ignored; dev credentials in `.env.example` are local-only.
- Infra teardown: `npm run infra:down` (keeps data in named volumes), `npm run infra:logs` / `infra:ps`.

## Reading order for contributors

`docs/PROJECT_STATE.md` → `docs/SESSION_HANDOFF.md` → `docs/DECISIONS.md` → `docs/ROADMAP.md`, then the relevant design doc.

## Key documents

| Doc                   | Purpose                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| docs/PRD.md           | Product requirements, MVP cut-line, flows, business model                                           |
| docs/ARCHITECTURE.md  | System architecture, Availability Engine, real-time design                                          |
| docs/DATABASE.md      | PostgreSQL schema + ER diagram + integrity rules                                                    |
| docs/API_SPEC.md      | REST v1 + WebSocket/fallback contracts                                                              |
| docs/BLOCKCHAIN.md    | V1 contracts, no-PII-on-chain rule                                                                  |
| docs/SECURITY.md      | Threat model + controls + per-feature checklist                                                     |
| docs/COMPLIANCE.md    | India DPDP-aware design (not legal advice)                                                          |
| docs/ACCESSIBILITY.md | WCAG 2.2 AA development checklist (not a certification claim)                                       |
| docs/COST_MODEL.md    | Zero-cost V1 baseline + decision rules                                                              |
| docs/IOT.md           | IoT-optional architecture + device security                                                         |
| docs/DECISIONS.md     | Decision log (change-controlled)                                                                    |
| docs/legal/*          | Legal DRAFTs (privacy, ToS, refund, operator agreement) — require professional review, not approved |

## Guiding principles

- IoT is optional; the platform works with manual availability updates alone.
- No Pune-specific logic hard-coded; cities are data.
- No personal data on-chain (verifiable state only).
- Availability is always labeled with source, freshness, and confidence.
- Prototype ≠ MVP ≠ production — nothing untested is called done.

## Status

- Phase 0/0A complete (2026-08-30): full docs + legal drafts delivered.
- Phase 1A complete (2026-08-30): workspace foundation — web app, API health endpoint, shared package, toolchain wired.
- Phase 1B complete (2026-08-30): dev infra (postgres/MinIO/anvil via docker compose), DB/storage/ready foundations, IoT seam, Foundry scaffold, ESLint/Prettier, CI. No authentication or parking features yet.
- Next: Phase 2 (auth + RBAC, parking registry, manual availability engine — see `docs/SESSION_HANDOFF.md`).

## License

See `LICENSE` when added (not yet added — pending decision).
