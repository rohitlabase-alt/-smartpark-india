-- 0005_phase2c_booking_foundation.sql
-- ---------------------------------------------------------------------------
-- Phase 2C booking/reservation foundation (docs/DATABASE.md §2.12 reservations).
--
-- This is a FOUNDATION layer only: authenticated booking CRUD + lifecycle
-- (CONFIRMED → CANCELLED/COMPLETED) with slot-level double-booking protection.
-- Payments, tokens, QR/gate, session start/stop and the payment/gate stripe of
-- the reservation states (PENDING_PAYMENT/ACTIVE/EXPIRED/FAILED) are NOT
-- implemented here — they land with the payment/token/reservation phases.
--
-- Convention compliance (DATABASE.md header/§3): id BIGSERIAL PK,
-- created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), soft delete
-- deleted_at where applicable, FKs everywhere. Naming follows §2.12 exactly.
--
-- Deliberate Phase 2C divergences (recorded in DECISIONS.md D-034):
--   * `state` CHECK holds only the non-payment subset CONFIRMED/CANCELLED/
--     COMPLETED; the payment/gate states are intentionally absent until the
--     payment phase (constraint is forward-compatible, not payment-dependent).
--   * `amount`/`payment_status` columns exist per §2.12 but are nullable and
--     unused in Phase 2C (no payment logic).
--   * `vehicle_id` (§2.12) is omitted because no `vehicles` table exists yet.
--   * Double-booking guard uses the documented **exclusion constraint**
--     (btree_gist) on `slot_id` + `[starts_at, ends_at)` for CONFIRMED rows.
--
-- No fake/demo booking rows are seeded.
-- ---------------------------------------------------------------------------

-- btree_gist: enables the exclusion-constraint double-booking guard
-- (docs/DATABASE.md §2.12).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --------------------------- reservations --------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id               BIGSERIAL   PRIMARY KEY,
  reservation_code VARCHAR(48) NOT NULL,
  user_id          BIGINT      NOT NULL REFERENCES users (id)            ON DELETE RESTRICT,
  facility_id      BIGINT      NOT NULL REFERENCES parking_facilities (id) ON DELETE RESTRICT,
  zone_id          BIGINT      NULL REFERENCES parking_zones (id)         ON DELETE SET NULL,
  slot_id          BIGINT      NULL REFERENCES parking_slots (id)         ON DELETE RESTRICT,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  state            VARCHAR(24) NOT NULL,
  amount           NUMERIC(12,2) NULL,   -- unused in Phase 2C (no payments)
  payment_status   VARCHAR(24) NULL,     -- unused in Phase 2C (no payments)
  cancel_reason    TEXT        NULL,
  cancelled_at     TIMESTAMPTZ NULL,
  confirmed_at     TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ NULL,

  -- Phase 2C lifecycle subset (docs/DATABASE.md §2.12 full list includes
  -- payment/gate states; those land with the payment/token phase).
  CONSTRAINT reservations_state_check
    CHECK (state IN ('CONFIRMED', 'CANCELLED', 'COMPLETED')),

  CONSTRAINT reservations_range_check
    CHECK (ends_at > starts_at)
);

-- human/QR friendly booking reference (docs/DATABASE.md §2.12).
CREATE UNIQUE INDEX IF NOT EXISTS reservations_code_idx   ON reservations (reservation_code);
-- per-owner history queries.
CREATE INDEX IF NOT EXISTS reservations_user_idx          ON reservations (user_id);
-- per-facility and per-slot lookups.
CREATE INDEX IF NOT EXISTS reservations_facility_idx      ON reservations (facility_id);
CREATE INDEX IF NOT EXISTS reservations_slot_idx          ON reservations (slot_id);
-- active-window lookups.
CREATE INDEX IF NOT EXISTS reservations_starts_at_idx     ON reservations (starts_at);

-- Primary double-booking guard (docs/DATABASE.md §2.12): no two CONFIRMED
-- reservations in the same slot may overlap in [starts_at, ends_at).
-- Enforced at the database level so concurrent creation cannot race.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_no_overlap'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_no_overlap
      EXCLUDE USING gist (
        slot_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      )
      WHERE (state = 'CONFIRMED');
  END IF;
END $$;
