-- ============================================================================
-- 287: Switch off the five account groups this business can never use.
--
-- PPK, 2026-09-08: "remove unwanted ledger group and types which we don't
-- want for our business".
--
-- LEDGER TYPES: nothing to remove. All 17 are in use - every one has at
-- least one ledger behind it. Checked, not assumed.
--
-- LEDGER GROUPS: seven were empty. Five of those cannot be used by this
-- ERP at all, and are switched off:
--
--   PROFIT & LOSS A/C   Tally reserves this as a system account you never
--                       post to. There is no equivalent here.
--   SUSPENSE A/C        For entries you cannot classify yet. Every screen
--                       in this app forces a category, so nothing can
--                       reach it.
--   SALES ACCOUNTS      In Tally an invoice posts to a nominal "Sales"
--   PURCHASE ACCOUNTS   or "Purchase" head under these. Here an invoice
--                       posts against the customer ledger and revenue is
--                       computed from the invoice rows, so no such head
--                       exists or can be created.
--   STOCK-IN-HAND       Yarn, beams and fabric are tracked as inventory,
--                       not as ledgers. Closing stock is something the CA
--                       posts in Tally at year end, not in here.
--
-- KEPT, though also empty, because they genuinely fit a weaving mill:
--
--   DIRECT INCOMES            PPK does job work (BMPT, Sri Murugan Tex).
--                             Job-work charges are DIRECT income for a
--                             weaver - that is where a JOB WORK INCOME
--                             head belongs, not Indirect Incomes.
--   LOANS & ADVANCES (ASSET)  An advance to a yarn or sizing mill before
--                             delivery is normal in textiles, and it is an
--                             asset, not an expense.
--
-- ----------------------------------------------------------------------------
-- WHY active=false RATHER THAN DELETE
--
-- Every group picker in the app filters on active, so switching these off
-- removes them from the UI completely - the same visible result as deleting.
-- But the row survives, and Settings -> Ledger Groups has an Active tick box
-- per row, so if PPK's CA ever asks for SALES ACCOUNTS to line up a Tally
-- export it is one click, not a re-entry. Deleting buys nothing here.
--
-- All five are empty, so no ledger changes group and no balance moves.
--
-- SAFETY: app/app/ledgers/[id]/page.tsx now re-adds a ledger's own group
-- and type to the pickers if either has been switched off. Without that,
-- opening such a ledger would show an empty group box and quietly reassign
-- it on save. None of the five holds a ledger today, but the guard means
-- switching any group off later stays safe.
-- ============================================================================

UPDATE public.ledger_group
SET active = false
WHERE name IN (
  'PROFIT & LOSS A/C',
  'SUSPENSE A/C',
  'SALES ACCOUNTS',
  'PURCHASE ACCOUNTS',
  'STOCK-IN-HAND'
)
-- Belt and braces: never switch off a group that has picked up a ledger
-- between writing this and running it.
AND NOT EXISTS (
  SELECT 1 FROM public.ledger l WHERE l.group_id = public.ledger_group.id
);

-- Verify:
--   select name, active,
--          (select count(*) from ledger l where l.group_id = lg.id) as ledgers
--   from ledger_group lg order by active desc, name;
-- Expected: 14 active groups, 5 inactive, and every inactive one empty.
