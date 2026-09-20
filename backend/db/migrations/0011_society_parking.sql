-- 0011_society_parking.sql
-- ---------------------------------------------------------------------------
-- Phase 10 MVP Society/Residential parking (docs/DATABASE.md §2.8, §2.11).
--
-- Adds the slot CATEGORY facet that lets a society (or any facility) label
-- parking inventory by who may use it: RESIDENT / VISITOR / GUEST / EV /
-- ACCESSIBLE, with STANDARD as the universal default. The column is additive
-- (DEFAULT 'STANDARD') so every existing slot keeps its current behaviour and
-- non-society facilities need no data migration.
--
-- Reversible: category can be dropped with a single ALTER TABLE ... DROP
-- COLUMN; new rows default STANDARD so dropping never strands data.
-- Forward-compatible vocabularies are NOT constrained in the DB (application
-- vocabulary lives in packages/shared); only the current effective set is
-- locked by the CHECK (docs/DATABASE.md convention, §2.8).
--
-- Convenience index drives the "category → slots" reads used by the society
-- booking UI and occupancy queries (docs/DATABASE.md §4).
-- ---------------------------------------------------------------------------

-- --------------------- parking_slots.category -----------------------------
ALTER TABLE parking_slots
  ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT 'STANDARD';

-- Effective slot-category vocabulary (packages/shared SLOT_CATEGORIES).
ALTER TABLE parking_slots
  ADD CONSTRAINT parking_slots_category_check
  CHECK (category IN ('STANDARD', 'RESIDENT', 'VISITOR', 'GUEST', 'EV', 'ACCESSIBLE'));

CREATE INDEX IF NOT EXISTS parking_slots_facility_category_idx
  ON parking_slots (facility_id, category);