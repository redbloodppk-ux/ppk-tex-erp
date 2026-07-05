-- ============================================================================
-- 234: One WBG-NNNN batch number per SAVE ACTION on jobwork_warp_beam, not
-- per physical beam row.
--
-- Two flows insert one jobwork_warp_beam row PER BEAM (add()'s jobwork
-- branch, sequential insert so each beam's pavu.id can be linked back; and
-- saveSplit(), bulk insert when an aggregate row is split into individually
-- tracked beams). Today's WBG-NNNN display is just `WBG-${id}`, so a 14-beam
-- delivery burns 14 consecutive numbers instead of one. See
-- docs/superpowers/specs/2026-07-05-warp-beam-batch-numbering-design.md
--
-- This migration:
--   1. Adds a nullable batch_no column + a plain sequence to hand out new
--      values (nullable at the DB level defensively; the app always
--      supplies it going forward — see the null-safe `?? id` display
--      fallback in the app code changes that follow this migration).
--   2. One-time backfills EVERY existing row (regardless of `status`, so
--      no row is ever left without a permanent number) using the exact
--      grouping key groupWarpBeamRows() already uses for on-screen
--      grouping — rows with beam_count <> 1 are singleton groups, same as
--      today's display — ordered by given_date ascending, tie-broken by
--      each group's lowest id, numbered 1, 2, 3...
--   3. Adds a (non-unique) index on batch_no for query/filter performance.
--      NOTE: this is deliberately NOT a unique index, despite the original
--      plan text calling for one — a plain column-level unique constraint
--      is mathematically incompatible with this design's core premise that
--      every row inserted by the SAME save action (e.g. all 14 rows of a
--      14-beam delivery) shares one identical batch_no. Applying a
--      UNIQUE INDEX against the live table failed immediately on the very
--      first (correctly computed) multi-row group: `ERROR 23505: could not
--      create unique index ... Key (batch_no)=(10) is duplicated` for the
--      14 rows (ids 31-44) that legitimately share batch_no 10. Uniqueness
--      *across* batches (the constraint's actual intent) is already
--      guaranteed structurally without a DB constraint: the backfill gives
--      each distinct group its own ROW_NUMBER(), and going forward
--      nextval() on the sequence is strictly monotonic and never reused.
--   4. Adds fn_next_warp_beam_batch_no(), a SECURITY DEFINER wrapper so the
--      app (supabase-js has no raw-SQL access) can pull exactly one new
--      value per save action and stamp it onto every row that save inserts
--      — never one value per row. Follows the same SECURITY DEFINER +
--      SET search_path pinning pattern used by this codebase's other
--      autogen-code functions (e.g. fn_batch_autogen_code in migration
--      008), but NOT the same grant/revoke posture: 008's function is
--      trigger-only (nobody calls it directly, so EXECUTE is revoked from
--      authenticated too), whereas this one is meant to be called directly
--      by the app via `sb.rpc(...)`, so EXECUTE is granted to authenticated
--      and only revoked from anon/PUBLIC.
-- ============================================================================

ALTER TABLE public.jobwork_warp_beam ADD COLUMN IF NOT EXISTS batch_no integer;

COMMENT ON COLUMN public.jobwork_warp_beam.batch_no IS 'One number per batch/save-action (not per beam row), shown on screen as WBG-NNNN. All rows inserted by the same save share one batch_no. Assigned from jobwork_warp_beam_batch_no_seq via fn_next_warp_beam_batch_no(). Never renumbered — deleting a batch just skips that number going forward, like a real invoice/DC book.';

CREATE SEQUENCE IF NOT EXISTS public.jobwork_warp_beam_batch_no_seq;

-- One-time historical backfill. Groups ALL existing rows (not filtered by
-- status) using the same key groupWarpBeamRows() uses in the UI:
-- jobwork_party_id, fabric_quality_id, warp_count_id, given_date,
-- reference_no, supplier_party_id, sizing_job_id. Rows with beam_count <> 1
-- are already-aggregate entries and each get their own singleton group,
-- matching today's display exactly.
WITH keyed AS (
  SELECT
    id,
    given_date,
    CASE
      WHEN beam_count <> 1 THEN 'singleton-' || id::text
      ELSE
        COALESCE(jobwork_party_id::text, '') || '|' ||
        COALESCE(fabric_quality_id::text, '') || '|' ||
        COALESCE(warp_count_id::text, '') || '|' ||
        COALESCE(given_date::text, '') || '|' ||
        COALESCE(reference_no, '') || '|' ||
        COALESCE(supplier_party_id::text, '') || '|' ||
        COALESCE(sizing_job_id::text, '')
    END AS grp_key
  FROM public.jobwork_warp_beam
),
group_order AS (
  SELECT
    grp_key,
    ROW_NUMBER() OVER (ORDER BY MIN(given_date) ASC, MIN(id) ASC) AS batch_no
  FROM keyed
  GROUP BY grp_key
)
UPDATE public.jobwork_warp_beam w
SET batch_no = go.batch_no
FROM keyed k
JOIN group_order go ON go.grp_key = k.grp_key
WHERE w.id = k.id
  AND w.batch_no IS NULL;

-- Move the sequence past the highest backfilled value so the very next
-- nextval() call (the first NEW batch saved after this migration lands)
-- continues on from the historical numbering instead of colliding with it.
-- GREATEST(...) against the sequence's own last_value ensures this can never
-- move the sequence backward if this file is ever re-applied (e.g. rows
-- already stamped with a batch_no via fn_next_warp_beam_batch_no() by a real
-- app save must not cause the sequence to be reset below its current value).
SELECT setval(
  'public.jobwork_warp_beam_batch_no_seq',
  GREATEST(
    (SELECT COALESCE(MAX(batch_no), 0) FROM public.jobwork_warp_beam),
    (SELECT last_value FROM public.jobwork_warp_beam_batch_no_seq)
  )
);

CREATE INDEX IF NOT EXISTS idx_jobwork_warp_beam_batch_no ON public.jobwork_warp_beam (batch_no);

CREATE OR REPLACE FUNCTION public.fn_next_warp_beam_batch_no()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next integer;
BEGIN
  SELECT nextval('public.jobwork_warp_beam_batch_no_seq') INTO v_next;
  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_next_warp_beam_batch_no() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_next_warp_beam_batch_no() FROM PUBLIC, anon;
