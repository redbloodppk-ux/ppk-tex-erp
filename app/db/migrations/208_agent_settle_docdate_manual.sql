-- 208_agent_settle_docdate_manual.sql
-- Corrects two problems in the agent auto-settle from migration 207:
--
--   1) Ordering: 207 distributed cash by agent_commission.created_at, which can
--      be the REVERSE of the real document date (commissions are often entered
--      newest-first). Settlement must follow the SOURCE DOCUMENT date, oldest
--      first, to match the operator's "settle the oldest bill first" model.
--
--   2) Manual selection ignored: when the operator ticks specific commission
--      bills on the Payments screen (payment_agent_allocation rows), those
--      choices were overwritten by FIFO. Manual allocations are now
--      AUTHORITATIVE; auto-fill only spreads whatever cash is left after the
--      manual picks and the opening payable.
--
-- Final amount_paid per commission =
--     manual_alloc(commission)                       -- explicit operator picks
--   + auto_fill(commission)                          -- leftover cash, oldest doc first
--   capped at the commission amount.
--
-- auto-fill budget =
--     total out-payments to the agent
--   − payments earmarked to purchase / sales bills
--   − all manual agent-commission allocations
--   − the agent's opening payable (Cr)

create or replace function public.fn_resettle_agent(p_party_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger_id   bigint;
  v_opening     numeric := 0;
  v_total_out   numeric := 0;
  v_earmarked   numeric := 0;
  v_manual_tot  numeric := 0;
  v_budget      numeric := 0;
  v_manual      numeric;
  v_auto_used   numeric;
  v_take        numeric;
  r             record;
begin
  if p_party_id is null then
    return;
  end if;

  if not exists (
    select 1 from agent_commission where agent_party_id = p_party_id
  ) then
    return;
  end if;

  -- Opening payable (only 'Cr' counts as something we owe the agent).
  select p.ledger_id into v_ledger_id from party p where p.id = p_party_id;
  if v_ledger_id is not null then
    select coalesce(l.opening_amount, 0)
      into v_opening
      from ledger l
     where l.id = v_ledger_id
       and l.opening_dr_cr = 'Cr';
  end if;
  v_opening := coalesce(v_opening, 0);

  -- Total cash paid out to the agent.
  select coalesce(sum(amount), 0)
    into v_total_out
    from payment
   where party_id = p_party_id
     and direction = 'out';

  -- Cash earmarked to specific purchase / sales bills.
  select coalesce(sum(a.amount), 0)
    into v_earmarked
    from (
      select payment_id, amount from payment_fabric_allocation
      union all select payment_id, amount from payment_sizing_allocation
      union all select payment_id, amount from payment_yarn_allocation
      union all select payment_id, amount from payment_bobbin_allocation
      union all select payment_id, amount from payment_allocation
    ) a
    join payment pm on pm.id = a.payment_id
   where pm.party_id = p_party_id
     and pm.direction = 'out';

  -- Cash explicitly tied to specific commissions by the operator.
  select coalesce(sum(paa.amount), 0)
    into v_manual_tot
    from payment_agent_allocation paa
    join payment pm on pm.id = paa.payment_id
   where pm.party_id = p_party_id
     and pm.direction = 'out';

  -- Budget left for auto-fill after manual picks and opening payable.
  v_budget := greatest(
                v_total_out - v_earmarked - v_manual_tot - v_opening,
                0);

  -- Walk commissions oldest SOURCE-DOCUMENT date first.
  for r in
    select ac.id,
           ac.amount,
           coalesce(yl.received_date, fp.received_date, inv.invoice_date)
             as doc_date
      from agent_commission ac
      left join yarn_lot       yl  on yl.id  = ac.yarn_lot_id
      left join fabric_purchase fp on fp.id  = ac.fabric_purchase_id
      left join invoice        inv on inv.id = ac.invoice_id
     where ac.agent_party_id = p_party_id
       and ac.status = 'active'
     order by doc_date asc nulls last, ac.id asc
  loop
    -- explicit manual allocation to THIS commission
    select coalesce(sum(paa.amount), 0)
      into v_manual
      from payment_agent_allocation paa
      join payment pm on pm.id = paa.payment_id
     where pm.party_id = p_party_id
       and pm.direction = 'out'
       and paa.agent_commission_id = r.id;

    -- auto-fill only the space left after the manual portion
    v_auto_used := least(greatest(r.amount - v_manual, 0), v_budget);
    v_take := least(r.amount, v_manual + v_auto_used);
    v_budget := v_budget - v_auto_used;

    update agent_commission
       set amount_paid = v_take,
           updated_at  = now()
     where id = r.id
       and amount_paid is distinct from v_take;
  end loop;

  -- Non-active commissions never carry a paid amount.
  update agent_commission
     set amount_paid = 0
   where agent_party_id = p_party_id
     and status <> 'active'
     and amount_paid <> 0;
end;
$$;

-- Re-settle whenever the operator's manual commission picks change.
create or replace function public.fn_trg_resettle_agent_alloc()
returns trigger
language plpgsql
as $$
declare
  v_party bigint;
begin
  select party_id into v_party
    from payment
   where id = coalesce(new.payment_id, old.payment_id);
  perform public.fn_resettle_agent(v_party);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resettle_agent_alloc on public.payment_agent_allocation;
create trigger trg_resettle_agent_alloc
after insert or update or delete on public.payment_agent_allocation
for each row
execute function public.fn_trg_resettle_agent_alloc();

-- Re-run the corrected distribution for every agent.
do $$
declare
  rec record;
begin
  for rec in select distinct agent_party_id from agent_commission loop
    perform public.fn_resettle_agent(rec.agent_party_id);
  end loop;
end;
$$;
