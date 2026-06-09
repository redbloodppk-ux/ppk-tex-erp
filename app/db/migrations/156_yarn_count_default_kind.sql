-- 156_yarn_count_default_kind.sql
--
-- Tag each yarn_count row as either 'yarn' (regular warp/weft yarn) or
-- 'porvai' (selvedge yarn used on the porvai edge). Until now this was
-- only encoded per-lot on yarn_lot.yarn_kind, which meant the Porvai
-- Yarn Stock page had no way to restrict its yarn_count dropdown to
-- porvai-eligible counts — it was listing every yarn_count in the
-- system, even cotton warp counts.
--
-- Backfill rules:
--   1. Existing porvai usage in yarn_lot.yarn_kind = 'porvai'
--      -> the count is porvai.
--   2. Codes starting with 'P-' (the convention the operator uses
--      in this DB, e.g. 'P-150D')
--      -> porvai.
--   3. Everything else stays 'yarn'.
--
-- Operators can change a count's kind later via the yarn count master
-- screen (UI hookup follows in a separate change). This migration is
-- safe to re-apply (uses IF NOT EXISTS + idempotent UPDATE).

ALTER TABLE public.yarn_count
  ADD COLUMN IF NOT EXISTS default_yarn_kind text NOT NULL DEFAULT 'yarn'
    CHECK (default_yarn_kind IN ('yarn','porvai'));

-- Backfill: any count that has at least one porvai lot is porvai.
UPDATE public.yarn_count yc
SET default_yarn_kind = 'porvai'
WHERE EXISTS (
  SELECT 1 FROM public.yarn_lot yl
  WHERE yl.yarn_count_id = yc.id
    AND yl.yarn_kind = 'porvai'
);

-- Backfill: P- prefixed counts (operator convention).
UPDATE public.yarn_count
SET default_yarn_kind = 'porvai'
WHERE code LIKE 'P-%';

CREATE INDEX IF NOT EXISTS idx_yarn_count_default_kind
  ON public.yarn_count (default_yarn_kind);
