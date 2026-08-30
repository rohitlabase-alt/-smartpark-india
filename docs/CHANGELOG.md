# SmartPark India — Changelog

Format: date — summary — refs. Chronological, newest last.

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