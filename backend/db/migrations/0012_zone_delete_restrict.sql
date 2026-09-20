-- ---------------------------------------------------------------------------
-- 0012_zone_delete_restrict.sql
--
-- Phase 10 society parking — zone DELETE integrity (fix of the TOCTOU hazard
-- audited in zones.service.ts deleteZone + docs/DATABASE.md §2.27).
--
-- PROBLEM (as it stood after 0004/0005):
--   * parking_slots.zone_id and parking_reservations.zone_id both referenced
--     parking_zones ON DELETE SET NULL; a zone DELETE therefore silently
--     detached every assigned slot (and every booking) with no database-level
--     objection. The application tried to compensate with countSlotsInZone()
--     AS A PRE-CHECK, but that count ran on getPool() — a different connection
--     than the transactional DELETE — so a slot (re)assigned between the
--     SELECT and the DELETE was detached under the app's nose: a classic
--     TOCTOU.
--
-- FIX (database-enforced integrity, as the brief demands):
--   * parking_slots.zone_id becomes ON DELETE RESTRICT. The database now
--     ATOMICALLY refuses to delete a zone while any slot still references it
--     (foreign_key_violation 23503), so the "zone must not contain slots"
--     invariant is enforced by the DB, not by an application timing window.
--     No dangling zone_id reference can ever result: the DELETE is rejected
--     outright.
--   * The service still runs countSlotsInZone() — but on the SAME transaction
--     client as the delete (see zones.repository.countSlotsInZone(zoneId,
--     client)) so the friendly 409 ZONE_IN_USE fast-path sees the same
--     snapshot, and separately maps the 23503 the delete raises on a
--     concurrent reassignment back to the same ZONE_IN_USE conflict code.
--
-- SCOPE GUARD: parking_reservations.zone_id is left ON DELETE SET NULL — it is
-- the committed Phase 2C booking contract (zoneId optional; reservations are
-- payment-state flows explicitly out of scope for this batch). Changing its FK
-- action is NOT part of this fix. Only the slot facet is tightened.
--
-- Reversible: the previous action can be restored with a plain
--   ALTER TABLE parking_slots DROP CONSTRAINT parking_slots_zone_id_fkey;
--   ALTER TABLE parking_slots ADD FOREIGN KEY (zone_id)
--     REFERENCES parking_zones(id) ON DELETE SET NULL;
-- Note: 0004 declared the FK INLINE (Postgres auto-named it
-- parking_slots_zone_id_fkey); we DROP that exact auto-name then re-add
-- explicitly so the action is RESTRICT going forward.
-- ---------------------------------------------------------------------------

ALTER TABLE parking_slots
  DROP CONSTRAINT IF EXISTS parking_slots_zone_id_fkey;

ALTER TABLE parking_slots
  ADD CONSTRAINT parking_slots_zone_id_fkey
  FOREIGN KEY (zone_id) REFERENCES parking_zones (id) ON DELETE RESTRICT;
