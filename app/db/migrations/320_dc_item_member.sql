-- 320: Society DCs list each member's goods per line.
-- Optional member name / member number on every DC line; shown on the
-- DC print only when at least one line carries them.
ALTER TABLE delivery_challan_item
  ADD COLUMN IF NOT EXISTS member_name text,
  ADD COLUMN IF NOT EXISTS member_no   text;
