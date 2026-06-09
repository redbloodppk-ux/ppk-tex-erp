-- 149_production_vs_delivery_fn.sql
-- fn_production_vs_delivery(p_from, p_to) → one row per
-- (fabric_quality_id, production_mode) inside the window:
--
--   inhouse     produced = net shift_log metres for the loom on a day
--               that lies inside the loom's active production_batch
--               window; quality = batch's costing_master.quality_code
--   jobwork     produced = fabric_receipt_item.received_metres on
--               receipts whose DC has production_mode='jobwork'
--   outsource   same as jobwork but production_mode='outsource'
--
-- Net shift metres = SUM(production_shift_log_weaver.metres_woven)
-- + production_shift_log.adjustment_metres (same convention as
-- v_loom_shift_utilisation).
--
-- Delivered (every mode) = delivery_challan_item.metres on DCs whose
-- production_mode matches and status IN ('confirmed','invoiced').
--
-- Shift-log rows with no overlapping production_batch land on a
-- 'unattributed' row (NULL quality) so they're visible without
-- polluting quality totals.

CREATE OR REPLACE FUNCTION public.fn_production_vs_delivery(p_from date, p_to date)
RETURNS TABLE (
  fabric_quality_id bigint,
  quality_code      text,
  quality_name      text,
  production_mode   text,
  produced_m        numeric,
  delivered_m       numeric,
  variance_m        numeric,
  variance_pct      numeric,
  last_activity     date
)
LANGUAGE sql STABLE SECURITY INVOKER AS $func$
  WITH shift_total AS (
    SELECT psl.id, psl.loom_id, psl.log_date,
           (COALESCE((SELECT SUM(pslw.metres_woven)
                       FROM public.production_shift_log_weaver pslw
                       WHERE pslw.shift_log_id = psl.id), 0::numeric)
            + psl.adjustment_metres) AS net_metres
    FROM public.production_shift_log psl
    WHERE psl.log_date BETWEEN p_from AND p_to
  ),
  ih_attributed AS (
    SELECT cm.id AS fabric_quality_id, cm.quality_code, cm.quality_name,
           SUM(st.net_metres)::numeric AS produced_m, MAX(st.log_date) AS last_event
    FROM shift_total st
    JOIN public.production_batch pb ON pb.loom_id = st.loom_id
                                   AND st.log_date BETWEEN pb.start_date AND pb.end_date
    JOIN public.costing_master cm ON cm.id = pb.costing_id
    GROUP BY cm.id, cm.quality_code, cm.quality_name
  ),
  ih_unattributed AS (
    SELECT NULL::bigint AS fabric_quality_id,
           NULL::text   AS quality_code,
           'Unattributed (no active batch)'::text AS quality_name,
           SUM(st.net_metres)::numeric AS produced_m,
           MAX(st.log_date)            AS last_event
    FROM shift_total st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.production_batch pb
      WHERE pb.loom_id = st.loom_id
        AND st.log_date BETWEEN pb.start_date AND pb.end_date
    )
    HAVING SUM(st.net_metres) > 0
  ),
  jw_os_prod AS (
    SELECT fri.fabric_quality_id, fq.code AS quality_code, fq.name AS quality_name,
           dc.production_mode,
           SUM(fri.received_metres)::numeric AS produced_m,
           MAX(fr.receipt_date)              AS last_event
    FROM public.fabric_receipt_item fri
    JOIN public.fabric_receipt fr  ON fr.id = fri.receipt_id
    JOIN public.delivery_challan dc ON dc.id = fr.dc_id
    LEFT JOIN public.fabric_quality fq ON fq.id = fri.fabric_quality_id
    WHERE dc.production_mode IN ('jobwork','outsource')
      AND fr.receipt_date BETWEEN p_from AND p_to
    GROUP BY fri.fabric_quality_id, fq.code, fq.name, dc.production_mode
  ),
  delivered AS (
    SELECT dci.fabric_quality_id, dc.production_mode,
           SUM(dci.metres)::numeric AS delivered_m, MAX(dc.dc_date) AS last_dc_date
    FROM public.delivery_challan_item dci
    JOIN public.delivery_challan dc ON dc.id = dci.dc_id
    WHERE dc.status IN ('confirmed','invoiced')
      AND dc.dc_date BETWEEN p_from AND p_to
    GROUP BY dci.fabric_quality_id, dc.production_mode
  ),
  produced_all AS (
    SELECT fabric_quality_id, quality_code, quality_name,
           'inhouse'::text AS production_mode, produced_m, last_event
    FROM ih_attributed
    UNION ALL
    SELECT fabric_quality_id, quality_code, quality_name,
           'unattributed'::text, produced_m, last_event
    FROM ih_unattributed
    UNION ALL
    SELECT fabric_quality_id, quality_code, quality_name,
           production_mode, produced_m, last_event
    FROM jw_os_prod
  )
  SELECT
    COALESCE(p.fabric_quality_id, d.fabric_quality_id)              AS fabric_quality_id,
    COALESCE(p.quality_code, fq.code)                               AS quality_code,
    COALESCE(p.quality_name, fq.name, 'Unknown quality')            AS quality_name,
    COALESCE(p.production_mode, d.production_mode)                  AS production_mode,
    COALESCE(p.produced_m, 0)::numeric(14,2)                        AS produced_m,
    COALESCE(d.delivered_m, 0)::numeric(14,2)                       AS delivered_m,
    (COALESCE(p.produced_m, 0) - COALESCE(d.delivered_m, 0))::numeric(14,2) AS variance_m,
    CASE
      WHEN COALESCE(p.produced_m, 0) > 0
        THEN ((COALESCE(p.produced_m, 0) - COALESCE(d.delivered_m, 0))
              / p.produced_m * 100)::numeric(8,2)
      ELSE NULL
    END                                                             AS variance_pct,
    GREATEST(p.last_event, d.last_dc_date)                          AS last_activity
  FROM produced_all p
  FULL OUTER JOIN delivered d
    ON d.fabric_quality_id = p.fabric_quality_id
   AND d.production_mode   = p.production_mode
  LEFT JOIN public.fabric_quality fq ON fq.id = d.fabric_quality_id
  WHERE COALESCE(p.produced_m, 0) + COALESCE(d.delivered_m, 0) > 0;
$func$;
