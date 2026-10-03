-- ============================================================================
-- 311: Folder pieces = metres woven / 2, for every per-piece quality.
--
-- PPK, 2026-10-03: "for how it's counted, always divided by 2 only for
-- folder wages by default". The folder's count does not use the quality's
-- own length per piece (1.65 m towel, 1.90 m dhoti); it is always metres/2.
-- Per-metre qualities (Congress Running) are unchanged.
-- Week 27-Sep..03-Oct: Rs 4,354.74 -> Rs 4,040.54.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_folding_estimate(p_from date, p_to date)
RETURNS TABLE(
  fabric_quality_id bigint, code text, name text,
  metres numeric, meter_per_pc numeric, pieces numeric,
  folding_unit text, folding_rate numeric, amount numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH params AS (SELECT 2::numeric AS mpp),  -- folder pieces = metres / 2 (PPK, 2026-10-03)
  logs AS (
    SELECT sl.fabric_quality_id,
           COALESCE((SELECT SUM(w.metres_woven) FROM production_shift_log_weaver w
                      WHERE w.shift_log_id = sl.id), 0)
             + COALESCE(sl.adjustment_metres, 0) AS m
      FROM production_shift_log sl
     WHERE sl.log_date BETWEEN p_from AND p_to
  )
  SELECT fq.id, fq.code, fq.name,
         ROUND(SUM(l.m), 2),
         CASE WHEN fq.folding_unit = 'pc' THEN MAX(p.mpp) END,
         CASE WHEN fq.folding_unit = 'pc' THEN ROUND(SUM(l.m) / MAX(p.mpp), 1) END,
         fq.folding_unit,
         fq.folding_rate,
         CASE
           WHEN fq.folding_rate IS NULL THEN NULL
           WHEN fq.folding_unit = 'm'  THEN ROUND(SUM(l.m) * fq.folding_rate, 2)
           WHEN fq.folding_unit = 'pc' THEN ROUND(SUM(l.m) / MAX(p.mpp) * fq.folding_rate, 2)
         END
    FROM logs l
    CROSS JOIN params p
    JOIN fabric_quality fq ON fq.id = l.fabric_quality_id
   GROUP BY fq.id, fq.code, fq.name, fq.folding_unit, fq.folding_rate
  HAVING SUM(l.m) <> 0
   ORDER BY fq.code;
$$;

COMMENT ON FUNCTION public.fn_folding_estimate(date, date) IS
  'Folding wage estimate per quality from the shift log. Per-piece qualities: pieces = metres / 2 (PPK 2026-10-03); per-metre qualities: metres x rate.';
