-- 328: Weaver Wages by Quality report (/app/reports/weaver-wages).
CREATE OR REPLACE FUNCTION public.fn_weaver_quality_wages(p_from date, p_to date, p_shed int DEFAULT NULL)
 RETURNS TABLE(employee_id bigint, full_name text, emp_code text, fabric_quality_id bigint, quality_code text, quality_name text,
               count_unit_cm numeric, shifts bigint, metres numeric, real_metres numeric, wage numeric, min_rate numeric, max_rate numeric)
 LANGUAGE sql STABLE
AS $function$
  -- metres      = as the weaver counted it (saree: folding metres, 137 cm)
  -- real_metres = stored metres_woven
  -- wage        = real_metres x the shift log's frozen rate (else loom default)
  SELECT w.employee_id, e.full_name, e.code,
         sl.fabric_quality_id, COALESCE(fq.code, 'NO_QUALITY'), COALESCE(fq.name, 'No quality'),
         fq.count_unit_cm,
         COUNT(*),
         ROUND(SUM(COALESCE(w.counted_metres, w.metres_woven)), 2),
         ROUND(SUM(w.metres_woven), 2),
         ROUND(SUM(w.metres_woven * COALESCE(sl.rate_per_m, l.default_rate_per_m, 0)), 2),
         MIN(COALESCE(sl.rate_per_m, l.default_rate_per_m)),
         MAX(COALESCE(sl.rate_per_m, l.default_rate_per_m))
    FROM production_shift_log sl
    JOIN production_shift_log_weaver w ON w.shift_log_id = sl.id
    JOIN employee e ON e.id = w.employee_id
    LEFT JOIN loom l ON l.id = sl.loom_id
    LEFT JOIN fabric_quality fq ON fq.id = sl.fabric_quality_id
   WHERE sl.log_date BETWEEN p_from AND p_to
     AND (p_shed IS NULL OR l.shed_no = p_shed)
     AND w.metres_woven > 0
   GROUP BY w.employee_id, e.full_name, e.code, sl.fabric_quality_id, fq.code, fq.name, fq.count_unit_cm;
$function$;
