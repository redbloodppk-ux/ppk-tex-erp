-- 056_drop_vendor_table.sql
--
-- Final cutover. All UIs now write *_ledger_id and all views source
-- vendor names from the ledger master, so the vendor table and its
-- legacy FK columns can go.

BEGIN;

-- Rebuild v_sizing_spend_by_month off sizing_ledger_id (was using sizing_vendor_id).
CREATE OR REPLACE VIEW public.v_sizing_spend_by_month AS
WITH scoped AS (
  SELECT sj.id, sj.sizing_ledger_id, sj.yarn_used_kg, sj.total_amount,
         sj.sizing_rate_per_kg,
         COALESCE(sj.date_received, sj.date_sent, (sj.created_at)::date) AS spend_date
  FROM public.sizing_job sj
  WHERE sj.status <> 'cancelled'::sizing_job_status AND sj.total_amount > 0
)
SELECT (date_trunc('month', spend_date::timestamptz))::date AS period_start,
       (count(*))::integer AS jobs_count,
       (sum(yarn_used_kg))::numeric(14,3) AS total_yarn_kg,
       (sum(total_amount))::numeric(14,2) AS total_spend,
       CASE WHEN sum(yarn_used_kg) > 0 THEN (sum(total_amount) / sum(yarn_used_kg))::numeric(10,4)
            ELSE NULL END AS effective_rate_per_kg
FROM scoped
GROUP BY period_start
ORDER BY period_start DESC;

DROP TRIGGER IF EXISTS trg_yarn_lot_sync_ledger ON public.yarn_lot;
DROP FUNCTION IF EXISTS public.tg_yarn_lot_sync_ledger();
DROP VIEW IF EXISTS public.v_vendor_ledger_map;

ALTER TABLE public.yarn_lot           DROP COLUMN IF EXISTS broker_id;
ALTER TABLE public.yarn_lot           DROP COLUMN IF EXISTS sizing_vendor_id;
ALTER TABLE public.pavu               DROP COLUMN IF EXISTS outsource_vendor_id;
ALTER TABLE public.sizing_job         DROP COLUMN IF EXISTS sizing_vendor_id;
ALTER TABLE public.sizing_job         DROP COLUMN IF EXISTS default_outsource_vendor_id;
ALTER TABLE public.outsource_order    DROP COLUMN IF EXISTS vendor_id;
ALTER TABLE public.delivery_challan   DROP COLUMN IF EXISTS vendor_id;
ALTER TABLE public.invoice            DROP COLUMN IF EXISTS vendor_id;
ALTER TABLE public.payment            DROP COLUMN IF EXISTS vendor_id;
ALTER TABLE public.resale_lot         DROP COLUMN IF EXISTS vendor_id;
ALTER TABLE public.vendor_performance DROP COLUMN IF EXISTS vendor_id;

DROP TABLE IF EXISTS public.vendor_performance CASCADE;
DROP TABLE IF EXISTS public.vendor             CASCADE;

COMMIT;
