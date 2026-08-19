-- 253_purchase_register_mixed_gst.sql
--
-- Purchase Register: handle mixed-GST general purchase bills.
--
-- PROBLEM
-- general_purchase stores ONE header gst_pct, but general_purchase_item
-- carries a rate per line. On a bill with more than one rate the header
-- holds a blended average, which is not a real GST rate. Bill 482
-- (AJANTHA MILL STORE) is SHUTTLE 6535.50 @ 18% + BRAIDED ROPE 516.00
-- @ 5%, so the header reads 17.05% and the register displayed "17%".
--
-- Worse, the view RECOMPUTED tax from that blended rate
-- (round(taxable * gst_pct / 100, 2)) instead of summing the real line
-- tax, so the GST total was wrong on every mixed-rate bill:
--   bill 482 — line GST 1202.19, view showed 1202.28  (+0.09)
--   bill 390 — line GST  962.97, view showed  962.73  (-0.24)
--
-- This is a filing problem, not just a display one: GSTR-2B reconciles
-- rate-wise and 17.05% does not exist as a rate.
--
-- FIX
-- Two new columns on v_purchase_register:
--   line_gst   — GST summed from general_purchase_item (NULL elsewhere)
--   gst_rates  — the distinct line rates, e.g. '18 / 5', only when a
--                bill actually mixes rates; NULL otherwise
-- gst_amount now prefers line_gst when present, so mixed-rate bills
-- report the true tax. The UI shows "Mixed" in the GST % column and
-- surfaces gst_rates on hover.
--
-- Single-rate general purchases and every other source (yarn, bobbin,
-- sizing, fabric, outsource weaving) are unaffected.

drop view if exists v_purchase_register;

create view v_purchase_register as
with company as (
  select upper(coalesce(cp.state, 'TAMIL NADU')) as state
  from company_profile cp
  limit 1
),
yarn as (
  select 'yarn'::text as source, yl.id as source_id, yl.received_date as bill_date,
         yl.invoice_no as bill_no, yl.supplier_party_id as party_id,
         yl.received_kg::numeric(14,2) as quantity, 'kg'::text as qty_uom,
         coalesce(yl.gst_pct,0)::numeric(6,2) as gst_pct,
         round((yl.total_amount - coalesce(yl.round_off,0))
               / (1 + coalesce(yl.gst_pct,0)/100.0), 2)::numeric(14,2) as taxable,
         yl.total_amount as total,
         coalesce(yl.round_off,0)::numeric(14,2) as round_off,
         coalesce(yl.amount_paid,0)::numeric(14,2) as amount_paid,
         'active'::text as status,
         null::numeric(14,2) as cgst_inv, null::numeric(14,2) as sgst_inv,
         null::numeric(14,2) as igst_inv, null::boolean as is_interstate_inv,
         null::numeric(14,2) as line_gst, null::text as gst_rates
  from yarn_lot yl
  where yl.total_amount is not null and yl.total_amount > 0
),
bobbin as (
  select 'bobbin'::text, bp.id, bp.purchase_date, bp.invoice_no, b.supplier_party_id,
         coalesce(bp.pieces_purchased,0)::numeric(14,2), 'pcs'::text,
         0::numeric(6,2),
         (bp.total_amount - coalesce(bp.round_off,0))::numeric(14,2),
         bp.total_amount,
         coalesce(bp.round_off,0)::numeric(14,2),
         coalesce(bp.amount_paid,0)::numeric(14,2),
         'active'::text,
         null::numeric(14,2), null::numeric(14,2), null::numeric(14,2), null::boolean,
         null::numeric(14,2), null::text
  from bobbin_purchase bp
  left join public.bobbin b on b.id = bp.bobbin_id
  where bp.total_amount is not null and bp.total_amount > 0
),
sizing as (
  select 'sizing'::text, sj.id,
         coalesce(sj.bill_date, sj.date_received, sj.date_sent),
         coalesce(sj.bill_no, sj.job_code), sj.party_id,
         coalesce(sj.yarn_sent_kg,0)::numeric(14,2), 'kg'::text,
         coalesce(sj.gst_pct,0)::numeric(6,2),
         coalesce(sj.charges_amount,0)::numeric(14,2),
         coalesce(sj.total_amount,0)::numeric(14,2),
         coalesce(sj.round_off,0)::numeric(14,2),
         coalesce(sj.amount_paid,0)::numeric(14,2),
         sj.status::text,
         null::numeric(14,2), null::numeric(14,2), null::numeric(14,2), null::boolean,
         null::numeric(14,2), null::text
  from sizing_job sj
  where coalesce(sj.total_amount,0) > 0
    and sj.status::text <> all (array['draft','cancelled'])
),
fabric as (
  select 'fabric'::text, fp.id, fp.received_date, fp.invoice_no, fp.supplier_party_id,
         fp.received_metres::numeric(14,2), 'm'::text,
         coalesce(fp.gst_pct,0)::numeric(6,2),
         round((fp.total_amount - coalesce(fp.round_off,0))
               / (1 + coalesce(fp.gst_pct,0)/100.0), 2)::numeric(14,2),
         fp.total_amount,
         coalesce(fp.round_off,0)::numeric(14,2),
         coalesce(fp.amount_paid,0)::numeric(14,2),
         fp.status::text,
         null::numeric(14,2), null::numeric(14,2), null::numeric(14,2), null::boolean,
         null::numeric(14,2), null::text
  from fabric_purchase fp
  where fp.total_amount is not null and fp.total_amount > 0
    and fp.status::text <> all (array['archived','inactive'])
),
general as (
  select 'general'::text, gp.id, gp.bill_date, gp.bill_no, gp.supplier_party_id,
         null::numeric(14,2), ''::text,
         coalesce(gp.gst_pct,0)::numeric(6,2),
         coalesce(gp.taxable,0)::numeric(14,2),
         coalesce(gp.total,0)::numeric(14,2),
         coalesce(gp.round_off,0)::numeric(14,2),
         coalesce(gp.amount_paid,0)::numeric(14,2),
         gp.status::text,
         null::numeric(14,2), null::numeric(14,2), null::numeric(14,2), null::boolean,
         li.line_gst,
         case when li.rate_count > 1 then lr.gst_rates else null end
  from general_purchase gp
  left join lateral (
    select round(sum(i.gst_amount),2)::numeric(14,2) as line_gst,
           count(distinct i.gst_pct)                 as rate_count
    from general_purchase_item i
    where i.general_purchase_id = gp.id
      and i.gst_amount is not null
  ) li on true
  left join lateral (
    select string_agg(x.r, ' / ' order by x.n desc) as gst_rates
    from (
      select distinct i.gst_pct as n, (i.gst_pct::float8)::text as r
      from general_purchase_item i
      where i.general_purchase_id = gp.id
    ) x
  ) lr on true
  where coalesce(gp.total,0) > 0
    and gp.status::text <> all (array['draft','cancelled'])
),
weaving as (
  select 'outsource_weaving'::text, inv.id, inv.invoice_date, inv.invoice_no,
         inv.jobwork_party_id,
         coalesce((select sum(il.quantity) from invoice_line il
                    where il.invoice_id = inv.id),0)::numeric(14,2),
         'm'::text,
         null::numeric(6,2),
         inv.taxable_value::numeric(14,2),
         inv.total,
         (coalesce(inv.round_off,0) + coalesce(inv.extra_charge,0))::numeric(14,2),
         coalesce(inv.amount_paid,0)::numeric(14,2),
         inv.status::text,
         inv.cgst_amount::numeric(14,2), inv.sgst_amount::numeric(14,2),
         inv.igst_amount::numeric(14,2), inv.is_interstate,
         null::numeric(14,2), null::text
  from invoice inv
  where inv.doc_type = 'weaving_bill'::invoice_doc_type
    and inv.status::text <> all (array['draft','cancelled'])
),
all_sources as (
  select * from yarn
  union all select * from bobbin
  union all select * from sizing
  union all select * from fabric
  union all select * from general
  union all select * from weaving
),
calc as (
  select s.*,
    case
      -- 1. invoice-native tax (outsource weaving) wins
      when s.cgst_inv is not null or s.sgst_inv is not null or s.igst_inv is not null
        then coalesce(s.cgst_inv,0) + coalesce(s.sgst_inv,0) + coalesce(s.igst_inv,0)
      -- 2. line-level tax (general purchases) — correct on mixed rates
      when s.line_gst is not null
        then s.line_gst
      -- 3. single header rate
      when coalesce(s.gst_pct,0) > 0
        then round(s.taxable * s.gst_pct / 100.0, 2)
      -- 4. fall back to whatever the totals imply
      else greatest(s.total - s.round_off - s.taxable, 0)
    end::numeric(14,2) as gst_calc
  from all_sources s
)
select s.source, s.source_id, s.bill_date, s.bill_no, s.party_id,
  coalesce(p.code,'')  as party_code,
  coalesce(p.name,'—') as party_name,
  p.gstin as party_gstin, p.state as party_state,
  s.quantity, s.qty_uom,
  coalesce(s.gst_pct,0) as gst_pct,
  s.gst_rates,
  (s.gst_rates is not null) as is_mixed_gst,
  s.taxable,
  s.gst_calc as gst_amount,
  s.total, s.round_off, s.amount_paid,
  (s.total - s.amount_paid)::numeric(14,2) as balance,
  s.status,
  case
    when s.is_interstate_inv is not null then s.is_interstate_inv
    when p.state is null then false
    else upper(p.state) <> c.state
  end as is_interstate,
  case
    when s.cgst_inv is not null then s.cgst_inv
    when p.state is not null and upper(p.state) <> c.state then 0
    else round(s.gst_calc / 2.0, 2)
  end::numeric(14,2) as cgst_amount,
  case
    when s.sgst_inv is not null then s.sgst_inv
    when p.state is not null and upper(p.state) <> c.state then 0
    else round(s.gst_calc / 2.0, 2)
  end::numeric(14,2) as sgst_amount,
  case
    when s.igst_inv is not null then s.igst_inv
    when p.state is not null and upper(p.state) <> c.state then s.gst_calc
    else 0
  end::numeric(14,2) as igst_amount,
  case
    when coalesce(s.gst_pct,0) > 0
      or s.line_gst > 0
      or s.cgst_inv is not null or s.sgst_inv is not null or s.igst_inv is not null
      or (s.total - s.round_off) > s.taxable
    then 'with_gst' else 'without_gst'
  end as gst_flag
from calc s
cross join company c
left join party p on p.id = s.party_id
where s.bill_date is not null;

comment on view v_purchase_register is
  'Unified supplier-bill register (yarn, bobbin, sizing, fabric, general, outsource weaving). '
  'gst_amount prefers invoice-native tax, then general_purchase_item line tax, then the header rate. '
  'gst_rates / is_mixed_gst flag bills that carry more than one GST rate — their header gst_pct is a '
  'blended average and must not be shown as a rate. See migration 253.';
