# SmartPark India

Multi-city, **IoT-optional**, blockchain-enabled smart parking platform. Find → Compare → Reserve → Pay → Digital Token → Verify → Park → Exit.

- **Current phase:** Phase 0 — product + architecture (documentation only). See `docs/ROADMAP.md`.
- **First city:** Pune, India (data-driven; designed for multi-city without code fork).

## Repo layout (planned)
```
frontend/   React + Vite + TypeScript + Tailwind (i18n EN/MR/HI)
backend/    Node + TypeScript + Express (/api/v1, WebSocket, Availability Engine)
contracts/  Solidity + Foundry (ParkingRegistryV1, ReservationV1, ParkingTokenV1)
iot/        Device firmware + simulator (optional track)
docs/       Product & engineering documentation (single source of truth)
tests/      E2E / cross-stack tests
scripts/    Dev utilities + seeds
.github/    CI (lint → typecheck → tests → build → security checks)
```

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
| docs/COST_MODEL.md | Zero-cost V1 baseline + decision rules |
| docs/IOT.md | IoT-optional architecture + device security |
| docs/DECISIONS.md | Decision log (change-controlled) |

## Guiding principles
- IoT is optional; the platform works with manual availability updates alone.
- No Pune-specific logic hard-coded; cities are data.
- No personal data on-chain (verifiable state only).
- Availability is always labeled with source, freshness, and confidence.
- Prototype ≠ MVP ≠ production — nothing untested is called done.

## Status
- Phase 0 complete (2026-08-30): docs set delivered. No application code yet.
- Next: Phase 1 workspace foundation.

## License
See `LICENSE` when added (not yet added — pending decision).