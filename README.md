# SmartPark India

Multi-city, **IoT-optional**, blockchain-enabled smart parking platform. Find → Compare → Reserve → Pay → Digital Token → Verify → Park → Exit.

- **Current phase:** Phase 1A — workspace foundation (see `docs/ROADMAP.md`).
- **First city:** Pune, India (data-driven; designed for multi-city without code fork).

## Repo layout
```
frontend/       React + Vite + TypeScript web app (placeholder in Phase 1A)
backend/        Node + TypeScript + Express API (health endpoint in Phase 1A)
packages/shared Shared TS constants/types/API contracts (@smartpark/shared)
contracts/      (future) Solidity + Foundry contracts
iot/            (future) Device firmware + simulator
docs/           Product & engineering documentation (single source of truth)
tests/          (future) E2E / cross-stack tests
scripts/        (future) Dev utilities + seeds
.github/        (future) CI (lint → typecheck → tests → build → security checks)
```

## Workspace — getting started

npm workspaces monorepo. Node >= 20.19 recommended (Node 22 used during setup).

```bash
npm install          # install all workspaces
npm run dev          # builds shared, then runs API (:4000) + web (:5173) concurrently
npm run dev:api      # API only (tsx watch)
npm run dev:web      # web only (Vite)
npm run build        # shared → api → web (tsc + vite)
npm run test         # shared + api unit tests (vitest)
npm run typecheck    # tsc --noEmit across all workspaces
```

- Web app: http://localhost:5173 — SmartPark India placeholder (Pune MVP / Workspace Foundation).
- API: http://localhost:4000/health → `{"status":"ok",...}`. No database required in Phase 1A.
- Environment placeholders: copy `.env.example` to `.env` as needed (real `.env` is git-ignored).

## Reading order for contributors
`docs/PROJECT_STATE.md` → `docs/SESSION_HANDOFF.md` → `docs/DECISIONS.md` → `docs/ROADMAP.md`, then the relevant design doc.

## Key documents
| Doc | Purpose |
|---|---|
| docs/PRD.md | Product requirements, MVP cut-line, flows, business model |
| docs/ARCHITECTURE.md | System architecture, Availability Engine, real-time design |
| docs/DATABASE.md | PostgreSQL schema + ER diagram + integrity rules |
| docs/API_SPEC.md | REST v1 + WebSocket/fallback contracts |
| docs/BLOCKCHAIN.md | V1 contracts, no-PII-on-chain rule |
| docs/SECURITY.md | Threat model + controls + per-feature checklist |
| docs/COMPLIANCE.md | India DPDP-aware design (not legal advice) |
| docs/ACCESSIBILITY.md | WCAG 2.2 AA development checklist (not a certification claim) |
| docs/COST_MODEL.md | Zero-cost V1 baseline + decision rules |
| docs/IOT.md | IoT-optional architecture + device security |
| docs/DECISIONS.md | Decision log (change-controlled) |
| docs/legal/* | Legal DRAFTs (privacy, ToS, refund, operator agreement) — require professional review, not approved |

## Guiding principles
- IoT is optional; the platform works with manual availability updates alone.
- No Pune-specific logic hard-coded; cities are data.
- No personal data on-chain (verifiable state only).
- Availability is always labeled with source, freshness, and confidence.
- Prototype ≠ MVP ≠ production — nothing untested is called done.

## Status
- Phase 0/0A complete (2026-08-30): full docs + legal drafts delivered.
- Phase 1A complete (2026-08-30): workspace foundation — web app, API health endpoint, shared package, toolchain wired. No authentication or parking features yet.
- Next: Phase 1B (foundation hardening — see `docs/SESSION_HANDOFF.md`).

## License
See `LICENSE` when added (not yet added — pending decision).