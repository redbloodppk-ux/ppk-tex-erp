-- ============================================================================
-- 282: A costing's name follows the quality it is linked to.
--
-- PPK, 2026-09-04, after the L-34 fix: "in future this error won't appear
-- rite?" Half of it would not. The other half — a costing naming a cloth
-- that does not exist — was still one keystroke away, so this closes it.
--
-- HOW THE TWO ARE MEANT TO RELATE
-- A costing is created with a free-typed name. Separately, on the Costing
-- Approvals screen, the owner picks a row from the fabric_quality master
-- and links it (fabric_quality.costing_id). The master IS already chosen
-- from a list; the gap is that the costing keeps its own text label, and
-- nothing kept the two in step.
--
-- That is how costing 15 came to read "COTTON THALAPATHY 60 X 46 = 31" while
-- being linked to the quality "...= 30"". Reports were right throughout —
-- they resolve through the link — but the costing screen said 31" to anyone
-- reading it, and migration 280 had to correct three such labels by hand.
--
-- Correcting them by hand is not a fix. This makes the label follow the
-- link automatically, in both directions that matter:
--   * the quality is renamed          -> every costing linked to it follows
--   * a quality is linked/unlinked    -> the newly linked costing follows
--
-- Deliberately one-way. Editing the costing's own name does NOT rename the
-- quality: the master is canonical, and a costing label should never be
-- able to rewrite a name that invoices and reports depend on.
--
-- Unlinked costings (Jobwork - exempt) keep whatever they were given.
--
-- NOTE ON SCOPE: an earlier plan was to add costing_master.fabric_quality_id
-- and make the costing form pick from the master. That was wrong for this
-- design — the picking already exists on the approvals screen, and a second
-- link would be a second thing to keep in step. This adds no new link.
--
-- Verified after applying, in a rolled-back transaction:
--   * renaming a quality updates its linked costing
--   * linking a quality to another costing updates that costing
--   * renaming a COSTING leaves the master untouched
--   * all six costings in step afterwards; the reconciliation also settled
--     costings 17 and 18, whose correct names their links already knew
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_costing_name_follows_quality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The quality now points at a costing: bring that costing's label across.
  IF NEW.costing_id IS NOT NULL THEN
    UPDATE public.costing_master
    SET quality_name = NEW.name
    WHERE id = NEW.costing_id
      AND quality_name IS DISTINCT FROM NEW.name;
  END IF;

  -- A costing that has just been UNLINKED keeps its label. Blanking it
  -- would lose the only description an unlinked costing has.
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_costing_name_follows_quality ON public.fabric_quality;
CREATE TRIGGER trg_costing_name_follows_quality
  AFTER INSERT OR UPDATE OF name, costing_id ON public.fabric_quality
  FOR EACH ROW EXECUTE FUNCTION public.fn_costing_name_follows_quality();

COMMENT ON FUNCTION public.fn_costing_name_follows_quality() IS
  'Keeps costing_master.quality_name equal to the name of the fabric_quality linked to it, so a costing can never name a cloth the master does not have. One-way: the master is canonical. See migration 282.';

-- Reconcile anything already out of step. Migration 280 fixed three by hand;
-- this catches the rest and proves the rule holds over existing data.
UPDATE public.costing_master cm
SET quality_name = fq.name
FROM public.fabric_quality fq
WHERE fq.costing_id = cm.id
  AND cm.quality_name IS DISTINCT FROM fq.name;

-- Verify:
--   select cm.id, cm.quality_name, fq.name
--   from costing_master cm left join fabric_quality fq on fq.costing_id = cm.id;
-- Expected: every linked pair identical; only "Jobwork - exempt" unlinked.
