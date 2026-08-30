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

## Open decisions (deferred)
- Real payment provider (Phase 11) — evaluate UPI providers; record in COMPLIANCE register first.
- On-chain network for production (Level 3): L2 EVM candidate list.
- Availability guarantee/liability model (Level 2, draft by counsel).
- Retention windows final numbers (confirm with counsel before production).
- Object-storage provider for Level 3 (S3 vs alternatives) — deferred; abstraction keeps it open.
- Offline mode operator adoption policy (which facilities may enable offline acceptance) — Level 2.