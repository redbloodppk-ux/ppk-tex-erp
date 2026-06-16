-- 176_costing_master_bobbin_table.sql
--
-- `costing_master` historically had two hard-coded slots:
--   use_bobbin_1, bobbin_1_id, bobbin_1_loading
--   use_bobbin_2, bobbin_2_id, bobbin_2_loading
-- The owner wants to pick an UNLIMITED number of bobbins per costing
-- (e.g. some qualities use 3 or 4 different bobbin types together).
--
-- This migration adds a child table `costing_master_bobbin` that holds
-- one row per bobbin attached to a costing. Each row has its own
-- price / metres / waste so the calculator can sum the per-metre cost
-- contribution from every bobbin in the set.
--
-- The legacy columns (use_bobbin_1, bobbin_1_id, bobbin_1_loading,
-- use_bobbin_2, bobbin_2_id, bobbin_2_loading) are KEPT for now so
-- existing code that reads them keeps working. A later migration can
-- drop them once every consumer has moved over to the child table.
--
-- Backfill: every existing costing_master row that has use_bobbin_1
-- or use_bobbin_2 set TRUE and a non-null id is migrated into one row
-- per slot, preserving the old loading value. price/metres are left
-- NULL so the calculator falls back to defaults if the row was set up
-- before this migration.

BEGIN;

-- ── 1) Child table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.costing_master_bobbin (
  id          bigserial PRIMARY KEY,
  costing_id  bigint  NOT NULL REFERENCES public.costing_master(id)
                                ON DELETE CASCADE,
  bobbin_id   bigint  NOT NULL REFERENCES public.bobbin(id)
                                ON DELETE RESTRICT,
  /* Per-row cost inputs — same shape as the legacy single-bobbin
     fields. waste is Rs/m, price is Rs per bobbin, metres is the
     metres yielded per bobbin. */
  price       numeric(12,2),
  metres      numeric(12,2),
  waste       numeric(8,3) NOT NULL DEFAULT 0,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

CREATE INDEX IF NOT EXISTS idx_cmb_costing
  ON public.costing_master_bobbin (costing_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_cmb_bobbin
  ON public.costing_master_bobbin (bobbin_id);

COMMENT ON TABLE public.costing_master_bobbin IS
  'One row per bobbin attached to a costing_master. Replaces the legacy bobbin_1/bobbin_2 columns with an unlimited list. Each row carries its own price/metres/waste so the calculator can sum per-bobbin cost contributions.';

-- ── 2) Backfill existing data ─────────────────────────────────────
-- Slot 1
INSERT INTO public.costing_master_bobbin (costing_id, bobbin_id, waste, sort_order)
SELECT cm.id, cm.bobbin_1_id, COALESCE(cm.bobbin_1_loading, 0), 0
FROM public.costing_master cm
WHERE cm.use_bobbin_1 = true
  AND cm.bobbin_1_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Slot 2
INSERT INTO public.costing_master_bobbin (costing_id, bobbin_id, waste, sort_order)
SELECT cm.id, cm.bobbin_2_id, COALESCE(cm.bobbin_2_loading, 0), 1
FROM public.costing_master cm
WHERE cm.use_bobbin_2 = true
  AND cm.bobbin_2_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3) Touch trigger ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cmb_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cmb_touch ON public.costing_master_bobbin;
CREATE TRIGGER trg_cmb_touch
  BEFORE UPDATE ON public.costing_master_bobbin
  FOR EACH ROW EXECUTE FUNCTION public.fn_cmb_touch();

-- ── 4) RLS — single-tenant app, broad authenticated read+write ────
ALTER TABLE public.costing_master_bobbin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_cmb_read  ON public.costing_master_bobbin;
DROP POLICY IF EXISTS p_cmb_write ON public.costing_master_bobbin;
CREATE POLICY p_cmb_read
  ON public.costing_master_bobbin
  FOR SELECT TO authenticated USING (true);
CREATE POLICY p_cmb_write
  ON public.costing_master_bobbin
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
