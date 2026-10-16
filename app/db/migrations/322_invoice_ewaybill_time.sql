-- 322: E-way bill generation TIME (the QR printed on the invoice encodes
-- EWB no / GSTIN / generated date + time, like the NIC portal print).
ALTER TABLE invoice ADD COLUMN IF NOT EXISTS ewaybill_time time;
