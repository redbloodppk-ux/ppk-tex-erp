-- 167_sizing_job_party_fuzzy_backfill.sql
--
-- Migration 165's backfill for sizing_job.party_id used a strict
-- upper(name) = upper(name) match between the sizing ledger and the
-- party master. In the real data the same vendor is spelled slightly
-- differently in the two places (e.g. ledger "SHRI NITHYA SIZING
-- MILL" vs party "SHRI NITHIYA SIZING MILL"), so the strict match
-- left every sizing_job.party_id NULL — and the "Record payment"
-- button on Sizing → Payment had no party to deep-link to.
--
-- This migration re-runs the backfill using pg_trgm similarity so
-- the typo is forgiven. similarity() of 0.7 demands the names share
-- most of their trigrams, which is loose enough to catch SHRI
-- NITHYA / SHRI NITHIYA (≈0.73 in practice) yet still rejects
-- unrelated mills.
--
-- Only writes when the best candidate has similarity ≥ 0.7 AND is
-- unambiguous (no other party within 0.05 of it). Anything more
-- ambiguous is left NULL — the operator can pick the right party
-- manually by editing the sizing job.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

UPDATE public.sizing_job sj
SET party_id = best.party_id
FROM (
  SELECT
    sj2.id           AS sj_id,
    p.id             AS party_id,
    similarity(upper(p.name), upper(l.name)) AS score,
    ROW_NUMBER() OVER (
      PARTITION BY sj2.id
      ORDER BY similarity(upper(p.name), upper(l.name)) DESC, p.id
    )                AS rn,
    -- second-best score, if any, used to detect ambiguous matches
    LEAD(similarity(upper(p.name), upper(l.name))) OVER (
      PARTITION BY sj2.id
      ORDER BY similarity(upper(p.name), upper(l.name)) DESC, p.id
    )                AS next_score
  FROM   public.sizing_job sj2
  JOIN   public.ledger l ON l.id = sj2.sizing_ledger_id
  JOIN   public.party  p ON p.status = 'active'
                         AND similarity(upper(p.name), upper(l.name)) >= 0.5
  WHERE  sj2.party_id IS NULL
    AND  sj2.bill_no  IS NOT NULL
) best
WHERE sj.id = best.sj_id
  AND best.rn = 1
  AND best.score >= 0.7
  AND (best.next_score IS NULL OR best.score - best.next_score >= 0.05);

-- One-time recompute of amount_paid using the trigger formula so any
-- existing legacy payment rows are reflected before the trigger from
-- 166 kicks in on the next change.
UPDATE public.sizing_job sj
SET amount_paid = COALESCE((
  SELECT SUM(a.amount)
  FROM   public.payment_sizing_allocation a
  WHERE  a.sizing_job_id = sj.id
), 0)
                + COALESCE((
  SELECT SUM(p.amount)
  FROM   public.payment p
  WHERE  p.sizing_job_id = sj.id
    AND  p.status::text NOT IN ('cancelled','void')
), 0);
