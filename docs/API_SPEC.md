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
| POST | /reservations/{code}/cancel | user | cancel (refund path in mock) |
| GET | /reservations/{code} | user/operator/admin | detail |

> **Implementation status (Phase 2C — booking foundation):** `GET /reservations`, `POST /reservations`, `GET /reservations/{code}`, and `POST /reservations/{code}/cancel` are **implemented** (mounted at `/api/v1/reservations`, user-authenticated, ownership enforced server-side — a user may list/detail/cancel only their own bookings, 404 `BOOKING_NOT_FOUND` on anyone else's). There is **no payment step in Phase 2C**: creation immediately produces a `CONFIRMED` booking (no `PENDING_PAYMENT`, no `confirm` endpoint) and does **not** mint tokens/QR codes. The non-payment lifecycle is `CONFIRMED → CANCELLED | COMPLETED`; `POST /reservations/{code}/confirm`, tokens, and the remaining states (`ACTIVE`/`EXPIRED`/`FAILED`) are deferred to the payments/tokens phase. Double-booking is enforced by the DB-level btree_gist exclusion constraint on `(slot_id, [starts_at, ends_at))` for `CONFIRMED` → `409 RESERVATION_CONFLICT`.

### tokens
| method | path | role | description |
|---|---|---|---|
| GET | /tokens/{code} | auth | fetch token detail (QR payload) |
| POST | /tokens/{code}/qr | auth | QR data for the user |
| POST | /gate/tokens/verify | gate/operator | verify token for entry/exit (scan) |
| POST | /gate/tokens/{code}/entry | gate/operator | approve entry |
| POST | /gate/tokens/{code}/exit | gate/operator | approve exit |
| POST | /gate/tokens/{code}/override | gate (with reason) | manual override (reason required) |

### payments
| method | path | role | description |
|---|---|---|---|
| POST | /payments/initiate | user | initiate mock payment for reservation |
| POST | /payments/{txnId}/verify | user | verify mock payment result |

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
| GET | /operators/me/reservations | operator | view own reservations |
| GET | /operators/me/reports/occupancy | operator | basic occupancy |

### admin
| method | path | role | description |
|---|---|---|---|
| GET | /admin/operators | admin | operator list w/ status |
| POST | /admin/operators/{id}/approve | verifier/admin | approve |
| POST | /admin/operators/{id}/reject | admin | reject (reason) |
| POST | /admin/operators/{id}/suspend | admin | suspend |
| GET | /admin/facilities | admin | facility list |
| POST | /admin/facilities/{id}/approve | verifier/admin | approve/verify |
| GET | /admin/users | admin | user management |
| PATCH | /admin/users/{id}/status | admin | suspend/activate |
| GET | /admin/reservations | admin | monitor reservations |
| GET | /admin/audit-logs | admin | audit log query (paginated/filter) |

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