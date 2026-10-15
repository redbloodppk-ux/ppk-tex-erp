-- 321: Towel length per DC line. Old stock (e.g. 1.65 m) and new stock
-- (1.60 m) of the same towel quality can go out on DCs after a length
-- change; the DC line records which. Fabric receipt pre-fills from it and
-- the fabric stock ledger converts towel counts with it.
ALTER TABLE delivery_challan_item ADD COLUMN IF NOT EXISTS length_per_pc numeric(6,3);
