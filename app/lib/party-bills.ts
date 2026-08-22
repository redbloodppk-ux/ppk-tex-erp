/**
 * One loader for "every open bill against a party".
 *
 * WHY THIS EXISTS
 * The same query set had been written THREE times — payments/page.tsx,
 * components/unpaid-bills-picker.tsx and payments/contra-tab.tsx — and
 * the three had already drifted apart:
 *
 *   source                  payments  picker  contra
 *   invoice                    y        y       y
 *   party_opening_ledger       y        y       -    (Rs 21,177 over 6 parties)
 *   sizing/bobbin/yarn/
 *     fabric/warp beam         y        y       y
 *   agent_commission           y        -       -    (Rs 9,247.19 over 38 rows)
 *
 * So a credit note raised from invoices/new could not be adjusted against
 * an agent commission, though a payment on the Payments page could; and
 * the contra tab understated any account holding an opening balance.
 *
 * Duplication of exactly this kind caused all three bugs found on
 * 2026-08-20 (warp double-count, job work shown as payable, bill picker
 * offering payables). See docs/superpowers/specs/2026-08-20-erp-audit.md.
 *
 * Add a new bill source HERE and all three screens get it at once.
 */
import { streamForBillKind, type PartyStream } from './party-streams';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

/** Which allocation table settles this bill kind, and via which column. */
export type BillKind =
  | 'invoice' | 'opening' | 'sizing' | 'bobbin'
  | 'yarn' | 'fabric' | 'agent' | 'warp_beam';

export interface OpenBill {
  kind: BillKind;
  id: number;
  /** Document number shown to the operator. */
  doc_no: string;
  /** ISO date, '' when the source has none. */
  doc_date: string;
  /** Fine-grained type used for labels AND stream classification.
   *  For invoices this is the real invoice.doc_type. */
  doc_type: string;
  total: number;
  amount_paid: number;
  balance: number;
  /** Which of the party's accounts this bill belongs to. */
  stream: PartyStream;
}

/** allocation table + FK column per bill kind. `null` = not settleable
 *  through an allocation table (nothing currently). */
export const ALLOC_TABLE: Record<BillKind, { table: string; col: string }> = {
  invoice:   { table: 'payment_allocation',           col: 'invoice_id' },
  opening:   { table: 'payment_opening_allocation',   col: 'opening_ledger_id' },
  sizing:    { table: 'payment_sizing_allocation',    col: 'sizing_job_id' },
  bobbin:    { table: 'payment_bobbin_allocation',    col: 'bobbin_purchase_id' },
  yarn:      { table: 'payment_yarn_allocation',      col: 'yarn_lot_id' },
  fabric:    { table: 'payment_fabric_allocation',    col: 'fabric_purchase_id' },
  agent:     { table: 'payment_agent_allocation',     col: 'agent_commission_id' },
  warp_beam: { table: 'payment_warp_beam_allocation', col: 'warp_beam_purchase_id' },
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice:        'Fabric Sale',
  yarn_sale:          'Yarn Sale',
  general_sale:       'General Sale',
  credit_note:        'Credit Note',
  debit_note:         'Debit Note',
  jobwork_invoice:    'Jobwork Bill',
  weaving_bill:       'Weaving Bill',
  opening_receivable: 'Opening (Receivable)',
  opening_payable:    'Opening (Payable)',
  sizing_bill:        'Sizing Bill',
  bobbin_purchase:    'Bobbin Purchase',
  yarn_purchase:      'Yarn Purchase',
  fabric_purchase:    'Fabric Purchase',
  warp_beam_purchase: 'Warp Beam Purchase',
  agent_commission:   'Agent Commission',
};

/** Stable composite key — ids come from different sequences and collide. */
export function billKey(b: { kind: BillKind; id: number }): string {
  return `${b.kind}-${b.id}`;
}

const n = (v: unknown): number => Number(v ?? 0);

/**
 * Every open bill for a party, across all eight sources, oldest first.
 *
 * `partyName` is retained in the signature for callers and future use,
 * but invoices are now matched on party_id (migration 262), not on the
 * printed party_name.
 */
export async function loadPartyBills(
  sb: Sb,
  partyId: number,
  partyName: string,
): Promise<{ bills: OpenBill[]; error: string | null }> {
  const [invRes, openRes, sizRes, bobRes, yarnRes, fabRes, agentRes, wbRes] = await Promise.all([
    // Matched on party_id, not party_name. The old text match worked only
    // while every party name stayed unique and unchanged - a rename would
    // have silently detached a party's whole invoice history with no
    // error. party_name is still the name PRINTED on the document; it is
    // no longer the link. See migration 262.
    //
    // No party_name fallback: PostgREST .or() cannot safely carry a raw
    // name, and 4 parties contain characters that break its syntax
    // (e.g. "SRI V BALAJI SPINNING MILLS INDIA (P) LTD"). All 94 existing
    // invoices were backfilled and the invoice form now writes party_id,
    // so a plain equality is both correct and safe.
    sb.from('invoice')
      .select('id, invoice_no, invoice_date, doc_type, total, amount_paid, balance')
      .eq('party_id', partyId)
      .in('status', ['issued', 'partial_paid', 'overdue'])
      // Credit / debit notes reduce what is owed; they are not themselves
      // debts, so they never belong in a "tick to settle" list.
      .not('doc_type', 'in', '(credit_note,debit_note)')
      .gt('balance', 0),
    sb.from('party_opening_ledger')
      .select('id, invoice_no, invoice_date, direction, amount, amount_paid, balance')
      .eq('party_id', partyId).eq('status', 'active').gt('balance', 0),
    sb.from('sizing_job')
      .select('id, bill_no, bill_date, total_amount, amount_paid')
      .eq('party_id', partyId).not('bill_no', 'is', null).gt('total_amount', 0),
    sb.from('bobbin_purchase')
      .select('id, invoice_no, purchase_date, total_amount, amount_paid')
      .eq('vendor_id', partyId).gt('total_amount', 0),
    sb.from('yarn_lot')
      .select('id, lot_code, invoice_no, received_date, total_amount, amount_paid')
      .eq('supplier_party_id', partyId).gt('total_amount', 0),
    // Only supplier-source fabric purchases are payable bills;
    // customer-adjustment rows already carry a synthetic payment.
    sb.from('fabric_purchase')
      .select('id, code, invoice_no, received_date, total_amount, amount_paid')
      .eq('supplier_party_id', partyId).eq('source', 'supplier')
      .eq('status', 'active').gt('total_amount', 0),
    sb.from('agent_commission')
      .select('id, amount, amount_paid, balance, invoice:invoice_id ( invoice_no, invoice_date ), yarn_lot:yarn_lot_id ( lot_code, received_date ), fabric_purchase:fabric_purchase_id ( code, received_date )')
      .eq('agent_party_id', partyId).eq('status', 'active').gt('balance', 0),
    sb.from('inhouse_warp_beam_purchase')
      .select('id, code, invoice_no, purchase_date, total_amount, amount_paid')
      .eq('supplier_party_id', partyId).eq('status', 'active').gt('total_amount', 0),
  ]);

  // Only the invoice query is fatal — it is the one source every party
  // has. The rest are optional tables whose absence should not blank the
  // whole list (this mirrors the previous per-screen behaviour).
  if (invRes?.error) return { bills: [], error: invRes.error.message };

  const out: OpenBill[] = [];

  for (const r of ((invRes?.data ?? []) as Array<Record<string, unknown>>)) {
    out.push({
      kind: 'invoice', id: Number(r.id),
      doc_no: String(r.invoice_no ?? ''), doc_date: String(r.invoice_date ?? ''),
      doc_type: String(r.doc_type ?? ''),
      total: n(r.total), amount_paid: n(r.amount_paid), balance: n(r.balance),
      stream: streamForBillKind(String(r.doc_type ?? '')),
    });
  }

  for (const r of ((openRes?.data ?? []) as Array<Record<string, unknown>>)) {
    const isReceivable = r.direction === 'receivable';
    out.push({
      kind: 'opening', id: Number(r.id),
      doc_no: String(r.invoice_no ?? 'Opening balance'),
      doc_date: String(r.invoice_date ?? ''),
      doc_type: isReceivable ? 'opening_receivable' : 'opening_payable',
      total: n(r.amount), amount_paid: n(r.amount_paid), balance: n(r.balance),
      stream: isReceivable ? 'customer' : 'supplier',
    });
  }

  /** Purchase-style sources: balance is total − paid, computed here
   *  because the parent total_amount columns are GENERATED and Postgres
   *  won't let one generated column reference another. */
  const pushPurchase = (
    rows: unknown[], kind: BillKind, docType: string,
    noKey: string, dateKey: string, fallbackPrefix: string,
  ): void => {
    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      const total = n(r.total_amount);
      const paid = n(r.amount_paid);
      const bal = Math.round((total - paid) * 100) / 100;
      if (bal <= 0.005) continue;
      out.push({
        kind, id: Number(r.id),
        doc_no: String(r[noKey] ?? `${fallbackPrefix}-${r.id}`),
        doc_date: String(r[dateKey] ?? ''),
        doc_type: docType,
        total, amount_paid: paid, balance: bal,
        stream: 'supplier',
      });
    }
  };

  pushPurchase(sizRes?.data  ?? [], 'sizing',    'sizing_bill',        'bill_no',    'bill_date',     'SZ');
  pushPurchase(bobRes?.data  ?? [], 'bobbin',    'bobbin_purchase',    'invoice_no', 'purchase_date', 'BOB');
  pushPurchase(yarnRes?.data ?? [], 'yarn',      'yarn_purchase',      'invoice_no', 'received_date', 'YRN');
  pushPurchase(fabRes?.data  ?? [], 'fabric',    'fabric_purchase',    'invoice_no', 'received_date', 'FAB');
  pushPurchase(wbRes?.data   ?? [], 'warp_beam', 'warp_beam_purchase', 'invoice_no', 'purchase_date', 'WB');

  // Agent commission hangs off whichever document earned it.
  for (const raw of ((agentRes?.data ?? []) as unknown[])) {
    const r = raw as Record<string, unknown>;
    const inv = r.invoice as Record<string, unknown> | null;
    const lot = r.yarn_lot as Record<string, unknown> | null;
    const fab = r.fabric_purchase as Record<string, unknown> | null;
    out.push({
      kind: 'agent', id: Number(r.id),
      doc_no: String(inv?.invoice_no ?? lot?.lot_code ?? fab?.code ?? `AC-${r.id}`),
      doc_date: String(inv?.invoice_date ?? lot?.received_date ?? fab?.received_date ?? ''),
      doc_type: 'agent_commission',
      total: n(r.amount), amount_paid: n(r.amount_paid), balance: n(r.balance),
      stream: 'supplier',
    });
  }

  out.sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || '') || a.id - b.id);
  return { bills: out, error: null };
}

/** Split allocations into the per-table payloads the DB expects. */
export function allocationPayloads(
  paymentId: number,
  allocs: Array<{ kind: BillKind; id: number; amount: number }>,
): Array<{ table: string; rows: Array<Record<string, number>> }> {
  const byTable = new Map<string, Array<Record<string, number>>>();
  for (const a of allocs) {
    if (!(a.amount > 0.005)) continue;
    const { table, col } = ALLOC_TABLE[a.kind];
    const list = byTable.get(table) ?? [];
    list.push({ payment_id: paymentId, [col]: a.id, amount: a.amount });
    byTable.set(table, list);
  }
  return Array.from(byTable.entries()).map(([table, rows]) => ({ table, rows }));
}
