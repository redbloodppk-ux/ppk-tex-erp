-- ============================================================================
-- 305: Keep capital purchases (MACHINERY) out of batch expense allocation.
--
-- PPK, 2026-09-23: "yes left machinery cost" - i.e. leave machinery out of
-- the pro-rata spread across in-house batches.
--
-- The new Dropbox / design box (Rs 2,58,350, moved to MACHINERY in 304) is a
-- one-time machine purchase. Spreading it by metres over whichever batches
-- happened to be running that week loaded batch 9 (27-Jun..04-Jul) with
-- Rs 195/m of "expenses" and batches 4 and 7 with part of it too.
--
-- A per-category flag, not a hard-coded name, so another capital category
-- can be excluded later without a migration. Entries are matched to their
-- category case-insensitively.
--
-- Unchanged: the entries themselves, cash movements, and fn_period_pnl*.
-- ============================================================================

ALTER TABLE public.expense_category
  ADD COLUMN IF NOT EXISTS exclude_from_batch_cost boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.expense_category.exclude_from_batch_cost IS
  'True for capital purchases (e.g. MACHINERY): entries in this category are not spread across production batches in v_batch_expense_allocation.';

UPDATE public.expense_category SET exclude_from_batch_cost = true WHERE upper(name) = 'MACHINERY';

CREATE OR REPLACE VIEW public.v_batch_expense_allocation WITH (security_invoker = true) AS
 WITH batch_window AS (
         SELECT pb.id AS batch_id,
            pb.produced_m,
            COALESCE(pb.start_date, (pb.created_at)::date) AS start_date,
            COALESCE(pb.end_date, (pb.created_at)::date) AS end_date
           FROM (production_batch pb
             JOIN costing_master cm ON ((cm.id = pb.costing_id)))
          WHERE (cm.production_mode = 'inhouse'::production_mode)
        ), pair_overlap AS (
         SELECT ee.id AS expense_entry_id,
            ee.category,
            ee.amount,
            bw.batch_id,
            bw.produced_m
           FROM (expense_entry ee
             JOIN batch_window bw ON (((ee.pay_date >= bw.start_date) AND (ee.pay_date <= bw.end_date))))
          WHERE NOT EXISTS (
                SELECT 1 FROM expense_category ec
                 WHERE upper(ec.name) = upper(ee.category)
                   AND ec.exclude_from_batch_cost)
        ), totals AS (
         SELECT pair_overlap.expense_entry_id,
            sum(COALESCE(pair_overlap.produced_m, (0)::numeric)) AS metres_total
           FROM pair_overlap
          GROUP BY pair_overlap.expense_entry_id
        )
 SELECT p.batch_id,
    p.expense_entry_id,
    p.category,
    p.amount AS expense_amount_inr,
        CASE
            WHEN (COALESCE(t.metres_total, (0)::numeric) > (0)::numeric) THEN (p.amount * (COALESCE(p.produced_m, (0)::numeric) / t.metres_total))
            ELSE (0)::numeric
        END AS allocated_expense_inr
   FROM (pair_overlap p
     LEFT JOIN totals t USING (expense_entry_id));
