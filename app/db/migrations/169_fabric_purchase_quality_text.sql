-- 169_fabric_purchase_quality_text.sql
--
-- Supplier-purchase fabric rows often don't belong in the
-- fabric_quality master: the operator just buys "saree 80*80" or
-- "viscose dobby" from a mill and resells it. The fabric_quality
-- dropdown forces them to either pre-create a quality row or skip
-- the field. Neither is great UX.
--
-- This migration adds a nullable quality_text column on
-- fabric_purchase so the operator can type the quality name freely
-- in supplier-purchase mode. customer-adjustment mode keeps the FK
-- pick because that fabric IS one of the in-house qualities being
-- handed back.
--
-- Either fabric_quality_id OR quality_text should be set; the form
-- enforces that. Reports and the new Fabric Resale stock view
-- coalesce the two columns into one display label.

ALTER TABLE public.fabric_purchase
  ADD COLUMN IF NOT EXISTS quality_text text;

COMMENT ON COLUMN public.fabric_purchase.quality_text IS
  'Free-text fabric quality name (used when the fabric isn''t one of '
  'the production qualities in fabric_quality). Set by Fabric Stock '
  'supplier-purchase mode. customer-adjustment mode uses fabric_quality_id instead.';
