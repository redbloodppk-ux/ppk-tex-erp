-- 315: Production vs Delivery — pieces use the towel length that was in
-- force at the time, not today's master value.
--   * produced pcs = shift metres / production_shift_log.towel_meter_per_pc
--     (snapshot taken when the shift was logged)
--   * delivered pcs = the DC's own piece count (dci.metres holds pieces
--     for piece-counted qualities; a DECIMAL value is a metre delivery,
--     same rule as the DC form); delivered metres = pcs x the length
--     in force on the DC date (latest shift-log snapshot on/before it,
--     else the master value)
-- Changing a towel length (e.g. DOBBY-CT-TOWEL-31 1.65 -> 1.60 on
-- 10-Oct-2026) therefore no longer rewrites older periods.
CREATE OR REPLACE FUNCTION public.fn_production_vs_delivery(p_from date, p_to date)
 RETURNS TABLE(fabric_quality_id bigint, quality_code text, quality_name text, is_merged boolean, meter_per_pc numeric, production_mode text, produced_m numeric, delivered_m numeric, variance_m numeric, variance_pct numeric, produced_pcs numeric, delivered_pcs numeric, variance_pcs numeric, last_activity date)
 LANGUAGE sql
 STABLE
AS $function$
  WITH shift_total AS (
    SELECT psl.id, psl.loom_id, psl.log_date, psl.towel_meter_per_pc,
           (COALESCE((SELECT SUM(pslw.metres_woven)
                       FROM public.production_shift_log_weaver pslw
                       WHERE pslw.shift_log_id = psl.id), 0::numeric)
            + psl.adjustment_metres) AS net_metres
    FROM public.production_shift_log psl
    WHERE psl.log_date BETWEEN p_from AND p_to
  ),
  shift_attributed AS (
    SELECT
      fq.id AS fabric_quality_id,
      CASE
        WHEN fq.production_mode::text = 'job_work' THEN 'jobwork'::text
        ELSE fq.production_mode::text
      END AS production_mode,
      SUM(st.net_metres)::numeric AS produced_m,
      SUM(CASE
            WHEN COALESCE(NULLIF(st.towel_meter_per_pc, 0), fq.meter_per_pc) > 0
              THEN st.net_metres / COALESCE(NULLIF(st.towel_meter_per_pc, 0), fq.meter_per_pc)
          END)::numeric AS produced_pcs,
      MAX(st.log_date)            AS last_event
    FROM shift_total st
    JOIN public.loom l ON l.id = st.loom_id
    JOIN public.fabric_quality fq ON fq.id = l.fabric_quality_id
    GROUP BY fq.id, fq.production_mode
  ),
  shift_unattributed AS (
    SELECT NULL::bigint AS fabric_quality_id,
           'unattributed'::text AS production_mode,
           SUM(st.net_metres)::numeric AS produced_m,
           NULL::numeric AS produced_pcs,
           MAX(st.log_date)            AS last_event
    FROM shift_total st
    JOIN public.loom l ON l.id = st.loom_id
    WHERE l.fabric_quality_id IS NULL
    HAVING SUM(st.net_metres) > 0
  ),
  delivered AS (
    SELECT dci.fabric_quality_id, dc.production_mode::text AS production_mode,
           SUM(
             CASE
               WHEN fq.meter_per_pc IS NOT NULL AND fq.meter_per_pc > 0 AND dci.metres = trunc(dci.metres)
                 THEN dci.metres * COALESCE(
                        (SELECT NULLIF(s.towel_meter_per_pc, 0)
                           FROM public.production_shift_log s
                          WHERE s.fabric_quality_id = dci.fabric_quality_id
                            AND s.towel_meter_per_pc IS NOT NULL
                            AND s.log_date <= dc.dc_date
                          ORDER BY s.log_date DESC, s.id DESC
                          LIMIT 1),
                        fq.meter_per_pc)
               ELSE dci.metres
             END
           )::numeric AS delivered_m,
           SUM(CASE
                 WHEN fq.meter_per_pc IS NULL OR fq.meter_per_pc <= 0 THEN NULL
                 WHEN dci.metres = trunc(dci.metres) THEN dci.metres   -- piece count
                 ELSE dci.metres / fq.meter_per_pc                       -- decimal = metres
               END)::numeric AS delivered_pcs,
           MAX(dc.dc_date) AS last_dc_date
    FROM public.delivery_challan_item dci
    JOIN public.delivery_challan dc ON dc.id = dci.dc_id
    JOIN public.fabric_quality fq ON fq.id = dci.fabric_quality_id
    WHERE dc.status::text IN ('confirmed','invoiced')
      AND dc.dc_date BETWEEN p_from AND p_to
    GROUP BY dci.fabric_quality_id, dc.production_mode
  ),
  produced_all AS (
    SELECT fabric_quality_id, production_mode, produced_m, produced_pcs, last_event
    FROM shift_attributed
    UNION ALL
    SELECT fabric_quality_id, production_mode, produced_m, produced_pcs, last_event
    FROM shift_unattributed
  ),
  raw AS (
    SELECT
      COALESCE(p.fabric_quality_id, d.fabric_quality_id) AS fabric_quality_id,
      COALESCE(p.production_mode,    d.production_mode)  AS production_mode,
      COALESCE(p.produced_m, 0)::numeric  AS produced_m,
      COALESCE(d.delivered_m, 0)::numeric AS delivered_m,
      p.produced_pcs,
      d.delivered_pcs,
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
         THEN COALESCE(SUM(produced_pcs), 0)::numeric(14,2) ELSE NULL END  AS produced_pcs,
    CASE WHEN MAX(meter_per_pc) > 0
         THEN COALESCE(SUM(delivered_pcs), 0)::numeric(14,2) ELSE NULL END AS delivered_pcs,
    CASE WHEN MAX(meter_per_pc) > 0
         THEN (COALESCE(SUM(produced_pcs), 0) - COALESCE(SUM(delivered_pcs), 0))::numeric(14,2)
         ELSE NULL END                                              AS variance_pcs,
    MAX(last_activity)                                              AS last_activity
  FROM raw_with_quality
  GROUP BY group_key, production_mode;
$function$;
