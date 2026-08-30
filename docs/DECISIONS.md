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

---

## Change log of decisions (reverse chronological)

| Date | Decision | Change | Why | Modules affected | Migration impact |
|---|---|---|---|---|---|
| 2026-08-30 | D-001..D-016 | Created (initial) | Session 1 | all | none (greenfield) |

## Open decisions (deferred)
- Real payment provider (Phase 11) — evaluate UPI providers; record in COMPLIANCE register first.
- On-chain network for production (Level 3): L2 EVM candidate list.
- Availability guarantee/liability model (Level 2, draft by counsel).
- Retention windows final numbers (confirm with counsel before production).