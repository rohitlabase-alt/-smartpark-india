# SmartPark India — Database Design

Status: DRAFT v0.1
Last updated: 2026-08-30
Phase: PHASE 0

PostgreSQL (V1: single database, modular schema; read-replicas are a Level 3 concern).

Conventions:
- `snake_case`, plural table names.
- All tables: `id BIGSERIAL PRIMARY KEY` unless noted; `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Soft delete: `deleted_at TIMESTAMPTZ NULL` where applicable.
- Money stored as integer **paise** (INR paise) or `NUMERIC(12,2)` with a documented decision — decision below.
- JSONB for flexible payloads (e.g., provider meta, availability snapshot) where relational modeling adds no value.

> DECISION (recorded in DECISIONS.md): monetary values stored as `NUMERIC(12,2)` in INR in V1 for readability, with a code-level helper to avoid float drift. Revisit to integer paise if rounding disputes arise.

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
reservations 1──1 parking_sessions
reservations 1──n payments
reservations 1──1 (or n) parking_tokens
reservations 1──n transactions

operators 1──n iot_devices
iot_devices 1──n iot_readings
parking_facilities 1──n iot_devices
parking_slots     1──n iot_readings (or 1─1 latest)

users 1──n notifications
audit_logs reference arbitrary entities via (table_name, record_id)
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

Constraint: no overlapping CONFIRMED/ACTIVE reservations on the same slot → enforce via **exclusion constraint** (btree_gist) on `slot_id, [starts_at, ends_at)` `WHERE state IN ('CONFIRMED','ACTIVE')`. This is the primary double-booking guard.

### 2.13 parking_sessions

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| reservation_id FK UNIQUE | 1-1 with reservation |
| entered_at | TIMESTAMPTZ NULL | |
| exited_at | TIMESTAMPTZ NULL | |
| entry_by | FK users NULL | gate staff/operator |
| exit_by | FK users NULL | |
| entry_override_reason | TEXT NULL | manual override |
| exit_override_reason | TEXT NULL | |
| status | VARCHAR(24) | RESERVED/ACTIVE/COMPLETED/ABANDONED |

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
| reservation_id FK | | |
| provider | VARCHAR(32) | mock |
| provider_txn_id | VARCHAR(80) UNIQUE NULL | |
| amount | NUMERIC(12,2) | INR |
| status | VARCHAR(24) | INITIATED/PENDING/SUCCESS/FAILED/REFUNDED |
| meta | JSONB NULL | provider payload (never card details) |
| created_at / updated_at | | |

### 2.16 transactions

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| payment_id FK | | |
| kind | VARCHAR(24) | charge/refund/reversal |
| amount | NUMERIC(12,2) | |
| status | VARCHAR(24) | capturable ledger semantics |
| reference | VARCHAR(80) NULL | |

### 2.17 iot_devices

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

### 2.18 iot_readings

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| device_id FK | | |
| slot_id FK NULL | | |
| reported_status | VARCHAR(16) | AVAILABLE/OCCUPIED/ERROR |
| received_at | TIMESTAMPTZ | |
| raw | JSONB NULL | |

Indexes: `(device_id, received_at DESC)`.

### 2.19 api_integrations

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

### 2.20 availability_state (engine output cache)

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

### 2.21 notifications

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id FK | | |
| channel | VARCHAR(16) | email/sms/push/in-app |
| template_key | VARCHAR(80) | |
| payload | JSONB | |
| status | VARCHAR(16) | queued/sent/failed |
| sent_at | TIMESTAMPTZ NULL | |

### 2.22 audit_logs

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| actor_user_id FK NULL | | |
| action | VARCHAR(64) | e.g., operator.approved |
| entity_type | VARCHAR(64) | table/entity name |
| entity_id | BIGINT | |
| before / after | JSONB NULL | diff snapshot |
| ip | INET NULL | |
| user_agent | TEXT NULL | |
| created_at | TIMESTAMPTZ | append-only (no UPDATE/DELETE grants) |

---

## 3. Integrity & Concurrency

- **Double-booking guard:** btree_gist exclusion constraint on reservations (slot_id, overlap) restricted to CONFIRMED/ACTIVE states. Reserve flow uses a transaction: `SELECT ... FOR UPDATE` on slot + insert reservation + update availability.
- **Money:** `NUMERIC(12,2)` INR; integer paise decision deferred (see top).
- **Soft delete** on users, facilities, slots, operators.
- **FKs** everywhere; `ON DELETE RESTRICT` for financial/history rows.
- **Timestamps** always `TIMESTAMPTZ`; store UTC.

---

## 4. Indexes (summary)

- users(email) unique, phone unique
- parking_facilities(parking_id) unique, (city), (type), (verification_status), geospatial
- parking_slots(slot_code) unique, (facility_id, status)
- reservations(reservation_code) unique, (user_id), (facility_id, starts_at), partial (slot_id, state)
- parking_tokens(token_id) unique
- bookings ONLOOKUP: partial indexes for pending payment cleanup
- iot_readings(device_id, received_at DESC)
- audit_logs(entity_type, entity_id), (created_at DESC)

---

## 5. Migration Strategy

- Migrations as versioned SQL files in `backend/db/migrations/` (or a lightweight tool like node-pg-migrate).
- Applied in CI and local dev via a script. Never auto-run destructive operations.
- Demo seed data (`is_demo=true`) in `backend/db/seeds/`.

---

## 6. Data Privacy Notes

- Personal data (phone, email, plates) lives here in the DB, NOT on-chain.
- Retention/deletion workflows tie to `COMPLIANCE.md`.
- Audit logs keep actor + snapshots append-only.