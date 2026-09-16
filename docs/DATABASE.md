# SmartPark India — Database Design

Status: DRAFT v0.1
Last updated: 2026-08-31
Phase: PHASE 0 (design); see "Implementation status" notes for what lands per phase

PostgreSQL (V1: single database, modular schema; read-replicas are a Level 3 concern).

Conventions:
- `snake_case`, plural table names.
- All tables: `id BIGSERIAL PRIMARY KEY` unless noted; `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Soft delete: `deleted_at TIMESTAMPTZ NULL` where applicable.
- Money stored as integer **paise** (INR paise) or `NUMERIC(12,2)` with a documented decision — decision below.
- JSONB for flexible payloads (e.g., provider meta, availability snapshot) where relational modeling adds no value.

> DECISION (recorded in DECISIONS.md): monetary values stored as `NUMERIC(12,2)` in INR in V1 for readability, with a code-level helper to avoid float drift. Revisit to integer paise if rounding disputes arise.

**Implementation status (Phase 2B):** `parking_zones` (§2.7), `parking_slots` (§2.8) and `availability_state` (§2.21) are implemented by migration `0004_phase2b_availability_foundation.sql`. These tables use the **authoritative** vocabulary below — `parking_slots.status` is the six-state list, `availability_state.status` the four-state engine list. The Phase 2B brief's four-state slot list differs and is **superseded** by the documented §2.8 vocabulary. `availability_state` is written only with `source=MANUAL` in Phase 2B; the `RESERVATION / IOT / API` source values are permitted by the constraint so later phases can write without a schema migration. See `DECISIONS.md` D-033.

---

## 1. ER Diagram (textual)

```
users 1──n user_roles n──1 roles
users 1──n vehicles
users 1──n user_addresses
users 1──1 (optional) operators   (operator owner/manager link)

states 1──n cities 1──n areas 1──n parking_facilities

operators 1──n parking_facilities
parking_facilities 1──n parking_zones
parking_zones    1──n parking_slots
parking_facilities 1──n operating_hours
parking_facilities 1──n pricing_rules
parking_facilities 1──n api_integrations

users 1──n reservations
parking_facilities 1──n reservations
parking_slots     1──n reservations
reservations 1──n parking_sessions   (max one ACTIVE per reservation, over time n total)
reservations 1──n payments
reservations 1──1 (or n) parking_tokens
reservations 1──n transactions

operators 1──n iot_devices
iot_devices 1──n iot_readings
parking_facilities 1──n iot_devices
parking_slots     1──n iot_readings (or 1─1 latest)

operators 1──n documents
parking_facilities 1──n documents    (operator verification docs / parking images)

users 1──n notifications
audit_events reference arbitrary entities via (entity_type, entity_id)
```

---

## 2. Schemas

All tables live in the default `public` schema in V1; namespaces (`auth`, `parking`, `billing`) are a later option. Table list below.

### 2.1 users

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| email | CITEXT UNIQUE NOT NULL | login identifier |
| phone | VARCHAR(15) UNIQUE NULL | India format |
| password_hash | TEXT NOT NULL | argon2/bcrypt |
| full_name | VARCHAR(120) | |
| status | VARCHAR(16) | ACTIVE/SUSPENDED/PENDING |
| locale | VARCHAR(8) | en/mr/hi |
| email_verified_at | TIMESTAMPTZ NULL | |
| last_login_at | TIMESTAMPTZ NULL | |
| deleted_at | TIMESTAMPTZ NULL | |

Indexes: `users_email_idx` unique, `users_phone_idx` unique.

### 2.2 roles

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| code | VARCHAR(32) UNIQUE | USER, GATE_STAFF, PARKING_OPERATOR, OPERATOR_MANAGER, VERIFIER, ADMIN |
| name | VARCHAR(64) | |

### 2.3 user_roles

| column | type | notes |
|---|---|---|
| user_id | FK users | PK(user_id, role_id) |
| role_id | FK roles | |
| facility_id | FK parking_facilities NULL | scope for GATE_STAFF/OPERATOR roles |
| assigned_at | TIMESTAMPTZ | |

### 2.4 operators

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| owner_user_id | FK users | |
| name | VARCHAR(160) | operator org display name |
| business_type | VARCHAR(64) | private/municipal/private-operator... |
| registration_number | VARCHAR(64) NULL | |
| verification_status | VARCHAR(24) | PENDING/UNDER_REVIEW/VERIFIED/REJECTED/SUSPENDED/ACTIVE/INACTIVE |
| approved_by | FK users NULL | verifier/admin |
| approved_at | TIMESTAMPTZ NULL | |

### 2.5 states / cities / areas

| table | columns |
|---|---|
| states | id, code (ISO 3166-2 in), name |
| cities | id, state_id FK, name, is_active |
| areas | id, city_id FK, name, lat, lng |

Cities are data, enabling multi-city without code changes. Pune = one row.

### 2.6 parking_facilities

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| parking_id | VARCHAR(64) UNIQUE NOT NULL | e.g., PUN-000001 |
| name | VARCHAR(160) | |
| description | TEXT | |
| type | VARCHAR(32) | public/private/on-street/off-street/mall/airport/railway-metro/hospital/corporate/ev |
| country | VARCHAR(64) | data-driven |
| state | VARCHAR(64) | |
| city | VARCHAR(64) | |
| area | VARCHAR(160) | |
| address | TEXT | |
| latitude | NUMERIC(9,6) | |
| longitude | NUMERIC(9,6) | |
| operator_id | FK operators | |
| capacity | INTEGER | base slots |
| pricing | JSONB | default pricing snapshot |
| operating_hours | JSONB | normalized hours |
| verification_status | VARCHAR(24) | PENDING/UNDER_REVIEW/VERIFIED/REJECTED/SUSPENDED/ACTIVE/INACTIVE |
| availability_mode | VARCHAR(16) | MANUAL/API/IOT |
| is_active | BOOLEAN | operator-controlled availability toggling |
| is_demo | BOOLEAN | marks DEMO-PUN-* records |
| deleted_at | TIMESTAMPTZ NULL | |

Indexes: city, type, geospatial `GIST (ll_to_earth(latitude, longitude))` or PostGIS if installed (V1: earthdistance), verification_status.

### 2.7 parking_zones

| column | type | notes |
|---|---|---|
| id, facility_id FK | | |
| name | VARCHAR(80) | e.g., "Level B2", "East Wing" |
| kind | VARCHAR(32) | car/two-wheeler/ev/heavy |
| is_active | BOOLEAN | |

### 2.8 parking_slots

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| slot_code | VARCHAR(40) UNIQUE | e.g., SP-PUN-000001-A01 |
| facility_id FK | | |
| zone_id FK NULL | | |
| vehicle_type | VARCHAR(32) | |
| status | VARCHAR(24) | AVAILABLE/RESERVED/OCCUPIED/OUT_OF_SERVICE/MAINTENANCE/UNKNOWN |
| reservations_enabled | BOOLEAN | |
| except_purchased availability from availability_state | | |
| deleted_at | TIMESTAMPTZ NULL | |

A "category" booking (e.g., "any 4-wheeler slot") is modeled by grouping slots; reservations may attach to a slot OR a slot-group.

### 2.9 pricing_rules

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| facility_id FK | | |
| vehicle_type | VARCHAR(32) | |
| basis | VARCHAR(24) | hourly/daily/fixed |
| amount | NUMERIC(12,2) | INR |
| max_amount_daily | NUMERIC(12,2) NULL | |
| currency | VARCHAR(8) | INR (start multi-currency-ready, INR only in V1) |
| valid_from / valid_to | TIMESTAMPTZ NULL | free-form window |
| is_active | BOOLEAN | |

### 2.10 operating_hours

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| facility_id FK | | |
| day_of_week | SMALLINT | 0=Sunday..6 |
| open_time / close_time | TIME | 24h |
| is_closed | BOOLEAN | |
| notes | TEXT | |

### 2.11 vehicles

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id FK | | |
| plate_number | VARCHAR(20) | |
| make_model | VARCHAR(80) NULL | |
| vehicle_type | VARCHAR(32) | |
| is_primary | BOOLEAN | |

### 2.12 reservations

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| reservation_code | VARCHAR(48) UNIQUE | human + QR friendly |
| user_id FK | | |
| facility_id FK | | |
| zone_id FK NULL | | |
| slot_id FK NULL | | |
| vehicle_id FK NULL | | |
| starts_at / ends_at | TIMESTAMPTZ | |
| state | VARCHAR(24) | PENDING_PAYMENT/CONFIRMED/ACTIVE/COMPLETED/CANCELLED/EXPIRED/FAILED |
| amount | NUMERIC(12,2) | INR |
| payment_status | VARCHAR(24) | |
| cancel_reason | TEXT NULL | |
| cancelled_at | TIMESTAMPTZ NULL | |
| confirmed_at | TIMESTAMPTZ NULL | |
| verification_token_hash | VARCHAR(64) NULL | SHA-256 digest of the deterministic parking-pass token (`ppk_`) — raw token never stored; partial UNIQUE `WHERE verification_token_hash IS NOT NULL` (migration `0010`) |

Constraint: no overlapping PENDING_PAYMENT/CONFIRMED/ACTIVE reservations on the same slot → enforced via **exclusion constraint** (btree_gist) on `slot_id, [starts_at, ends_at)` `WHERE state IN ('PENDING_PAYMENT','CONFIRMED','ACTIVE')`. This is the primary double-booking guard (migration `0006`).

> **Phase 7 implementation (migrations `0005` + `0006`):** the table is created (migration `0005`, D-034) with the columns above **minus `vehicle_id`** (no `vehicles` table exists yet). Migration `0006` (Phase 7, D-035) activates the payment fields: the `state` CHECK now covers the full vocabulary `('PENDING_PAYMENT','CONFIRMED','ACTIVE','COMPLETED','CANCELLED','EXPIRED','FAILED')` (creates with `PENDING_PAYMENT`, transitions to `CONFIRMED` on a successful mock payment verification, `FAILED` on a failed verification), and `amount` (nullable, `reservations_amount_check`) is populated from the facility pricing JSONB (`hourlyRate`, default ₹100/hr) at creation while `payment_status` tracks the payment outcome. The **live exclusion constraint** is widened to `WHERE state IN ('PENDING_PAYMENT','CONFIRMED','ACTIVE')` so a pending (unpaid) reservation still holds its slot; failed/cancelled/completed reservations release it.
>
> **Phase 9, Block 3 (migration `0010`, gate/parking-pass):** adds `verification_token_hash` (NULL until the pass is first needed). Backs the deterministic HS256-JWT parking-pass token (`ppk_...`): the token is derived byte-for-byte from `(user_id, reservation_code, facility_id, ends_at)` + the app secret bound to the reservation's user/facility, so reads never rotate or invalidate a previously-issued pass; `exp` = `ends_at`, so no turnover migration is needed. Only the SHA-256 digest is stored; the partial unique index `reservations_verification_token_hash_idx` rejects a second reservation sharing a digest. Rows created before the migration get their hash lazily backfilled inside the first pass-issue / token-entry transaction (byte-deterministic → backfill never invalidates a pass already handed out).

### 2.13 parking_sessions

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| reservation_id FK | | RESTRICT |
| facility_id FK | | RESTRICT — snapshot of the reservation's facility |
| slot_id FK | | RESTRICT — snapshot of the reservation's slot |
| user_id FK | | RESTRICT — the reservation owner |
| entry_token_hash | VARCHAR(64) NOT NULL UNIQUE | SHA-256 digest of the one-time bearer entry token ($2.13 security note); the raw token is never stored |
| entry_at | TIMESTAMPTZ NOT NULL DEFAULT now() | set at entry |
| exit_at | TIMESTAMPTZ NULL | set at exit |
| status | VARCHAR(24) | ACTIVE/COMPLETED/CANCELLED (CANCELLED = operator force-exit, Phase 9 Block 4.2, D-039) |
| created_at / updated_at | | |

Lifecycle: a paid **CONFIRMED** reservation enters → session `ACTIVE`, reservation → `ACTIVE`, slot → `OCCUPIED`; exiting → session `COMPLETED`, reservation → `COMPLETED`, slot → `AVAILABLE`. Source of truth for occupancy is **`parking_slots.status`**; the session row is a ledger of the lifecycle (`availability_state` is mirrored to match).

Uniqueness (partial, so the same reservation can have multiple sessions **over time**, but only ever **one active** at a time, migration `0009`):
- `parking_sessions_active_reservation_idx` — UNIQUE `(reservation_id) WHERE status = 'ACTIVE'` (single active session per reservation; double-entry defense in depth)
- `parking_sessions_active_slot_idx` — UNIQUE `(slot_id) WHERE status = 'ACTIVE'` (no two active sessions on the same slot)
- `parking_sessions_entry_token_hash_idx` — UNIQUE `(entry_token_hash)`

Indexes: `(facility_id, status)`, `(user_id)`, `(slot_id)`.

> **Phase 9 Block 1 implementation (migration `0009`, D-037):** table implemented with the columns above. Entry: `POST /parking-sessions/entry` (auth + reservation owner OR VERIFIED facility operator) generates a high-entropy `ses_<48 hex>` bearer token, persists only its SHA-256 hash, transitions reservation `CONFIRMED → ACTIVE`, slot → `OCCUPIED` (guarded UPDATE over `AVAILABLE`/`RESERVED`, race-safe), mirrors the availability cache, and writes a `PARKING_SESSION_ENTRY` audit record — all in one transaction. Exit: `POST /parking-sessions/:id/exit` completes the session (`ACTIVE → COMPLETED`), releases the slot (`OCCUPIED → AVAILABLE`, preserving operator-set statuses), reservation `ACTIVE → COMPLETED`, availability cache re-mirrored, `PARKING_SESSION_EXIT` audit record. `GET /parking-sessions/:id` is owner/operator-scoped (SQL-enforced, 404 on miss). The single-active-session invariants are also enforced at the DB level by the two partial UNIQUE indexes above.
>
> **Phase 9 Block 3 (migration `0010`, D-038):** gate entry accepts **exactly one** of `reservationCode` or `verificationToken`; the token path looks up `verification_token_hash` by `sub` (the reservation code), in-tx backfills the digest, verifies it byte-for-byte, and enforces the reservation window (`TOKEN_NOT_YET_VALID`/`TOKEN_EXPIRED`) and the reservation's slot `reservationsEnabled` + `OUT_OF_SERVICE` states. Occupancy now has a **manual guard in the slot UPDATE path** (`slots.service`): a change away from `OCCUPIED` throws `409 SLOT_IN_USE` whenever `hasActiveSessionForSlot` returns true, serialized by `SELECT ... FOR UPDATE` on the slot row — so hand-flipping an active session's slot is impossible, while a genuinely stuck `OCCUPIED` flag (no active session) can still be corrected. Success entry/exit additionally emit `GATE_ENTRY_VERIFIED`/`GATE_EXIT_VERIFIED` (verification mode + `enteredBy` in metadata) plus `SLOT_OCCUPIED`/`SLOT_RELEASED`; rejections write `GATE_ENTRY_REJECTED`/`GATE_EXIT_REJECTED` with the reason code (raw tokens never enter audit metadata).
>
> **Phase 9 Block 4.2 (no migration, D-039):** the `CANCELLED` session status gets its intended use — `POST /parking-sessions/:id/cancel` (VERIFIED facility operator only, facility scope in SQL) transitions session `ACTIVE → CANCELLED` (`exit_at` stamped), slot `OCCUPIED → AVAILABLE`, reservation `ACTIVE → CANCELLED` (`cancel_reason`/`cancelled_at`), mirrors the availability cache and writes a `PARKING_SESSION_CANCELLED` audit record — one transaction. The session row is `FOR UPDATE`-locked first, then the reservation row, then the slot via the guarded release, so a force-cancel racing a normal exit serializes and exactly one transition wins (the loser gets `409 SESSION_NOT_ACTIVE` and rolls back). No schema change was required.

### 2.14 parking_tokens

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| token_id | VARCHAR(64) UNIQUE | |
| reservation_id FK | | |
| token_code | VARCHAR(120) | QR payload reference (signed JWT) |
| onchain_token_id | VARCHAR(80) NULL | contract token reference |
| status | VARCHAR(24) | ISSUED/ACTIVE/VERIFIED_FOR_ENTRY/IN_USE/COMPLETED/EXPIRED/REVOKED |
| expires_at | TIMESTAMPTZ | derives from reservation window |
| used_at | TIMESTAMPTZ NULL | |
| revoked_at | TIMESTAMPTZ NULL | |

### 2.15 payments

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| reservation_id FK | | RESTRICT |
| provider | VARCHAR(32) | `'MOCK'` in Phase 7 (`payments_provider_check`) |
| provider_txn_id | VARCHAR(80) UNIQUE NULL | deterministic `MOCK-<code>-<amount>`; partial unique index |
| amount | NUMERIC(12,2) | INR |
| status | VARCHAR(24) | INITIATED/PENDING/SUCCESS/FAILED/REFUNDED |
| meta | JSONB NULL | provider payload (never card details) |
| created_at / updated_at | | |

> **Phase 7 implementation (migration `0006`, D-035):** created by `POST /payments/initiate` with `status='PENDING'`; the reservation's stored `amount` is the charge amount. `POST /payments/{txnId}/verify` drives `status` to `SUCCESS` (reservation → CONFIRMED + one `CHARGE`) or `FAILED` (reservation → FAILED + one `CHARGE`/`FAILED`); `REFUNDED` is reserved for the deferred refund workflow (no refunds in the mock, D-035).

### 2.16 transactions

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| payment_id FK | | RESTRICT |
| kind | VARCHAR(24) | CHARGE/REFUND/REVERSAL |
| amount | NUMERIC(12,2) | |
| status | VARCHAR(24) | SUCCESS/FAILED |
| reference | VARCHAR(80) NULL | prior transaction id for reversals |

> **Phase 7 implementation (migration `0006`):** written inside the verify transaction — exactly one `CHARGE` per verified payment (`SUCCESS` when the payment succeeds, `FAILED` when it fails). `REFUND`/`REVERSAL` kinds are permitted by the constraint for the future refund workflow but not yet written.

### 2.17 payment_idempotency_keys

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id FK | | RESTRICT |
| key | VARCHAR(128) | caller-provided `Idempotency-Key` |
| endpoint | VARCHAR(64) | `payments/initiate` |
| payment_id FK | | CASCADE |
| expires_at | TIMESTAMPTZ | 15 min TTL |

> **Phase 7 implementation (migration `0006`):** claim + payment creation happen atomically inside the initiate transaction; unique index `(user_id, key, endpoint)` guarantees a repeated initiate with the same key reuses the existing payment rather than creating a duplicate attempt.

### 2.18 iot_devices

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| device_id | VARCHAR(64) UNIQUE | |
| operator_id FK | | |
| facility_id FK NULL | | |
| slot_id FK NULL | | |
| protocol | VARCHAR(16) | http/mqtt |
| auth_secret_hash | TEXT | never plaintext |
| status | VARCHAR(16) | ONLINE/OFFLINE/STALE/ERROR |
| last_seen_at | TIMESTAMPTZ NULL | |
| firmware_version | VARCHAR(32) NULL | |
| registered_at | TIMESTAMPTZ | |

### 2.19 iot_readings

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| device_id FK | | |
| slot_id FK NULL | | |
| reported_status | VARCHAR(16) | AVAILABLE/OCCUPIED/ERROR |
| received_at | TIMESTAMPTZ | |
| raw | JSONB NULL | |

Indexes: `(device_id, received_at DESC)`.

### 2.20 api_integrations

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| facility_id FK | | |
| provider_name | VARCHAR(80) | |
| provider_type | VARCHAR(24) | availability/pms |
| base_url | VARCHAR(255) | |
| credential_ref | VARCHAR(255) | pointer to secret store, never plaintext |
| status | VARCHAR(16) | configured/testing/active/failed |
| last_sync_at | TIMESTAMPTZ NULL | |
| last_sync_status | VARCHAR(24) NULL | |

### 2.21 availability_state (engine output cache)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| facility_id FK | | |
| slot_id FK NULL | | |
| status | VARCHAR(24) | AVAILABLE/OCCUPIED/RESERVED/UNKNOWN |
| source | VARCHAR(16) | MANUAL/API/IOT/RESERVATION |
| confidence | VARCHAR(16) | HIGH/MEDIUM_HIGH/MEDIUM/LOW/UNKNOWN |
| last_updated_at | TIMESTAMPTZ | |
| raw_payload | JSONB NULL | |

This table is the normalized output the API/WS actually serves.

### 2.22 notifications

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id FK | | |
| channel | VARCHAR(16) | email/sms/push/in-app |
| template_key | VARCHAR(80) | |
| payload | JSONB | |
| status | VARCHAR(16) | queued/sent/failed |
| sent_at | TIMESTAMPTZ NULL | |

### 2.23 audit_events

Append-only audit trail of admin/operator/user/payment actions (Phase 8, Part 4; migration 0008). Rows are written by application code **inside the same transaction** as the business mutation so a mutation can never commit without its audit record; no application path updates or deletes rows (`updated_at` is deliberately omitted — the append-only contract). Actor identity comes from the server-side session; `metadata` is sanitized by the service (credential-like keys dropped).

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| actor_user_id FK NULL | | acting user from the server-side session; NULL for system events |
| action | VARCHAR(64) | shared `AUDIT_ACTIONS` vocabulary, e.g., `OPERATOR_APPROVED`, `RESERVATION_CANCELLED` |
| entity_type | VARCHAR(64) | shared `AUDIT_ENTITY_TYPES` vocabulary, e.g., OPERATOR/FACILITY/SLOT/RESERVATION/PAYMENT/USER |
| entity_id | BIGINT NULL | entity the action touched |
| metadata | JSONB | sanitized, JSON-safe context; no credentials/PII |
| created_at | TIMESTAMPTZ | default now(); append-only |

Indexes: `(created_at DESC)`, `(actor_user_id, created_at DESC)`, `(entity_type, entity_id, created_at DESC)`, `(action, created_at DESC)`.

### 2.24 documents

Operator verification documents and parking images. Stores **metadata + reference only**; the binary lives in S3-compatible object storage abstraction, not PostgreSQL (see `ARCHITECTURE.md` §12).

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| document_id | VARCHAR(64) UNIQUE | public ref, e.g., DOC-1001 |
| operator_id | FK operators NULL | required for operator verification docs |
| parking_id | FK parking_facilities NULL | required for facility/parking images |
| uploaded_by | FK users NULL | who uploaded |
| storage_key | VARCHAR(255) NOT NULL | object-storage key (no PII, no public enumeration); binary is NOT in DB |
| document_type | VARCHAR(48) NOT NULL | e.g., operator_license/registration_proof/id_proof/parking_image/other |
| mime_type | VARCHAR(80) NOT NULL | validated by magic bytes |
| file_size | INTEGER NOT NULL | bytes |
| checksum | TEXT NULL | e.g., SHA-256, integrity check |
| verification_status | VARCHAR(24) NOT NULL | PENDING/UNDER_REVIEW/VERIFIED/REJECTED (aligns with facility/operator vocabulary) |
| verification_note | TEXT NULL | reviewer note / rejection reason |
| reviewed_by | FK users NULL | verifier/admin |
| reviewed_at | TIMESTAMPTZ NULL | |
| expires_at | TIMESTAMPTZ NULL | policy-driven (e.g., license expiry); optional |
| deleted_at | TIMESTAMPTZ NULL | soft delete |

Constraints:
- CHECK `(operator_id IS NOT NULL OR parking_id IS NOT NULL)` — a document must belong to an operator or a facility (or both for a facility-level document tied to its operator).
- FK `ON DELETE RESTRICT` for verified/reviewed documents; children linking to soft-deleted parents remain for audit history.

Indexes:
- `documents_operator_idx` (operator_id) 
- `documents_parking_idx` (parking_id)
- `documents_status_idx` (verification_status) — supports admin review queues
- `documents_document_id_idx` unique (document_id)

Lifecycle:
1. Operator uploads document (multipart, validated type/size) → inserted with `verification_status=PENDING`, object stored via `ObjectStorageProvider.put`, `storage_key` persisted (metadata only in DB).
2. Verifier/admin marks `UNDER_REVIEW` (optional) then `VERIFIED` or `REJECTED` (with `verification_note`).
3. Deletion: soft-delete row first, then delete object from storage; runs through retention/deletion jobs (see `ARCHITECTURE.md` §12.7, `COMPLIANCE.md` §4).

---

## 3. Integrity & Concurrency

- **Double-booking guard:** btree_gist exclusion constraint on reservations (slot_id, overlap) restricted to PENDING_PAYMENT/CONFIRMED/ACTIVE states (migration `0006`). Reserve flow uses a transaction: `SELECT ... FOR UPDATE` on slot + insert reservation + update availability.
- **Single-active-session / single-active-slot:** two partial UNIQUE indexes on parking_sessions (`WHERE status='ACTIVE'` on `reservation_id` and on `slot_id`, migration `0009`) + the guarded slot-UPDATE (`AVAILABLE`/`RESERVED → OCCUPIED`) serialize entry; the loser gets a mapped `409`.
- **Occupancy manual guard (Block 3, migration `0010`):** slot UPDATE from `OCCUPIED` takes `SELECT ... FOR UPDATE` on the slot row, then `409 SLOT_IN_USE` whenever `hasActiveSessionForSlot` is true — race-free against concurrent entry (whichever side wins the row lock, the other observes the committed outcome).
- **Token digest uniqueness:** partial UNIQUE `verification_token_hash` on reservations prevents two reservations sharing a parking-pass digest.
- **Money:** `NUMERIC(12,2)` INR; integer paise decision deferred (see top).
- **Soft delete** on users, facilities, slots, operators.
- **FKs** everywhere; `ON DELETE RESTRICT` for financial/history rows.
- **Timestamps** always `TIMESTAMPTZ`; store UTC.

---

## 4. Indexes (summary)

- users(email) unique, phone unique
- parking_facilities(parking_id) unique, (city), (type), (verification_status), geospatial
- parking_slots(slot_code) unique, (facility_id, status)
- reservations(reservation_code) unique, (user_id), (facility_id, starts_at), partial (slot_id, state), partial unique (verification_token_hash WHERE NOT NULL) — migration `0010`
- parking_sessions(entry_token_hash) unique, partial active (reservation_id) / active (slot_id), (facility_id, status), (user_id), (slot_id)
- parking_tokens(token_id) unique
- documents(operator_id), (parking_id), (verification_status), (document_id) unique
- bookings ONLOOKUP: partial indexes for pending payment cleanup
- iot_readings(device_id, received_at DESC)
- audit_events(created_at DESC), (actor_user_id, created_at DESC), (entity_type, entity_id, created_at DESC), (action, created_at DESC)

---

## 5. Migration Strategy

- Migrations as versioned SQL files in `backend/db/migrations/` (or a lightweight tool like node-pg-migrate).
- Applied in CI and local dev via a script. Never auto-run destructive operations.
- Demo seed data (`is_demo=true`) in `backend/db/seeds/`.

---

## 6. Data Privacy Notes

- Personal data (phone, email, plates) lives here in the DB, NOT on-chain.
- Uploaded documents may contain personal or business identity data; the binary lives in object storage (private, access-scoped), the DB holds metadata only. Document retention/deletion follows `COMPLIANCE.md` §4 and `ARCHITECTURE.md` §12.7.
- Retention/deletion workflows tie to `COMPLIANCE.md`.
- Audit logs keep actor + snapshots append-only.