-- 206_agent_commission_report_view.sql
--
-- Agent-wise report source. Unifies the three kinds of agent_commission
-- rows (sales invoices, yarn-lot purchases, fabric purchases) into one
-- normalised stream the report page can group by agent.
--
-- Each row carries:
--   * the agent (party) it belongs to,
--   * the counterparty (customer for sales, supplier for purchases),
--   * the underlying brokered business value, and
--   * commission earned / paid / outstanding.
--
-- side = 'sales' | 'purchase' lets the page split the two sections;
-- source pins the exact document kind for drill-down links.

CREATE OR REPLACE VIEW public.v_agent_commission_report AS
-- ── Sales (fabric / tax invoices) ──────────────────────────────────────
SELECT
  ac.id                         AS commission_id,
  'sales'::text                 AS side,
  'sales'::text                 AS source,
  ac.invoice_id                 AS source_id,
  i.invoice_no                  AS doc_no,
  i.invoice_date                AS doc_date,
  ac.agent_party_id,
  ag.code                       AS agent_code,
  ag.name                       AS agent_name,
  c.name                        AS counterparty_name,
  COALESCE(i.total, 0)          AS business_value,
  ac.commission_type,
  ac.commission_rate,
  COALESCE(ac.amount, 0)        AS commission_amount,
  COALESCE(ac.amount_paid, 0)   AS commission_paid,
  COALESCE(ac.balance, 0)       AS commission_balance,
  ac.status
FROM public.agent_commission ac
JOIN public.party    ag ON ag.id = ac.agent_party_id
JOIN public.invoice  i  ON i.id  = ac.invoice_id
LEFT JOIN public.customer c ON c.id = i.customer_id
WHERE ac.invoice_id IS NOT NULL

UNION ALL
-- ── Yarn purchases ─────────────────────────────────────────────────────
SELECT
  ac.id,
  'purchase'::text,
  'yarn_purchase'::text,
  ac.yarn_lot_id,
  yl.invoice_no,
  yl.received_date,
  ac.agent_party_id,
  ag.code,
  ag.name,
  sp.name,
  COALESCE(yl.total_amount, 0),
  ac.commission_type,
  ac.commission_rate,
  COALESCE(ac.amount, 0),
  COALESCE(ac.amount_paid, 0),
  COALESCE(ac.balance, 0),
  ac.status
FROM public.agent_commission ac
JOIN public.party    ag ON ag.id = ac.agent_party_id
JOIN public.yarn_lot yl ON yl.id = ac.yarn_lot_id
LEFT JOIN public.party sp ON sp.id = yl.supplier_party_id
WHERE ac.yarn_lot_id IS NOT NULL

UNION ALL
-- ── Fabric purchases ───────────────────────────────────────────────────
SELECT
  ac.id,
  'purchase'::text,
  'fabric_purchase'::text,
  ac.fabric_purchase_id,
  fp.invoice_no,
  fp.received_date,
  ac.agent_party_id,
  ag.code,
  ag.name,
  sp.name,
  COALESCE(fp.total_amount, 0),
  ac.commission_type,
  ac.commission_rate,
  COALESCE(ac.amount, 0),
  COALESCE(ac.amount_paid, 0),
  COALESCE(ac.balance, 0),
  ac.status
FROM public.agent_commission ac
JOIN public.party           ag ON ag.id = ac.agent_party_id
JOIN public.fabric_purchase fp ON fp.id = ac.fabric_purchase_id
LEFT JOIN public.party sp ON sp.id = fp.supplier_party_id
WHERE ac.fabric_purchase_id IS NOT NULL;

GRANT SELECT ON public.v_agent_commission_report TO authenticated;
