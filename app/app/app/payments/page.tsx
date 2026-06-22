'use client';
/**
 * /app/payments — unified Payments page.
 *
 * Replaces the old /app/pay-customer and /app/pay-purchase stubs.
 * One page handles every money movement for every party type.
 *
 * Two tabs:
 *
 *   1. New Payment
 *      Record a fresh receipt (direction = in) or payment (direction =
 *      out). The party-type dropdown filters the party list to just
 *      that type (Customer / Mill / Yarn Supplier / Sizing Vendor /
 *      Weaving Vendor / Jobwork Party / Bobbin Supplier / Broker), so
 *      the operator never has to scroll through every party in the
 *      database.
 *
 *   2. Status
 *      Ledger-style view of inflows + outflows for the selected party,
 *      chronological with a running balance column. Grand balance
 *      shown at the bottom. Filter by party type and party.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
import { Loader2, Save, CheckCircle2, ArrowDownToLine, ArrowUpFromLine, Pencil, Trash2, X, ExternalLink, IndianRupee } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────────

type Direction = 'in' | 'out';

interface PartyTypeOpt {
  id: number;
  name: string;
}
interface PartyOpt {
  id: number;
  code: string;
  name: string;
  party_type_ids: number[] | null;
}
// A real BANK or CASH ledger that the payment can be drawn from /
// received into. Sourced from the ledger master (filtered by type
// CASH or BANK) so the dropdown matches the operator's own chart of
// accounts.
interface ModeLedgerOpt {
  id: number;
  code: string;
  name: string;
  type_name: 'BANK' | 'CASH';
}
interface PaymentRow {
  id: number;
  payment_no: string;
  payment_date: string;
  direction: Direction;
  amount: number | string;
  mode: string | null;
  mode_ledger_id: number | null;
  mode_ledger?: { id: number; name: string } | null;
  reference: string | null;
  notes: string | null;
  party_id: number | null;
  // Resolved party + its types when the Status tab is showing
  // payments across multiple parties (no specific party selected).
  party?: { id: number; code: string; name: string; party_type_ids: number[] | null } | null;
}
/** An unpaid (or part-paid) bill of the selected party, offered for
 *  bill-to-bill adjustment when recording a payment. Invoices are
 *  matched to the unified party master by the party_name stamped on
 *  every invoice. */
interface UnpaidBill {
  /** Discriminator for which child table the allocation goes into:
   *    invoice -> payment_allocation (invoice_id)
   *    opening -> payment_opening_allocation (opening_ledger_id)
   *    sizing  -> payment_sizing_allocation (sizing_job_id)
   *    bobbin  -> payment_bobbin_allocation (bobbin_purchase_id)
   *    yarn    -> payment_yarn_allocation (yarn_lot_id)
   *    fabric  -> payment_fabric_allocation (fabric_purchase_id)
   *    agent   -> payment_agent_allocation (agent_commission_id)
   */
  kind: 'invoice' | 'opening' | 'sizing' | 'bobbin' | 'yarn' | 'fabric' | 'agent';
  id: number;
  invoice_no: string;
  invoice_date: string;
  doc_type: string;
  total: number | string;
  amount_paid: number | string;
  balance: number | string;
}

/** A single line in the party-ledger statement-of-account view.
 *  Bills increase or decrease the party's account; payments move the
 *  other way. Sign convention:
 *    - debit  > 0 → adds to "party owes us" side
 *    - credit > 0 → adds to "we owe party" side
 *  Running balance is (debit - credit) cumulative. Positive balance
 *  means the party is a debtor; negative means a creditor.
 */
interface LedgerTxn {
  /** Stable key per row (kind + source id). */
  key: string;
  /** Original row id for edit / delete / link-out. */
  source_id: number;
  kind:
    | 'sale_invoice' | 'jobwork_bill'
    | 'credit_note'  | 'debit_note'
    | 'sizing_bill'  | 'bobbin_purchase' | 'yarn_purchase' | 'fabric_purchase'
    | 'opening_receivable' | 'opening_payable'
    | 'payment_in' | 'payment_out';
  date: string;
  voucher_no: string;
  description: string;
  debit:  number;
  credit: number;
  /** Optional deep-link to view / edit the source row. */
  href?: string;
  /** Full payment row, only present for payment_in / payment_out. */
  payment?: PaymentRow;
  /** Party label + id, populated when the ledger view includes
   *  rows across multiple parties (no specific party picked). */
  party_label?: string;
  party_link_id?: number | null;
}

/** Party types where a payment MUST be adjusted against bills — or
 *  explicitly confirmed as an advance to the party ledger — before it
 *  can be saved. Keeps supplier/jobwork ledgers bill-to-bill clean. */
const BILL_ADJUST_REQUIRED_TYPES: readonly string[] = [
  'Bobbin Supplier',
  'Jobwork Party',
  'Outsource Weaver',
  'Mill / Yarn Supplier',
  'Sizing Party',
  'Customer',
];

const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice:        'Fabric Sale',
  yarn_sale:          'Yarn Sale',
  general_sale:       'General Sale',
  credit_note:        'Credit Note',
  debit_note:         'Debit Note',
  jobwork_invoice:    'Jobwork Bill',
  weaving_bill:       'Weaving Bill',
  sizing_bill:        'Sizing Bill',
  agent_commission:   'Agent Commission',
  bobbin_purchase:    'Bobbin Purchase',
  yarn_purchase:      'Yarn Purchase',
  fabric_purchase:    'Fabric Purchase',
  // Opening ledger entries (settings → Opening Ledger) — discriminated
  // by direction so the operator can see at a glance which way the
  // pre-ERP balance was sitting.
  opening_receivable: 'Opening (Receivable)',
  opening_payable:    'Opening (Payable)',
};

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

function fmtINR(n: number | string | null | undefined): string {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return '0.00';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear());
}

// ── Page shell ──────────────────────────────────────────────────────────────

type Tab = 'new' | 'status';

export default function PaymentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) || 'new';

  function setTab(next: Tab): void {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', next);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Record every receipt and payment for any party type. The Status tab shows a ledger of inflow / outflow / running balance per party."
      />

      <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
        <TabButton active={tab === 'new'}    onClick={() => setTab('new')}>New Payment</TabButton>
        <TabButton active={tab === 'status'} onClick={() => setTab('status')}>Status</TabButton>
      </div>

      {tab === 'new' ? <NewPaymentTab /> : <StatusTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
        active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-ink-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

// ── New Payment tab ─────────────────────────────────────────────────────────

function NewPaymentTab(): React.ReactElement {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const initialDirection: Direction = searchParams.get('direction') === 'out' ? 'out' : 'in';
  // Other pages (e.g. Jobwork → Payment Status) deep-link here with the
  // party pre-selected so its unpaid bills show up immediately.
  const initialParty: string = searchParams.get('party') ?? '';

  // Re-record deep link: when the Status tab deletes a payment to let the
  // operator change its amount, it bounces here with the old payment's
  // details pre-filled (amount / date / ledger / reference / notes) plus a
  // `redo` marker carrying the old payment number for the banner. The
  // operator just corrects the amount, re-ticks the bills, and saves —
  // the proven bill-allocation engine does the rest.
  const redoLabel: string = searchParams.get('redo') ?? '';
  const initialAmount: string = searchParams.get('amount') ?? '';
  const initialDate: string = searchParams.get('pdate') ?? todayISO();
  const initialLedger: string = searchParams.get('ledger') ?? '';
  const initialRef: string = searchParams.get('ref') ?? '';
  const initialNotes: string = searchParams.get('pnotes') ?? '';

  const [direction,    setDirection]   = useState<Direction>(initialDirection);
  const [partyTypeId,  setPartyTypeId] = useState<string>('');
  const [partyId,      setPartyId]     = useState<string>(initialParty);
  const [date,         setDate]        = useState<string>(initialDate);
  const [amount,       setAmount]      = useState<string>(initialAmount);
  // Replaces the old free-text Mode enum. The picked ledger is what
  // gets saved; the legacy `mode` text column is auto-derived by a DB
  // trigger from the ledger's type ('cash' / 'bank_transfer').
  const [modeLedgerId, setModeLedgerId] = useState<string>(initialLedger);
  const [reference,    setReference]   = useState<string>(initialRef);
  const [notes,        setNotes]       = useState<string>(initialNotes);

  const [partyTypes,   setPartyTypes]   = useState<PartyTypeOpt[]>([]);
  const [parties,      setParties]      = useState<PartyOpt[]>([]);
  const [modeLedgers,  setModeLedgers]  = useState<ModeLedgerOpt[]>([]);
  const [loading,      setLoading]      = useState<boolean>(true);
  const [busy,         setBusy]         = useState<boolean>(false);
  const [error,        setError]        = useState<string | null>(null);
  const [savedMsg,     setSavedMsg]     = useState<string | null>(null);

  // ── Bill-to-bill adjustment state ────────────────────────────────────────
  // Unpaid bills of the picked party, which of them are ticked, and how
  // much of this payment is adjusted against each (invoice id → amount).
  const [bills,        setBills]        = useState<UnpaidBill[]>([]);
  const [billsLoading, setBillsLoading] = useState<boolean>(false);
  // checkedBills / alloc are keyed by a composite `${kind}-${id}` string
  // because the bill list is now a merge of invoice rows and opening_ledger
  // rows whose IDs come from two different sequences and could collide.
  const [checkedBills, setCheckedBills] = useState<Set<string>>(new Set());
  const [alloc,        setAlloc]        = useState<Record<string, string>>({});
  /** True while AMOUNT is being driven by the ticked bills (so each new
   *  tick GROWS the total). Becomes false the moment the operator types a
   *  custom amount, after which ticking only re-spreads that fixed amount. */
  const [amountAuto,   setAmountAuto]   = useState<boolean>(true);
  /** Operator's explicit confirmation that this payment is an ADVANCE
   *  to the party ledger (no bill adjusted). Required for the party
   *  types in BILL_ADJUST_REQUIRED_TYPES. */
  const [advanceOk,    setAdvanceOk]    = useState<boolean>(false);
  /** Operator's explicit OK to keep the leftover (amount minus the bill
   *  adjustments) on the party ledger as an advance, instead of being
   *  forced to allocate the receipt in full. */
  const [keepOnAccount, setKeepOnAccount] = useState<boolean>(false);

  /** Composite key for the merged invoice + opening_ledger bill list. */
  function billKey(b: UnpaidBill): string { return `${b.kind}-${b.id}`; }

  // ── Load party types, parties, and mode (BANK / CASH) ledgers ───────────
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [ptRes, pRes, mRes] = await Promise.all([
        sb.from('party_type_master').select('id, name').eq('active', true).order('name'),
        sb.from('party')
          .select('id, code, name, party_type_ids')
          .eq('status', 'active')
          .order('name'),
        // Only BANK and CASH ledgers can be a payment source/destination.
        sb.from('ledger')
          .select('id, code, name, ledger_type:type_id!inner(name)')
          .eq('active', true)
          .in('ledger_type.name', ['BANK', 'CASH'])
          .order('name'),
      ]);
      setPartyTypes((ptRes.data ?? []) as PartyTypeOpt[]);
      setParties((pRes.data ?? []) as PartyOpt[]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setModeLedgers(((mRes.data ?? []) as any[]).map((l) => ({
        id: l.id, code: l.code, name: l.name,
        type_name: l.ledger_type?.name as 'BANK' | 'CASH',
      })));
      setLoading(false);
    })();
  }, [supabase]);

  // Cascade: when party type changes, reset party_id and filter the list.
  const filteredParties = useMemo(() => {
    if (!partyTypeId) return parties;
    const id = Number(partyTypeId);
    return parties.filter((p) =>
      Array.isArray(p.party_type_ids) && p.party_type_ids.includes(id),
    );
  }, [parties, partyTypeId]);

  useEffect(() => {
    // Drop the picked party only when an explicit party-TYPE filter is active
    // and it narrows the picked party out of view. Without the `partyTypeId`
    // guard this also fired during the initial load window — while `parties`
    // is still empty, `filteredParties` is empty too, which would wipe a
    // party pre-selected via the ?party= deep link (e.g. dashboard "Collect")
    // before its name could ever show.
    if (!partyTypeId) return;
    if (partyId && !filteredParties.some((p) => String(p.id) === partyId)) {
      setPartyId('');
    }
  }, [filteredParties, partyId, partyTypeId]);

  // ── Load the party's unpaid bills whenever the party changes ─────────────
  // Invoices stamp party_name at creation, so we match the picked party
  // by name (case-insensitive). Only open bills with a balance left.
  const loadBills = useCallback(async (): Promise<void> => {
    setCheckedBills(new Set());
    setAlloc({});
    setAmountAuto(true);
    setAdvanceOk(false);
    setKeepOnAccount(false);
    if (!partyId) { setBills([]); return; }
    const party = parties.find((p) => String(p.id) === partyId);
    if (!party) { setBills([]); return; }
    setBillsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Pull every unpaid bill against this party from the five sources
    // in parallel. After migration 165 the Payments page is the unified
    // settlement screen for invoices + opening ledger + sizing bills +
    // bobbin purchases + yarn purchases.
    const [invRes, openRes, sizRes, bobRes, yarnRes, fabRes, agentRes] = await Promise.all([
      sb.from('invoice')
        .select('id, invoice_no, invoice_date, doc_type, total, amount_paid, balance')
        .ilike('party_name', party.name)
        .in('status', ['issued', 'partial_paid', 'overdue'])
        // Exclude reduction-type docs — credit / debit notes aren't
        // themselves debts, so they don't belong in a "tick to settle"
        // list.
        .not('doc_type', 'in', '(credit_note,debit_note)')
        .gt('balance', 0)
        .order('invoice_date', { ascending: true })
        .order('id', { ascending: true }),
      sb.from('party_opening_ledger')
        .select('id, invoice_no, invoice_date, direction, amount, amount_paid, balance')
        .eq('party_id', party.id)
        .eq('status', 'active')
        .gt('balance', 0)
        .order('invoice_date', { ascending: true })
        .order('id', { ascending: true }),
      // Sizing bills (party_id linked via migration 165 backfill).
      // Only billed jobs with a remaining balance.
      sb.from('sizing_job')
        .select('id, bill_no, bill_date, total_amount, amount_paid')
        .eq('party_id', party.id)
        .not('bill_no', 'is', null)
        .gt('total_amount', 0),
      // Bobbin purchases against this supplier.
      sb.from('bobbin_purchase')
        .select('id, invoice_no, purchase_date, total_amount, amount_paid')
        .eq('vendor_id', party.id)
        .gt('total_amount', 0),
      // Yarn lots against this supplier.
      sb.from('yarn_lot')
        .select('id, lot_code, invoice_no, received_date, total_amount, amount_paid')
        .eq('supplier_party_id', party.id)
        .gt('total_amount', 0),
      // Fabric resale purchases (migration 170). Only supplier-mode
      // rows are payable bills; customer-adjustment rows already have
      // a synthetic payment so they're excluded.
      sb.from('fabric_purchase')
        .select('id, code, invoice_no, received_date, total_amount, amount_paid')
        .eq('supplier_party_id', party.id)
        .eq('source', 'supplier')
        .eq('status', 'active')
        .gt('total_amount', 0),
      // Agent / broker commission owed to this party (from fabric invoices).
      sb.from('agent_commission')
        .select('id, amount, amount_paid, balance, invoice:invoice_id ( invoice_no, invoice_date ), yarn_lot:yarn_lot_id ( lot_code, received_date ), fabric_purchase:fabric_purchase_id ( code, received_date )')
        .eq('agent_party_id', party.id)
        .eq('status', 'active')
        .gt('balance', 0),
    ]);
    setBillsLoading(false);
    if (invRes.error) { setError(invRes.error.message); return; }
    if (openRes.error) {
      // eslint-disable-next-line no-console
      console.warn('opening_ledger not available:', openRes.error.message);
    }
    if (sizRes?.error)  { /* eslint-disable-next-line no-console */ console.warn('sizing_job not loadable:', sizRes.error.message); }
    if (bobRes?.error)  { /* eslint-disable-next-line no-console */ console.warn('bobbin_purchase not loadable:', bobRes.error.message); }
    if (yarnRes?.error) { /* eslint-disable-next-line no-console */ console.warn('yarn_lot not loadable:', yarnRes.error.message); }
    if (fabRes?.error)  { /* eslint-disable-next-line no-console */ console.warn('fabric_purchase not loadable:', fabRes.error.message); }
    if (agentRes?.error){ /* eslint-disable-next-line no-console */ console.warn('agent_commission not loadable:', agentRes.error.message); }

    const liveBills: UnpaidBill[] = ((invRes.data ?? []) as Array<{
      id: number; invoice_no: string; invoice_date: string; doc_type: string;
      total: number | string; amount_paid: number | string; balance: number | string;
    }>).map((r) => ({ ...r, kind: 'invoice' }));

    const openBills: UnpaidBill[] = ((openRes?.data ?? []) as Array<{
      id: number; invoice_no: string; invoice_date: string; direction: string;
      amount: number | string; amount_paid: number | string; balance: number | string;
    }>).map((r) => ({
      kind: 'opening',
      id: r.id,
      invoice_no: r.invoice_no,
      invoice_date: r.invoice_date,
      doc_type: `opening_${r.direction}`,
      total: r.amount,
      amount_paid: r.amount_paid,
      balance: r.balance,
    }));

    // sizing / bobbin / yarn bills — balance computed on the fly
    // because their parent total_amount columns are GENERATED, which
    // PG won't let us reference from another generated column.
    const sizingBills: UnpaidBill[] = ((sizRes?.data ?? []) as Array<{
      id: number; bill_no: string | null; bill_date: string | null;
      total_amount: number | string; amount_paid: number | string;
    }>).filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
       .map((r) => ({
         kind: 'sizing',
         id: r.id,
         invoice_no: r.bill_no ?? `SZ-${r.id}`,
         invoice_date: r.bill_date ?? '',
         doc_type: 'sizing_bill',
         total: r.total_amount,
         amount_paid: r.amount_paid,
         balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
       }));

    const bobbinBills: UnpaidBill[] = ((bobRes?.data ?? []) as Array<{
      id: number; invoice_no: string | null; purchase_date: string | null;
      total_amount: number | string; amount_paid: number | string;
    }>).filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
       .map((r) => ({
         kind: 'bobbin',
         id: r.id,
         invoice_no: r.invoice_no ?? `BB-${r.id}`,
         invoice_date: r.purchase_date ?? '',
         doc_type: 'bobbin_purchase',
         total: r.total_amount,
         amount_paid: r.amount_paid,
         balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
       }));

    const yarnBills: UnpaidBill[] = ((yarnRes?.data ?? []) as Array<{
      id: number; lot_code: string | null; invoice_no: string | null;
      received_date: string | null; total_amount: number | string; amount_paid: number | string;
    }>).filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
       .map((r) => ({
         kind: 'yarn',
         id: r.id,
         invoice_no: r.invoice_no ?? r.lot_code ?? `YL-${r.id}`,
         invoice_date: r.received_date ?? '',
         doc_type: 'yarn_purchase',
         total: r.total_amount,
         amount_paid: r.amount_paid,
         balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
       }));

    const fabricBills: UnpaidBill[] = ((fabRes?.data ?? []) as Array<{
      id: number; code: string; invoice_no: string | null;
      received_date: string | null; total_amount: number | string; amount_paid: number | string;
    }>).filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
       .map((r) => ({
         kind: 'fabric',
         id: r.id,
         invoice_no: r.invoice_no ?? r.code ?? `FP-${r.id}`,
         invoice_date: r.received_date ?? '',
         doc_type: 'fabric_purchase',
         total: r.total_amount,
         amount_paid: r.amount_paid,
         balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
       }));

    const agentBills: UnpaidBill[] = ((agentRes?.data ?? []) as Array<{
      id: number; amount: number | string; amount_paid: number | string; balance: number | string;
      invoice: { invoice_no: string | null; invoice_date: string | null } | null;
      yarn_lot: { lot_code: string | null; received_date: string | null } | null;
      fabric_purchase: { code: string | null; received_date: string | null } | null;
    }>).filter((r) => Number(r.balance ?? 0) > 0.005)
       .map((r) => {
         // Commission points at one source: fabric sales invoice, yarn
         // lot, or fabric purchase. Label + date come from whichever set.
         const srcNo = r.invoice?.invoice_no ?? r.yarn_lot?.lot_code ?? r.fabric_purchase?.code ?? null;
         const srcDate = r.invoice?.invoice_date ?? r.yarn_lot?.received_date ?? r.fabric_purchase?.received_date ?? '';
         return {
           kind: 'agent' as const,
           id: r.id,
           invoice_no: srcNo ? `${srcNo} (Comm)` : `COMM-${r.id}`,
           invoice_date: srcDate,
           doc_type: 'agent_commission',
           total: r.amount,
           amount_paid: r.amount_paid,
           balance: r.balance,
         };
       });

    // Sort merged list by date (oldest first) so the operator's mental
    // model is "settle the oldest bill first" regardless of source.
    const merged = [...liveBills, ...openBills, ...sizingBills, ...bobbinBills, ...yarnBills, ...fabricBills, ...agentBills].sort((a, b) => {
      const dc = a.invoice_date.localeCompare(b.invoice_date);
      return dc !== 0 ? dc : a.id - b.id;
    });
    setBills(merged);
  }, [partyId, parties, supabase]);

  useEffect(() => { void loadBills(); }, [loadBills]);

  /** Spread `amt` across the given bills oldest-first (each bill takes
   *  up to its open balance). Returns a composite-key → amount map so
   *  invoice and opening_ledger rows can coexist without collision. */
  function distribute(amt: number, billKeys: Set<string>): Record<string, string> {
    const next: Record<string, string> = {};
    let remaining = amt;
    for (const b of bills) {
      const k = billKey(b);
      if (!billKeys.has(k)) continue;
      const bal = Number(b.balance);
      const take = Math.min(bal, Math.max(remaining, 0));
      next[k] = take > 0 ? String(Math.round(take * 100) / 100) : '';
      remaining -= take;
    }
    return next;
  }

  function toggleBill(b: UnpaidBill): void {
    const k = billKey(b);
    const next = new Set(checkedBills);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setCheckedBills(next);

    const amt = Number(amount);
    if (amountAuto || amount.trim() === '' || !Number.isFinite(amt) || amt <= 0) {
      // Bill-to-bill mode: the operator hasn't typed a custom amount, so
      // AMOUNT tracks the ticked bills — each new tick GROWS the total to
      // the sum of all ticked bills' balances, fully adjusted.
      const sum = bills.filter((x) => next.has(billKey(x)))
        .reduce((s, x) => s + Number(x.balance), 0);
      setAmount(sum > 0 ? String(Math.round(sum * 100) / 100) : '');
      setAlloc(distribute(sum, next));
      setAmountAuto(true);
    } else {
      // Operator typed a custom amount → keep it fixed, just re-spread it.
      setAlloc(distribute(amt, next));
    }
  }

  function handleAmountChange(v: string): void {
    setAmount(v);
    // Operator is now driving the amount by hand; stop auto-summing ticks.
    setAmountAuto(false);
    const amt = Number(v);
    if (checkedBills.size > 0 && Number.isFinite(amt)) {
      setAlloc(distribute(amt, checkedBills));
    }
  }

  function handleAllocChange(billKeyStr: string, v: string): void {
    setAlloc((a) => ({ ...a, [billKeyStr]: v }));
  }

  const allocatedTotal = useMemo<number>(() => {
    let s = 0;
    for (const b of bills) {
      const k = billKey(b);
      if (!checkedBills.has(k)) continue;
      const n = Number(alloc[k] ?? '');
      if (Number.isFinite(n) && n > 0) s += n;
    }
    return Math.round(s * 100) / 100;
  }, [bills, checkedBills, alloc]);

  const unallocated = useMemo<number>(() => {
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return 0;
    return Math.round((amt - allocatedTotal) * 100) / 100;
  }, [amount, allocatedTotal]);

  /** True when the picked party's type demands bill-to-bill adjustment
   *  (or an explicit advance confirmation) before saving. */
  const billAdjustRequired = useMemo<boolean>(() => {
    if (!partyId) return false;
    const party = parties.find((p) => String(p.id) === partyId);
    if (!party || !Array.isArray(party.party_type_ids)) return false;
    const requiredIds = new Set(
      partyTypes.filter((pt) => BILL_ADJUST_REQUIRED_TYPES.includes(pt.name)).map((pt) => pt.id),
    );
    return party.party_type_ids.some((id) => requiredIds.has(Number(id)));
  }, [partyId, parties, partyTypes]);

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSavedMsg(null);

    if (!partyId) { setError('Pick a party.'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Amount must be greater than zero.'); return; }
    if (!date) { setError('Pick a payment date.'); return; }
    if (!modeLedgerId) {
      setError('Pick a Bank / Cash ledger. Add one from the Ledgers page if the dropdown is empty.');
      return;
    }

    // Validate the bill-to-bill adjustments before writing anything.
    // Split allocations by kind so we write to the correct child table:
    //   invoice -> payment_allocation
    //   opening -> payment_opening_allocation
    //   sizing  -> payment_sizing_allocation
    //   bobbin  -> payment_bobbin_allocation
    //   yarn    -> payment_yarn_allocation
    //   fabric  -> payment_fabric_allocation
    const allocations:    { invoice_id: number; amount: number }[]         = [];
    const openingAllocs:  { opening_ledger_id: number; amount: number }[]  = [];
    const sizingAllocs:   { sizing_job_id: number; amount: number }[]      = [];
    const bobbinAllocs:   { bobbin_purchase_id: number; amount: number }[] = [];
    const yarnAllocs:     { yarn_lot_id: number; amount: number }[]        = [];
    const fabricAllocs:   { fabric_purchase_id: number; amount: number }[] = [];
    const agentAllocs:    { agent_commission_id: number; amount: number }[] = [];
    for (const b of bills) {
      const k = billKey(b);
      if (!checkedBills.has(k)) continue;
      const raw = (alloc[k] ?? '').trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(`Bill ${b.invoice_no}: adjusted amount is not a valid number.`);
        return;
      }
      if (n === 0) continue;
      if (n > Number(b.balance) + 0.005) {
        setError(`Bill ${b.invoice_no}: adjusted ₹${fmtINR(n)} is more than its balance ₹${fmtINR(b.balance)}.`);
        return;
      }
      const rounded = Math.round(n * 100) / 100;
      switch (b.kind) {
        case 'opening': openingAllocs.push({ opening_ledger_id:  b.id, amount: rounded }); break;
        case 'sizing':  sizingAllocs .push({ sizing_job_id:      b.id, amount: rounded }); break;
        case 'bobbin':  bobbinAllocs .push({ bobbin_purchase_id: b.id, amount: rounded }); break;
        case 'yarn':    yarnAllocs   .push({ yarn_lot_id:        b.id, amount: rounded }); break;
        case 'fabric':  fabricAllocs .push({ fabric_purchase_id: b.id, amount: rounded }); break;
        case 'agent':   agentAllocs  .push({ agent_commission_id: b.id, amount: rounded }); break;
        default:        allocations  .push({ invoice_id:         b.id, amount: rounded });
      }
    }
    const totalAllocCount = allocations.length + openingAllocs.length
                          + sizingAllocs.length + bobbinAllocs.length + yarnAllocs.length
                          + fabricAllocs.length + agentAllocs.length;
    // Supplier-type parties (and customers): no save without either a
    // bill adjustment or an explicit "advance payment" confirmation.
    if (billAdjustRequired && totalAllocCount === 0 && !advanceOk) {
      setError(bills.length > 0
        ? 'Tick the bill(s) this payment settles — or tick "Advance payment" to post it to the party ledger without adjusting a bill.'
        : 'This party has no unpaid bills. Tick "Advance payment" to confirm posting this amount to the party ledger.');
      return;
    }

    const allocSum = allocations.reduce((s, a) => s + a.amount, 0)
                    + openingAllocs.reduce((s, a) => s + a.amount, 0)
                    + sizingAllocs.reduce((s, a) => s + a.amount, 0)
                    + bobbinAllocs.reduce((s, a) => s + a.amount, 0)
                    + yarnAllocs.reduce((s, a) => s + a.amount, 0)
                    + fabricAllocs.reduce((s, a) => s + a.amount, 0)
                    + agentAllocs.reduce((s, a) => s + a.amount, 0);
    if (allocSum > amt + 0.005) {
      setError(`Adjusted total ₹${fmtINR(allocSum)} is more than the payment amount ₹${fmtINR(amt)}. Reduce the bill adjustments or raise the amount.`);
      return;
    }
    // Save-block when bill adjustment is partial: if the operator
    // ticked any bills the allocated total must equal the payment
    // amount (no "kept on account" leftover allowed). Forces the
    // operator to either (a) raise / drop the bill adjustments to
    // fully consume the amount, or (b) lower the amount to match,
    // or (c) untick all bills and post the whole thing as an advance.
    if (totalAllocCount > 0 && Math.abs(amt - allocSum) > 0.005) {
      const diff = Math.round((amt - allocSum) * 100) / 100;
      // A positive leftover (payment exceeds what was adjusted) is allowed
      // when the operator ticks "keep remaining on account" — the unallocated
      // balance is recorded as an advance on the party ledger. Over-adjusting
      // (negative diff) is never valid.
      if (!(diff > 0 && keepOnAccount)) {
        setError(
          diff > 0
            ? `₹${fmtINR(diff)} of the payment is still unallocated. Tick more bills, raise the bill adjustments, or tick "Keep remaining ₹${fmtINR(diff)} on account" to post it as an advance.`
            : `Allocated ₹${fmtINR(allocSum)} is ₹${fmtINR(-diff)} more than the payment. Reduce the bill adjustments or raise the payment amount.`,
        );
        return;
      }
    }

    setBusy(true);
    const payload = {
      direction,
      party_id:       Number(partyId),
      payment_date:   date,
      amount:         amt,
      // The legacy `mode` text column is auto-derived from the picked
      // ledger's type by a DB trigger (migration 104), so we don't
      // need to send it here.
      mode_ledger_id: Number(modeLedgerId),
      reference:      reference.trim() || null,
      notes:          notes.trim() || null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('payment')
      .insert(payload)
      .select('id, payment_no')
      .single();
    if (err) { setBusy(false); setError(err.message); return; }

    // Write the bill-to-bill adjustments. A DB trigger bumps each
    // invoice's amount_paid / balance / status automatically.
    if (allocations.length > 0 && data?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: allocErr } = await (supabase as any)
        .from('payment_allocation')
        .insert(allocations.map((a) => ({ ...a, payment_id: data.id })));
      if (allocErr) {
        setBusy(false);
        setError(`Payment ${data?.payment_no ?? ''} saved, but the bill adjustment failed: ${allocErr.message}`);
        await loadBills();
        return;
      }
    }
    // Opening ledger adjustments — separate table, triggered to bump
    // party_opening_ledger.amount_paid automatically (migration 162).
    if (openingAllocs.length > 0 && data?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: openErr } = await (supabase as any)
        .from('payment_opening_allocation')
        .insert(openingAllocs.map((a) => ({ ...a, payment_id: data.id })));
      if (openErr) {
        setBusy(false);
        setError(`Payment ${data?.payment_no ?? ''} saved, but the opening-ledger adjustment failed: ${openErr.message}`);
        await loadBills();
        return;
      }
    }
    // Sizing / Bobbin / Yarn allocations (migration 165). Each gets a
    // dedicated table whose trigger bumps the parent row's amount_paid.
    if (sizingAllocs.length > 0 && data?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: sErr } = await (supabase as any)
        .from('payment_sizing_allocation')
        .insert(sizingAllocs.map((a) => ({ ...a, payment_id: data.id })));
      if (sErr) {
        setBusy(false);
        setError(`Payment ${data?.payment_no ?? ''} saved, but the sizing-bill adjustment failed: ${sErr.message}`);
        await loadBills();
        return;
      }
    }
    if (bobbinAllocs.length > 0 && data?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: bErr } = await (supabase as any)
        .from('payment_bobbin_allocation')
        .insert(bobbinAllocs.map((a) => ({ ...a, payment_id: data.id })));
      if (bErr) {
        setBusy(false);
        setError(`Payment ${data?.payment_no ?? ''} saved, but the bobbin-bill adjustment failed: ${bErr.message}`);
        await loadBills();
        return;
      }
    }
    if (yarnAllocs.length > 0 && data?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: yErr } = await (supabase as any)
        .from('payment_yarn_allocation')
        .insert(yarnAllocs.map((a) => ({ ...a, payment_id: data.id })));
      if (yErr) {
        setBusy(false);
        setError(`Payment ${data?.payment_no ?? ''} saved, but the yarn-lot adjustment failed: ${yErr.message}`);
        await loadBills();
        return;
      }
    }
    // Fabric resale purchases (migration 170): same recalc-trigger
    // pattern as the others.
    if (fabricAllocs.length > 0 && data?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: fErr } = await (supabase as any)
        .from('payment_fabric_allocation')
        .insert(fabricAllocs.map((a) => ({ ...a, payment_id: data.id })));
      if (fErr) {
        setBusy(false);
        setError(`Payment ${data?.payment_no ?? ''} saved, but the fabric-purchase adjustment failed: ${fErr.message}`);
        await loadBills();
        return;
      }
    }
    // Agent commission allocations: the trigger bumps agent_commission.amount_paid.
    if (agentAllocs.length > 0 && data?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: aErr } = await (supabase as any)
        .from('payment_agent_allocation')
        .insert(agentAllocs.map((a) => ({ ...a, payment_id: data.id })));
      if (aErr) {
        setBusy(false);
        setError(`Payment ${data?.payment_no ?? ''} saved, but the agent-commission adjustment failed: ${aErr.message}`);
        await loadBills();
        return;
      }
    }
    setBusy(false);
    const totalAdjusted = totalAllocCount;
    setSavedMsg(
      totalAdjusted > 0
        ? `Saved ${data?.payment_no ?? 'payment'} — adjusted against ${totalAdjusted} bill${totalAdjusted === 1 ? '' : 's'}.`
        : `Saved ${data?.payment_no ?? 'payment'}.`,
    );
    // Reset only the volatile fields; keep the direction + party so the
    // operator can log several payments to the same party in a row.
    setAmount(''); setReference(''); setNotes('');
    await loadBills();
  }

  if (loading) {
    return (
      <div className="card p-6 flex items-center gap-2 text-sm text-ink-mute">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading party master…
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="card p-6 space-y-4 max-w-4xl">
      {redoLabel && !savedMsg && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Re-recording {redoLabel}.</span>{' '}
          The old payment was removed and its bill adjustments reversed.
          Correct the amount, re-tick the bill(s) it settles, then Save to
          record it afresh.
        </div>
      )}
      {/* Direction toggle */}
      <div className="grid grid-cols-2 gap-2">
        <DirectionPill
          active={direction === 'in'}
          onClick={() => setDirection('in')}
          icon={<ArrowDownToLine className="w-4 h-4" />}
          label="Receipt (Inflow)"
          tone="in"
        />
        <DirectionPill
          active={direction === 'out'}
          onClick={() => setDirection('out')}
          icon={<ArrowUpFromLine className="w-4 h-4" />}
          label="Payment (Outflow)"
          tone="out"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Party type</label>
          <select className="input" value={partyTypeId} onChange={(e) => setPartyTypeId(e.target.value)}>
            <option value="">All types</option>
            {partyTypes.map((pt) => (
              <option key={pt.id} value={pt.id}>{pt.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-ink-mute mt-1">
            Filter the party dropdown — Customer, Mill / Yarn Supplier, Sizing Vendor, Weaving Vendor, etc.
          </p>
        </div>
        <div>
          <label className="label">Party *</label>
          {/* Type-ahead: type any words of the name (or the code) in any
              order and matching parties auto-suggest. */}
          <SearchSelect
            options={filteredParties.map((p): SearchSelectOption => ({
              value: String(p.id),
              label: `${p.code} — ${p.name}`,
            }))}
            value={partyId}
            onChange={setPartyId}
            placeholder={filteredParties.length ? 'Type party name…' : 'No parties match this type'}
            required
          />
        </div>

        <div>
          <label className="label">Payment date *</label>
          <input
            type="date"
            required
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Amount (₹) *</label>
          <input
            type="number"
            required
            min="0"
            step="0.01"
            className="input num"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="e.g. 25000"
          />
          {checkedBills.size > 0 && (
            <p className="text-[11px] text-ink-mute mt-1">
              Typing here re-spreads the amount across the ticked bills, oldest first.
            </p>
          )}
        </div>

        <div>
          <label className="label">Mode (Bank / Cash ledger) *</label>
          <select
            required
            className="input"
            value={modeLedgerId}
            onChange={(e) => setModeLedgerId(e.target.value)}
          >
            <option value="" disabled>
              {modeLedgers.length
                ? 'Select Bank or Cash ledger…'
                : 'No Bank / Cash ledgers — add one in the Ledgers page first'}
            </option>
            {modeLedgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.type_name === 'CASH' ? '💵' : '🏦'} {l.name}
              </option>
            ))}
          </select>
          {modeLedgers.length === 0 && (
            <p className="text-[11px] text-amber-700 mt-1">
              No Bank / Cash ledgers exist yet. <a className="underline font-semibold" href="/app/ledgers/new">Add one</a> with type CASH (for cash drawers) or BANK (for each bank account).
            </p>
          )}
        </div>
        <div>
          <label className="label">Reference</label>
          <input
            type="text"
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Cheque no / UTR / UPI ref"
          />
        </div>

        <div className="md:col-span-2">
          <label className="label">Notes</label>
          <textarea
            rows={2}
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional remarks"
          />
        </div>
      </div>

      {/* ── Unpaid bills of the picked party — bill-to-bill adjustment ── */}
      {partyId !== '' && (
        billsLoading ? (
          <div className="border border-line/40 rounded-md p-4 flex items-center gap-2 text-sm text-ink-mute">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading unpaid bills…
          </div>
        ) : bills.length === 0 ? (
          <div className="border border-line/40 rounded-md p-4 text-sm text-ink-soft">
            No unpaid bills for this party — the payment will be saved on account.
          </div>
        ) : (
          <div className="border border-line/40 rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-cloud/40 border-b border-line/40 flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Unpaid bills — tick to adjust this {direction === 'in' ? 'receipt' : 'payment'} against them
              </span>
              <span className="text-xs text-ink-mute">
                Tick bills with no amount typed → amount auto-fills from the bills.
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-3 py-2" />
                    <th className="text-left  px-3 py-2">Bill no</th>
                    <th className="text-left  px-3 py-2">Date</th>
                    <th className="text-left  px-3 py-2 hidden md:table-cell">Type</th>
                    <th className="text-right px-3 py-2">Bill (₹)</th>
                    <th className="text-right px-3 py-2">Paid (₹)</th>
                    <th className="text-right px-3 py-2">Balance (₹)</th>
                    <th className="text-right px-3 py-2">Adjust now (₹)</th>
                    <th className="text-right px-3 py-2">Left after (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => {
                    const k = billKey(b);
                    const isChecked = checkedBills.has(k);
                    const allocNum = Number(alloc[k] ?? '');
                    const adj = isChecked && Number.isFinite(allocNum) && allocNum > 0 ? allocNum : 0;
                    const leftAfter = Math.round((Number(b.balance) - adj) * 100) / 100;
                    const overAlloc = adj > Number(b.balance) + 0.005;
                    return (
                      <tr key={k} className={cn('border-t border-line/40', isChecked ? 'bg-indigo-50/40' : 'hover:bg-haze/60')}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-indigo-600"
                            checked={isChecked}
                            onChange={() => toggleBill(b)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{b.invoice_no}</td>
                        <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(b.invoice_date)}</td>
                        <td className="px-3 py-2 hidden md:table-cell text-xs text-ink-soft">
                          {DOC_TYPE_LABEL[b.doc_type] ?? b.doc_type}
                        </td>
                        <td className="px-3 py-2 text-right num">{fmtINR(b.total)}</td>
                        <td className="px-3 py-2 text-right num text-ink-soft">{fmtINR(b.amount_paid)}</td>
                        <td className="px-3 py-2 text-right num font-semibold text-rose-700">{fmtINR(b.balance)}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={!isChecked}
                            className={cn('input num h-8 text-xs w-28 text-right inline-block', overAlloc && 'ring-2 ring-rose-400')}
                            value={isChecked ? (alloc[k] ?? '') : ''}
                            onChange={(e) => handleAllocChange(k, e.target.value)}
                          />
                        </td>
                        <td className={cn('px-3 py-2 text-right num font-semibold', leftAfter <= 0.005 ? 'text-emerald-700' : 'text-amber-700')}>
                          {isChecked ? fmtINR(Math.max(leftAfter, 0)) : fmtINR(b.balance)}
                          {isChecked && leftAfter <= 0.005 && <span className="ml-1 text-[10px]">✓ settled</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {checkedBills.size > 0 && (
                  <tfoot>
                    <tr className="border-t border-line/60 bg-cloud/30 text-xs font-semibold">
                      <td colSpan={7} className="px-3 py-2 text-right">
                        Adjusted against bills: <span className="num text-indigo-700">₹ {fmtINR(allocatedTotal)}</span>
                      </td>
                      <td colSpan={2} className="px-3 py-2 text-right">
                        {unallocated > 0.005 ? (
                          <span className="text-amber-700">On account (unadjusted): ₹ {fmtINR(unallocated)}</span>
                        ) : unallocated < -0.005 ? (
                          <span className="text-rose-700">Over-adjusted by ₹ {fmtINR(Math.abs(unallocated))}</span>
                        ) : (
                          <span className="text-emerald-700">Fully adjusted ✓</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      )}

      {/* Keep-on-account — shown when bills ARE ticked but the receipt is
          larger than the adjusted total. Lets the operator post the leftover
          to the party ledger as an advance instead of being forced to
          allocate the whole receipt. */}
      {partyId !== '' && allocatedTotal > 0 && unallocated > 0.005 && !billsLoading && (
        <label className="flex items-start gap-2 border border-amber-200 bg-amber-50/60 rounded-md p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 mt-0.5 accent-amber-600"
            checked={keepOnAccount}
            onChange={(e) => setKeepOnAccount(e.target.checked)}
          />
          <span>
            <span className="font-semibold text-amber-800">
              Keep remaining ₹{fmtINR(unallocated)} on account (advance).
            </span>{' '}
            <span className="text-ink-soft">
              The ticked bills are settled and the leftover is posted to this
              party&rsquo;s ledger as an advance you can adjust against a future bill.
            </span>
          </span>
        </label>
      )}

      {/* Advance-payment confirmation — shown for party types that
          require bill-to-bill adjustment, when nothing is adjusted. */}
      {partyId !== '' && billAdjustRequired && allocatedTotal <= 0 && !billsLoading && (
        <label className="flex items-start gap-2 border border-amber-200 bg-amber-50/60 rounded-md p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 mt-0.5 accent-amber-600"
            checked={advanceOk}
            onChange={(e) => setAdvanceOk(e.target.checked)}
          />
          <span>
            <span className="font-semibold text-amber-800">Advance payment — no bill adjusted.</span>{' '}
            <span className="text-ink-soft">
              {bills.length > 0
                ? 'This party has unpaid bills. Tick bills above to adjust, or confirm here to post the amount to the party ledger as an advance.'
                : 'Post this amount to the party ledger as an advance.'}
            </span>
          </span>
        </label>
      )}

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4" /> {savedMsg}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {direction === 'in' ? 'Record Receipt' : 'Record Payment'}
        </button>
      </div>
    </form>
  );
}

function DirectionPill({ active, onClick, icon, label, tone }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: Direction;
}): React.ReactElement {
  // Use distinct hues for inflow vs outflow so the operator is never in
  // doubt about which side they're on.
  const activeClass = tone === 'in'
    ? 'ring-2 ring-emerald-500 bg-emerald-50 text-emerald-800'
    : 'ring-2 ring-rose-500 bg-rose-50 text-rose-800';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'card p-3 cursor-pointer flex items-center justify-center gap-2 font-semibold transition-colors',
        active ? activeClass : 'text-ink-soft hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Status tab — ledger view ────────────────────────────────────────────────

function StatusTab(): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  const [partyTypes,  setPartyTypes]  = useState<PartyTypeOpt[]>([]);
  const [parties,     setParties]     = useState<PartyOpt[]>([]);
  const [modeLedgers, setModeLedgers] = useState<ModeLedgerOpt[]>([]);
  const [payments,    setPayments]    = useState<PaymentRow[]>([]);
  /** Non-payment transactions for the single-party ledger view:
   *  invoices, sizing bills, bobbin / yarn purchases, opening ledger
   *  rows. Empty when no party is picked (all-payments view shows
   *  payments only). */
  const [billTxns,    setBillTxns]    = useState<LedgerTxn[]>([]);
  const [loading,     setLoading]     = useState<boolean>(true);
  const [pmtLoading,  setPmtLoading]  = useState<boolean>(false);
  const [error,       setError]       = useState<string | null>(null);

  // Filters.
  const [partyTypeId, setPartyTypeId] = useState<string>('');
  const [partyId,     setPartyId]     = useState<string>('');
  const [dateFrom,    setDateFrom]    = useState<string>('');
  const [dateTo,      setDateTo]      = useState<string>('');

  // ── Edit / delete state ───────────────────────────────────────────
  // The id of the row currently being edited (null = none). Only one
  // row at a time can be in edit mode — keeps the UX simple.
  const [editingId,   setEditingId]   = useState<number | null>(null);
  const [editDate,    setEditDate]    = useState<string>('');
  const [editLedger,  setEditLedger]  = useState<string>('');
  const [editRef,     setEditRef]     = useState<string>('');
  const [editNotes,   setEditNotes]   = useState<string>('');
  const [busyRowId,   setBusyRowId]   = useState<number | null>(null);
  // Bumps to force the payments query to re-run after edit / delete.
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [ptRes, pRes, mRes] = await Promise.all([
      sb.from('party_type_master').select('id, name').eq('active', true).order('name'),
      sb.from('party')
        .select('id, code, name, party_type_ids')
        .eq('status', 'active')
        .order('name'),
      // BANK / CASH ledgers so the operator can switch the mode_ledger
      // on an existing payment from this screen.
      sb.from('ledger')
        .select('id, code, name, ledger_type:type_id!inner(name)')
        .eq('active', true)
        .in('ledger_type.name', ['BANK', 'CASH'])
        .order('name'),
    ]);
    if (ptRes.error)    { setError(ptRes.error.message); setLoading(false); return; }
    if (pRes.error)     { setError(pRes.error.message); setLoading(false); return; }
    setPartyTypes((ptRes.data ?? []) as PartyTypeOpt[]);
    setParties((pRes.data ?? []) as PartyOpt[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setModeLedgers(((mRes.data ?? []) as any[]).map((l) => ({
      id: l.id, code: l.code, name: l.name,
      type_name: l.ledger_type?.name as 'BANK' | 'CASH',
    })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // Narrow the Party dropdown by the picked Party type.
  const filteredParties = useMemo(() => {
    if (!partyTypeId) return parties;
    const id = Number(partyTypeId);
    return parties.filter((p) =>
      Array.isArray(p.party_type_ids) && p.party_type_ids.includes(id),
    );
  }, [parties, partyTypeId]);

  useEffect(() => {
    if (partyId && !filteredParties.some((p) => String(p.id) === partyId)) {
      setPartyId('');
    }
  }, [filteredParties, partyId]);

  // Pull every payment that passes the filters. Default view (no
  // party picked) shows every recorded transaction across every
  // party in chronological order. Filters narrow the list:
  //   - party (single)        ➜ classic ledger view with running balance
  //   - party type (multiple) ➜ all parties of that type
  //   - date from/to          ➜ time window
  // The party FK is joined back so the operator can see who each
  // payment was for when no specific party is picked.
  useEffect(() => {
    setPmtLoading(true);
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      let q = sb.from('payment')
        .select(
          'id, payment_no, payment_date, direction, amount, mode, mode_ledger_id, ' +
          'mode_ledger:mode_ledger_id ( id, name ), reference, notes, party_id, ' +
          'party:party_id ( id, code, name, party_type_ids )'
        )
        .eq('status', 'active')
        // Hide synthetic payments — they're internal plumbing for
        // credit-note and customer-fabric-adjustment allocations.
        // The customer-facing document (the credit note invoice or
        // the fabric_purchase row) is already in the ledger via
        // billTxns, so including the synthetic payment would
        // double-count the same money movement.
        .not('mode', 'in', '(credit_note,fabric_adjustment)');

      if (partyId) {
        q = q.eq('party_id', Number(partyId));
      } else if (partyTypeId) {
        // Filter to parties of the picked type. If the type matches
        // no parties (rare), short-circuit to an empty list rather
        // than fetching every payment.
        const ids = filteredParties.map((p) => p.id);
        if (ids.length === 0) { setPayments([]); setPmtLoading(false); return; }
        q = q.in('party_id', ids);
      }
      if (dateFrom) q = q.gte('payment_date', dateFrom);
      if (dateTo)   q = q.lte('payment_date', dateTo);

      // When a single party is picked, sort oldest -> newest so the
      // running balance accumulates from the bottom up. Otherwise
      // sort newest -> oldest so the operator sees the latest
      // transactions first.
      q = q
        .order('payment_date', { ascending: partyId !== '' })
        .order('id',           { ascending: partyId !== '' });

      const { data, error: err } = await q;
      if (err) { setError(err.message); setPmtLoading(false); return; }
      setPayments((data ?? []) as PaymentRow[]);
      setPmtLoading(false);
    })();
  }, [partyId, partyTypeId, dateFrom, dateTo, filteredParties, supabase, refreshTick]);

  // ── Fetch bills (non-payment ledger rows) ────────────────────────
  // Runs in two modes:
  //   - single-party  (partyId set)  → filter every source by that party
  //   - all-parties   (partyId blank) → fetch every active bill in the
  //                                      window (date-filtered) so the
  //                                      all-payments view can mix in
  //                                      sales / purchase / opening
  //                                      bills alongside the payments.
  // Each row carries a party_label so the all-view can show who the
  // transaction belongs to.
  useEffect(() => {
    void (async () => {
      const hasParty = partyId !== '';
      const pid = hasParty ? Number(partyId) : null;
      const party = pid !== null ? parties.find((p) => p.id === pid) : undefined;
      if (hasParty && !party) { setBillTxns([]); return; }

      // Lookup helpers for the all-view party label.
      const partyById = new Map<number, PartyOpt>();
      for (const p of parties) partyById.set(p.id, p);
      const labelFor = (id: number | null | undefined): string =>
        id != null ? (partyById.get(id)?.name ?? `#${id}`) : '—';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;

      // Build the six source queries — in single-party mode they're
      // narrowed by the relevant party FK / name; in all-view they
      // hit every row, ordered newest first with a soft cap so the
      // page doesn't drown in 10k rows.
      const LIMIT = hasParty ? 1000 : 500;

      let invQ  = sb.from('invoice')
        .select('id, invoice_no, invoice_date, doc_type, total, status, party_name, customer_id, jobwork_party_id')
        .neq('status', 'cancelled');
      if (hasParty) invQ = invQ.ilike('party_name', party!.name);
      invQ = invQ
        .order('invoice_date', { ascending: !hasParty ? false : true })
        .limit(LIMIT);

      let openQ = sb.from('party_opening_ledger')
        .select('id, invoice_no, invoice_date, direction, amount, party_id')
        .eq('status', 'active');
      if (hasParty) openQ = openQ.eq('party_id', pid!);
      openQ = openQ.limit(LIMIT);

      let sizQ  = sb.from('sizing_job')
        .select('id, bill_no, bill_date, total_amount, party_id')
        .not('bill_no', 'is', null);
      if (hasParty) sizQ = sizQ.eq('party_id', pid!);
      sizQ = sizQ.limit(LIMIT);

      let bobQ  = sb.from('bobbin_purchase')
        .select('id, invoice_no, purchase_date, total_amount, vendor_id');
      if (hasParty) bobQ = bobQ.eq('vendor_id', pid!);
      bobQ = bobQ.limit(LIMIT);

      let yarnQ = sb.from('yarn_lot')
        .select('id, lot_code, invoice_no, received_date, total_amount, supplier_party_id');
      if (hasParty) yarnQ = yarnQ.eq('supplier_party_id', pid!);
      yarnQ = yarnQ.limit(LIMIT);

      // Supplier-mode fabric resale only — customer-adjustment rows
      // are already captured by their synthetic payment row.
      let fabQ  = sb.from('fabric_purchase')
        .select('id, code, invoice_no, received_date, total_amount, supplier_party_id')
        .eq('source', 'supplier')
        .eq('status', 'active');
      if (hasParty) fabQ = fabQ.eq('supplier_party_id', pid!);
      fabQ = fabQ.limit(LIMIT);

      const [invRes, openRes, sizRes, bobRes, yarnRes, fabRes] = await Promise.all([
        invQ, openQ, sizQ, bobQ, yarnQ, fabQ,
      ]);

      const txns: LedgerTxn[] = [];

      // Resolve invoice → party.id via party_name match (the invoice
      // table stamps party_name as text, not party.id).
      const partyByUpperName = new Map<string, PartyOpt>();
      for (const p of parties) partyByUpperName.set(p.name.trim().toUpperCase(), p);

      // Invoices — direction depends on doc_type.
      for (const r of ((invRes.data ?? []) as Array<{
        id: number; invoice_no: string; invoice_date: string;
        doc_type: string; total: number | string; status: string;
        party_name: string | null;
      }>)) {
        const total = Number(r.total ?? 0);
        const isCredit = r.doc_type === 'credit_note';
        const lookup = r.party_name ? partyByUpperName.get(r.party_name.trim().toUpperCase()) : undefined;
        txns.push({
          key:        `inv-${r.id}`,
          source_id:  r.id,
          kind:       r.doc_type === 'credit_note' ? 'credit_note'
                    : r.doc_type === 'debit_note'  ? 'debit_note'
                    : r.doc_type === 'jobwork_invoice' || r.doc_type === 'weaving_bill' ? 'jobwork_bill'
                    : 'sale_invoice',
          date:       r.invoice_date,
          voucher_no: r.invoice_no,
          description: DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type,
          debit:      isCredit ? 0 : total,
          credit:     isCredit ? total : 0,
          href:       `/app/invoices/${r.id}`,
          party_label:  r.party_name ?? '—',
          party_link_id: lookup?.id ?? null,
        });
      }

      // Opening ledger
      for (const r of ((openRes.data ?? []) as Array<{
        id: number; invoice_no: string; invoice_date: string;
        direction: string; amount: number | string; party_id: number | null;
      }>)) {
        const amt = Number(r.amount ?? 0);
        const isReceivable = r.direction === 'receivable';
        txns.push({
          key:        `open-${r.id}`,
          source_id:  r.id,
          kind:       isReceivable ? 'opening_receivable' : 'opening_payable',
          date:       r.invoice_date,
          voucher_no: r.invoice_no,
          description: isReceivable ? 'Opening (Receivable)' : 'Opening (Payable)',
          debit:      isReceivable ? amt : 0,
          credit:     isReceivable ? 0   : amt,
          party_label:  labelFor(r.party_id),
          party_link_id: r.party_id,
        });
      }

      // Sizing — we always owe the sizing mill.
      for (const r of ((sizRes.data ?? []) as Array<{
        id: number; bill_no: string | null; bill_date: string | null;
        total_amount: number | string; party_id: number | null;
      }>)) {
        const total = Number(r.total_amount ?? 0);
        if (total <= 0) continue;
        txns.push({
          key:        `siz-${r.id}`,
          source_id:  r.id,
          kind:       'sizing_bill',
          date:       r.bill_date ?? '',
          voucher_no: r.bill_no ?? `SZ-${r.id}`,
          description: 'Sizing Bill',
          debit:      0,
          credit:     total,
          href:       `/app/sizing/${r.id}`,
          party_label:  labelFor(r.party_id),
          party_link_id: r.party_id,
        });
      }

      // Bobbin purchase — we always owe the supplier.
      for (const r of ((bobRes.data ?? []) as Array<{
        id: number; invoice_no: string | null; purchase_date: string | null;
        total_amount: number | string; vendor_id: number | null;
      }>)) {
        const total = Number(r.total_amount ?? 0);
        if (total <= 0) continue;
        txns.push({
          key:        `bob-${r.id}`,
          source_id:  r.id,
          kind:       'bobbin_purchase',
          date:       r.purchase_date ?? '',
          voucher_no: r.invoice_no ?? `BB-${r.id}`,
          description: 'Bobbin Purchase',
          debit:      0,
          credit:     total,
          party_label:  labelFor(r.vendor_id),
          party_link_id: r.vendor_id,
        });
      }

      // Yarn purchase
      for (const r of ((yarnRes.data ?? []) as Array<{
        id: number; lot_code: string | null; invoice_no: string | null;
        received_date: string | null; total_amount: number | string;
        supplier_party_id: number | null;
      }>)) {
        const total = Number(r.total_amount ?? 0);
        if (total <= 0) continue;
        txns.push({
          key:        `yarn-${r.id}`,
          source_id:  r.id,
          kind:       'yarn_purchase',
          date:       r.received_date ?? '',
          voucher_no: r.invoice_no ?? r.lot_code ?? `YL-${r.id}`,
          description: 'Yarn Purchase',
          debit:      0,
          credit:     total,
          party_label:  labelFor(r.supplier_party_id),
          party_link_id: r.supplier_party_id,
        });
      }

      // Fabric resale purchases (supplier mode) — we always owe the
      // supplier.
      for (const r of ((fabRes?.data ?? []) as Array<{
        id: number; code: string; invoice_no: string | null;
        received_date: string | null; total_amount: number | string;
        supplier_party_id: number | null;
      }>)) {
        const total = Number(r.total_amount ?? 0);
        if (total <= 0) continue;
        txns.push({
          key:        `fab-${r.id}`,
          source_id:  r.id,
          kind:       'fabric_purchase',
          date:       r.received_date ?? '',
          voucher_no: r.invoice_no ?? r.code ?? `FP-${r.id}`,
          description: 'Fabric Purchase',
          debit:      0,
          credit:     total,
          href:       '/app/fabric-stock',
          party_label:  labelFor(r.supplier_party_id),
          party_link_id: r.supplier_party_id,
        });
      }

      // Apply date filters client-side so we don't re-issue queries
      // per filter change.
      const filtered = txns.filter((t) => {
        if (dateFrom && t.date < dateFrom) return false;
        if (dateTo   && t.date > dateTo)   return false;
        return true;
      });
      setBillTxns(filtered);
    })();
  }, [partyId, parties, dateFrom, dateTo, supabase, refreshTick]);

  // ── Edit / delete handlers ───────────────────────────────────────
  /** Open the inline edit form pre-filled from the given row. */
  function startEdit(p: PaymentRow): void {
    setEditingId(p.id);
    setEditDate(p.payment_date);
    setEditLedger(p.mode_ledger_id != null ? String(p.mode_ledger_id) : '');
    setEditRef(p.reference ?? '');
    setEditNotes(p.notes ?? '');
    setError(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditDate(''); setEditLedger(''); setEditRef(''); setEditNotes('');
  }

  async function saveEdit(id: number): Promise<void> {
    setError(null);
    if (!editDate) { setError('Payment date cannot be empty.'); return; }
    setBusyRowId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Only safe-to-change fields: date, mode_ledger, reference, notes.
    // Amount / party / direction are intentionally NOT editable here
    // because they have flow-on effects (allocations, ledger balances)
    // that need a different UX to handle cleanly. To change those,
    // delete and re-record the payment.
    const payload: Record<string, unknown> = {
      payment_date:   editDate,
      mode_ledger_id: editLedger === '' ? null : Number(editLedger),
      reference:      editRef.trim() === '' ? null : editRef.trim(),
      notes:          editNotes.trim() === '' ? null : editNotes.trim(),
    };
    const { error: err } = await sb.from('payment').update(payload).eq('id', id);
    setBusyRowId(null);
    if (err) { setError(err.message); return; }
    cancelEdit();
    setRefreshTick((t) => t + 1);
  }

  async function deletePayment(p: PaymentRow): Promise<void> {
    const msg =
      `Delete payment ${p.payment_no}?\n\n` +
      `Amount: ₹${fmtINR(p.amount)} (${p.direction === 'in' ? 'inflow' : 'outflow'})\n` +
      `Date:   ${fmtDate(p.payment_date)}\n\n` +
      `Any bill adjustments tied to this payment will also be removed and the affected bills' balances will be restored.`;
    if (!window.confirm(msg)) return;
    setBusyRowId(p.id);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('payment').delete().eq('id', p.id);
    setBusyRowId(null);
    if (err) { setError(err.message); return; }
    setRefreshTick((t) => t + 1);
  }

  // Change a payment's amount (or its bill allocations). Amount is NOT
  // editable in place because it drives every linked bill's balance via
  // DB triggers; a half-applied amount edit would silently corrupt the
  // reconciliation. Instead we delete the payment — which cleanly reverses
  // all its bill adjustments and restores those balances — then bounce to
  // the New Payment tab pre-filled with the old details so the operator
  // re-records it with the corrected amount, re-ticking the now-restored
  // bills against the same proven allocation engine.
  async function reRecord(p: PaymentRow): Promise<void> {
    const msg =
      `Change the amount of ${p.payment_no}?\n\n` +
      `The amount can't be edited on the spot because it's tied to the ` +
      `bill balances it settled. We'll remove this payment (restoring those ` +
      `bills) and reopen it in the New Payment form, pre-filled, so you can ` +
      `enter the correct amount and re-tick the bills.\n\n` +
      `Current: ₹${fmtINR(p.amount)} (${p.direction === 'in' ? 'inflow' : 'outflow'}), ${fmtDate(p.payment_date)}\n\n` +
      `Continue?`;
    if (!window.confirm(msg)) return;
    setBusyRowId(p.id);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('payment').delete().eq('id', p.id);
    if (err) { setBusyRowId(null); setError(err.message); return; }
    const params = new URLSearchParams();
    params.set('tab', 'new');
    params.set('redo', p.payment_no);
    params.set('direction', p.direction);
    if (p.party_id != null)      params.set('party',  String(p.party_id));
    params.set('amount', String(p.amount));
    params.set('pdate', p.payment_date);
    if (p.mode_ledger_id != null) params.set('ledger', String(p.mode_ledger_id));
    if (p.reference)             params.set('ref',    p.reference);
    if (p.notes)                 params.set('pnotes', p.notes);
    router.push(`${pathname}?${params.toString()}`);
  }

  // When a single party is picked, compose the unified statement-of-
  // account: every sales / purchase / sizing / bobbin / yarn bill +
  // every payment, sorted oldest -> newest, with a running balance.
  //
  // Convention (Indian Tally style):
  //   Debit (Dr)  -> party owes us more (or we paid them, reducing
  //                  what we owed them)
  //   Credit (Cr) -> we owe party more  (or they paid us, reducing
  //                  what they owed us)
  //   running balance = sum(debit) - sum(credit)
  //     > 0 -> party is a debtor (Dr)
  //     < 0 -> party is a creditor (Cr)
  const ledger = useMemo<Array<LedgerTxn & { balance: number }>>(() => {
    // Map each payment row to a LedgerTxn. For the all-view we also
    // stamp the party_label so each row can show whose payment it was.
    const partyById = new Map<number, PartyOpt>();
    for (const p of parties) partyById.set(p.id, p);
    const paymentTxns: LedgerTxn[] = payments.map((p) => {
      const amt = Number(p.amount);
      const isIn = p.direction === 'in';
      const modeLabel = p.mode_ledger?.name ?? (p.mode ?? '').replace('_', ' ') ?? '';
      return {
        key:         `pmt-${p.id}`,
        source_id:   p.id,
        kind:        isIn ? 'payment_in' : 'payment_out',
        date:        p.payment_date,
        voucher_no:  p.payment_no,
        description: (isIn ? 'Receipt' : 'Payment') + (modeLabel ? ` — ${modeLabel}` : ''),
        debit:       isIn ? 0   : amt,
        credit:      isIn ? amt : 0,
        payment:     p,
        party_label:  p.party?.name ?? (p.party_id ? partyById.get(p.party_id)?.name : null) ?? '—',
        party_link_id: p.party_id,
      };
    });
    // Combine with the bill side, sort by date. Single-party view:
    // oldest first so the running balance builds from the top.
    // All-view: newest first so the latest activity is on top.
    const merged = [...billTxns, ...paymentTxns].sort((a, b) => {
      const dc = (a.date ?? '').localeCompare(b.date ?? '');
      const cmp = partyId !== '' ? dc : -dc;
      return cmp !== 0 ? cmp : (partyId !== '' ? a.source_id - b.source_id : b.source_id - a.source_id);
    });
    // Running balance only makes sense for one party. All-view rows
    // get balance=0 (the column isn't shown there anyway).
    if (partyId === '') return merged.map((t) => ({ ...t, balance: 0 }));
    let running = 0;
    return merged.map((t) => {
      running += t.debit - t.credit;
      return { ...t, balance: running };
    });
  }, [partyId, payments, billTxns, parties]);

  const totals = useMemo(() => {
    let inflow = 0, outflow = 0, debit = 0, credit = 0;
    for (const p of payments) {
      const amt = Number(p.amount);
      if (p.direction === 'in')  inflow  += amt;
      else                       outflow += amt;
    }
    for (const t of ledger) {
      debit  += t.debit;
      credit += t.credit;
    }
    return {
      inflow, outflow,
      balance: inflow - outflow,
      debit,   credit,
      ledgerBalance: debit - credit,
      // Count reflects the full ledger (bills + payments) so the
      // header "N transactions" line is honest about everything the
      // operator can see below — not just the payment rows.
      count: partyId !== '' ? ledger.length : payments.length,
    };
  }, [payments, ledger, partyId]);

  const partyName = useMemo(() => {
    const p = parties.find((x) => String(x.id) === partyId);
    return p ? `${p.code} — ${p.name}` : '';
  }, [parties, partyId]);

  const showLedger = partyId !== '';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="label">Party type</label>
          <select className="input" value={partyTypeId} onChange={(e) => setPartyTypeId(e.target.value)}>
            <option value="">All types</option>
            {partyTypes.map((pt) => (
              <option key={pt.id} value={pt.id}>{pt.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Party</label>
          <SearchSelect
            options={filteredParties.map((p): SearchSelectOption => ({
              value: String(p.id),
              label: `${p.code} — ${p.name}`,
            }))}
            value={partyId}
            onChange={setPartyId}
            placeholder="All parties — type to filter…"
          />
        </div>
        <div>
          <label className="label">From date</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            max={dateTo || undefined}
          />
        </div>
        <div>
          <label className="label">To date</label>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            min={dateFrom || undefined}
          />
        </div>
        {(partyTypeId || partyId || dateFrom || dateTo) && (
          <div className="md:col-span-4 flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-ink-mute">
              Showing {totals.count.toLocaleString('en-IN')} transaction{totals.count === 1 ? '' : 's'}
              {showLedger ? ` for ${partyName}` : ''}.
            </span>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => { setPartyTypeId(''); setPartyId(''); setDateFrom(''); setDateTo(''); }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {error && <div className="card p-3 text-sm text-err">{error}</div>}

      {loading || pmtLoading ? (
        <div className="card p-6 flex items-center gap-2 text-sm text-ink-mute">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (showLedger ? ledger.length === 0 : payments.length === 0) ? (
        // Empty state — for the single-party ledger view we check the
        // unified ledger length (bills + payments), not just payments,
        // because a party can have bill activity (invoices, openings,
        // sizing, etc.) without any payment rows yet.
        <div className="card p-6 text-sm text-ink-soft">
          {showLedger ? (
            <>No transactions for this party in the current window. Try widening the date filters, or record a payment from the New Payment tab.</>
          ) : (
            <>No payments found. Try widening the filters, or record a payment from the New Payment tab.</>
          )}
        </div>
      ) : showLedger ? (
        // Ledger view — single party, running balance.
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/40 bg-cloud/40">
            <div className="text-xs uppercase tracking-wider text-ink-mute">Ledger for</div>
            <div className="font-semibold text-ink">{partyName}</div>
          </div>
          <div className="md:hidden p-3 space-y-2">
            {ledger.map((r) => {
              const isPayment = r.kind === 'payment_in' || r.kind === 'payment_out';
              const isEditing = isPayment && editingId === r.source_id;
              const isBusy    = isPayment && busyRowId === r.source_id;
              return (
                <div key={r.key} className={cn('card p-3', isEditing && 'ring-1 ring-indigo-200')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-ink-soft">{r.voucher_no}</div>
                      <div className={cn('text-sm break-words', isPayment ? 'text-ink' : 'text-ink-soft')}>
                        {r.description}
                        {r.payment?.reference && <span className="text-[10px] text-ink-mute"> · {r.payment.reference}</span>}
                      </div>
                    </div>
                    <div className="text-[11px] text-ink-soft whitespace-nowrap shrink-0">{fmtDate(r.date)}</div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2 text-xs">
                    <div className="flex gap-3">
                      {r.debit > 0 && <span className="num text-emerald-700">Dr {fmtINR(r.debit)}</span>}
                      {r.credit > 0 && <span className="num text-rose-700">Cr {fmtINR(r.credit)}</span>}
                    </div>
                    <span className={cn(
                      'num font-semibold whitespace-nowrap',
                      r.balance > 0 ? 'text-emerald-700' : r.balance < 0 ? 'text-rose-700' : 'text-ink-soft',
                    )}>
                      {fmtINR(Math.abs(r.balance))}{' '}
                      <span className="text-[10px] font-normal">
                        {r.balance > 0.005 ? 'Dr' : r.balance < -0.005 ? 'Cr' : ''}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin text-ink-mute" />
                    ) : isEditing ? (
                      <button type="button" onClick={cancelEdit} className="btn-ghost text-xs" title="Cancel">
                        <X className="w-3.5 h-3.5" /> Cancel
                      </button>
                    ) : isPayment && r.payment ? (
                      <>
                        <button type="button" onClick={() => startEdit(r.payment as PaymentRow)} className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50" title="Edit date / ledger / reference / notes">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => void reRecord(r.payment as PaymentRow)} className="p-1.5 rounded text-amber-600 hover:bg-amber-50" title="Change amount / re-allocate (reopens in New Payment)">
                          <IndianRupee className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => void deletePayment(r.payment as PaymentRow)} className="p-1.5 rounded text-rose-600 hover:bg-rose-50" title="Delete payment (will restore affected bill balances)">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : r.href ? (
                      <Link href={r.href} className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50 inline-flex items-center gap-1 text-xs" title="View source bill">
                        <ExternalLink className="w-4 h-4" /> View bill
                      </Link>
                    ) : null}
                  </div>
                  {isEditing && r.payment && (
                    <div className="mt-3 pt-3 border-t border-indigo-100">
                      <PaymentEditFields
                        date={editDate}        setDate={setEditDate}
                        ledger={editLedger}    setLedger={setEditLedger}
                        ref_={editRef}         setRef={setEditRef}
                        notes={editNotes}      setNotes={setEditNotes}
                        modeLedgers={modeLedgers}
                        busy={isBusy}
                        onSave={() => void saveEdit(r.source_id)}
                        onCancel={cancelEdit}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left  px-3 py-3">Date</th>
                  <th className="text-left  px-3 py-3">Voucher</th>
                  <th className="text-left  px-3 py-3">Particulars</th>
                  <th className="text-right px-3 py-3">Debit (₹)</th>
                  <th className="text-right px-3 py-3">Credit (₹)</th>
                  <th className="text-right px-3 py-3">Balance (₹)</th>
                  <th className="text-right px-3 py-3 w-[100px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => {
                  const isPayment = r.kind === 'payment_in' || r.kind === 'payment_out';
                  const isEditing = isPayment && editingId === r.source_id;
                  const isBusy    = isPayment && busyRowId === r.source_id;
                  return (
                    <React.Fragment key={r.key}>
                      <tr className={cn('border-t border-line/40', isEditing ? 'bg-indigo-50/30' : 'hover:bg-haze/60')}>
                        <td className="px-3 py-3 text-ink-soft whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="px-3 py-3 font-mono text-xs">{r.voucher_no}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              isPayment ? 'text-ink' : 'text-ink-soft',
                            )}>
                              {r.description}
                            </span>
                            {r.payment?.reference && (
                              <span className="text-[10px] text-ink-mute">· {r.payment.reference}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right num text-emerald-700">
                          {r.debit > 0 ? fmtINR(r.debit) : '-'}
                        </td>
                        <td className="px-3 py-3 text-right num text-rose-700">
                          {r.credit > 0 ? fmtINR(r.credit) : '-'}
                        </td>
                        <td className={cn(
                          'px-3 py-3 text-right num font-semibold whitespace-nowrap',
                          r.balance > 0 ? 'text-emerald-700' : r.balance < 0 ? 'text-rose-700' : 'text-ink-soft',
                        )}>
                          {fmtINR(Math.abs(r.balance))}
                          {' '}
                          <span className="text-[10px] font-normal">
                            {r.balance > 0.005 ? 'Dr' : r.balance < -0.005 ? 'Cr' : ''}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {isBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin inline-block text-ink-mute" />
                          ) : isEditing ? (
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="p-1 rounded text-ink-mute hover:bg-haze/60"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : isPayment && r.payment ? (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(r.payment as PaymentRow)}
                                className="p-1 rounded text-indigo-600 hover:bg-indigo-50"
                                title="Edit date / ledger / reference / notes"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void reRecord(r.payment as PaymentRow)}
                                className="p-1 rounded text-amber-600 hover:bg-amber-50 ml-1"
                                title="Change amount / re-allocate (reopens in New Payment)"
                              >
                                <IndianRupee className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void deletePayment(r.payment as PaymentRow)}
                                className="p-1 rounded text-rose-600 hover:bg-rose-50 ml-1"
                                title="Delete payment (will restore affected bill balances)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : r.href ? (
                            <Link
                              href={r.href}
                              className="p-1 rounded text-indigo-600 hover:bg-indigo-50 inline-block"
                              title="View source bill"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                          ) : (
                            <span className="text-[10px] text-ink-mute">—</span>
                          )}
                        </td>
                      </tr>
                      {isEditing && r.payment && (
                        <tr className="bg-indigo-50/20 border-t border-indigo-100">
                          <td colSpan={7} className="px-3 py-3">
                            <PaymentEditFields
                              date={editDate}        setDate={setEditDate}
                              ledger={editLedger}    setLedger={setEditLedger}
                              ref_={editRef}         setRef={setEditRef}
                              notes={editNotes}      setNotes={setEditNotes}
                              modeLedgers={modeLedgers}
                              busy={isBusy}
                              onSave={() => void saveEdit(r.source_id)}
                              onCancel={cancelEdit}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line/60 bg-cloud/30 font-bold">
                  <td className="px-3 py-3" colSpan={3}>Totals</td>
                  <td className="px-3 py-3 text-right num text-emerald-700">{fmtINR(totals.debit)}</td>
                  <td className="px-3 py-3 text-right num text-rose-700">{fmtINR(totals.credit)}</td>
                  <td className={cn(
                    'px-3 py-3 text-right num text-base whitespace-nowrap',
                    totals.ledgerBalance > 0 ? 'text-emerald-700' : totals.ledgerBalance < 0 ? 'text-rose-700' : 'text-ink-soft',
                  )}>
                    {fmtINR(Math.abs(totals.ledgerBalance))}
                    {' '}
                    <span className="text-[10px] font-normal">
                      {totals.ledgerBalance > 0.005 ? 'Dr' : totals.ledgerBalance < -0.005 ? 'Cr' : ''}
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-line/40 bg-cloud/20 text-[11px] text-ink-mute">
            <span className="font-semibold text-emerald-700">Dr</span> = party owes you (debtor) ·{' '}
            <span className="font-semibold text-rose-700">Cr</span> = you owe the party (creditor).
            Sales / jobwork bills + payments out debit the party; purchases (sizing, bobbin, yarn) + payments in credit them.
            Sorted oldest → newest.
          </div>
        </div>
      ) : (
        // All-payments view — chronological across every party.
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/40 bg-cloud/40 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-mute">All payments</div>
              <div className="font-semibold text-ink">
                {totals.count.toLocaleString('en-IN')} transaction{totals.count === 1 ? '' : 's'}
                {partyTypeId && (
                  <span className="ml-2 text-xs font-normal text-ink-soft">
                    · {(partyTypes.find((pt) => String(pt.id) === partyTypeId)?.name) ?? ''}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div>
                <span className="text-ink-mute">Debit:</span>{' '}
                <span className="font-semibold text-emerald-700 num">₹ {fmtINR(totals.debit)}</span>
              </div>
              <div>
                <span className="text-ink-mute">Credit:</span>{' '}
                <span className="font-semibold text-rose-700 num">₹ {fmtINR(totals.credit)}</span>
              </div>
              <div>
                <span className="text-ink-mute">Net:</span>{' '}
                <span className={cn(
                  'font-semibold num',
                  totals.ledgerBalance > 0 ? 'text-emerald-700' : totals.ledgerBalance < 0 ? 'text-rose-700' : 'text-ink-soft',
                )}>
                  ₹ {fmtINR(Math.abs(totals.ledgerBalance))}{' '}
                  <span className="text-[10px] font-normal">
                    {totals.ledgerBalance > 0.005 ? 'Dr' : totals.ledgerBalance < -0.005 ? 'Cr' : ''}
                  </span>
                </span>
              </div>
            </div>
          </div>
          <div className="md:hidden p-3 space-y-2">
            {ledger.map((r) => {
              const isPayment = r.kind === 'payment_in' || r.kind === 'payment_out';
              const isEditing = isPayment && editingId === r.source_id;
              const isBusy    = isPayment && busyRowId === r.source_id;
              return (
                <div key={r.key} className={cn('card p-3', isEditing && 'ring-1 ring-indigo-200')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-ink-soft">{r.voucher_no}</div>
                      {r.party_link_id != null ? (
                        <Link href={`/app/payments?party=${r.party_link_id}`} className="font-semibold text-ink hover:text-indigo hover:underline break-words">
                          {r.party_label ?? '—'}
                        </Link>
                      ) : (
                        <span className={cn('font-semibold break-words', r.party_label ? 'text-ink' : 'text-ink-mute italic')}>
                          {r.party_label ?? '—'}
                        </span>
                      )}
                      <div className="text-xs text-ink-soft break-words">
                        {r.description}
                        {r.payment?.reference && <span className="text-ink-mute"> · {r.payment.reference}</span>}
                      </div>
                    </div>
                    <div className="text-[11px] text-ink-soft whitespace-nowrap shrink-0">{fmtDate(r.date)}</div>
                  </div>
                  <div className="flex gap-3 mt-2 text-xs">
                    {r.debit > 0 && <span className="num text-emerald-700">Dr {fmtINR(r.debit)}</span>}
                    {r.credit > 0 && <span className="num text-rose-700">Cr {fmtINR(r.credit)}</span>}
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin text-ink-mute" />
                    ) : isEditing ? (
                      <button type="button" onClick={cancelEdit} className="btn-ghost text-xs" title="Cancel">
                        <X className="w-3.5 h-3.5" /> Cancel
                      </button>
                    ) : isPayment && r.payment ? (
                      <>
                        <button type="button" onClick={() => startEdit(r.payment as PaymentRow)} className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50" title="Edit date / ledger / reference / notes">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => void reRecord(r.payment as PaymentRow)} className="p-1.5 rounded text-amber-600 hover:bg-amber-50" title="Change amount / re-allocate (reopens in New Payment)">
                          <IndianRupee className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => void deletePayment(r.payment as PaymentRow)} className="p-1.5 rounded text-rose-600 hover:bg-rose-50" title="Delete payment (restores affected bill balances)">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : r.href ? (
                      <Link href={r.href} className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50 inline-flex items-center gap-1 text-xs" title="View source bill">
                        <ExternalLink className="w-4 h-4" /> View bill
                      </Link>
                    ) : null}
                  </div>
                  {isEditing && r.payment && (
                    <div className="mt-3 pt-3 border-t border-indigo-100">
                      <PaymentEditFields
                        date={editDate}        setDate={setEditDate}
                        ledger={editLedger}    setLedger={setEditLedger}
                        ref_={editRef}         setRef={setEditRef}
                        notes={editNotes}      setNotes={setEditNotes}
                        modeLedgers={modeLedgers}
                        busy={isBusy}
                        onSave={() => void saveEdit(r.source_id)}
                        onCancel={cancelEdit}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left  px-3 py-3">Date</th>
                  <th className="text-left  px-3 py-3">Voucher</th>
                  <th className="text-left  px-3 py-3">Party</th>
                  <th className="text-left  px-3 py-3 hidden md:table-cell">Particulars</th>
                  <th className="text-right px-3 py-3">Debit (₹)</th>
                  <th className="text-right px-3 py-3">Credit (₹)</th>
                  <th className="text-right px-3 py-3 w-[100px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => {
                  const isPayment = r.kind === 'payment_in' || r.kind === 'payment_out';
                  const isEditing = isPayment && editingId === r.source_id;
                  const isBusy    = isPayment && busyRowId === r.source_id;
                  return (
                    <React.Fragment key={r.key}>
                      <tr className={cn('border-t border-line/40', isEditing ? 'bg-indigo-50/30' : 'hover:bg-haze/60')}>
                        <td className="px-3 py-3 text-ink-soft whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="px-3 py-3 font-mono text-xs">{r.voucher_no}</td>
                        <td className="px-3 py-3">
                          {r.party_link_id != null ? (
                            <Link
                              href={`/app/payments?party=${r.party_link_id}`}
                              className="text-ink hover:text-indigo hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.party_label ?? '—'}
                            </Link>
                          ) : (
                            <span className={r.party_label ? 'text-ink' : 'text-ink-mute italic'}>
                              {r.party_label ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell text-xs text-ink-soft">
                          {r.description}
                          {r.payment?.reference && <span className="ml-1 text-ink-mute">· {r.payment.reference}</span>}
                        </td>
                        <td className="px-3 py-3 text-right num text-emerald-700">
                          {r.debit > 0 ? fmtINR(r.debit) : '-'}
                        </td>
                        <td className="px-3 py-3 text-right num text-rose-700">
                          {r.credit > 0 ? fmtINR(r.credit) : '-'}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {isBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin inline-block text-ink-mute" />
                          ) : isEditing ? (
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="p-1 rounded text-ink-mute hover:bg-haze/60"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : isPayment && r.payment ? (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(r.payment as PaymentRow)}
                                className="p-1 rounded text-indigo-600 hover:bg-indigo-50"
                                title="Edit date / ledger / reference / notes"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void reRecord(r.payment as PaymentRow)}
                                className="p-1 rounded text-amber-600 hover:bg-amber-50 ml-1"
                                title="Change amount / re-allocate (reopens in New Payment)"
                              >
                                <IndianRupee className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void deletePayment(r.payment as PaymentRow)}
                                className="p-1 rounded text-rose-600 hover:bg-rose-50 ml-1"
                                title="Delete payment (restores affected bill balances)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : r.href ? (
                            <Link
                              href={r.href}
                              className="p-1 rounded text-indigo-600 hover:bg-indigo-50 inline-block"
                              title="View source bill"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                          ) : (
                            <span className="text-[10px] text-ink-mute">—</span>
                          )}
                        </td>
                      </tr>
                      {isEditing && r.payment && (
                        <tr className="bg-indigo-50/20 border-t border-indigo-100">
                          <td colSpan={7} className="px-3 py-3">
                            <PaymentEditFields
                              date={editDate}        setDate={setEditDate}
                              ledger={editLedger}    setLedger={setEditLedger}
                              ref_={editRef}         setRef={setEditRef}
                              notes={editNotes}      setNotes={setEditNotes}
                              modeLedgers={modeLedgers}
                              busy={isBusy}
                              onSave={() => void saveEdit(r.source_id)}
                              onCancel={cancelEdit}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line/60 bg-cloud/30 font-bold">
                  <td className="px-3 py-3" colSpan={4}>Totals</td>
                  <td className="px-3 py-3 text-right num text-emerald-700">{fmtINR(totals.debit)}</td>
                  <td className="px-3 py-3 text-right num text-rose-700">{fmtINR(totals.credit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-line/40 bg-cloud/20 text-[11px] text-ink-mute">
            Bills + payments across every party. Sorted newest → oldest. Click a party name to open their ledger with running balance.
            Soft-capped at the most recent 500 bills per source — use date filters to narrow.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared inline edit form (date, mode ledger, reference, notes) ──
// Amount / party / direction are deliberately NOT editable here. They
// have flow-on effects (allocations, party balances) that need a
// different UX. To change them, delete the payment and re-record.
function PaymentEditFields({
  date, setDate,
  ledger, setLedger,
  ref_, setRef,
  notes, setNotes,
  modeLedgers,
  busy,
  onSave,
  onCancel,
}: {
  date: string;       setDate:   (v: string) => void;
  ledger: string;     setLedger: (v: string) => void;
  ref_: string;       setRef:    (v: string) => void;
  notes: string;      setNotes:  (v: string) => void;
  modeLedgers: ModeLedgerOpt[];
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
      <div>
        <label className="label text-[10px]">Date</label>
        <input
          type="date"
          className="input h-8 text-xs"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label text-[10px]">Bank / Cash ledger</label>
        <select
          className="input h-8 text-xs"
          value={ledger}
          onChange={(e) => setLedger(e.target.value)}
        >
          <option value="">— None —</option>
          {modeLedgers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.type_name === 'CASH' ? '💵' : '🏦'} {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label text-[10px]">Reference</label>
        <input
          type="text"
          className="input h-8 text-xs"
          value={ref_}
          onChange={(e) => setRef(e.target.value)}
          placeholder="UTR / cheque no / UPI ref"
        />
      </div>
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="btn-primary text-xs py-1 px-3 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn-ghost text-xs py-1 px-3"
        >
          Cancel
        </button>
      </div>
      <div className="sm:col-span-6">
        <label className="label text-[10px]">Notes</label>
        <textarea
          rows={2}
          className="input text-xs"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional remarks"
        />
      </div>
    </div>
  );
}
