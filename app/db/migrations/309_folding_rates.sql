-- ============================================================================
-- 309: Folding rates per fabric quality + a shift-log based folding estimate.
--
-- PPK, 2026-09-26: the folder (Ravi) is paid per piece folded:
--   Cotton Thalapathy  Rs 0.50 / piece
--   Dhoties            Rs 0.60 / piece
--   Congress Running   Rs 0.20 / metre
-- and the weekly amount was worked out by hand.
--
-- fabric_quality.folding_rate / folding_unit ('pc' | 'm') hold the rate.
-- fn_folding_estimate(from, to) turns the shift log (metres woven) into
-- pieces (metres / length per piece) and money, per quality. It is an
-- ESTIMATE of what was woven; the folder is paid on what he actually folded
-- (his book), so the wage form shows it beside the amount, not in it.
-- ============================================================================

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS folding_rate numeric CHECK (folding_rate IS NULL OR folding_rate >= 0),
  ADD COLUMN IF NOT EXISTS folding_unit text CHECK (folding_unit IS NULL OR folding_unit IN ('pc', 'm'));

COMMENT ON COLUMN public.fabric_quality.folding_rate IS 'Folder''s piece rate in Rs per folding_unit.';
COMMENT ON COLUMN public.fabric_quality.folding_unit IS '''pc'' = per piece (metres / meter_per_pc), ''m'' = per metre.';

UPDATE public.fabric_quality SET folding_rate = 0.50, folding_unit = 'pc'
 WHERE code IN ('DOBBY-CT-TOWEL-31', 'DOBBY-CT-TOWEL-34');
UPDATE public.fabric_quality SET folding_rate = 0.60, folding_unit = 'pc'
 WHERE code IN ('FQ-0001', 'FQ-0002', 'FQ-0003', 'FQ-0004', 'FQ-0005', 'FQ-0007');
UPDATE public.fabric_quality SET folding_rate = 0.20, folding_unit = 'm'
 WHERE code = 'FQ-0006';

CREATE OR REPLACE FUNCTION public.fn_folding_estimate(p_from date, p_to date)
RETURNS TABLE(
  fabric_quality_id bigint, code text, name text,
  metres numeric, meter_per_pc numeric, pieces numeric,
  folding_unit text, folding_rate numeric, amount numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH logs AS (
    SELECT sl.fabric_quality_id,
           COALESCE(sl.towel_meter_per_pc, fq.meter_per_pc) AS mpp,
           COALESCE((SELECT SUM(w.metres_woven) FROM production_shift_log_weaver w
                      WHERE w.shift_log_id = sl.id), 0)
             + COALESCE(sl.adjustment_metres, 0) AS m
      FROM production_shift_log sl
      JOIN fabric_quality fq ON fq.id = sl.fabric_quality_id
     WHERE sl.log_date BETWEEN p_from AND p_to
  )
  SELECT fq.id, fq.code, fq.name,
         ROUND(SUM(l.m), 2),
         MAX(l.mpp),
         CASE WHEN fq.folding_unit = 'pc' AND MAX(l.mpp) > 0
              THEN ROUND(SUM(l.m / NULLIF(l.mpp, 0)), 1) END,
         fq.folding_unit,
         fq.folding_rate,
         CASE
           WHEN fq.folding_rate IS NULL THEN NULL
           WHEN fq.folding_unit = 'm'  THEN ROUND(SUM(l.m) * fq.folding_rate, 2)
           WHEN fq.folding_unit = 'pc' THEN ROUND(SUM(l.m / NULLIF(l.mpp, 0)) * fq.folding_rate, 2)
         END
    FROM logs l
    JOIN fabric_quality fq ON fq.id = l.fabric_quality_id
   GROUP BY fq.id, fq.code, fq.name, fq.folding_unit, fq.folding_rate
  HAVING SUM(l.m) <> 0
   ORDER BY fq.code;
$$;

COMMENT ON FUNCTION public.fn_folding_estimate(date, date) IS
  'Folding wage estimate per quality from the shift log (metres woven) between two dates, using fabric_quality.folding_rate/unit.';
