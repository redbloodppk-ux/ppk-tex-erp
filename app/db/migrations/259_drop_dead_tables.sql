-- 259_drop_dead_tables.sql
--
-- Audit item 4. Removes five tables that have never held a row, plus the
-- five always-NULL columns that pointed at them.
--
-- WHAT IS BEING DROPPED AND WHY IT IS SAFE
--
--   table               rows  code queries  views  functions  FKs at it
--   yarn_purchase          0      0           0        0       3
--   yarn_purchase_line     0      0           0        0       0
--   resale_lot             0      0           0        0       2
--   jobwork_order          0      0           0        0       1
--   notification           0      0           0        0       0
--
-- yarn_purchase / yarn_purchase_line were a second, never-used model for
-- what yarn_lot already does. resale_lot was superseded by
-- fabric_purchase (the /app/resale route is already a redirect stub).
-- jobwork_order was superseded by the jobwork_* stock tables.
-- notification was superseded by DERIVED notifications
-- (lib/notifications/source.ts); notification_clear is still used for
-- dismissals and is NOT touched.
--
-- THREE THINGS CHECKED THAT COULD HAVE BITTEN
--
-- 1. fn_period_pnl_split mentions jobwork_order, but only in a COMMENT
--    explaining why the P&L stopped using it ("jobwork_order has zero
--    rows, so both previously forced own_share=1"). Not a dependency.
-- 2. 'yarn_purchase' appears in 7 source files, but every one is the
--    doc-type LABEL string, not a table read. There is not a single
--    .from('yarn_purchase') in the codebase.
-- 3. All five linking columns are 100% NULL — verified across 157
--    payments, 108 invoice_lines and every yarn_lot / fabric_stock row.
--
-- Snapshot taken immediately before applying (auto_backup id 5).

-- ── Drop the always-NULL linking columns first ───────────────────────
-- Each is a foreign key to a table that has never had a row, and each is
-- NULL on every existing record.
alter table payment      drop column if exists purchase_id;          -- -> yarn_purchase
alter table yarn_lot     drop column if exists purchase_invoice_id;  -- -> yarn_purchase
alter table invoice_line drop column if exists resale_lot_id;        -- -> resale_lot
alter table fabric_stock drop column if exists resale_lot_id;        -- -> resale_lot
alter table fabric_stock drop column if exists jw_id;                -- -> jobwork_order

-- ── Drop the tables ──────────────────────────────────────────────────
-- yarn_purchase_line before yarn_purchase (child first).
drop table if exists yarn_purchase_line;
drop table if exists yarn_purchase;
drop table if exists resale_lot;
drop table if exists jobwork_order;
drop table if exists notification;

-- notification_clear is deliberately KEPT: it records per-user dismissals
-- of the derived notifications and is live.
