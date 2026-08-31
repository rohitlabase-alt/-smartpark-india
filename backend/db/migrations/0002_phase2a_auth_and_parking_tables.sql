-- 0002_phase2a_auth_and_parking_tables.sql
-- ---------------------------------------------------------------------------
-- Phase 2A foundation tables (docs/DATABASE.md §2):
--   users (§2.1), roles (§2.2) + Phase 2A seeds, operators (§2.4),
--   parking_facilities (§2.6), user_roles (§2.3).
-- Plus refresh_tokens — session foundation (docs/SECURITY.md §6: refresh
-- tokens random + hashed at rest + rotatable/revocable). The table is new
-- (DATABASE.md has no auth-session table yet); recorded in DECISIONS.md.
--
-- Convention compliance (DATABASE.md header): every table gets id BIGSERIAL
-- PK, created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), and soft
-- delete deleted_at where applicable. FKs use ON DELETE RESTRICT per §3.
-- ---------------------------------------------------------------------------

-- citext: case-insensitive unique email (DATABASE.md §2.1).
CREATE EXTENSION IF NOT EXISTS citext;

-- ----------------------------- users ------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  email            CITEXT       NOT NULL,
  phone            VARCHAR(15)  NULL,
  password_hash    TEXT         NOT NULL,
  full_name        VARCHAR(120) NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
  locale           VARCHAR(8)   NOT NULL DEFAULT 'en',
  email_verified_at TIMESTAMPTZ NULL,
  last_login_at    TIMESTAMPTZ  NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ  NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_idx ON users (phone);

-- ----------------------------- roles ------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id   BIGSERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_code_idx ON roles (code);

-- Phase 2A seeds only (docs/DATABASE.md §2.2 catalogue is wider; the rest of
-- the roles land with their feature phases). Idempotent ON CONFLICT DO NOTHING.
INSERT INTO roles (code, name) VALUES
  ('USER',                'Customer'),
  ('PARKING_OPERATOR',    'Parking Operator'),
  ('ADMIN',               'Administrator')
ON CONFLICT (code) DO NOTHING;

-- --------------------------- operators ----------------------------------
CREATE TABLE IF NOT EXISTS operators (
  id                   BIGSERIAL   PRIMARY KEY,
  owner_user_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                 VARCHAR(160) NOT NULL,
  business_type        VARCHAR(64) NULL,
  registration_number  VARCHAR(64) NULL,
  verification_status  VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  approved_by          BIGINT      NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at          TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ NULL
);

-- One operator org per owner account (docs/API_SPEC.md /operators/me).
CREATE UNIQUE INDEX IF NOT EXISTS operators_owner_user_id_uk
  ON operators (owner_user_id);
CREATE INDEX IF NOT EXISTS operators_owner_idx ON operators (owner_user_id);
CREATE INDEX IF NOT EXISTS operators_status_idx ON operators (verification_status);

-- ----------------------- parking_facilities ------------------------------
CREATE TABLE IF NOT EXISTS parking_facilities (
  id                  BIGSERIAL   PRIMARY KEY,
  parking_id          VARCHAR(64) NOT NULL,
  name                VARCHAR(160) NOT NULL,
  description         TEXT        NULL,
  type                VARCHAR(32) NULL,
  country             VARCHAR(64) NOT NULL DEFAULT 'India',
  state               VARCHAR(64) NULL,
  city                VARCHAR(64) NOT NULL,
  area                VARCHAR(160) NULL,
  address             TEXT        NULL,
  latitude            NUMERIC(9,6) NULL,
  longitude           NUMERIC(9,6) NULL,
  operator_id         BIGINT      NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  capacity            INTEGER     NOT NULL,
  pricing             JSONB       NULL,
  operating_hours     JSONB       NULL,
  verification_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  availability_mode   VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  is_demo             BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL,

  CONSTRAINT facilities_latitude_check
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CONSTRAINT facilities_longitude_check
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
);

CREATE UNIQUE INDEX IF NOT EXISTS facilities_parking_id_idx ON parking_facilities (parking_id);
CREATE INDEX IF NOT EXISTS facilities_city_idx ON parking_facilities (city);
CREATE INDEX IF NOT EXISTS facilities_type_idx ON parking_facilities (type);
CREATE INDEX IF NOT EXISTS facilities_status_idx ON parking_facilities (verification_status);
CREATE INDEX IF NOT EXISTS facilities_operator_idx ON parking_facilities (operator_id);
-- Geospatial index (earthdistance/PostGIS) deferred per DATABASE.md §2.6
-- ("or PostGIS if installed"); not required for Phase 2A workflow.

-- Running counter for public parking ids (e.g. PUN-000007).
CREATE SEQUENCE IF NOT EXISTS parking_id_seq;

-- --------------------------- user_roles ---------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     BIGINT      NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  role_id     BIGINT      NOT NULL REFERENCES roles(id)            ON DELETE RESTRICT,
  -- scopes GATE_STAFF/OPERATOR roles to a facility (DATABASE.md §2.3);
  -- the org-level PARKING_OPERATOR role keeps this NULL.
  facility_id BIGINT      NULL REFERENCES parking_facilities(id)   ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles (role_id);
CREATE INDEX IF NOT EXISTS user_roles_facility_idx ON user_roles (facility_id);

-- ------------------------- refresh_tokens -------------------------------
-- Session foundation (SECURITY.md): only the SHA-256 digest is stored so a
-- database leak never exposes usable refresh tokens. Rotated on every use;
-- a consumed token keeps its revoked_at/replaced_at marker for replay
-- detection.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  replaced_at  TIMESTAMPTZ NULL,
  revoked_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_idx ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);