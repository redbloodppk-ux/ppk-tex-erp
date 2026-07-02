-- 225_sizing_job_auto_link_party.sql
--
-- Migrations 165 and 167 backfilled sizing_job.party_id for jobs that
-- existed at the time, but that was a one-time UPDATE — every sizing
-- job created since then (e.g. bill 280 / SZ-26-27-0001) is saved with
-- sizing_ledger_id only, so party_id stays NULL forever and the
-- Sizing -> Payment tab shows "No party linked" instead of a working
-- "Record payment" button.
--
-- This migration:
--   A) Adds a trigger that resolves party_id from sizing_ledger_id
--      automatically on INSERT (and whenever sizing_ledger_id changes),
--      using the same matching rule 167 used for the one-off backfill:
--      exact case-insensitive name match first, falling back to
--      pg_trgm similarity >= 0.7 with an ambiguity guard.
--   B) Re-runs the backfill once more so any rows created since 167
--      (including bill 280) are fixed immediately.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── A) Auto-link trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sizing_job_link_party()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ledger_name text;
  v_party_id    bigint;
BEGIN
  -- Don't override a party_id that's already set (e.g. picked
  -- manually or already resolved).
  IF NEW.party_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.sizing_ledger_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_ledger_name
  FROM   public.ledger
  WHERE  id = NEW.sizing_ledger_id;

  IF v_ledger_name IS NULL THEN RETURN NEW; END IF;

  -- 1) Exact case-insensitive match.
  SELECT id INTO v_party_id
  FROM   public.party
  WHERE  status = 'active'
    AND  upper(name) = upper(v_ledger_name)
  LIMIT  1;

  -- 2) Fuzzy fallback (mirrors migration 167): best trigram match
  --    must score >= 0.7 and be unambiguous (>= 0.05 clear of the
  --    second-best candidate).
  IF v_party_id IS NULL THEN
    SELECT best.id INTO v_party_id
    FROM (
      SELECT
        p.id,
        similarity(upper(p.name), upper(v_ledger_name)) AS score,
        LEAD(similarity(upper(p.name), upper(v_ledger_name))) OVER (
          ORDER BY similarity(upper(p.name), upper(v_ledger_name)) DESC, p.id
        ) AS next_score
      FROM public.party p
      WHERE p.status = 'active'
        AND similarity(upper(p.name), upper(v_ledger_name)) >= 0.5
      ORDER BY score DESC, p.id
      LIMIT 1
    ) best
    WHERE best.score >= 0.7
      AND (best.next_score IS NULL OR best.score - best.next_score >= 0.05);
  END IF;

  NEW.party_id := v_party_id; -- still NULL if no confident match; safe to leave for manual linking
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sizing_job_link_party ON public.sizing_job;
CREATE TRIGGER trg_sizing_job_link_party
  BEFORE INSERT OR UPDATE OF sizing_ledger_id ON public.sizing_job
  FOR EACH ROW EXECUTE FUNCTION public.tg_sizing_job_link_party();

-- ── B) Catch-up backfill for rows created since migration 167 ─────
UPDATE public.sizing_job sj
SET party_id = p.id
FROM   public.ledger l
JOIN   public.party  p ON upper(p.name) = upper(l.name)
WHERE  l.id = sj.sizing_ledger_id
  AND  sj.party_id IS NULL
  AND  p.status = 'active';

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
