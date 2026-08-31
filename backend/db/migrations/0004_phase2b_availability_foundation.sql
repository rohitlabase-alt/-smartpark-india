-- 0004_phase2b_availability_foundation.sql
-- ---------------------------------------------------------------------------
-- Phase 2B availability foundation (docs/DATABASE.md §2.7/§2.8/§2.20):
--   parking_zones        (§2.7) minimal grouping — no CRUD API this phase
--   parking_slots        (§2.8) per-space inventory owned by a facility
--   availability_state   (§2.20) normalized output cache the API serves
--
-- Convention compliance (DATABASE.md header/§3): id BIGSERIAL PK,
-- created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), soft delete
-- deleted_at where applicable, FKs everywhere.
--
-- Vocabulary is the AUTHORITATIVE one (docs/DATABASE.md):
--   parking_slots.status (§2.8): AVAILABLE/RESERVED/OCCUPIED/OUT_OF_SERVICE/
--                                MAINTENANCE/UNKNOWN
--   availability_state.status (§2.20): AVAILABLE/OCCUPIED/RESERVED/UNKNOWN
--   availability_state.source (§2.20): MANUAL/API/IOT/RESERVATION
--   availability_state.confidence (§2.20): HIGH/MEDIUM_HIGH/MEDIUM/LOW/UNKNOWN
--
-- No fake/demo rows are seeded. The manual source (MANUAL) is the only
-- write path implemented in Phase 2B; RESERVATION/IOT/API appear in the
-- source constraint so later phases can insert without a migration.
-- ---------------------------------------------------------------------------

-- --------------------------- parking_zones --------------------------------
-- Grouping facet (§2.7); created so parking_slots.zone_id FK resolves.
-- Zone management is a later phase (no API here).
CREATE TABLE IF NOT EXISTS parking_zones (
  id          BIGSERIAL   PRIMARY KEY,
  facility_id BIGINT      NOT NULL REFERENCES parking_facilities (id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  kind        VARCHAR(32) NOT NULL DEFAULT 'car',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parking_zones_facility_idx ON parking_zones (facility_id);

-- --------------------------- parking_slots --------------------------------
CREATE TABLE IF NOT EXISTS parking_slots (
  id          BIGSERIAL   PRIMARY KEY,
  slot_code   VARCHAR(40) NOT NULL,
  facility_id BIGINT      NOT NULL REFERENCES parking_facilities (id) ON DELETE RESTRICT,
  zone_id     BIGINT      NULL REFERENCES parking_zones (id)          ON DELETE SET NULL,
  vehicle_type VARCHAR(32) NOT NULL DEFAULT 'car',
  status      VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
  reservations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ NULL,

  -- Authoritative status vocabulary (docs/DATABASE.md §2.8).
  CONSTRAINT parking_slots_status_check
    CHECK (status IN ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'OUT_OF_SERVICE', 'MAINTENANCE', 'UNKNOWN'))
);

-- slot_code unique globally (docs/DATABASE.md §2.8/§4).
CREATE UNIQUE INDEX IF NOT EXISTS parking_slots_slot_code_idx   ON parking_slots (slot_code);
-- index for per-facility status queries (§4 parking_slots(facility_id, status)).
CREATE INDEX IF NOT EXISTS parking_slots_facility_status_idx   ON parking_slots (facility_id, status);
CREATE INDEX IF NOT EXISTS parking_slots_facility_idx          ON parking_slots (facility_id);
CREATE INDEX IF NOT EXISTS parking_slots_zone_idx              ON parking_slots (zone_id);

-- ----------------------- availability_state -------------------------------
-- Normalized output cache (docs/DATABASE.md §2.20). The API serves FROM this
-- table. The manual write path (operator slot update → engine) upserts one
-- row per affected slot/facility with source=MANUAL.
CREATE TABLE IF NOT EXISTS availability_state (
  id              BIGSERIAL   PRIMARY KEY,
  facility_id     BIGINT      NOT NULL REFERENCES parking_facilities (id) ON DELETE CASCADE,
  slot_id         BIGINT      NULL REFERENCES parking_slots (id)         ON DELETE CASCADE,
  status          VARCHAR(24) NOT NULL,
  source          VARCHAR(16) NOT NULL,
  confidence      VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload     JSONB       NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- status/source/confidence vocabularies (docs/DATABASE.md §2.20).
  CONSTRAINT availability_state_status_check
    CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'UNKNOWN')),
  CONSTRAINT availability_state_source_check
    CHECK (source IN ('MANUAL', 'API', 'IOT', 'RESERVATION')),
  CONSTRAINT availability_state_confidence_check
    CHECK (confidence IN ('HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'))
);

-- a slot may appear at most once (per slot) in the engine output.
CREATE UNIQUE INDEX IF NOT EXISTS availability_state_slot_uk
  ON availability_state (slot_id) WHERE slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS availability_state_facility_idx ON availability_state (facility_id);
CREATE INDEX IF NOT EXISTS availability_state_status_idx ON availability_state (status);
