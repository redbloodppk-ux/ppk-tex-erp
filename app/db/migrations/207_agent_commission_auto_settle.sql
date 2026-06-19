-- 207_agent_commission_auto_settle.sql
-- Opening-aware auto-settlement of agent commissions.
--
-- When money is paid OUT to an agent party, that cash is applied in this order:
--   1) the agent's OPENING balance, if it is a payable (opening_dr_cr = 'Cr'),
--   2) then the agent's commissions, oldest first (FIFO), capped at each
--      commission's amount.
-- The result is written to agent_commission.amount_paid, so the commission
-- report, the dashboard payables and the ledger drill-down all stay in sync
-- automatically, regardless of how the payment was entered.
--
-- "Budget" for an agent = (total out-payments to the party)
--                         minus (those payments' allocations to purchase bills:
--                                fabric / sizing / yarn / bobbin / sales-invoice).
-- So a payment explicitly earmarked to a purchase bill does NOT bleed into
-- commission settlement.
--
-- This supersedes the old payment_agent_allocation -> amount_paid sync trigger,
-- which is dropped below.

-- ---------------------------------------------------------------------------
-- Core recompute function
-- ---------------------------------------------------------------------------
create or replace function public.fn_resettle_agent(p_party_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger_id  bigint;
  v_opening    numeric := 0;
  v_total_out  numeric := 0;
  v_earmarked  numeric := 0;
  v_budget     numeric := 0;
  v_take       numeric;
  r            record;
begin
  if p_party_id is null then
    return;
  end if;

  -- Nothing to do unless this party actually has agent commissions.
  if not exists (
    select 1 from agent_commission where agent_party_id = p_party_id
  ) then
    return;
  end if;

  -- Agent's opening payable (only 'Cr' opening counts as something we owe).
  select p.ledger_id into v_ledger_id from party p where p.id = p_party_id;
  if v_ledger_id is not null then
    select coalesce(l.opening_amount, 0)
      into v_opening
      from ledger l
     where l.id = v_ledger_id
       and l.opening_dr_cr = 'Cr';
  end if;
  v_opening := coalesce(v_opening, 0);

  -- Total cash paid out to this party.
  select coalesce(sum(amount), 0)
    into v_total_out
    from payment
   where party_id = p_party_id
     and direction = 'out';

  -- Of that cash, how much is earmarked to specific purchase / sales bills.
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

  v_budget := greatest(v_total_out - v_earmarked, 0);

  -- 1) Opening payable consumes budget first.
  v_budget := greatest(v_budget - v_opening, 0);

  -- 2) Spill remaining budget over commissions, oldest first.
  for r in
    select id, amount
      from agent_commission
     where agent_party_id = p_party_id
       and status = 'active'
     order by created_at asc, id asc
  loop
    v_take := least(r.amount, v_budget);
    if v_take < 0 then
      v_take := 0;
    end if;
    update agent_commission
       set amount_paid = v_take,
           updated_at  = now()
     where id = r.id
       and amount_paid is distinct from v_take;
    v_budget := v_budget - v_take;
  end loop;

  -- Non-active commissions never carry a paid amount.
  update agent_commission
     set amount_paid = 0
   where agent_party_id = p_party_id
     and status <> 'active'
     and amount_paid <> 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger wrappers
-- ---------------------------------------------------------------------------
create or replace function public.fn_trg_resettle_agent_payment()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_resettle_agent(old.party_id);
    return old;
  elsif tg_op = 'UPDATE' then
    perform public.fn_resettle_agent(new.party_id);
    if new.party_id is distinct from old.party_id then
      perform public.fn_resettle_agent(old.party_id);
    end if;
    return new;
  else -- INSERT
    perform public.fn_resettle_agent(new.party_id);
    return new;
  end if;
end;
$$;

create or replace function public.fn_trg_resettle_agent_commission()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_resettle_agent(old.agent_party_id);
    return old;
  else
    perform public.fn_resettle_agent(new.agent_party_id);
    if tg_op = 'UPDATE'
       and new.agent_party_id is distinct from old.agent_party_id then
      perform public.fn_resettle_agent(old.agent_party_id);
    end if;
    return new;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_resettle_agent_payment on public.payment;
create trigger trg_resettle_agent_payment
after insert or update or delete on public.payment
for each row
execute function public.fn_trg_resettle_agent_payment();

drop trigger if exists trg_resettle_agent_commission_ins on public.agent_commission;
create trigger trg_resettle_agent_commission_ins
after insert on public.agent_commission
for each row
execute function public.fn_trg_resettle_agent_commission();

drop trigger if exists trg_resettle_agent_commission_del on public.agent_commission;
create trigger trg_resettle_agent_commission_del
after delete on public.agent_commission
for each row
execute function public.fn_trg_resettle_agent_commission();

-- UPDATE only re-settles when something that affects distribution changes.
-- amount_paid-only updates (written by fn_resettle_agent itself) are excluded,
-- which prevents trigger recursion.
drop trigger if exists trg_resettle_agent_commission_upd on public.agent_commission;
create trigger trg_resettle_agent_commission_upd
after update on public.agent_commission
for each row
when (
  old.amount         is distinct from new.amount
  or old.agent_party_id is distinct from new.agent_party_id
  or old.status      is distinct from new.status
)
execute function public.fn_trg_resettle_agent_commission();

-- ---------------------------------------------------------------------------
-- Retire the old manual-allocation -> amount_paid sync. amount_paid is now
-- owned solely by fn_resettle_agent. payment_agent_allocation rows (if any are
-- still written by the Payments UI) become informational only.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pay_agent_alloc_sync on public.payment_agent_allocation;

-- ---------------------------------------------------------------------------
-- One-time backfill for every existing agent.
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
begin
  for rec in select distinct agent_party_id from agent_commission loop
    perform public.fn_resettle_agent(rec.agent_party_id);
  end loop;
end;
$$;
