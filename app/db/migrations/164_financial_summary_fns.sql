-- 164_financial_summary_fns.sql
--
-- Two RPCs powering the new Financial Summary report (FY-scoped):
--
--   fn_party_balances_as_of(p_as_of date)
--     Per-party receivable / payable as of the given date. Joins live
--     invoices (matched by upper(party_name)) and the party_opening_
--     ledger backfill so a single row shows the full open position.
--
--   fn_warehouse_stock_as_of(p_as_of date)
--     Quantity-on-hand per (mode, bucket) as of the given date.
--     Combines opening_stock (status=active, open_date<=as_of) with
--     stock_ledger movements (event_date<=as_of). Mode for ledger rows
--     is derived from jobwork_party_id + party type:
--       jobwork_party_id IS NULL                           -> 'inhouse'
--       party is tagged 'Sizing Party'  (type_id = 4)      -> 'sizing'
--       party is tagged 'Outsource Weaver' (type_id = 5)   -> 'outsource'
--       else                                                -> 'jobwork'

CREATE OR REPLACE FUNCTION public.fn_party_balances_as_of(p_as_of date)
RETURNS TABLE (
  party_id       bigint,
  party_code     text,
  party_name     text,
  receivable     numeric,
  payable        numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $func$
  WITH
    -- Opening-ledger receivables / payables for entries dated on or
    -- before the cut-off. Balance already accounts for partial
    -- settlements (balance = amount - amount_paid).
    opl AS (
      SELECT party_id,
             SUM(balance) FILTER (WHERE direction = 'receivable') AS r_open,
             SUM(balance) FILTER (WHERE direction = 'payable')    AS p_open
      FROM   public.party_opening_ledger
      WHERE  status = 'active'
        AND  invoice_date <= p_as_of
      GROUP BY party_id
    ),
    -- Live invoices: balance > 0 on the as-of date. We can't filter by
    -- amount_paid as-of (it's a current value), so this snapshot uses
    -- the *current* balance on every invoice whose invoice_date <= as-of.
    -- Operators reading older years should pin the as-of in the same
    -- year as the invoice activity.
    inv AS (
      SELECT p.id AS party_id,
             SUM(i.balance) FILTER (WHERE i.doc_type::text IN ('tax_invoice','jobwork_invoice','yarn_sale','general_sale','debit_note'))
               AS r_inv,
             SUM(i.balance) FILTER (WHERE i.doc_type::text = 'credit_note')
               AS p_inv
      FROM   public.invoice i
      JOIN   public.party   p ON upper(p.name) = upper(i.party_name)
      WHERE  i.invoice_date <= p_as_of
        AND  i.status::text NOT IN ('paid','cancelled')
        AND  i.balance > 0
      GROUP BY p.id
    )
  SELECT
    p.id                                                          AS party_id,
    p.code                                                        AS party_code,
    p.name                                                        AS party_name,
    COALESCE(opl.r_open, 0) + COALESCE(inv.r_inv, 0)              AS receivable,
    COALESCE(opl.p_open, 0) + COALESCE(inv.p_inv, 0)              AS payable
  FROM   public.party p
  LEFT JOIN opl ON opl.party_id = p.id
  LEFT JOIN inv ON inv.party_id = p.id
  WHERE  p.status = 'active'
    AND  (COALESCE(opl.r_open, 0) + COALESCE(inv.r_inv, 0) <> 0
       OR COALESCE(opl.p_open, 0) + COALESCE(inv.p_inv, 0) <> 0)
  ORDER BY p.name;
$func$;

COMMENT ON FUNCTION public.fn_party_balances_as_of(date) IS
  'Per-party (receivable, payable) snapshot as of a date. Combines '
  'party_opening_ledger + live invoice.balance. Only parties with a '
  'non-zero position are returned.';

CREATE OR REPLACE FUNCTION public.fn_warehouse_stock_as_of(p_as_of date)
RETURNS TABLE (
  mode    text,
  bucket  text,
  quantity numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $func$
  WITH
    -- Opening_stock contributes IN-only quantities, dated on/before
    -- the cut-off.
    open_q AS (
      SELECT COALESCE(os.mode, 'inhouse') AS mode,
             os.bucket,
             SUM(os.quantity)::numeric AS qty
      FROM   public.opening_stock os
      WHERE  os.status = 'active'
        AND  (os.open_date IS NULL OR os.open_date <= p_as_of)
      GROUP BY os.mode, os.bucket
    ),
    -- stock_ledger: in - out as of the cut-off, mode derived from the
    -- jobwork party's primary type.
    ledger_q AS (
      SELECT
        CASE
          WHEN sl.jobwork_party_id IS NULL THEN 'inhouse'
          WHEN p.party_type_ids @> ARRAY[4::bigint] THEN 'sizing'
          WHEN p.party_type_ids @> ARRAY[5::bigint] THEN 'outsource'
          ELSE 'jobwork'
        END AS mode,
        sl.bucket,
        SUM(CASE WHEN sl.direction = 'in'  THEN  sl.quantity
                 WHEN sl.direction = 'out' THEN -sl.quantity
                 ELSE 0 END)::numeric AS qty
      FROM   public.stock_ledger sl
      LEFT JOIN public.party p ON p.id = sl.jobwork_party_id
      WHERE  sl.event_date <= p_as_of
      GROUP BY 1, sl.bucket
    ),
    merged AS (
      SELECT mode, bucket, qty FROM open_q
      UNION ALL
      SELECT mode, bucket, qty FROM ledger_q
    )
  SELECT mode, bucket, SUM(qty)::numeric(14,2) AS quantity
  FROM   merged
  GROUP  BY mode, bucket
  HAVING SUM(qty) <> 0
  ORDER  BY mode, bucket;
$func$;

COMMENT ON FUNCTION public.fn_warehouse_stock_as_of(date) IS
  'Per-(mode, bucket) stock-on-hand as of a date. Combines '
  'opening_stock + stock_ledger movements. Mode for ledger rows is '
  'derived from jobwork party type (NULL = inhouse, type 4 = sizing, '
  'type 5 = outsource, else jobwork).';
