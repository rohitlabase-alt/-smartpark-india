# SmartPark India — System Architecture

Status: DRAFT v0.1
Last updated: 2026-08-30
Phase: PHASE 0

---

## 1. Architectural Principles

1. **IoT is optional.** The platform must be fully functional with manual operator updates alone.
2. **Single Availability Engine.** Manual, API, and IoT sources all normalize into one availability model.
3. **Monolith-first backend.** No microservices in V1. Modular monolith (Express) with clear module boundaries.
4. **Provider abstractions.** Payment, Maps, Geocoding, Routing are interfaces; mock/free implementations by default.
5. **Data-driven multi-city.** Cities/states are data, never code. No hard-coded Pune logic.
6. **Blockchain as verifiable state, not storage.** No personal data on-chain. Local dev chain in V1.
7. **Honest availability.** Never present stale/unknown data as live guaranteed availability.
8. **Real-time primary, polling fallback.** WebSocket with HTTP polling fallback.

---

## 2. High-Level System Diagram

```
                          ┌─────────────────────────────────────────────┐
                          │                 CLIENT (WEB)                │
                          │  React + Vite + TypeScript + Tailwind CSS   │
                          │  i18n (EN/MR/HI) · Maps view · QR · WS      │
                          └──────────────────▲──────────────────────────┘
                                             │ HTTPS / WSS (+ poll fallback)
┌────────────────┐                           │
│  MANUAL        │  Operator / gate actions  │
│  (Operators)   ─────────────┐              │
├────────────────┤             ▼             ▼
│  EXISTING APIs ──▶ Availability Engine ──▶ API Gateway / Express /api/v1
│  (Integrations)│   (normalize + freshness)│   auth · rbac · rate-limit
├────────────────┤             │            │
│  IoT (optional)─────▶ IoT Ingestion ──────┤   WebSocket hub
│  Simulator(V1)  │   (auth + validation)   │            │
└────────────────┘                          ▼            ▼
                     ┌────────────────────────────────────────────┐
                     │               POSTGRES (single DB, V1)     │
                     │  users · facilities · slots · reservations │
                     │  tokens · payments · audit · iot_readings  │
                     └───────────────▲────────────────────────────┘
                                     │ events / references (no PII)
                     ┌───────────────┴────────────────────────────┐
                     │      BLOCKCHAIN (EVM local dev chain)      │
                     │  ParkingRegistryV1 · ReservationV1 ·       │
                     │  ParkingTokenV1   (Solidity + Foundry)     │
                     └────────────────────────────────────────────┘
```

---

## 3. Backend Architecture (V1 Modular Monolith)

Stack: Node.js, TypeScript, Express.js.

Module layout under `backend/src/modules/`:

```
auth
├── registration, login, JWT, refresh, password reset, OTP-ready
users
├── profile, vehicles, roles assignment, locations
cities
├── cities, states, areas (data-driven)
parking
├── facilities, zones, slots, availability engine hooks
reservations
├── availability check, reserve, double-booking guard, cancel, expire
tokens
├── digital token, QR encode/decode, verification client (contract call)
payments
├── PaymentProvider interface
├── MockPaymentProvider (V1)
operators
├── operator org, staff, facility management
gate
├── scan, verify, entry/exit, manual override w/ reason
admin
├── approvals, users, facility management, audit views
iot
├── device registry, auth, telemetry ingestion, status
integrations
├── adapter scaffold for external parking APIs
notifications
├── provider-interface (email/SMS/push adapters, no-op/mock V1)
```

Cross-cutting:
- Middleware: auth, RBAC, validation (zod), rate limiting, request logging, error handling, request ID.
- WS hub: emits availability + reservation/token state changes.
- Config: env-based (`backend/src/config`), never committed secrets.
- API versioning: `/api/v1/`.

---

## 4. Availability Engine

```
Manual ─┐
API ─────┼──▶ Availability Engine ──▶ AvailabilityState
IoT ─────┘      {
                  slotId / categoryId
                  status: AVAILABLE | OCCUPIED | RESERVED | UNKNOWN
                  source: MANUAL | API | IOT
                  lastUpdatedAt
                  confidence: HIGH | MEDIUM_HIGH | MEDIUM | LOW | UNKNOWN
                }
                    │
                    ▼
        ┌──────────────────────────┐
        │ Persisted (DB)           │
        │ Broadcast (WebSocket)    │
        │ Served (REST)            │
        └──────────────────────────┘
```

Rules (initial deterministic confidence model):

| Source freshness | Confidence |
|---|---|
| IoT ≤ 30 s | HIGH |
| Trusted API ≤ 2 min | MEDIUM_HIGH |
| Manual/operator ≤ 10 min | MEDIUM |
| Any > 30 min | LOW |
| None | UNKNOWN |

Note: RESERVATIONS always take precedence over any source for the reserved span — availability engine merges source status with reservation state for the final displayed status.

---

## 5. Availability Lifecycle

```
Unknown ──▶ (source update) ──▶ Available / Occupied
    ▲                                    │
    │                                    │ reservation / release
    └──────── stale (>30min) ◀───── RESERVED (from reservation engine)
```

- A slot shown AVAILABLE in UI may still be reserved by a user in real time; the WS hub pushes updates to keep clients honest.
- LIVE badge requires confidence HIGH/MEDIUM_HIGH and recency; otherwise certainty is labeled lower.

---

## 6. Real-Time Architecture

```
Data Source → Backend → Availability Engine → WebSocket Hub → Frontend
Frontend fallback: if WS not connected → HTTP polling (e.g., every 30 s) of /api/v1/parking/:id/availability
```

- WS events: `availability.update`, `reservation.state`, `token.verified`.
- Polling endpoint returns identical payload shape so the UI path is shared.

---

## 7. Payment Provider Abstraction

```ts
interface PaymentProvider {
  initiatePayment(opts): Promise<PaymentInitiation>
  verifyPayment(txnId): Promise<PaymentStatus>
  refund(txnId, amount): Promise<RefundResult>
}
```

Payment states: `INITIATED | PENDING | SUCCESS | FAILED | REFUNDED`.

V1 implementation: `MockPaymentProvider` (no real money, clearly labeled in UI).
Future: UPI/Razorpay/Stripe etc. added without touching reservation logic.

---

## 8. Map Provider Abstraction

Interfaces:

```ts
interface MapProvider     { renderMap(...) }                 // UI abstraction
interface GeocodingProvider { geocode(address), reverseGeocode(lat,lng) }
interface RoutingProvider  { getDistance(a,b), getRoute(a,b) }
```

V1: free provider (OSM-based) or built-in map view; navigation handoff via `geo:`/maps deep links.
Map data never authorizes a facility — only SmartPark Registry facilities can be booked/tokenized.

---

## 9. Blockchain Integration

See `BLOCKCHAIN.md`. Summary:

- Solidity + Foundry, EVM-compatible local dev chain (Anvil) in V1.
- Contracts: `ParkingRegistryV1`, `ReservationV1`, `ParkingTokenV1`.
- Backend signs transactions with a service key (dev network), indexes events for reads.
- QR token encodes an off-chain reference (signed JWT for scan speed) AND an on-chain verifiable reference.
- No name/phone/email/vehicle number/PII on-chain — hashed references only where needed.

---

## 10. Data Flow: Full Reservation + Token

```

User reserves ──▶ Backend guard (DB lock) ──▶ Mock payment SUCCESS
     │                                              │
     ▼                                              ▼
Reservation CONFIRMED (DB) ──▶ Reserve/Token contract (local chain)
     │
     ▼
Digital token issued (QR + code)
     ▼
Gate scans → Backend verifies on-chain + DB → ENTRY (session ACTIVE)
     ▼
Exit → Backend → session COMPLETED → token status COMPLETED on-chain
```

---

## 11. IoT Architecture (Optional Track)

Physical data path (note: independent of the core platform):

```
ESP32 + ultrasonic ──▶ (auth: deviceId + secret) ──▶ IoT Ingestion API
      │                                                    │
      │ (MQTT/HTTP)                                        ▼
      │                                           validate + normalize
      └──────────────────────────────────────▶ Availability Engine
```

- Every device: deviceId, secret/keys, status (ONLINE/OFFLINE/STALE/ERROR), lastSeen, firmwareVersion.
- Unauthenticated telemetry rejected. No raw telemetry on-chain.
- V1 uses an **IoT Simulator** only. See `IOT.md`.

---

## 12. Environments & CI/CD

```
LOCAL (docker-compose: postgres + backend + frontend + anvil)
STAGING (deployed pre-production)
PRODUCTION (Level 3 only — never deployed untested)
```

CI runs: lint → type-check → unit tests → integration tests → contract tests → build → security checks.
Git: `main` / `develop` / `feature/*`. See `ROADMAP.md`.

---

## 13. Future India-Scale Architecture (NOT built now)

Level 3 evolution (for reference only, not implemented in V1):

```
CDN/CDN-L2 ──▶ Load balancers ──▶ Stateless API servers (horizontally scaled)
        │                              │
        ▼                              ▼
   WebSocket fan-out (pub/sub)   Read replicas / PostgreSQL cluster
        │                              │
        ▼                              ▼
   Queues (reservations, tokens, payments, notifications)
        │
        ▼
   Object storage (QR, docs) · Observability (metrics/traces/logs)
   Secrets manager · DR/HA · Security monitoring
```

Deliberately avoided until product validation (Level 3). Prerequisites are documented in `ROADMAP.md` Phase 13.

---

## 14. Architecture Review Checklist (used per feature)

- [ ] Feature does not depend on IoT/hardware.
- [ ] No Pune-specific hard-coding.
- [ ] Uses provider abstractions, not vendor-coupled calls.
- [ ] Availability data carries source/freshness/confidence.
- [ ] No PII sent to blockchain.
- [ ] Auth + RBAC enforced at API layer.
- [ ] DB transactions protect invariants (no double booking).
- [ ] Real-time via WS with polling fallback.
- [ ] Cost preset: free/local/mock unless justified.