# SmartPark India — Roadmap

Status: DRAFT v0.1
Last updated: 2026-08-30

---

## 1. Maturity Levels

| Level | Scope | Target | Gate |
|---|---|---|---|
| **Level 1 — Pune Prototype** | Working demonstration, not production. All local, free, mock providers. | ~4–8 weeks | All V1 features + tests pass locally |
| **Level 2 — Real-World MVP** | Small controlled pilot: real operators/users on a few verified Pune facilities. | ~3–6 months | Validation metrics + compliance/legal review |
| **Level 3 — India-Scale Product** | Multiple cities, integrations, production infra, business ops. | ~6–18+ months | Validated demand + funding/partnerships |

Never build Level 3 complexity during Level 1.

---

## 2. Phases

### PHASE 0 — Product + architecture (CURRENT — Session 1 deliverable)
Deliver: PRD, Architecture, Database, API spec, Blockchain spec, Security model, Compliance model, Cost model, Roadmap, IoT strategy.
No major implementation.

**Status: COMPLETE (this session)** when the docs below exist and are consistent.

### PHASE 1 — Project foundation
Frontend (Vite+React+TS+Tailwind), Backend (Node/TS/Express), Postgres (docker-compose), Foundry, env config, CI skeleton, lint/type/test toolchains run locally.
Gate: `docker-compose up` boots db+backend+frontend; `forge test` runs; CI green.

### PHASE 2 — Database + Backend core
Migrations + seeds; auth; RBAC; cities; parking registry; operators; slots; availability engine (manual); audit logs; basic APIs; WebSocket hub stub. Operator verification documents + document APIs (metadata in DB, binary in MinIO/local object storage per `ARCHITECTURE.md` §12).

### PHASE 3 — Frontend
Login/home/map/search/facility details/dashboards (user, operator, admin, gate). i18n (EN/MR/HI). Map via MapProvider abstraction (free).

### PHASE 4 — Reservation engine
Availability → reserve (exclusion-guarded) → mock payment → confirm → cancel/expire → sessions. Real-time via WS + polling fallback.

### PHASE 5 — Blockchain
Foundry contracts (ParkingRegistryV1, ReservationV1, ParkingTokenV1) + deploy to Anvil + backend integration + contract tests.

### PHASE 6 — QR + Gate
QR generation/scanning, verification, entry/exit, override-with-reason, gate staff RBAC. After online verification is stable: Offline Gate Mode enhancement (bounded local cache, event queue, resync, conflict resolution — `ARCHITECTURE.md` §11).

### PHASE 7 — Mock payment
`PaymentProvider` interface + `MockPaymentProvider`; states INITIATED/PENDING/SUCCESS/FAILED/REFUNDED; idempotency.

### PHASE 8 — IoT simulator
Simulator emitting AVAILABLE/OCCUPIED/OFFLINE/STALE into ingestion → availability engine; tests.

### PHASE 9 — Physical IoT prototype (optional)
4-slot ESP32 + ultrasonic demo. Only after software stable.

### PHASE 10 — Pune MVP validation
Demo/verified facilities, controlled users/operators; measure reservation success, verification, availability accuracy, UX.

### PHASE 11 — Real integrations
Evaluate PMS/ANPR/RFID/gate/maps/payment providers — assume APIs may not exist; adapter-driven.

### PHASE 12 — Multi-city expansion
Mumbai, Delhi, Bengaluru, Hyderabad, Chennai (+ Kolkata, Ahmedabad) without core-code duplication (data-driven cities).

### PHASE 13 — India-scale production
Caching, queues, horizontal scale, read replicas, CDN, object storage, observability, DR/HA, security monitoring. NOT premature; only after validation.

---

## 3. Business Roadmap (independent modules, evaluate each: value / complexity / cost / security / legal)

Corporate Parking · EV Charging · Monthly Pass · Subscriptions · Fleet Parking · Airport Parking · Mall Parking · Event Parking · Valet Parking · Parking API · Analytics · Demand Prediction · Dynamic Pricing · SmartPark IoT Kit.

Each module gets its own feasibility note in DECISIONS.md before inclusion.

---

## 4. Out-of-Scope Now (see also PRD §7)

Real payments, mainnet, hardware dependency, ANPR/RFID, dynamic pricing, AI prediction, EV integration, government APIs, corporate parking, native mobile, gate automation, Kubernetes. Phases ≥9 carry these.

---

## 5. Milestone Cheat-sheet

| # | Milestone | Phase | Done when |
|---|---|---|---|
| 1 | Docs complete | 0 | this session |
| 2 | Local stack boots | 1 | docker-compose + CI green |
| 3 | Registry + auth + slots APIs | 2 | integration tests |
| 4 | UI for all roles | 3 | E2E smoke |
| 5 | Reservation engine | 4 | no-double-book tests |
| 6 | Token on-chain | 5 | forge tests + e2e |
| 7 | Gate QR loop | 6 | e2e entry/exit |
| 8 | Mock payment | 7 | state tests |
| 9 | IoT simulator | 8 | ingestion + decay tests |
| 10 | Physical demo (opt.) | 9 | ESP32 reports |
| 11 | Pune pilot | 10 | validation report |