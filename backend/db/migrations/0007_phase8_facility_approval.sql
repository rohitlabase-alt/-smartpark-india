-- 0007_phase8_facility_approval.sql
-- ---------------------------------------------------------------------------
-- Phase 8 facility approval (docs/ROADMAP.md PHASE 8).
--
-- Adds admin-approval tracking to parking_facilities so an administrator can
-- approve a facility listing after operator onboarding and document review.
-- mirrors the approved_by / approved_at pattern on operators (§2.4).
-- ---------------------------------------------------------------------------

ALTER TABLE parking_facilities
  ADD COLUMN approved_by BIGINT      NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN approved_at TIMESTAMPTZ NULL;
