-- 0006_phase7_mock_payment.sql
-- ---------------------------------------------------------------------------
-- Phase 7 mock payment (docs/ROADMAP.md PHASE 7, docs/DECISIONS.md D-010).
--
-- Activates the payment stripe of the reservation lifecycle:
--   * opens the `reservations.state` CHECK to the full documented vocabulary
--     (PENDING_PAYMENT/CONFIRMED/ACTIVE/COMPLETED/CANCELLED/EXPIRED/FAILED —
--     docs/DATABASE.md §2.12, docs/PRD.md §10).
--   * makes `amount`/`payment_status` meaningful (previously nullable/unused,
--     D-034) and widens the btree_gist exclusion predicate to cover ACTIVE
--     rows too, so a slot is protected while payment is pending or in use.
--   * creates `payments` (§2.15) and `transactions` (§2.16).
--   * adds a minimal `payment_idempotency_keys` table for the API_SPEC §6
--     "one-time per key" guarantee that prevents duplicate payment attempts.
--
-- Convention compliance (DATABASE.md header/§3): id BIGSERIAL PK,
-- created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), FKs everywhere,
-- ON DELETE RESTRICT for financial/history rows, TIMESTAMPTZ stored UTC.
-- ---------------------------------------------------------------------------

-- ---------------------- reservations reservations -----------------------------
-- Widen the state CHECK to the full §2.12 vocabulary.
-- (Drops and re-adds so the constraint becomes the documented full set.)
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_state_check;

ALTER TABLE reservations ADD CONSTRAINT reservations_state_check
  CHECK (state IN (
    'PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE',
    'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'
  ));

-- Widen the double-booking guard (docs/DATABASE.md §2.12 exclusion constraint)
-- to cover PENDING_PAYMENT and ACTIVE as well as CONFIRMED. PENDING_PAYMENT
-- still reserves the slot while payment is pending (task requirement), so its
-- tuples participate in the overlap guard: a conflicting window on the same
-- slot is rejected whether the incumbent is PENDING_PAYMENT, CONFIRMED or
-- ACTIVE. On payment success the row transitions PENDING_PAYMENT→CONFIRMED
-- within its own existing exclusion tuple (same slot/window), so the transition
-- does not self-conflict. Cancellation moves the row to CANCELLED (outside the
-- predicate), freeing the slot for a fresh booking.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_no_overlap'
  ) THEN
    ALTER TABLE reservations DROP CONSTRAINT reservations_no_overlap;
  END IF;
END $$;

ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    slot_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (state IN ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE'));

-- Make amount/payment_status constraints explicit now that they are used.
-- (Both remain NULLABLE: pre-payment and unfacilitated rows carry no value.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_amount_check'
  ) THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_amount_check
      CHECK (amount IS NULL OR amount >= 0);
  END IF;
END $$;

-- ------------------------------ payments ------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id              BIGSERIAL   PRIMARY KEY,
  reservation_id  BIGINT      NOT NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  provider        VARCHAR(32) NOT NULL,
  provider_txn_id VARCHAR(80) NULL,
  amount          NUMERIC(12,2) NOT NULL,
  status          VARCHAR(24) NOT NULL,
  meta            JSONB       NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT payments_provider_check
    CHECK (provider IN ('MOCK')),
  CONSTRAINT payments_status_check
    CHECK (status IN ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
  CONSTRAINT payments_amount_check
    CHECK (amount >= 0)
);

-- provider_txn_id is unique when present (docs/DATABASE.md §2.15).
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_txn_idx
  ON payments (provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_reservation_idx ON payments (reservation_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

-- ----------------------------- transactions ---------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id          BIGSERIAL   PRIMARY KEY,
  payment_id  BIGINT      NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  kind        VARCHAR(24) NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  status      VARCHAR(24) NOT NULL,
  reference   VARCHAR(80) NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT transactions_kind_check
    CHECK (kind IN ('CHARGE', 'REFUND', 'REVERSAL')),
  CONSTRAINT transactions_status_check
    CHECK (status IN ('SUCCESS', 'FAILED')),
  CONSTRAINT transactions_amount_check
    CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS transactions_payment_idx ON transactions (payment_id);

-- ---------------------- payment_idempotency_keys ----------------------------
-- API_SPEC §6 idempotency: the same authenticated user + endpoint + key maps
-- to at most one payment attempt. A unique (user_id, key, endpoint) index is
-- the race-safe dedupe guard; rows carry a TTL so keys are one-time within a
-- window. provider_txn_id links the key back to the created payment.
CREATE TABLE IF NOT EXISTS payment_idempotency_keys (
  id              BIGSERIAL   PRIMARY KEY,
  user_id         BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  key             VARCHAR(128) NOT NULL,
  endpoint        VARCHAR(64)  NOT NULL,
  payment_id      BIGINT      NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,

  CONSTRAINT payment_idempotency_key_length_check CHECK (char_length(key) >= 1)
);

-- One key per (user, key, endpoint); repeated requests with the same key reuse
-- the same payment instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS payment_idempotency_lookup_idx
  ON payment_idempotency_keys (user_id, key, endpoint);
CREATE INDEX IF NOT EXISTS payment_idempotency_payment_idx
  ON payment_idempotency_keys (payment_id);
