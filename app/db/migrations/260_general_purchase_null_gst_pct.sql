-- 260_general_purchase_null_gst_pct.sql
--
-- Audit item 5. Stops general_purchase storing an invented GST rate.
--
-- THE PROBLEM
-- general_purchase has ONE header gst_pct, but general_purchase_item
-- carries a rate per line. When a bill mixes rates the form computed a
-- weighted average and stored that:
--
--   bill 482  SHUTTLE 6535.50 @ 18% + BRAIDED ROPE 516.00 @ 5%  -> 17.05%
--   bill 390  same shape                                        -> 12.92%
--
-- 17.05% is not a GST rate. Migration 253 stopped the Purchase Register
-- DISPLAYING it, but the value was still being written on every save, so
-- the stored data remained wrong and anything reading the column
-- directly would be misled.
--
-- THE FIX
-- gst_pct becomes nullable and means exactly one thing: "this bill has a
-- single GST rate, and it is this". A mixed-rate bill has no single rate,
-- so it stores NULL — the honest representation of "not applicable"
-- rather than an average nobody can act on.
--
-- 0 would have been wrong here: it already means "zero-rated / no GST"
-- for the 10 header-only bills that legitimately carry 0.
--
-- Safe because only v_purchase_register reads this column, and since
-- migration 253 it prefers general_purchase_item line tax whenever line
-- items exist, falling back to the header rate otherwise. NULL flows
-- through its existing coalesce(gp.gst_pct, 0) untouched.
--
-- Of 12 general purchases: 10 are header-only with a real rate (kept as
-- is), 2 are itemised and both mixed (set to NULL).

alter table general_purchase
  alter column gst_pct drop not null;

comment on column general_purchase.gst_pct is
  'Single GST rate for the whole bill, or NULL when the bill mixes rates '
  '(then general_purchase_item.gst_pct per line is the truth). Never store '
  'a blended average here — 17.05% is not a GST rate. See migration 260.';

-- Null out the two bills that hold a blended average. Any general
-- purchase whose line items disagree on rate has no single bill rate.
update general_purchase gp
set gst_pct = null
where exists (
  select 1 from general_purchase_item i
  where i.general_purchase_id = gp.id
  group by i.general_purchase_id
  having count(distinct i.gst_pct) > 1
);
