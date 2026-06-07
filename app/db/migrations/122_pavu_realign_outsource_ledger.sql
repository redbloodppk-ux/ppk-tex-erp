-- 122_pavu_realign_outsource_ledger.sql
--
-- Pavu Master now sources outsource parties from `jobwork_party`
-- (kind='outsource') instead of `party` (Outsource Weaver type), so
-- `pavu.outsource_ledger_id` matches `jobwork_party.ledger_id`
-- (created by migration 121). Existing outsource-routed pavus,
-- however, carry the old `party`-master ledger_id, which doesn't
-- exist on any jobwork_party row — that breaks the strict cascade on
-- the Add Warp Beam Given form.
--
-- This migration realigns those rows by name match: for every pavu
-- with an outsource_ledger_id that doesn't already point at a
-- jobwork_party.ledger_id, find the Outsource Weaver party row that
-- owns the current ledger_id, then find a jobwork_party
-- (kind='outsource') with the same name. If found, update the pavu's
-- outsource_ledger_id to that jobwork_party's ledger_id.
--
-- Pavus whose name match fails are left untouched and surface in the
-- warp-given cascade only after the operator releases + re-assigns
-- them via the updated Pavu Master.

BEGIN;

WITH realigned AS (
  SELECT
    p.id              AS pavu_id,
    jp.ledger_id      AS new_ledger_id
  FROM public.pavu p
  JOIN public.party        ow ON ow.ledger_id  = p.outsource_ledger_id
  JOIN public.jobwork_party jp ON jp.name      = ow.name
                              AND jp.kind      = 'outsource'
                              AND jp.ledger_id IS NOT NULL
  WHERE p.production_mode    = 'outsource'
    AND p.outsource_ledger_id IS NOT NULL
    -- Only realign rows whose current ledger_id ISN'T already a
    -- jobwork_party.ledger_id (some pavus may already be aligned).
    AND NOT EXISTS (
      SELECT 1 FROM public.jobwork_party jp2
      WHERE jp2.ledger_id = p.outsource_ledger_id
    )
)
UPDATE public.pavu p
SET outsource_ledger_id = r.new_ledger_id
FROM realigned r
WHERE p.id = r.pavu_id;

COMMIT;
