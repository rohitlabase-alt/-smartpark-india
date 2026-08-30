# SmartPark India — System Architecture

Status: DRAFT v0.1 (Phase 0A)
Last updated: 2026-08-30
Phase: PHASE 0 / 0A

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

## 11. Offline Gate Mode

### 11.1 Purpose & Scope

Gate entry/exit must keep working when the facility loses internet connectivity, WITHOUT weakening security. Offline mode is a **bounded convenience feature**: it caches only the minimum verification data, enforces a short acceptance window, and reconciles everything once connectivity returns. Security always takes priority over convenience.

Out of scope in V1: offline mode is a design contract; basic V1 behavior is online-only verification with a clearly documented degradation message. The offline queue design below is the target for a later phase (Phase 6 enhancement), implemented only after online verification is stable and tested.

### 11.2 Online verification (baseline)

```
User token → Gate Staff (scans QR) → API (POST /gate/tokens/verify)
     → Token verification (DB + on-chain cross-check)
     → Entry/Exit event recorded → Database (+ audit log)
     → Gate approves/rejects with server-authoritative result
```

Online verification is always the default and the most trusted path. Any decision it rejects cannot be overridden by offline logic.

### 11.3 Offline verification

When connectivity is unavailable, the gate application changes behaviour as follows:

- **Local secure cache:** the gate device caches only a minimal allow-list of token references it has recently been authorized to read. The cache is encrypted at rest (device key, OS keychain/file-channel), never plaintext.
- **Cached token/reference data:** cache contains `{ tokenRef, facilityRef, validUntil, status, entryDeterministicId }` only. **No PII** (no name, phone, email, plate, payment data) is cached.
- **Event queue:** accepted ENTRY/EXIT decisions are written to a local persistent queue (append-only) with the exact record kept after verification.
- **Local audit records:** every offline decision writes a local audit entry (`timestamp, action, tokenRef, gateUserId, deviceId, accepted, reason`). Local logs are durable and uploaded before being overwritten/cleaned.
- **Synchronization after reconnection:** the queue is pushed to the server in order; each item carries an idempotency key.
- **Conflict resolution:** server state is authoritative. See §11.5.
- **Duplicate/replay prevention:** offline decisions are single-use per token (see §11.5) and carry monotonic sequence numbers.
- **Expiry handling:** cached authorization expires at the earlier of (`validUntil` from the token) or (configurable offline window, default policy §11.4). Expired cached authorization is rejected outright, even if the device remains offline.

Flow:

```
Offline events → Local queue → Connectivity restored → Server synchronization
     → Idempotency check → Conflict detection → Resolution → Audit record
```

### 11.4 Token caching limits (configurable policy — default values are POLICY DEFAULTS, not fixed law)

| Policy knob | Default | Notes |
|---|---|---|
| `OFFLINE_ACCEPT_WINDOW` | 5 minutes | Max time since the cached authorization was validated online before offline acceptance. Configurable per facility. |
| `OFFLINE_CACHE_TTL` | 15 minutes | Max age of any cached token reference on the device; entries older are purged. |
| `OFFLINE_MAX_ENTRIES_PER_DEVICE` | 200 | Bounded cache size to prevent unbounded growth. |
| `OFFLINE_QUEUE_MAX` | 1,000 events | Bounded queue; if exceeded, offline mode rejects new decisions (fail-closed). |
| `OFFLINE_MAX_ACCEPTED_PER_TOKEN` | 1 | A token may be accepted at most once (entry) + once (exit) in the offline queue; any further offline use of the same token is rejected. |

Rules (non-negotiable):
- Cache only the minimal verification info above; never unnecessary personal information.
- Cached authorization has a short, configurable validity window.
- Offline acceptance is limited and fail-closed (default-reject).
- Expired cached authorization is rejected.

Any change to these values is a change-controlled configuration decision (recorded in `DECISIONS.md`), not an ad-hoc code constant.

### 11.5 Synchronization, conflict resolution, and edge cases

Server is authoritative. On resync each event is:

1. **Idempotency check** — every offline event carries a deterministic `eventId` + `Idempotency-Key`; if the server has already applied it, it is skipped (returns the previously stored result).
2. **Conflict detection** — server compares the offline decision against current DB/token state.
3. **Resolution** — see matrix below.
4. **Audit record** — every outcome (applied / skipped / rejected / escalated) is appended to `audit_logs`.

| Scenario | Resolution (security-first) |
|---|---|
| Same token used twice offline (two ENTRY events) | First offers whichever is rejected by the other. Any second ENTRY is rejected and flagged; both recorded. If timestamps differ, the earlier is kept, the later is rejected. |
| Entry exists on device but no exit on server | On resync, exit is applied normally; if the exit is missing because the device lost the record, the server marks the session active and the gate re-verifies online before exit. |
| Server state conflicts with local state (e.g., token already COMPLETED server-side) | Offline acceptance is REJECTED. Server state wins; device is told to purge the cached entry. |
| Offline token has expired | Rejected. Server+device never accept an expired token. |
| Two gate devices submit conflicting events (e.g., DEV-1 entry, DEV-2 says same token not entry on this device) | The server merges by unique eventId; the token state machine allows one ENTRY and one EXIT. The competing device's event is rejected with a clear reason, and both are audited. |

**Security-first principle:** in any ambiguity, reject. Overrides are only possible online, by an authorized staff member, with a mandatory reason (recorded).

---

## 12. Document Storage (S3-compatible abstraction)

### 12.1 Purpose

Operator verification documents and parking images are stored as objects, NOT as large blobs in PostgreSQL. The database holds metadata/reference only. The storage layer is an abstraction so the app never couples to one vendor.

Supportable providers:
- **MinIO** — local/dev default (free, S3-compatible, runs in Docker). Aligns with the V1 zero-cost rule (`docs/COST_MODEL.md`).
- **AWS S3** — production candidate.
- **Any other S3-compatible provider** (storage abstraction, single adapter).

### 12.2 Abstraction

```ts
interface ObjectStorageProvider {
  put(bucket, key, data, { contentType }): Promise<StoredObject>
  getSignedGetUrl(bucket, key, ttlSeconds): Promise<string>   // temporary access
  getSignedPutUrl?(bucket, key, { contentType, maxSize }): Promise<string>
  delete(bucket, key): Promise<void>
  head(bucket, key): Promise<ObjectMeta>
}
```

The DB stores `storage_key` + metadata, never the object bytes (`docs/DATABASE.md` §2.23).

### 12.3 Upload flow (small-file, app-mediated in V1)

```
Client → POST /documents (multipart) → Backend validates (type, size, auth)
  → Backend generates storage key
  → Backend uploads bytes via ObjectStorageProvider.put
  → Backend inserts `documents` row (storage_key + metadata, status=PENDING)
  → Audit log entry
```

Optionally, for large files later: `getSignedPutUrl` used by the client and an async confirmation webhook — with a "Planned / Future" marker.

### 12.4 Storage key generation

- Key pattern: `{org}/{entityType}/{entityId}/{uuid}.{ext}` (e.g., `doc/operator/42/8f3c...1a.pdf`).
- Never include user PII (name/phone/email) or plaintext IDs that enable enumeration in the public key.
- UUID is the non-guessable component; regarding guessing, keys themselves are unguessable but access still requires auth (see §12.5).

### 12.5 Access control & privacy

- Buckets are **private by default**. Nothing is ever made a public bucket.
- All reads require (a) authentication and (b) RBAC ownership/role scope.
- Direct object access is via **short-lived signed GET URLs** (e.g., 300 s TTL, configurable) issued only through an authorized API endpoint.
- Never expose the storage bucket URL/bucket names to clients as public endpoints.
- Document download authorization: document owner (operator), verifier/admin; parking images viewable per facility policy with the same scoped rules.

### 12.6 File validation

- **File type validation:** MIME allow-list per `document_type` (e.g., allowed image/pdf types); validate by magic bytes server-side, not just client extension/MIME.
- **File size validation:** per-type maximum (e.g., default `DOC_MAX_BYTES` = 10 MB images / 20 MB PDFs — configurable policy defaults recorded in `DECISIONS.md`, not arbitrary constants in code).
- **Malware/security scanning:** a production requirement, deferred and documented as such (async AV-scan hook in the storage adapter; V1 accepts trusted/operator-test documents with a clear warning). Marked **Future / Production**.
- Reject oversized/malformed uploads before writing to storage.

### 12.7 Retention & deletion

- Retention follows `docs/COMPLIANCE.md` §4 (operator verification documents kept while operator active + legal retention window).
- Soft-delete the metadata row first (`documents.deleted_at`), then delete the object from storage (cascade in reverse order to avoid orphan objects).
- Deletion is threaded through the user/operator deletion and data-retention jobs.

### 12.8 Audit logging

- Upload, verify, reject, download(signed URL issuance), and delete events are recorded in `audit_logs` (append-only) with actor/timestamp/entity (`docs/DATABASE.md` §2.22).
- Signed URL issuance is logged (rate-limited) to detect abuse.

### 12.9 Cost & scale notes

- V1 uses **MinIO in Docker** (₹0) — see `docs/COST_MODEL.md`.
- Production object storage is a Level 3 concern (per `ROADMAP.md` Phase 13) — the abstraction means switching providers does not touch application logic or DB schema.

---

## 13. IoT Architecture (Optional Track)

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

## 14. Environments & CI/CD

```
LOCAL (docker-compose: postgres + backend + frontend + anvil)
STAGING (deployed pre-production)
PRODUCTION (Level 3 only — never deployed untested)
```

CI runs: lint → type-check → unit tests → integration tests → contract tests → build → security checks.
Git: `main` / `develop` / `feature/*`. See `ROADMAP.md`.

---

## 15. Future India-Scale Architecture (NOT built now)

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

## 16. Architecture Review Checklist (used per feature)

- [ ] Feature does not depend on IoT/hardware.
- [ ] No Pune-specific hard-coding.
- [ ] Uses provider abstractions, not vendor-coupled calls.
- [ ] Availability data carries source/freshness/confidence.
- [ ] No PII sent to blockchain.
- [ ] Auth + RBAC enforced at API layer.
- [ ] DB transactions protect invariants (no double booking).
- [ ] Real-time via WS with polling fallback.
- [ ] Offline gate paths fail closed and are bounded/cache-minimal (§11).
- [ ] Large blobs go to object storage; DB stores references only (§12).
- [ ] Cost preset: free/local/mock unless justified.