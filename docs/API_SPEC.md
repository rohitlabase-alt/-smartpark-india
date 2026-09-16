# SmartPark India — API Specification (V1)

Status: DRAFT v0.1 (Phase 0A)
Last updated: 2026-08-30
Base path: `/api/v1`
Transport: HTTPS (REST) + WebSocket (`/ws`) with HTTP polling fallback.

---

## 1. Conventions

- Request/response: JSON (`application/json`).
- Auth: `Authorization: Bearer <JWT>` for most endpoints.
- Errors: consistent shape below.
- Pagination: `?page=1&limit=20` returning `{ data, meta }`.
- Validation errors: 400 + field details.
- Idempotency: reserve/create operations accept `Idempotency-Key`.

### Error body

```json
{
  "error": {
    "code": "RESERVATION_CONFLICT",
    "message": "Slot is no longer available for this window",
    "details": {}
  }
}
```

### Standard status codes

| code | meaning |
|---|---|
| 200/201 | success / created |
| 400 | validation / bad request |
| 401 | unauthenticated |
| 403 | forbidden (RBAC) |
| 404 | not found |
| 409 | conflict (double booking, state transition) |
| 422 | unprocessable state (e.g., cancel on COMPLETED) |
| 429 | rate limited |
| 500 | server error |

---

## 2. Endpoint Map (module → routes)

### auth
| method | path | role | description |
|---|---|---|---|
| POST | /auth/register | public | user registration |
| POST | /auth/login | public | returns access + refresh tokens |
| POST | /auth/refresh | public | rotate refresh token |
| POST | /auth/logout | auth | revoke session |
| POST | /auth/forgot-password | public | send reset link (mock email) |
| POST | /auth/reset-password | public | reset with token |

### users
| method | path | role | description |
|---|---|---|---|
| GET | /users/me | auth | own profile |
| PATCH | /users/me | auth | update profile/locale |
| GET | /users/me/vehicles | auth | list vehicles |
| POST | /users/me/vehicles | auth | add vehicle |
| DELETE | /users/me/vehicles/{id} | auth | remove vehicle |
| GET/PATCH | /users/me/location | auth | saved location |

### cities (data-driven)
| method | path | role | description |
|---|---|---|---|
| GET | /cities | public | list active cities |
| GET | /cities/{id}/areas | public | list areas |

### parking
| method | path | role | description |
|---|---|---|---|
| GET | /parking | public | search facilities (filters: city, area, type, vehicle, availability) |
| GET | /parking/{facilityId} | public | facility detail incl. availability + freshness |
| GET | /parking/{facilityId}/availability | public | availability snapshot (polling fallback) |
| GET | /parking/{facilityId}/pricing | public | pricing rules |
| GET | /parking/{facilityId}/slots | public | slot list (levels of honesty: aggregated counts + freshness) |

### reservations
| method | path | role | description |
|---|---|---|---|
| GET | /reservations | user | own reservation history |
| POST | /reservations (check availability then create PENDING_PAYMENT) | user | create reservation (idempotent) |
| POST | /reservations/{code}/confirm | user | confirm after payment success |
| POST | /reservations/{code}/cancel | user | cancel (no refund in mock — D-035) |
| GET | /reservations/{code} | user/operator/admin | detail |

> **Implementation status (Phase 7 — mock payment lifecycle):** `GET /reservations`, `POST /reservations`, `GET /reservations/{code}`, and `POST /reservations/{code}/cancel` are **implemented** (mounted at `/api/v1/reservations`, user-authenticated, ownership enforced server-side — a user may list/detail/cancel only their own bookings, 404 `BOOKING_NOT_FOUND` on anyone else's). Creation produces a `PENDING_PAYMENT` booking with a computed `amount` (`facility.pricing` JSONB's `hourlyRate`, default ₹100/hr — see `DECISIONS.md` D-035) and `paymentStatus: "INITIATED"`; it becomes `CONFIRMED` only after a successful `POST /payments/{txnId}/verify`. Customer cancellation is allowed while `PENDING_PAYMENT` or `CONFIRMED` (no refund workflow — the mock never reverses the CHARGE; D-035). Tokens/QR codes and the remaining states (`ACTIVE`/`EXPIRED`) are deferred to the tokens phase. Double-booking is enforced by the DB-level btree_gist exclusion constraint on `(slot_id, [starts_at, ends_at))` for `PENDING_PAYMENT`/`CONFIRMED`/`ACTIVE` → `409 RESERVATION_CONFLICT`. `GET /operators/me/reservations` is also implemented for `PARKING_OPERATOR` users and returns only reservations joined to facilities owned by their operator organization.

### tokens
| method | path | role | description |
|---|---|---|---|
| GET | /tokens/{code} | auth | fetch token detail (QR payload) |
| POST | /tokens/{code}/qr | auth | QR data for the user |
| POST | /gate/tokens/verify | gate/operator | verify token for entry/exit (scan) |
| POST | /gate/tokens/{code}/entry | gate/operator | approve entry |
| POST | /gate/tokens/{code}/exit | gate/operator | approve exit |
| POST | /gate/tokens/{code}/override | gate (with reason) | manual override (reason required) |

> **Phase 9, Block 3 — parking-pass vs gate tokens:** the planned `/gate/tokens/*` entry/exit set is **not implemented**. Block 3 replaces it with the parking-pass flow: `GET /parking-sessions/by-reservation/{code}/pass` issues the deterministic `ppk_` token and `POST /parking-sessions/entry { verificationToken }` consumes it at the gate (see §2 **parking-sessions**). The `/gate/tokens/*` rows and §4 remain as a legacy/alternate contract; nothing in V1 implements them.

### payments
| method | path | role | description |
|---|---|---|---|
| POST | /payments/initiate | user | initiate mock payment for reservation |
| POST | /payments/{txnId}/verify | user | verify mock payment result |

> **Implementation status (Phase 7 — mock payment flow):** both endpoints are **implemented** (mounted at `/api/v1/payments`, user-authenticated, server-side ownership enforced — initiating/verifying another user's reservation is 404 `PAYMENT_NOT_FOUND`, never an IDOR leak).
>
> - `POST /payments/initiate { reservationCode, [Idempotency-Key] }` → `200 { payment }`. Reserved when the reservation is `PENDING_PAYMENT` and has a non-zero `amount`; otherwise `409 PAYMENT_NOT_PENDING` / `409 PAYMENT_UNAVAILABLE`. The provider (`MOCK`) derives a deterministic `providerTxnId` (`MOCK-<code>-<amount>`). A repeat with the same `Idempotency-Key` reuses the existing payment (no duplicate attempt; key TTL 15 min).
> - `POST /payments/{txnId}/verify` → `200 { payment, reservation }`. `MOCK` verification: `providerTxnId` ending in `__FAIL__` → `FAILED`, otherwise `SUCCESS`. SUCCESS is atomic: payment → `SUCCESS`, reservation → `CONFIRMED` (`paymentStatus: "SUCCESS"`, `confirmedAt` set), one `CHARGE`/`SUCCESS` ledger transaction — all in a single DB transaction. FAILED is atomic too: payment → `FAILED`, reservation → `FAILED` (never CONFIRMED), one `CHARGE`/`FAILED` transaction. Re-verifying a SUCCESS payment is idempotent; re-verifying a FAILED one → `409 PAYMENT_ALREADY_FAILED`; verifying when the reservation is no longer pending → `409 RESERVATION_NOT_CONFIRMABLE` (the whole verification rolls back).

### parking-sessions
| method | path | role | description |
|---|---|---|---|
| POST | /parking-sessions/entry | user/operator | enter: paid CONFIRMED reservation → ACTIVE session (mints one-time bearer entry token); accepts exactly one of `reservationCode` or `verificationToken` |
| GET | /parking-sessions/{id} | user/operator | session detail (owner or facility operator) |
| POST | /parking-sessions/{id}/exit | user/operator | exit: ACTIVE → COMPLETED, release slot |
| GET | /parking-sessions/by-reservation/{code} | user/operator | most recent session for a reservation (for re-hydration or verification) |
| GET | /parking-sessions/by-reservation/{code}/pass | user/operator | deterministic parking-pass token (`ppk_`) for gate entry |

> **Implementation status (Phase 9, Block 1 — entry/exit foundation, Block 2 — session read/UI, Block 3 — pass/gate tokens + occupancy):** all endpoints are **implemented** (mounted at `/api/v1/parking-sessions`, authenticated, authorization enforced server-side — the reservation owner OR the VERIFIED operator who owns the facility; any other caller gets `404`, no existence disclosure).
>
> - `POST /parking-sessions/entry { reservationCode }` → `201 { session, entryToken }`. Requires a `CONFIRMED` (paid) reservation; otherwise `409 RESERVATION_NOT_ENTRYABLE`. The reservation's facility must be `VERIFIED` + active (`409 FACILITY_NOT_ENTRYABLE`) and the reservation must have an assigned slot (`409 SLOT_NOT_ASSIGNED`). Entry is atomic: reservation → `ACTIVE`, slot → `OCCUPIED` (guarded `AVAILABLE`/`RESERVED` update — `409 SLOT_OCCUPIED` if already taken), availability cache mirrored, `PARKING_SESSION_ENTRY` audit record written. The `entryToken` (`ses_<48 hex>`) is a high-entropy one-time bearer credential returned **only** by this call; only its SHA-256 digest is stored, and it never appears in audit metadata (safe for a future QR/gate flow). Double entry → `409 SESSION_ALREADY_ACTIVE`.
> - `POST /parking-sessions/entry { verificationToken }` → `201 { session, entryToken }`. Exactly one of `reservationCode` / `verificationToken` is accepted (zod `.strict()`), both → `400 VALIDATION_ERROR`. The token is a deterministic HS256 JWT (`ppk_` prefix, `scope: parking:entry`, `sub` = reservation code, `exp` = reservation.endsAt). Verified against the stored SHA-256 digest (`reservations.verification_token_hash`, unique partial index) with an in-tx lazy backfill for pre-migration rows. Failed token format/digest → `409 INVALID_TOKEN`; before the reservation window → `409 TOKEN_NOT_YET_VALID`; after `endsAt` → `409 TOKEN_EXPIRED`. All other state checks and the slot-occupancy + uniqueness guards mirror the reservationCode path (`SESSION_ALREADY_ACTIVE`, `SLOT_OCCUPIED`, `FACILITY_NOT_ENTRYABLE`, `SLOT_NOT_ENTRYABLE` for reservations-enabled=false slots, `SLOT_UNAVAILABLE` for OUT_OF_SERVICE slots). Reusing the same token (or a second reservation on the same slot) concurrently → exactly one `201`, the other `409` via `active_session` / `active_slot` partial unique indexes.
> - `POST /parking-sessions/{id}/exit` → `200 { session }`. Exiting a non-active session → `409 SESSION_NOT_ACTIVE`. Atomic: session → `COMPLETED`, slot → `AVAILABLE` (operator-set statuses preserved, and only while no other active session holds the slot — manual correction of a stuck `OCCUPIED` slot is allowed via slot-status update, see `slots`), reservation → `COMPLETED`, availability cache mirrored, `PARKING_SESSION_EXIT` audit record.
> - `GET /parking-sessions/{id}` → `200 { session }`. Never returns an entry token. The session id is a lookup identifier, never a security credential — authorization is enforced server-side.
> - **Block 2:** `GET /parking-sessions/by-reservation/{reservationCode}` → `200 { session }` returns the owner's most recent session for a booking code (lets a driver reload and resume/exit an active session, and an operator confirm a vehicle's on-site state). Unknown/foreign code or no session → `404 SESSION_NOT_FOUND`. The entry token is never returned by any read endpoint.
> - **Block 2:** `GET /operators/me/sessions` → `200 { sessions }` lists the verified operator's facility sessions (newest first; only `ACTIVE` by default, no customer PII superset); unverified operators → `403 OPERATOR_NOT_VERIFIED`.
> - **Block 3:** `GET /parking-sessions/by-reservation/{reservationCode}/pass` → `200 { verificationToken }`. Owner or the facility's VERIFIED operator (else `404`, no disclosure). Only when the reservation is `CONFIRMED` (else `409 RESERVATION_NOT_ENTRYABLE`) and within its window (see `TOKEN_NOT_YET_VALID`/`TOKEN_EXPIRED`). Tokens are **deterministic** for a reservation (byte-identical on repeat reads — re-run longest-prefix vs `PARKING_SESSION_ENTRY`-tracked primes), so re-requesting never invalidates an existing one. Lazy hash backfill happens inside the same transaction. The header `verificationToken` claim must be a reservation code (`^BKG-[0-9A-F]{12}$`), enforced as a digest-format guard (invalid → `INVALID_TOKEN`).
> - **Block 3 — occupancy integrity:** slot status changes away from `OCCUPIED` throw `409 SLOT_IN_USE` **only** when an active session still references the slot (row-lock serialization via `findByIdForUpdate`); genuine manual corrections of stuck slots remain allowed. Success audit actions: `GATE_ENTRY_VERIFIED`/`GATE_EXIT_VERIFIED` (verification `"reservation-code"`|`"gate-token"`, enteredBy `CUSTOMER`|`OPERATOR`, slot-release/occupancy events `SLOT_OCCUPIED`/`SLOT_RELEASED`). Rejections write `GATE_ENTRY_REJECTED`/`GATE_EXIT_REJECTED` (SESSION_NOT_ACTIVE only) with `metadata.reason` = the error code — tokens never appear in audit metadata.

### operators
| method | path | role | description |
|---|---|---|---|
| POST | /operators/register | operator | operator registration → PENDING |
| GET | /operators/me | operator | own operator profile |
| PATCH | /operators/me | operator | update profile |
| GET | /operators/me/facilities | operator | own facilities |
| POST | /operators/me/facilities | operator | submit facility (PENDING) |
| PATCH | /operators/me/facilities/{id} | operator | edit facility/detail |
| POST | /operators/me/facilities/{id}/slots | operator | add slot |
| PATCH | /operators/me/slots/{id}/availability | operator | manual availability update (source=MANUAL) |
| PATCH | /operators/me/facilities/{id}/status | operator | deactivate/activate |
| GET | /operators/me/reservations | operator (verified) | view own reservations |
| GET | /operators/me/sessions | operator (verified) | active parking sessions across owned facilities |
| GET | /operators/me/reports/occupancy | operator | basic occupancy |

### admin
| method | path | role | description |
|---|---|---|---|
| GET | /admin/operators | admin | operator list (filter by `?status`, default `PENDING`) |
| POST | /admin/operators/{id}/review | admin | START review (PENDING → UNDER_REVIEW) |
| POST | /admin/operators/{id}/approve | admin | approve (UNDER_REVIEW → VERIFIED) |
| POST | /admin/operators/{id}/reject | admin | reject (UNDER_REVIEW → REJECTED) |
| POST | /admin/operators/{id}/suspend | admin | suspend *(deferred — no VERIFIED→SUSPENDED yet)* |
| GET | /admin/facilities | admin | facility list (filter by `?status`, default `PENDING`) |
| POST | /admin/facilities/{id}/review | admin | START review (PENDING → UNDER_REVIEW) |
| POST | /admin/facilities/{id}/approve | admin | approve (UNDER_REVIEW → VERIFIED) |
| POST | /admin/facilities/{id}/reject | admin | reject (UNDER_REVIEW → REJECTED) |
| POST | /admin/facilities/{id}/activate | admin | activate (VERIFIED → ACTIVE) |
| POST | /admin/facilities/{id}/deactivate | admin | deactivate (VERIFIED → INACTIVE) |
| GET | /admin/audit-events | admin | audit trail query (newest-first; filters + pagination) |
| GET | /admin/platform-summary | admin | platform dashboard aggregates + newest audit events |
| GET | /admin/users | admin | user management *(deferred)* |
| PATCH | /admin/users/{id}/status | admin | suspend/activate *(deferred)* |
| GET | /admin/reservations | admin | monitor reservations *(deferred)* |

> **Implementation status (Phase 8 — admin):** the operator and facility endpoints plus the audit trail and platform dashboard are **implemented** (mounted at `/api/v1/admin`, authenticated **and** `ADMIN` role enforced server-side via `requireAuth` + `requireRole("ADMIN")`). Operator workflow is strict and sequential — `GET /admin/operators?status=` lists by the shared `OPERATOR_STATUSES` vocabulary (invalid filter → `400 VALIDATION_ERROR`); `POST /{id}/review` moves `PENDING → UNDER_REVIEW`; `POST /{id}/approve` records the admin as `approved_by` with `approved_at` only from `UNDER_REVIEW → VERIFIED`; `POST /{id}/reject` moves `UNDER_REVIEW → REJECTED`. Facility workflow mirrors it (`PENDING → UNDER_REVIEW → VERIFIED | REJECTED`), plus `POST /{id}/activate` / `POST /{id}/deactivate` toggles (VERIFIED only). Any transition from the wrong source state → `409 <ENTITY>_STATUS_CONFLICT`; unknown/non-numeric ids → `404 <ENTITY>_NOT_FOUND`; non-admin sessions → `403 FORBIDDEN`. Verification gating: only `VERIFIED` operators may create/list/update facilities, create/list/update slots, or use `GET /operators/me/reservations` / cancel via the operator flow (PENDING/UNDER_REVIEW/REJECTED → `403 OPERATOR_NOT_VERIFIED`); `GET /operators/me/sessions` (Block 2) is gated the same way; registration and `GET /operators/me` stay open. Review does **not** record a reviewer identity and reject does **not** persist a reason (schema has only `approved_by`/`approved_at` — see `DECISIONS.md` D-036).
>
> **Phase 8, Part 4 — audit trail + platform dashboard:** `GET /admin/audit-events` returns the append-only audit trail newest-first with optional `action`/`entityType`/`actorUserId`/`entityId`/`from`/`to` filters and `page`/`limit` pagination (`{ events, page, limit, total }`; invalid vocabulary/date/non-numeric filter → `400 VALIDATION_ERROR`). `GET /admin/platform-summary` returns aggregate counts + status breakdowns by the existing vocabularies + the 10 newest audit events (`recentAuditEvents`); deliberately no user PII. **Phase 9, Block 3** adds the live occupancy aggregates `activeParkingSessions`, `occupiedSlots`, `availableSlots` (counted from active sessions + `OCCUPIED`/available slot statuses). Audit events are **server-generated** inside the same transaction as the underlying mutation — there is no audit-write endpoint (reads only, `docs/SECURITY.md` §5).

### documents
Metadata lives in the DB; binary lives in private S3-compatible object storage. **Private storage is never exposed directly** — clients get metadata via API and short-lived signed URLs only (`ARCHITECTURE.md` §12).

| method | path | role | description |
|---|---|---|---|
| POST | /operators/me/documents | operator | upload operator verification document (multipart) |
| GET | /operators/me/documents | operator | list own documents (metadata only) |
| GET | /operators/me/documents/{documentId} | operator | document metadata + signed download URL (TTL-limited) |
| POST | /operators/me/facilities/{facilityId}/documents | operator | upload parking facility image/attachment |
| GET | /operators/me/facilities/{facilityId}/documents | operator | list facility documents |
| GET | /admin/documents | admin/verifier | review queue (filter by verification_status, pending first) |
| GET | /admin/documents/{documentId} | admin/verifier | metadata + signed download URL (review use) |
| POST | /admin/documents/{documentId}/verify | verifier/admin | approve document → VERIFIED |
| POST | /admin/documents/{documentId}/reject | verifier/admin | reject with required note → REJECTED |

Authorization rules:
- Operators can only access documents of their own operator org / own facilities (ownership + facility-scope checks; IDOR resistance per `SECURITY.md`).
- Verifier/admin can access the full review queue.
- All download access is via short-lived signed URLs; every issuance is audit-logged.

Implementation status:
- Endpoints are defined now as the V1 contract.
- Operationally they land with the **Operator onboarding + Admin verification work in Phase 2/6** (see `ROADMAP.md`); nothing in this spec asserts they already exist.

Implementation status (Phase 2B — parking slots + manual availability):
- `POST /operators/me/facilities/{id}/slots` (add slot) and `GET /operators/me/facilities/{id}/slots` (list own facility's slots) are **implemented**. Slot status is changed via `PATCH /operators/me/facilities/{id}/slots/{slotId}` (body: `status`/`vehicleType`/`reservationsEnabled`); this is the Phase 2B **manual availability** write (writes `source=MANUAL` to `availability_state`). The spec's separate `PATCH /operators/me/slots/{id}/availability` is deferred — the slot-status resource is the manual write path for now (see `DECISIONS.md` D-033). Written by `PARKING_OPERATOR` with server-side ownership checks (403 IDOR).
- `GET /parking/{facilityId}/availability` (§3) is **implemented** and served deterministically from `availability_state` (only active/verified facilities). In Phase 2B `sources` is always `["MANUAL"]` (or `[]` when no data), `confidence` HIGH while data exists else LOW, and `isLive` true only when data exists and confidence HIGH; the multi-source freshness-window policy ships with the availability-engine phase.

### iot
| method | path | role | description |
|---|---|---|---|
| POST | /iot/devices/register | operator/admin | register device (issues credential) |
| GET | /iot/devices | operator/admin | list own devices |
| POST | /iot/telemetry | device-key auth | ingest telemetry (normalized, validated) |
| GET | /iot/devices/{id}/status | operator/admin | device status |

> Telemetry auth uses a per-device credential/secret, NOT user JWT. Rejects unauthenticated/unknown devices.

### notifications
| method | path | role | description |
|---|---|---|---|
| GET | /notifications | user | own notifications |
| PATCH | /notifications/{id}/read | user | mark read |

---

## 3. Availability Response Contract (honesty-critical)

`GET /parking/{id}/availability`

```json
{
  "facilityId": "PUN-000001",
  "totalSlots": 40,
  "availableSlots": 12,
  "isLive": false,
  "sources": ["MANUAL"],
  "lastUpdatedAt": "2026-08-30T09:30:00Z",
  "confidence": "MEDIUM",
  "disclaimer": "Operator-reported availability. Not guaranteed.",
  "slots": [] // optional detail when authorized/needed
}
```

Rules:
- `isLive` true only when confidence HIGH/MEDIUM_HIGH and within freshness window.
- Frontend must render `confidence`, `lastUpdatedAt`, `isLive`, `disclaimer` truthfully.

---

## 4. Token/QR Verification Contract

`POST /gate/tokens/verify { code: "SP-..." }`

```json
{
  "valid": true,
  "reason": "OK",
  "token": {
    "status": "ISSUED",
    "facilityId": "PUN-000001",
    "plannedEntry": "2026-08-30T10:00:00Z",
    "expiresAt": "2026-08-30T12:00:00Z",
    "onchainVerification": { "chain": "anvil-local", "status": "CONFIRMED" }
  }
}
```

Invalid cases return `valid:false` + `reason` (EXPIRED, ALREADY_USED, WRONG_FACILITY, NOT_YET_VALID, REVOKED, WRONG_CHAIN).

> **Phase 9, Block 3 — this legacy contract is superseded.** The implemented gate flow is the **parking-pass token**: `GET /parking-sessions/by-reservation/{code}/pass` returns a deterministic `ppk_` JWT, and `POST /parking-sessions/entry { verificationToken }` verifies it (digest vs `reservations.verification_token_hash`, deterministic → no turnover/rotation, `exp` bound to the reservation window) and opens the session atomically. QR encoding of the pass is a documented next-step integration (no QR library in the frontend — the pass is currently presented as a copyable token). The `/gate/tokens/verify` shape above stays as the reference for a future independent gate/ANPR reader contract.

Entry/exit transitions are guarded by state machine; invalid transitions → 422.

---

## 5. WebSocket Protocol

Endpoint: `/ws?token=<jwt>`

Channels:
- `availability:{facilityId}` — `{ facilityId, availableSlots, confidence, lastUpdatedAt, status }`
- `reservation:{code}` — `{ code, state, paymentStatus }` (for the owner)
- `gate:{facilityId}` — gate-staff scoped verification events

Fallback: when WS unavailable, client polls `GET /parking/{id}/availability` every 30 s (configurable).

---

## 6. Auth & Rate Limiting

- Access token: short-lived JWT (e.g., 30 min). Refresh token: httpOnly cookie, rotation, revocation list.
- RBAC enforced via middleware decorating handlers; gate routes require GATE_STAFF or PARKING_OPERATOR scoped to facility.
- Rate limits:
  - login/register: 10/min/IP
  - telemetry: 60/min/device (configurable)
  - public search: 60/min/IP
  - verification/entry/exit: 120/min/user
  - document upload: 10/min/user; signed URL issuance: 120/min/user
- Idempotency keys: one-time per key, TTL to prevent duplicate reserve/pay.

---

## 7. Testing Notes

- Contract tests: response shape/schema for all public + gate endpoints.
- Security tests: 401/403/404/429 paths, IDOR probes.
- Integration: full reservation → token → entry → exit on local chain + postgres.
