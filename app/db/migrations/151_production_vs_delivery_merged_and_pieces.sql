-- 151_production_vs_delivery_merged_and_pieces.sql
--
-- Two enhancements to fn_production_vs_delivery:
--
-- 1. Merged-name grouping. fabric_quality rows with is_merged=true
--    collapse onto a single row whose key is merged_name. A merged
--    group reports MAX(merged_name) and the sum of metres across its
--    constituent FQs.
--
-- 2. Pieces conversion. fabric_quality.meter_per_pc gives metres per
--    finished piece (towel length, dhoti length, etc.). When set the
--    function exposes produced_pcs / delivered_pcs / variance_pcs
--    alongside the metres so the operator can compare in pieces.

DROP FUNCTION IF EXISTS public.fn_production_vs_delivery(date, date);

CREATE OR REPLACE FUNCTION public.fn_production_vs_delivery(p_from date, p_to date)
RETURNS TABLE (
  fabric_quality_id bigint,
  quality_code      text,
  quality_name      text,
  is_merged         boolean,
  meter_per_pc      numeric,
  production_mode   text,
  produced_m        numeric,
  delivered_m       numeric,
  variance_m        numeric,
  variance_pct      numeric,
  produced_pcs      numeric,
  delivered_pcs     numeric,
  variance_pcs      numeric,
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
    SELECT fq.id AS fabric_quality_id,
           SUM(st.net_metres)::numeric AS produced_m,
           MAX(st.log_date)            AS last_event
    FROM shift_total st
    JOIN public.loom l ON l.id = st.loom_id
    JOIN public.fabric_quality fq ON fq.id = l.fabric_quality_id
    GROUP BY fq.id
  ),
  ih_unattributed AS (
    SELECT NULL::bigint AS fabric_quality_id,
           SUM(st.net_metres)::numeric AS produced_m,
           MAX(st.log_date)            AS last_event
    FROM shift_total st
    JOIN public.loom l ON l.id = st.loom_id
    WHERE l.fabric_quality_id IS NULL
    HAVING SUM(st.net_metres) > 0
  ),
  jw_os_prod AS (
    SELECT fri.fabric_quality_id, dc.production_mode,
           SUM(fri.received_metres)::numeric AS produced_m,
           MAX(fr.receipt_date)              AS last_event
    FROM public.fabric_receipt_item fri
    JOIN public.fabric_receipt fr  ON fr.id = fri.receipt_id
    JOIN public.delivery_challan dc ON dc.id = fr.dc_id
    WHERE dc.production_mode IN ('jobwork','outsource')
      AND fr.receipt_date BETWEEN p_from AND p_to
    GROUP BY fri.fabric_quality_id, dc.production_mode
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
    SELECT fabric_quality_id, 'inhouse'::text AS production_mode, produced_m, last_event
    FROM ih_attributed
    UNION ALL
    SELECT fabric_quality_id, 'unattributed'::text, produced_m, last_event
    FROM ih_unattributed
    UNION ALL
    SELECT fabric_quality_id, production_mode, produced_m, last_event
    FROM jw_os_prod
  ),
  raw AS (
    SELECT
      COALESCE(p.fabric_quality_id, d.fabric_quality_id) AS fabric_quality_id,
      COALESCE(p.production_mode,    d.production_mode)  AS production_mode,
      COALESCE(p.produced_m, 0)::numeric  AS produced_m,
      COALESCE(d.delivered_m, 0)::numeric AS delivered_m,
      GREATEST(p.last_event, d.last_dc_date) AS last_activity
    FROM produced_all p
    FULL OUTER JOIN delivered d
      ON d.fabric_quality_id = p.fabric_quality_id
     AND d.production_mode   = p.production_mode
    WHERE COALESCE(p.produced_m, 0) + COALESCE(d.delivered_m, 0) > 0
  ),
  raw_with_quality AS (
    SELECT r.*,
           fq.code, fq.name, fq.is_merged, fq.merged_name, fq.meter_per_pc,
           CASE
             WHEN r.fabric_quality_id IS NULL THEN '__unattributed__'
             WHEN fq.is_merged AND fq.merged_name IS NOT NULL THEN 'M:' || fq.merged_name
             ELSE 'F:' || COALESCE(fq.code, r.fabric_quality_id::text)
           END AS group_key
    FROM raw r
    LEFT JOIN public.fabric_quality fq ON fq.id = r.fabric_quality_id
  )
  SELECT
    MIN(fabric_quality_id)                                          AS fabric_quality_id,
    CASE
      WHEN MAX(group_key) = '__unattributed__' THEN NULL
      WHEN bool_or(is_merged) AND MAX(merged_name) IS NOT NULL THEN MAX(merged_name)
      ELSE MAX(code)
    END                                                             AS quality_code,
    CASE
      WHEN MAX(group_key) = '__unattributed__' THEN 'Unattributed (no quality on loom)'
      WHEN bool_or(is_merged) AND MAX(merged_name) IS NOT NULL THEN MAX(merged_name)
      ELSE MAX(name)
    END                                                             AS quality_name,
    bool_or(is_merged)                                              AS is_merged,
    MAX(meter_per_pc)                                               AS meter_per_pc,
    production_mode,
    SUM(produced_m)::numeric(14,2)                                  AS produced_m,
    SUM(delivered_m)::numeric(14,2)                                 AS delivered_m,
    (SUM(produced_m) - SUM(delivered_m))::numeric(14,2)             AS variance_m,
    CASE
      WHEN SUM(produced_m) > 0
        THEN ((SUM(produced_m) - SUM(delivered_m)) / SUM(produced_m) * 100)::numeric(8,2)
      ELSE NULL
    END                                                             AS variance_pct,
    CASE WHEN MAX(meter_per_pc) > 0
         THEN (SUM(produced_m) / MAX(meter_per_pc))::numeric(14,2)
         ELSE NULL END                                              AS produced_pcs,
    CASE WHEN MAX(meter_per_pc) > 0
         THEN (SUM(delivered_m) / MAX(meter_per_pc))::numeric(14,2)
         ELSE NULL END                                              AS delivered_pcs,
    CASE WHEN MAX(meter_per_pc) > 0
         THEN ((SUM(produced_m) - SUM(delivered_m)) / MAX(meter_per_pc))::numeric(14,2)
         ELSE NULL END                                              AS variance_pcs,
    MAX(last_activity)                                              AS last_activity
  FROM raw_with_quality
  GROUP BY group_key, production_mode;
$func$;
