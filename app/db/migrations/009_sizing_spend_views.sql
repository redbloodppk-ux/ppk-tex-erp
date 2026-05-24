-- ────────────────────────────────────────────────────────────────────────────
-- Migration 009 — Sizing Spend report views (CORR-R3)
--
--   Two read-only views to feed the Sizing Spend report:
--
--   1. v_sizing_spend_by_month  — monthly rollup: # jobs, kg used, ₹ spent,
--                                  weighted avg rate. Period = month of
--                                  date_received (fall back to date_sent,
--                                  then created_at). Excludes cancelled.
--
--   2. v_sizing_spend_by_vendor — per-vendor totals over the same scope.
--                                  Useful for picking the cheapest vendor.
--
--   Spend = sizing_job.total_amount (billed, includes charges + GST).
--   The page filters both views by a date range using period_start so the
--   SQL is identical on the client.
--
-- Safe to re-run: CREATE OR REPLACE VIEW + DROP IF EXISTS.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP VIEW IF EXISTS v_sizing_spend_by_month;
CREATE VIEW v_sizing_spend_by_month AS
WITH scoped AS (
  SELECT
    sj.id,
    sj.sizing_vendor_id,
    sj.yarn_used_kg,
    sj.total_amount,
    sj.sizing_rate_per_kg,
    COALESCE(sj.date_received, sj.date_sent, sj.created_at::date) AS spend_date
  FROM sizing_job sj
  WHERE sj.status <> 'cancelled'
    AND sj.total_amount > 0
)
SELECT
  date_trunc('month', spend_date)::date           AS period_start,
  COUNT(*)::int                                   AS jobs_count,
  SUM(yarn_used_kg)::numeric(14,3)                AS total_yarn_kg,
  SUM(total_amount)::numeric(14,2)                AS total_spend,
  CASE
    WHEN SUM(yarn_used_kg) > 0
      THEN (SUM(total_amount) / SUM(yarn_used_kg))::numeric(10,4)
    ELSE NULL
  END                                             AS effective_rate_per_kg
FROM scoped
GROUP BY 1
ORDER BY 1 DESC;

COMMENT ON VIEW v_sizing_spend_by_month IS
  'CORR-R3: monthly sizing spend rollup. Period = month of date_received '
  '(fallback date_sent, then created_at). effective_rate_per_kg = total ₹ / '
  'total yarn kg (weighted by job size, not a simple avg of per-job rates).';

DROP VIEW IF EXISTS v_sizing_spend_by_vendor;
CREATE VIEW v_sizing_spend_by_vendor AS
WITH scoped AS (
  SELECT
    sj.id,
    sj.sizing_vendor_id,
    sj.yarn_used_kg,
    sj.total_amount,
    COALESCE(sj.date_received, sj.date_sent, sj.created_at::date) AS spend_date
  FROM sizing_job sj
  WHERE sj.status <> 'cancelled'
    AND sj.total_amount > 0
)
SELECT
  v.id                                            AS vendor_id,
  v.code                                          AS vendor_code,
  v.name                                          AS vendor_name,
  COUNT(s.id)::int                                AS jobs_count,
  SUM(s.yarn_used_kg)::numeric(14,3)              AS total_yarn_kg,
  SUM(s.total_amount)::numeric(14,2)              AS total_spend,
  CASE
    WHEN SUM(s.yarn_used_kg) > 0
      THEN (SUM(s.total_amount) / SUM(s.yarn_used_kg))::numeric(10,4)
    ELSE NULL
  END                                             AS effective_rate_per_kg,
  MIN(s.spend_date)                               AS first_job_date,
  MAX(s.spend_date)                               AS last_job_date
FROM scoped s
JOIN vendor v ON v.id = s.sizing_vendor_id
GROUP BY v.id, v.code, v.name
ORDER BY total_spend DESC;

COMMENT ON VIEW v_sizing_spend_by_vendor IS
  'CORR-R3: per-vendor sizing spend totals over the same scope as '
  'v_sizing_spend_by_month. Ranked by total_spend so the biggest spend rows '
  'appear first. effective_rate_per_kg is weighted by job size.';

-- Read access — keep these views read-only and exposed to logged-in users.
GRANT SELECT ON v_sizing_spend_by_month  TO authenticated;
GRANT SELECT ON v_sizing_spend_by_vendor TO authenticated;

COMMIT;
