-- 0009_phase9_parking_sessions.sql
-- Phase 9 Block 1: parking session lifecycle (docs/ROADMAP.md PHASE 9).
--
-- Converts paid/confirmed reservations into operational parking sessions with
-- entry/exit lifecycle, token-based verification, and slot occupancy management.

CREATE TABLE IF NOT EXISTS parking_sessions (
  id                BIGSERIAL    PRIMARY KEY,
  reservation_id    BIGINT       NOT NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  facility_id       BIGINT       NOT NULL REFERENCES parking_facilities (id) ON DELETE RESTRICT,
  slot_id           BIGINT       NOT NULL REFERENCES parking_slots (id) ON DELETE RESTRICT,
  user_id           BIGINT       NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  entry_token_hash  VARCHAR(64)  NOT NULL,
  entry_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  exit_at           TIMESTAMPTZ  NULL,
  status            VARCHAR(24)  NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT parking_sessions_status_check CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_entry_token_hash_idx
  ON parking_sessions (entry_token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_active_reservation_idx
  ON parking_sessions (reservation_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS parking_sessions_facility_status_idx
  ON parking_sessions (facility_id, status);

CREATE INDEX IF NOT EXISTS parking_sessions_user_idx
  ON parking_sessions (user_id);

CREATE INDEX IF NOT EXISTS parking_sessions_slot_idx
  ON parking_sessions (slot_id);

-- Defense-in-depth: prevent two ACTIVE sessions for the same slot.
CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_active_slot_idx
  ON parking_sessions (slot_id) WHERE status = 'ACTIVE';
