-- 257_merge_duplicate_party_ledgers.sql
--
-- Retires the genuinely duplicated party ledgers.
--
-- Renaming in migration 256 made the real duplicates visible. Two
-- parties had TWO ledgers of the SAME type for the SAME account,
-- because party.ledger_id and jobwork_party.ledger_id each auto-created
-- one:
--
--   SRI MURUGAN TEX  LED-0002 #22  <- party.ledger_id
--                    LED-0184 #215 <- jobwork_party.ledger_id, pavu.jobwork_ledger_id
--   DEEPA TEX        LED-0183 #214 <- party.ledger_id
--                    LED-0185 #216 <- jobwork_party.ledger_id
--
-- BMPT TEXTILES is NOT in this list and is deliberately left alone: its
-- two ledgers are different TYPES (CUSTOMER + JOB WORK(CUSTOMER)) for two
-- genuinely different accounts, which is the separation this project
-- exists to build.
--
-- Survivor = the ledger with more references, so fewer rows move.
-- The spare is DEACTIVATED, not deleted: 21 tables carry an FK to
-- ledger, and a retired master is far safer than a cascade. It is also
-- renamed so it can never be picked from a dropdown by mistake, and the
-- reason is written into notes.

update party set ledger_id = 215 where ledger_id = 22;   -- SRI MURUGAN TEX
update party set ledger_id = 216 where ledger_id = 214;  -- DEEPA TEX

update ledger
set active = false,
    name  = name || ' [MERGED into ' || (select code from ledger l2 where l2.id = 215) || ']',
    notes = coalesce(notes || ' | ', '')
            || 'Merged into LED-0184 by migration 257 (duplicate jobwork ledger).'
where id = 22;

update ledger
set active = false,
    name  = name || ' [MERGED into ' || (select code from ledger l2 where l2.id = 216) || ']',
    notes = coalesce(notes || ' | ', '')
            || 'Merged into LED-0185 by migration 257 (duplicate outsource ledger).'
where id = 214;

-- Verified after applying: 0 remaining active same-name/same-type
-- duplicates, 0 broken party.ledger_id, 0 broken jobwork_party.ledger_id,
-- 210 ledgers (nothing deleted), 2 retired.
