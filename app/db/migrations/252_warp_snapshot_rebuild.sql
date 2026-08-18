-- 252_warp_snapshot_rebuild.sql
--
-- Rebuild the warp_beam figures frozen onto every IN-HOUSE fabric
-- receipt's stock_snapshot.
--
-- WHY
-- The in-house warp pool counted only pavu with status='in_stock' as
-- inflow while subtracting every in-house fabric receipt as outflow.
-- Each beam was therefore deducted twice: its inflow vanished the
-- moment it moved to on_loom/finished, and the cloth woven from it was
-- then subtracted again. Commit 268b492 fixed the Warehouse pivot;
-- the receipt snapshot and the receipt-entry form kept the bug until
-- commit 86748fb. The snapshots frozen before that are still wrong.
--
-- WHAT THIS DOES
-- Recomputes warp_beam.{before_m, consumed_m, after_m} chronologically
-- per warp spec (ends + warp count), pooled across the specs a receipt
-- touches:
--
--   before_m   = opening stock + beam purchases + ALL in-house pavu
--                dated on/before the receipt date
--                − every earlier in-house receipt on the same spec
--   consumed_m = the receipt's own received metres
--   after_m    = before_m − consumed_m
--
-- Pavu status is deliberately NOT referenced — that was the bug.
-- weft_yarn / porvai_yarn / bobbin are left untouched; only warp_beam
-- is affected by this defect. Job-work and outsource receipts are not
-- touched at all.
--
-- KNOWN RESIDUAL
-- 15 receipt lines still show a negative before_m, all in Apr–May 2026.
-- This is NOT an arithmetic fault: pavu records only begin 2026-06-06
-- while receipts begin 2026-04-06, so roughly 16,900 m of pre-pavu warp
-- inflow was never entered (approx 6,574 m on 1770/count-1, 1,172 m on
-- 1770/count-9, 9,123 m on 2400). Left visible on purpose so the gap is
-- not silently papered over. Entering the true April opening stock for
-- those three specs and re-running this script will clear them.
--
-- Original values are preserved in fabric_receipt_snapshot_backup and
-- can be restored with the query at the bottom of this file.

-- ── 1. Backup ────────────────────────────────────────────────────────
create table if not exists fabric_receipt_snapshot_backup (
  receipt_id     bigint primary key references fabric_receipt(id) on delete cascade,
  code           text,
  receipt_date   date,
  stock_snapshot jsonb,
  backed_up_at   timestamptz not null default now(),
  reason         text
);

comment on table fabric_receipt_snapshot_backup is
  'Pre-rebuild copies of fabric_receipt.stock_snapshot. Written by migration 252 before the warp_beam chronological rebuild.';

insert into fabric_receipt_snapshot_backup (receipt_id, code, receipt_date, stock_snapshot, reason)
select fr.id, fr.code, fr.receipt_date, fr.stock_snapshot,
       'pre warp_beam chronological rebuild (pavu in_stock double-count fix)'
from fabric_receipt fr
where fr.stock_snapshot is not null
on conflict (receipt_id) do nothing;

-- ── 2. Rebuild ───────────────────────────────────────────────────────
with s as (
  select fq.id qid,
         (fq.calc_snapshot->>'totalEnds')::int          as ends,
         nullif(fq.calc_snapshot->>'warpCountId','')::int as wc
  from fabric_quality fq
),
rc as (  -- one row per (receipt, warp spec)
  select fr.id rid, fr.receipt_date, s.ends, s.wc,
         sum(fri.received_metres) m
  from fabric_receipt fr
  join fabric_receipt_item fri on fri.receipt_id = fr.id
  join s on s.qid = fri.fabric_quality_id
  join delivery_challan d on d.id = fr.dc_id
  where d.production_mode = 'inhouse'
    and fr.status <> 'draft'
    and s.ends is not null
  group by 1,2,3,4
),
inflow as (
  select warp_ends as ends, yarn_count_id as wc, open_date as d, quantity as q
    from opening_stock
    where bucket = 'warp_beam' and mode = 'inhouse' and status = 'active'
  union all
  select e.ends_count, p.yarn_count_id, p.purchase_date, p.metres
    from inhouse_warp_beam_purchase p
    join ends_master e on e.id = p.ends_id
    where p.status = 'active'
  union all
  select p.ends, sj.warp_count_id,
         coalesce(sj.date_sent, p.created_at::date), p.meters
    from pavu p
    left join sizing_job sj on sj.id = p.sizing_job_id
    where p.production_mode = 'in_house'
),
per_spec as (
  select rc.rid, rc.m,
    coalesce((select sum(i.q) from inflow i
               where i.ends = rc.ends
                 and (i.wc is not distinct from rc.wc or i.wc is null)
                 and i.d <= rc.receipt_date), 0)
    - coalesce((select sum(r2.m) from rc r2
                 where r2.ends = rc.ends
                   and r2.wc is not distinct from rc.wc
                   and (r2.receipt_date <  rc.receipt_date
                     or (r2.receipt_date = rc.receipt_date and r2.rid < rc.rid))), 0)
    as before_m
  from rc
),
rebuilt as (
  select rid,
         round(sum(before_m), 2)          as new_before_m,
         round(sum(m), 2)                 as new_consumed_m,
         round(sum(before_m) - sum(m), 2) as new_after_m
  from per_spec
  group by rid
)
update fabric_receipt fr
set stock_snapshot = jsonb_set(
      coalesce(fr.stock_snapshot, '{}'::jsonb),
      '{warp_beam}',
      jsonb_build_object(
        'before_m',   r.new_before_m,
        'consumed_m', r.new_consumed_m,
        'after_m',    r.new_after_m
      ),
      true
    ),
    updated_at = now()
from rebuilt r
where r.rid = fr.id;

-- ── Rollback ─────────────────────────────────────────────────────────
-- update fabric_receipt fr
-- set stock_snapshot = b.stock_snapshot
-- from fabric_receipt_snapshot_backup b
-- where b.receipt_id = fr.id;
