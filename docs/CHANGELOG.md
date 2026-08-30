# SmartPark India — Changelog

Format: date — summary — refs. Chronological, newest last.

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