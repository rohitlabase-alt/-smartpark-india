-- 0001_create_documents.sql
-- ---------------------------------------------------------------------------
-- documents: metadata + storage_key reference only (docs/DATABASE.md §2.23,
-- docs/ARCHITECTURE.md §12). The binary itself lives in S3-compatible object
-- storage, never in PostgreSQL.
--
-- Phase 1B note: FK constraints to operators / parking_facilities / users are
-- intentionally OMITTED here — those base tables land in Phase 2. This table
-- is created standalone; the FKs are added by a Phase 2 migration alongside
-- their base tables. Columns match docs/DATABASE.md §2.23 verbatim, plus the
-- standard created_at/updated_at timestamps documented in DATABASE.md header
-- conventions (all tables get id/created_at/updated_at).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS documents (
  id                 BIGSERIAL PRIMARY KEY,
  document_id        VARCHAR(64)  NOT NULL,
  operator_id        BIGINT       NULL,
  parking_id         BIGINT       NULL,
  uploaded_by        BIGINT       NULL,
  storage_key        VARCHAR(255) NOT NULL,
  document_type      VARCHAR(48)  NOT NULL,
  mime_type          VARCHAR(80)  NOT NULL,
  file_size          INTEGER      NOT NULL CHECK (file_size >= 0),
  checksum           TEXT         NULL,
  verification_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  verification_note  TEXT         NULL,
  reviewed_by        BIGINT       NULL,
  reviewed_at        TIMESTAMPTZ  NULL,
  expires_at         TIMESTAMPTZ  NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ  NULL,

  -- A document must belong to an operator or a facility (doc §2.23).
  CONSTRAINT documents_owner_check
    CHECK (operator_id IS NOT NULL OR parking_id IS NOT NULL),

  -- Vocabulary per docs/DATABASE.md §2.23.
  CONSTRAINT documents_status_check
    CHECK (verification_status IN ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED')),

  -- Example set from docs/DATABASE.md §2.23; may be widened in later phases.
  CONSTRAINT documents_type_check
    CHECK (document_type IN ('operator_license', 'registration_proof', 'id_proof', 'parking_image', 'other'))
);

CREATE INDEX IF NOT EXISTS documents_operator_idx ON documents (operator_id);
CREATE INDEX IF NOT EXISTS documents_parking_idx  ON documents (parking_id);
CREATE INDEX IF NOT EXISTS documents_status_idx   ON documents (verification_status);
-- documents_document_id UNIQUE constraint above provides the index;
-- a naming-compatible unique index satisfies the DATABASE.md §2.23 index list:
CREATE UNIQUE INDEX IF NOT EXISTS documents_document_id_idx ON documents (document_id);