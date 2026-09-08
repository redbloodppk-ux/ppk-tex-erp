-- ============================================================================
-- 286: Put every ledger in the group Tally would put it in, and fix the
--      mapping that keeps putting them in the wrong one.
--
-- PPK, 2026-09-08: "CHECK OTHER ledgers are in correct ledger group and type
-- for reference check with tally".
--
-- All 200 ledgers audited. Five were misfiled. More importantly, three of
-- them were misfiled BY A RULE, so correcting the rows alone would have let
-- the next rental or transport party land in the same wrong place.
--
-- ----------------------------------------------------------------------------
-- WHY IT KEEPS HAPPENING
--
-- tg_party_link_ledger creates a party's ledger by copying ledger_type_id
-- and ledger_group_id straight off party_type_master. Three of the ten
-- mappings were wrong:
--
--   Rental    -> INDIRECT EXPENSES   a tenant is not an expense
--   Shipping  -> INDIRECT EXPENSES   a transporter is not an expense
--   General   -> NULL                and NULL means the trigger returns
--                                    early and NO LEDGER IS CREATED AT ALL
--
-- The distinction Tally draws, and the one that was lost here: a PARTY is
-- someone who owes you or whom you owe - a balance-sheet account under
-- Sundry Debtors or Sundry Creditors. The EXPENSE or INCOME head is a
-- separate ledger. Rent received already has its own head, RENTAL INCOME
-- under INDIRECT INCOMES, and it stays exactly where it is. The tenants
-- move out to Sundry Debtors, where the money they owe belongs.
--
-- Rental maps to Sundry Debtors because PPK is the landlord: both rental
-- parties are billed by him, five invoices each, and fn_party_to_customer_sync
-- already treats 'Rental' as a customer kind. Confirmed with him 2026-09-08.
--
-- ----------------------------------------------------------------------------
-- THE ONE THAT WAS BREAKING SOMETHING TODAY
--
-- The CASH ledger sat in DIRECT EXPENSES while CASH-IN-HAND stood empty.
-- That is not cosmetic. /app/tds/new and /app/tds/[id] build the "Paid
-- from" list by filtering on group CASH-IN-HAND / BANK ACCOUNTS / BANK OD
-- A/C, so with cash-in-hand empty a TDS challan paid in cash could not be
-- recorded at all - only the five bank accounts appeared. 773 transactions
-- run through that ledger.
--
-- ----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT TOUCHED
--
-- WEAVER WAGES stays in DIRECT EXPENSES - wages are a direct cost for a
-- manufacturer, which is where Tally wants them. KUMAR and VEHICLE LOAN
-- stay under LOANS (LIABILITY). The chits stay under INVESTMENTS. GST and
-- TDS PAYABLE stay under DUTIES & TAXES. All 166 debtors and 16 creditors
-- were already right.
--
-- KOTAK MAHINDRA BANK is left without a ledger on purpose. It is a General
-- party, but giving it a Sundry Creditors ledger would put a second "Kotak"
-- in the ledger list next to KOTAK CURRENT ACCOUNT and invite a wrong pick.
-- If a bill from them ever needs posting, give it a ledger by hand then.
--
-- No amounts move. Groups and types only: this changes where balances are
-- REPORTED, not what they are.
--
-- ----------------------------------------------------------------------------
-- ONE KNOCK-ON, HANDLED
--
-- Retyping the two drawings ledgers to CAPITAL (step 3) would have made them
-- appear in the Expenses "Paid from" picker, which migration 285 had widened
-- to CASH / BANK / CAPITAL for OWNER FUNDS. They are the opposite of a
-- payment source - money going out TO PPK, not in from him. The picker now
-- takes CASH and BANK by type plus owner funds by code, so drawings cannot
-- be selected as a way to pay for something.
-- See app/app/expenses/new/expense-entry-form.tsx.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The source. Fix these and the rows below stop re-occurring.
-- ---------------------------------------------------------------------------

-- A tenant owes rent -> Sundry Debtors. RENTAL INCOME stays the income head.
UPDATE public.party_type_master
SET ledger_group_id = (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY DEBTORS')
WHERE name = 'Rental';

-- A transporter / calenderer is someone we pay -> Sundry Creditors.
UPDATE public.party_type_master
SET ledger_group_id = (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY CREDITORS')
WHERE name = 'Shipping';

-- 'General' had neither, so tg_party_link_ledger bailed out and nine
-- parties ended up with no ledger. They are mill stores, engineering and
-- computer suppliers - people PPK buys from.
UPDATE public.party_type_master
SET ledger_type_id  = (SELECT id FROM public.ledger_type  WHERE name = 'SUPPLIER'),
    ledger_group_id = (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY CREDITORS')
WHERE name = 'General';

-- ---------------------------------------------------------------------------
-- 2. The five misfiled ledgers.
-- ---------------------------------------------------------------------------

-- Cash is cash. Also restores the cash option on the TDS challan screen.
UPDATE public.ledger
SET group_id = (SELECT id FROM public.ledger_group WHERE name = 'CASH-IN-HAND')
WHERE name = 'CASH'
  AND type_id = (SELECT id FROM public.ledger_type WHERE name = 'CASH');

-- Tenants: Rs 1,29,800 and Rs 47,200 billed, both fully collected.
UPDATE public.ledger
SET group_id = (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY DEBTORS')
WHERE name IN ('VARNAA COTTON MILLS', 'VENKATESHWARRA STORES');

-- Vendors we pay. Raghu's own party type is Broker / Agent, and his four
-- fellow agents were already in Sundry Creditors - he was the odd one out.
UPDATE public.ledger
SET group_id = (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY CREDITORS')
WHERE name IN ('VENKATESWARA CALENDERING MILLS', 'RAGHU');

-- ---------------------------------------------------------------------------
-- 3. Type left behind by migration 284.
--    284 moved these two into CAPITAL ACCOUNT but left the type reading
--    EXPENSES, so the ledger list showed "EXPENSES - CAPITAL ACCOUNT",
--    which contradicts itself. Drawings are capital, not cost.
-- ---------------------------------------------------------------------------

UPDATE public.ledger
SET type_id = (SELECT id FROM public.ledger_type WHERE name = 'CAPITAL')
WHERE name IN ('CREDIT CARD PAYMENT', 'PERSONAL EXPENSES')
  AND group_id = (SELECT id FROM public.ledger_group WHERE name = 'CAPITAL ACCOUNT');

-- ---------------------------------------------------------------------------
-- 4. The ledgers 'General' never created.
--    trg_party_link_ledger is BEFORE INSERT only, so fixing the mapping
--    above does nothing for parties that already exist. Create them here.
-- ---------------------------------------------------------------------------

WITH missing AS (
  SELECT p.id, p.name, p.address1, p.address2, p.address3, p.address4,
         p.billing_address, p.phone, p.email, p.gstin
  FROM public.party p
  JOIN public.party_type_master ptm ON ptm.id = p.party_type_id
  WHERE p.ledger_id IS NULL
    AND ptm.name = 'General'
    AND p.name <> 'KOTAK  MAHINDRA  BANK  LIMITED'
    AND NOT EXISTS (SELECT 1 FROM public.ledger l WHERE l.name = p.name)
),
created AS (
  INSERT INTO public.ledger
    (name, type_id, group_id, address1, address2, address3, address4,
     phone, email, gstin, active)
  SELECT m.name,
         (SELECT id FROM public.ledger_type  WHERE name = 'SUPPLIER'),
         (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY CREDITORS'),
         COALESCE(NULLIF(m.address1, ''), NULLIF(m.billing_address, '')),
         NULLIF(m.address2, ''), NULLIF(m.address3, ''), NULLIF(m.address4, ''),
         m.phone, m.email, m.gstin, true
  FROM missing m
  RETURNING id, name
)
UPDATE public.party p
SET ledger_id = c.id
FROM created c
WHERE p.name = c.name AND p.ledger_id IS NULL;

-- ============================================================================
-- Verify:
--   select lt.name, lg.name, count(*) from ledger l
--   join ledger_type lt on lt.id=l.type_id
--   join ledger_group lg on lg.id=l.group_id
--   group by 1,2 having count(*) <= 6 order by 1,2;
-- Expected: no CASH in DIRECT EXPENSES, no RENTAL in INDIRECT INCOMES, no
-- TRANSPORT in INDIRECT EXPENSES, no AGENT outside SUNDRY CREDITORS, and
-- CAPITAL ACCOUNT holding three CAPITAL-typed ledgers.
--
--   select count(*) from ledger l join ledger_group lg on lg.id=l.group_id
--   where lg.name='CASH-IN-HAND';
-- Expected: 1 - so the TDS challan screen can offer cash again.
-- ============================================================================
