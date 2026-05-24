-- ────────────────────────────────────────────────────────────────────────────
-- Migration 008 — Auto-generate production_batch.batch_code
--
--   Production module v1 needs a code generator. Every other doc type (SO,
--   invoice, sizing_job, pavu, etc.) already uses fn_next_doc_no('<doc_type>')
--   driven by the doc_sequence master table. We register 'batch' there and
--   wire a BEFORE INSERT trigger so the form doesn't have to compute the
--   sequence client-side.
--
--   Format: B-{fy}-{seq:0000}  →  B-2026-0001, B-2026-0002, …
--   Reset yearly, same as SZ / OW / PO.
--
-- Safe to re-run: ON CONFLICT DO NOTHING + CREATE OR REPLACE + DROP TRIGGER.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES ('batch', 'B', '{prefix}-{fy}-{seq:0000}', '2026', 1, true)
ON CONFLICT (doc_type) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_batch_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.batch_code IS NULL OR NEW.batch_code = '' THEN
    NEW.batch_code := fn_next_doc_no('batch');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_batch_autogen_code() FROM PUBLIC, anon, authenticated;

-- Order matters: this trigger runs BEFORE the cost snapshot trigger (005), so
-- both stay BEFORE INSERT but Postgres fires them alphabetically by name.
-- We pick "trg_batch_autogen_code" which sorts before "trg_batch_cost_snapshot".
DROP TRIGGER IF EXISTS trg_batch_autogen_code ON production_batch;
CREATE TRIGGER trg_batch_autogen_code
  BEFORE INSERT ON production_batch
  FOR EACH ROW
  EXECUTE FUNCTION fn_batch_autogen_code();

COMMIT;
