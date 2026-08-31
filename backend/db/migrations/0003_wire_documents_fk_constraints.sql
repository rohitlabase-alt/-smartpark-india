-- 0003_wire_documents_fk_constraints.sql
-- ---------------------------------------------------------------------------
-- Phase 1B created the `documents` table standalone (D-025 note: "FK
-- constraints ... are intentionally deferred to Phase 2 alongside base
-- tables"). Phase 2A migration 0002 introduces users / operators /
-- parking_facilities, so the deferred FKs are wired here per
-- docs/DATABASE.md §2.23: ON DELETE RESTRICT for verified/reviewed documents;
-- children linking to soft-deleted parents remain for audit history.
-- ---------------------------------------------------------------------------

ALTER TABLE documents
  ADD CONSTRAINT documents_operator_id_fkey
    FOREIGN KEY (operator_id) REFERENCES operators (id) ON DELETE RESTRICT,
  ADD CONSTRAINT documents_parking_id_fkey
    FOREIGN KEY (parking_id) REFERENCES parking_facilities (id) ON DELETE RESTRICT,
  ADD CONSTRAINT documents_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT documents_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE RESTRICT;