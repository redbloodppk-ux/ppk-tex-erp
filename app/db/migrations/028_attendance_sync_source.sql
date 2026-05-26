-- 028_attendance_sync_source.sql — CORR-A7
--
-- Track whether an attendance row was saved while online or replayed from
-- the offline PWA queue. This is purely diagnostic — reports don't care —
-- but the addendum Scenario O calls it out for the parallel-run audit and
-- it helps the owner trust the offline path.
--
-- Default 'online' so every existing row is correctly classified without
-- back-fill. The PWA writes 'offline_pwa' when flushing the queue.

ALTER TABLE attendance_day
  ADD COLUMN IF NOT EXISTS sync_source text NOT NULL DEFAULT 'online';

ALTER TABLE attendance_entry
  ADD COLUMN IF NOT EXISTS sync_source text NOT NULL DEFAULT 'online';

CREATE INDEX IF NOT EXISTS idx_attendance_entry_sync_source
  ON attendance_entry(sync_source)
  WHERE sync_source <> 'online';
