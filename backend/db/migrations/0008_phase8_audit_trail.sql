-- 0008_phase8_audit_trail.sql
-- ---------------------------------------------------------------------------
-- Phase 8, Part 4 audit trail (docs/ROADMAP.md PHASE 8, docs/DATABASE.md §2.23).
--
-- Append-only audit event ledger: server-generated records of admin and
-- platform actions (docs/SECURITY.md §5, docs/COMPLIANCE.md). Rows are written
-- by application code inside the same transaction as the business mutation so
-- a mutation without its audit record cannot commit. No application path
-- updates or deletes audit rows.
--
-- Convention note: id BIGSERIAL PK, created_at TIMESTAMPTZ NOT NULL DEFAULT
-- now(), FKs everywhere, ON DELETE SET NULL for the (nullable) actor reference.
-- updated_at is deliberately omitted — the append-only contract means rows are
-- written once and never changed (DATABASE.md §2.23).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_events (
  id            BIGSERIAL   PRIMARY KEY,
  actor_user_id BIGINT      NULL REFERENCES users (id) ON DELETE SET NULL,
  action        VARCHAR(64) NOT NULL,
  entity_type   VARCHAR(64) NOT NULL,
  entity_id     BIGINT      NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin audit queries: newest-first timeline, actor history, per-entity
-- history, and action-partitioned history (docs/DATABASE.md §2.23/§4).
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
  ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_created_idx
  ON audit_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON audit_events (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_created_idx
  ON audit_events (action, created_at DESC);