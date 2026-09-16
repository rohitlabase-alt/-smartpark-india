-- 0010_phase9_gate_tokens.sql
-- Phase 9 Block 3: parking-pass verification tokens (docs/ROADMAP.md PHASE 9).
--
-- Every confirmed reservation carries a deterministic parking-pass verification
-- token (docs/DATABASE.md §2.12, docs/SECURITY.md). Only its SHA-256 digest is
-- stored at rest — the raw token is never persisted and never logged. The
-- partial unique index makes concurrent chain-of-token lookups race-safe and
-- guarantees at most one issued pass digest per reservation.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS verification_token_hash VARCHAR(64) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_verification_token_hash_idx
  ON reservations (verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;