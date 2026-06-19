'use client';
/**
 * LedgerViewTab — chronological transaction view for a single ledger.
 *
 * Filter flow:
 *   1. Type dropdown   (CUSTOMER / SUPPLIER / BANK / CASH / WAGES / …)
 *   2. Ledger dropdown — cascades from the picked type
 *   3. Start date + End date (optional; empty = unbounded)
 *   4. Show button     — runs the query
 *
 * The result table merges ten sources in date order with a running
 * balance column. Cash side:
 *
 *   - payment         — receipts / payments to / from parties or via
 *                       BANK / CASH ledgers
 *   - wage_entry      — wages tagged to a WAGES-type ledger
 *   - expense_entry   — expenses tagged to an EXPENSES-type ledger
 *   - bank_entry      — direct bank/cash transactions tagged to a
 *                       category; rows where either side of the
 *                       contra (bank_ledger_id OR other_ledger_id)
 *                       points at this ledger are surfaced.
 *
 * Bill side (only when the ledger is linked to a party via
 * party.ledger_id):
 *
 *   - invoice              — sales invoices, jobwork/weaving bills,
 *                            credit/debit notes
 *   - party_opening_ledger — pre-ERP opening balances
 *   - sizing_job, bobbin_purchase, yarn_lot, fabric_purchase
 *                          — supplier-side payable bills
 *
 * Inflow / Outflow convention on a party-linked ledger:
 *   - Bills that GROW what the party owes us (sale invoice, debit
 *     note, opening receivable) → Inflow (running balance UP).
 *   - Bills that GROW what WE owe the party (purchases, sizing,
 *     bobbin, yarn, fabric, credit note, opening payable) → Outflow.
 *   - Receipts (payment direction='in') still count as Inflow and
 *     payments out (direction='out') as Outflow, matching the cash
 *     ledger semantic that's been on this page from day one.
 *
 * Bank entry sign convention:
 *   - When the picked ledger IS the bank/cash side (bank_ledger_id
 *     matches), direction='in' → Inflow, direction='out' → Outflow.
 *   - When the picked ledger is the OTHER (offset) side, the sign is
 *     inverted: an "out" from bank is a debit on the offset ledger,
 *     so it counts as an Inflow there ("grew" the expense/asset).
 *     direction='out' → Inflow, direction='in' → Outflow.
 */
import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LedgerOpt {
  id: number;
  code: string;
  name: string;
  type_id: number | null;
  type_name: string | null;
}

interface PaymentRow {
  id: number;
  payment_no: string;
  payment_date: string;
  direction: 'in' | 'out';
  amount: number | string;
  reference: string | null;
  notes: string | null;
  party_id: number | null;
  mode_ledger_id: number | null;
  party: { id: number; code: string; name: string } | null;
  mode_ledger: { id: number; name: string } | null;
}

// Unified ledger-entry shape used by the table. Whether the row came
// from a payment, a wage_entry, an expense_entry, or any of the six
// bill sources, we project it into this common shape so the table
// render is a single loop.
interface LedgerEntry {
  key:           string;
  source:        'payment' | 'wage' | 'expense' | 'bill' | 'bank';
  /** Sub-kind for bill rows so the pill says "sale" / "sizing" / etc.
   *  Bank rows use 'bank_in' / 'bank_out'. */
  bill_kind?:    string;
  date:          string;
  voucher:       string;
  counterparty:  string;
  mode:          string;
  reference:     string | null;
  inflow:        number;
  outflow:       number;
}

interface PartyByLedger {
  id: number;
  ledger_id: number;
}

interface Props {
  /** Pre-loaded ledger list (id, code, name, type_id, type_name)
   *  sourced server-side so the cascading dropdowns render instantly. */
  ledgers: LedgerOpt[];
}

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

export function LedgerViewTab({ ledgers }: Props): React.ReactElement {
  const supabase = createClient();

  // Cascading filter state — picked by the operator, only acted on
  // when they click Show (so changing a dropdown doesn't fire a query
  // and waste a round-trip). End date defaults to today so the
  // operator only has to pick the start date for the common "last N
  // days" question.
  const [typeId,    setTypeId]    = useState<string>('');
  const [ledgerId,  setLedgerId]  = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate,   setEndDate]   = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Result state — populated only after Show is clicked.
  const [entries,  setEntries]  = useState<LedgerEntry[]>([]);
  const [loading,  setLoading]  = useState<boolean>(false);
  const [error,    setError]    = useState<string | null>(null);
  // Snapshot of the ledger that produced the visible results, so the
  // header doesn't shift if the operator changes the dropdown without
  // clicking Show.
  const [shownLedger, setShownLedger] = useState<LedgerOpt | null>(null);
  const [hasShown, setHasShown] = useState<boolean>(false);

  // Distinct types present in the ledger list (drives the first
  // dropdown). Excluding NULL types so the operator only sees real
  // categories.
  const types = useMemo(() => {
    const map = new Map<number, string>();
    for (const l of ledgers) {
      if (l.type_id != null && l.type_name) {
        map.set(l.type_id, l.type_name);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ledgers]);

  // Cascading: ledger list filtered by the picked type.
  const filteredLedgers = useMemo(() => {
    if (!typeId) return ledgers;
    const id = Number(typeId);
    return ledgers.filter((l) => l.type_id === id);
  }, [ledgers, typeId]);

  // Drop the picked ledger when the type filter narrows it out of view.
  function onTypeChange(next: string): void {
    setTypeId(next);
    if (next) {
      const id = Number(next);
      if (ledgerId && !ledgers.some((l) => String(l.id) === ledgerId && l.type_id === id)) {
        setLedgerId('');
      }
    }
  }

  async function handleShow(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!ledgerId) { setError('Pick a ledger first.'); return; }
    if (startDate && endDate && startDate > endDate) {
      setError('Start date is after end date.');
      return;
    }

    setLoading(true);
    setHasShown(true);

    const numericId = Number(ledgerId);
    const picked = ledgers.find((l) => l.id === numericId) ?? null;
    setShownLedger(picked);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Step 1: find every party whose ledger_id == picked ledger.
    // Also pull their names so we can match invoices by party_name.
    const { data: matchingParties, error: partyErr } = await sb
      .from('party')
      .select('id, ledger_id, name')
      .eq('ledger_id', numericId);
    if (partyErr) { setError(partyErr.message); setLoading(false); return; }
    const partyRows = ((matchingParties ?? []) as Array<{ id: number; ledger_id: number; name: string }>);
    const partyIds: number[] = partyRows.map((p) => p.id);
    const partyNames: string[] = partyRows.map((p) => p.name);

    // Step 2: pull every payment that touches this ledger.
    const orParts: string[] = [`mode_ledger_id.eq.${numericId}`];
    if (partyIds.length > 0) {
      orParts.push(`party_id.in.(${partyIds.join(',')})`);
    }
    let paymentsQ = sb
      .from('payment')
      .select(`
        id, payment_no, payment_date, direction, amount, reference, notes,
        party_id, mode_ledger_id,
        party:party_id ( id, code, name ),
        mode_ledger:mode_ledger_id ( id, name )
      `)
      .eq('status', 'active')
      .or(orParts.join(','));
    if (startDate) paymentsQ = paymentsQ.gte('payment_date', startDate);
    if (endDate)   paymentsQ = paymentsQ.lte('payment_date', endDate);
    const paymentsRes = await paymentsQ;
    if (paymentsRes.error) { setError(paymentsRes.error.message); setLoading(false); return; }
    const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];

    // Step 3: wage + expense entries targeting this ledger, narrowed
    // by the same date range.
    let wagesQ = sb.from('wage_entry')
      .select('id, pay_date, amount, kind, notes, employee:employee_id ( full_name )')
      .eq('target_ledger_id', numericId);
    if (startDate) wagesQ = wagesQ.gte('pay_date', startDate);
    if (endDate)   wagesQ = wagesQ.lte('pay_date', endDate);

    let expensesQ = sb.from('expense_entry')
      .select('id, pay_date, amount, category, notes')
      .eq('target_ledger_id', numericId);
    if (startDate) expensesQ = expensesQ.gte('pay_date', startDate);
    if (endDate)   expensesQ = expensesQ.lte('pay_date', endDate);

    // Bank entries — pull rows where this ledger is either the bank
    // side (bank_ledger_id) or the contra/offset side (other_ledger_id).
    // The sign of the inflow/outflow projection depends on which side
    // matches; see the projection loop below.
    let bankQ = sb.from('bank_entry')
      .select(`
        id, entry_no, entry_date, direction, amount, mode, reference, notes,
        status, bank_ledger_id, other_ledger_id, category_id,
        bank:bank_ledger_id ( id, name ),
        other:other_ledger_id ( id, name ),
        category:category_id ( id, code, name )
      `)
      .eq('status', 'active')
      .or(`bank_ledger_id.eq.${numericId},other_ledger_id.eq.${numericId}`);
    if (startDate) bankQ = bankQ.gte('entry_date', startDate);
    if (endDate)   bankQ = bankQ.lte('entry_date', endDate);

    // Step 3b: bills for the matching parties. Only fires when the
    // ledger is linked to a party (CUSTOMER / SUPPLIER / MILL / etc.).
    // BANK / CASH / WAGES ledgers won't have matching parties and
    // this section is a no-op for them. Same date window applies.
    let invRes: { data: unknown; error: { message: string } | null } = { data: [], error: null };
    let openRes: typeof invRes = { data: [], error: null };
    let sizRes:  typeof invRes = { data: [], error: null };
    let bobRes:  typeof invRes = { data: [], error: null };
    let yarnRes: typeof invRes = { data: [], error: null };
    let fabRes:  typeof invRes = { data: [], error: null };
    let agentRes: typeof invRes = { data: [], error: null };
    if (partyIds.length > 0) {
      // Pull every active invoice where party_name matches any of
      // the linked party names. Supabase doesn't have a clean
      // multi-ilike OR, so we use the "in" operator on an
      // uppercased shadow comparison done client-side after fetch.
      let invQ = sb.from('invoice')
        .select('id, invoice_no, invoice_date, doc_type, total, party_name')
        .neq('status', 'cancelled')
        .in('party_name', partyNames);
      if (startDate) invQ = invQ.gte('invoice_date', startDate);
      if (endDate)   invQ = invQ.lte('invoice_date', endDate);

      let openQ = sb.from('party_opening_ledger')
        .select('id, invoice_no, invoice_date, direction, amount')
        .eq('status', 'active')
        .in('party_id', partyIds);
      if (startDate) openQ = openQ.gte('invoice_date', startDate);
      if (endDate)   openQ = openQ.lte('invoice_date', endDate);

      let sizQ = sb.from('sizing_job')
        .select('id, bill_no, bill_date, total_amount')
        .not('bill_no', 'is', null)
        .in('party_id', partyIds);
      if (startDate) sizQ = sizQ.gte('bill_date', startDate);
      if (endDate)   sizQ = sizQ.lte('bill_date', endDate);

      let bobQ = sb.from('bobbin_purchase')
        .select('id, invoice_no, purchase_date, total_amount')
        .in('vendor_id', partyIds);
      if (startDate) bobQ = bobQ.gte('purchase_date', startDate);
      if (endDate)   bobQ = bobQ.lte('purchase_date', endDate);

      let yarnQ = sb.from('yarn_lot')
        .select('id, lot_code, invoice_no, received_date, total_amount')
        .in('supplier_party_id', partyIds);
      if (startDate) yarnQ = yarnQ.gte('received_date', startDate);
      if (endDate)   yarnQ = yarnQ.lte('received_date', endDate);

      // Supplier-mode fabric resale only. Customer-mode rows are
      // accounted for via the synthetic payment created at entry.
      let fabQ = sb.from('fabric_purchase')
        .select('id, code, invoice_no, received_date, total_amount')
        .eq('source', 'supplier')
        .eq('status', 'active')
        .in('supplier_party_id', partyIds);
      if (startDate) fabQ = fabQ.gte('received_date', startDate);
      if (endDate)   fabQ = fabQ.lte('received_date', endDate);

      // Agent / broker commission we owe this party. The amount is a
      // payable (what WE owe the agent) earned on a fabric sales invoice
      // OR a yarn / fabric purchase. It has no date column of its own, so
      // we carry the source document's date and number and filter by the
      // chosen range client-side below.
      const agentCommQ = sb.from('agent_commission')
        .select('id, amount, invoice:invoice_id ( invoice_no, invoice_date ), yarn_lot:yarn_lot_id ( lot_code, received_date ), fabric_purchase:fabric_purchase_id ( code, received_date )')
        .eq('status', 'active')
        .in('agent_party_id', partyIds);

      const billRes = await Promise.all([invQ, openQ, sizQ, bobQ, yarnQ, fabQ, agentCommQ]);
      [invRes, openRes, sizRes, bobRes, yarnRes, fabRes, agentRes] = billRes;
    }

    const [wagesRes, expensesRes, bankRes] = await Promise.all([wagesQ, expensesQ, bankQ]);
    if (wagesRes.error)    { setError(wagesRes.error.message);    setLoading(false); return; }
    if (expensesRes.error) { setError(expensesRes.error.message); setLoading(false); return; }
    if (bankRes.error)     { setError(bankRes.error.message);     setLoading(false); return; }

    // Step 4: project into LedgerEntry, sort, store.
    const all: LedgerEntry[] = [];
    for (const p of payments) {
      const amt = Number(p.amount);
      all.push({
        key:          `pay-${p.id}`,
        source:       'payment',
        date:         p.payment_date,
        voucher:      p.payment_no,
        counterparty: p.party?.name ?? '-',
        mode:         p.mode_ledger?.name ?? '-',
        reference:    p.reference,
        inflow:       p.direction === 'in'  ? amt : 0,
        outflow:      p.direction === 'out' ? amt : 0,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const w of ((wagesRes.data ?? []) as any[])) {
      all.push({
        key:          `wage-${w.id}`,
        source:       'wage',
        date:         w.pay_date,
        voucher:      `WAGE/${w.id}`,
        counterparty: w.employee?.full_name ?? '-',
        mode:         '-',
        reference:    w.kind ?? null,
        inflow:       0,
        outflow:      Number(w.amount ?? 0),
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const x of ((expensesRes.data ?? []) as any[])) {
      all.push({
        key:          `exp-${x.id}`,
        source:       'expense',
        date:         x.pay_date,
        voucher:      `EXP/${x.id}`,
        counterparty: x.category ?? '-',
        mode:         '-',
        reference:    null,
        inflow:       0,
        outflow:      Number(x.amount ?? 0),
      });
    }

    // Bank entries. The same bank_entry row can appear on either side
    // of the contra (bank or offset). We figure out which side this
    // ledger sits on and project the amount with the right sign:
    //   - On the BANK side: in → inflow, out → outflow (matches the
    //     bank account's POV).
    //   - On the OTHER side: in → outflow, out → inflow (the contra
    //     account moves opposite to the bank).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const be of ((bankRes.data ?? []) as any[])) {
      const amt = Number(be.amount ?? 0);
      if (!Number.isFinite(amt) || amt === 0) continue;
      const isBankSide  = Number(be.bank_ledger_id)  === numericId;
      const isOtherSide = Number(be.other_ledger_id) === numericId;
      // Defensive: skip rows that don't actually touch this ledger
      // (shouldn't happen given the .or filter, but keeps the math
      // honest if Supabase returns something unexpected).
      if (!isBankSide && !isOtherSide) continue;

      let inflow = 0;
      let outflow = 0;
      if (isBankSide) {
        if (be.direction === 'in') inflow = amt;
        else                       outflow = amt;
      } else {
        // isOtherSide — sign inverted relative to bank POV.
        if (be.direction === 'out') inflow = amt;
        else                        outflow = amt;
      }

      // Counterparty label: when we're on the bank side, the
      // interesting "who" is the offset ledger; when we're on the
      // offset side, it's the bank account. Fall back to the
      // category name, then a generic placeholder.
      const counterparty =
        isBankSide
          ? (be.other?.name ?? be.category?.name ?? '(bank entry)')
          : (be.bank?.name  ?? be.category?.name ?? '(bank entry)');

      all.push({
        key:          `bank-${be.id}`,
        source:       'bank',
        bill_kind:    be.direction === 'in' ? 'bank_in' : 'bank_out',
        date:         be.entry_date,
        voucher:      be.entry_no ?? `BE-${be.id}`,
        counterparty,
        mode:         be.mode ?? (be.category?.name ?? '-'),
        reference:    be.reference ?? be.notes ?? null,
        inflow,
        outflow,
      });
    }

    // Bills — direction depends on doc kind.
    //   Inflow (running balance UP for a customer ledger): sale,
    //   jobwork bill, debit note, opening receivable.
    //   Outflow (running balance DOWN — or UP for a supplier
    //   payable): credit note, sizing bill, bobbin / yarn / fabric
    //   purchase, opening payable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((invRes.data ?? []) as any[])) {
      const amt = Number(r.total ?? 0);
      const doc: string = r.doc_type;
      const isCredit = doc === 'credit_note';
      const isDebitNote = doc === 'debit_note';
      const label = doc === 'tax_invoice'     ? 'Fabric Sale'
                  : doc === 'yarn_sale'       ? 'Yarn Sale'
                  : doc === 'general_sale'    ? 'General Sale'
                  : doc === 'jobwork_invoice' ? 'Jobwork Bill'
                  : doc === 'weaving_bill'    ? 'Weaving Bill'
                  : doc === 'credit_note'     ? 'Credit Note'
                  : doc === 'debit_note'      ? 'Debit Note'
                  : doc;
      all.push({
        key:          `inv-${r.id}`,
        source:       'bill',
        bill_kind:    isCredit ? 'credit' : isDebitNote ? 'debit' : 'sale',
        date:         r.invoice_date,
        voucher:      r.invoice_no,
        counterparty: r.party_name ?? '-',
        mode:         label,
        reference:    null,
        inflow:       isCredit ? 0   : amt,
        outflow:      isCredit ? amt : 0,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((openRes.data ?? []) as any[])) {
      const amt = Number(r.amount ?? 0);
      const isReceivable = r.direction === 'receivable';
      all.push({
        key:          `open-${r.id}`,
        source:       'bill',
        bill_kind:    'opening',
        date:         r.invoice_date,
        voucher:      r.invoice_no,
        counterparty: '—',
        mode:         isReceivable ? 'Opening (Receivable)' : 'Opening (Payable)',
        reference:    null,
        inflow:       isReceivable ? amt : 0,
        outflow:      isReceivable ? 0   : amt,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((sizRes.data ?? []) as any[])) {
      const amt = Number(r.total_amount ?? 0);
      if (amt <= 0) continue;
      all.push({
        key:          `siz-${r.id}`,
        source:       'bill',
        bill_kind:    'sizing',
        date:         r.bill_date,
        voucher:      r.bill_no ?? `SZ-${r.id}`,
        counterparty: '—',
        mode:         'Sizing Bill',
        reference:    null,
        inflow:       0,
        outflow:      amt,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((bobRes.data ?? []) as any[])) {
      const amt = Number(r.total_amount ?? 0);
      if (amt <= 0) continue;
      all.push({
        key:          `bob-${r.id}`,
        source:       'bill',
        bill_kind:    'bobbin',
        date:         r.purchase_date,
        voucher:      r.invoice_no ?? `BB-${r.id}`,
        counterparty: '—',
        mode:         'Bobbin Purchase',
        reference:    null,
        inflow:       0,
        outflow:      amt,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((yarnRes.data ?? []) as any[])) {
      const amt = Number(r.total_amount ?? 0);
      if (amt <= 0) continue;
      all.push({
        key:          `yarn-${r.id}`,
        source:       'bill',
        bill_kind:    'yarn',
        date:         r.received_date,
        voucher:      r.invoice_no ?? r.lot_code ?? `YL-${r.id}`,
        counterparty: '—',
        mode:         'Yarn Purchase',
        reference:    null,
        inflow:       0,
        outflow:      amt,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((fabRes.data ?? []) as any[])) {
      const amt = Number(r.total_amount ?? 0);
      if (amt <= 0) continue;
      all.push({
        key:          `fab-${r.id}`,
        source:       'bill',
        bill_kind:    'fabric',
        date:         r.received_date,
        voucher:      r.invoice_no ?? r.code ?? `FP-${r.id}`,
        counterparty: '—',
        mode:         'Fabric Purchase',
        reference:    null,
        inflow:       0,
        outflow:      amt,
      });
    }

    // Agent commission — a payable we owe the agent. The operator
    // thinks of this as the agent's "inflow" (what they earned), which
    // nets against payments paid out to them. Recorded as Inflow so the
    // running balance reads: commission earned − amounts paid =
    // still owed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((agentRes.data ?? []) as any[])) {
      const amt = Number(r.amount ?? 0);
      if (amt <= 0) continue;
      // The commission points at exactly one source document: a fabric
      // sales invoice, a yarn lot, or a fabric purchase. Pull the date
      // and voucher from whichever one is set.
      const inv  = r.invoice ?? null;
      const yarn = r.yarn_lot ?? null;
      const fab  = r.fabric_purchase ?? null;
      let date: string | null = null;
      let voucher = `AC-${r.id}`;
      if (inv) { date = inv.invoice_date ?? null; voucher = inv.invoice_no ?? voucher; }
      else if (yarn) { date = yarn.received_date ?? null; voucher = yarn.lot_code ?? voucher; }
      else if (fab)  { date = fab.received_date ?? null;  voucher = fab.code ?? voucher; }
      if (!date) continue;
      if (startDate && date < startDate) continue;
      if (endDate && date > endDate) continue;
      all.push({
        key:          `agentcomm-${r.id}`,
        source:       'bill',
        bill_kind:    'commission',
        date,
        voucher,
        counterparty: '—',
        mode:         'Agent Commission',
        reference:    null,
        inflow:       amt,
        outflow:      0,
      });
    }

    all.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.key.localeCompare(b.key);
    });

    setEntries(all);
    setLoading(false);
  }

  // Compute running balance per row + grand totals.
  const ledger = useMemo(() => {
    let running = 0;
    return entries.map((e) => {
      running += e.inflow - e.outflow;
      return { ...e, balance: running };
    });
  }, [entries]);

  const totals = useMemo(() => {
    const inflow  = ledger.reduce((s, r) => s + r.inflow,  0);
    const outflow = ledger.reduce((s, r) => s + r.outflow, 0);
    return { inflow, outflow, balance: inflow - outflow };
  }, [ledger]);

  return (
    <div className="space-y-4">
      {/* ── Cascading filter form ─────────────────────────────────────── */}
      <form onSubmit={handleShow} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div>
          <label className="label">Ledger type *</label>
          <select
            className="input"
            value={typeId}
            onChange={(e) => onTypeChange(e.target.value)}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Ledger *</label>
          <select
            className="input"
            value={ledgerId}
            onChange={(e) => setLedgerId(e.target.value)}
          >
            <option value="">
              {filteredLedgers.length
                ? (typeId ? 'Select ledger…' : 'Pick a type first or select…')
                : 'No ledgers under this type'}
            </option>
            {filteredLedgers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Start date</label>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">End date</label>
          <input
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Show
          </button>
        </div>
      </form>

      {error && <div className="card p-3 text-sm text-err">{error}</div>}

      {/* ── Results ──────────────────────────────────────────────────── */}
      {!hasShown ? (
        <div className="card p-6 text-sm text-ink-soft">
          Pick a type, then a ledger, optionally narrow by date, and click <b>Show</b>.
        </div>
      ) : loading ? (
        <div className="card p-6 flex items-center gap-2 text-sm text-ink-mute">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : ledger.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No transactions for <span className="font-semibold">{shownLedger?.name ?? 'this ledger'}</span>
          {startDate || endDate ? ' in the chosen date range' : ''}.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/40 bg-cloud/40">
            <div className="text-xs uppercase tracking-wider text-ink-mute">Transaction ledger for</div>
            <div className="font-semibold text-ink flex flex-wrap items-center gap-2">
              {shownLedger?.name}
              {shownLedger?.type_name && (
                <span className="pill bg-indigo-50 text-indigo-700">{shownLedger.type_name}</span>
              )}
              {(startDate || endDate) && (
                <span className="text-[11px] text-ink-mute font-normal">
                  · {startDate ? fmtDate(startDate) : 'beginning'} → {endDate ? fmtDate(endDate) : 'today'}
                </span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left  px-3 py-3">Date</th>
                  <th className="text-left  px-3 py-3">Voucher</th>
                  <th className="text-left  px-3 py-3 hidden md:table-cell">Counterparty</th>
                  <th className="text-left  px-3 py-3 hidden md:table-cell">Bank / Cash</th>
                  <th className="text-left  px-3 py-3 hidden lg:table-cell">Reference</th>
                  <th className="text-right px-3 py-3">Inflow (₹)</th>
                  <th className="text-right px-3 py-3">Outflow (₹)</th>
                  <th className="text-right px-3 py-3">Running balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.key} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-3 text-ink-soft">{fmtDate(r.date)}</td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {r.voucher}
                      {r.source !== 'payment' && (
                        <span className={cn(
                          'ml-1 pill text-[9px]',
                          r.source === 'wage'    ? 'bg-amber-50 text-amber-700'
                          : r.source === 'expense' ? 'bg-violet-50 text-violet-700'
                          : r.source === 'bill'  ? 'bg-indigo-50 text-indigo-700'
                          : r.source === 'bank'  ? 'bg-sky-50 text-sky-700'
                                                 : 'bg-cloud text-ink-soft',
                        )}>
                          {r.source === 'bill'
                            ? (r.bill_kind ?? 'bill')
                            : r.source === 'bank'
                              ? (r.bill_kind === 'bank_in' ? 'bank in' : 'bank out')
                              : r.source}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{r.counterparty}</td>
                    <td className="px-3 py-3 hidden md:table-cell text-xs text-ink-soft">{r.mode}</td>
                    <td className="px-3 py-3 hidden lg:table-cell text-xs text-ink-soft">{r.reference ?? '-'}</td>
                    <td className="px-3 py-3 text-right num text-emerald-700">
                      {r.inflow > 0 ? fmtINR(r.inflow) : '-'}
                    </td>
                    <td className="px-3 py-3 text-right num text-rose-700">
                      {r.outflow > 0 ? fmtINR(r.outflow) : '-'}
                    </td>
                    <td className={cn(
                      'px-3 py-3 text-right num font-semibold',
                      r.balance > 0 ? 'text-emerald-700' : r.balance < 0 ? 'text-rose-700' : 'text-ink-soft',
                    )}>
                      {fmtINR(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line/60 bg-cloud/30 font-bold">
                  <td className="px-3 py-3" colSpan={5}>Totals</td>
                  <td className="px-3 py-3 text-right num text-emerald-700">{fmtINR(totals.inflow)}</td>
                  <td className="px-3 py-3 text-right num text-rose-700">{fmtINR(totals.outflow)}</td>
                  <td className={cn(
                    'px-3 py-3 text-right num text-base',
                    totals.balance > 0 ? 'text-emerald-700' : totals.balance < 0 ? 'text-rose-700' : 'text-ink-soft',
                  )}>
                    {fmtINR(totals.balance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-line/40 bg-cloud/20 text-[11px] text-ink-mute">
            Sorted oldest → newest. Inflows are payments received; outflows are payments paid out (including wages, expenses, and bank entries tagged to this ledger).
          </div>
        </div>
      )}
    </div>
  );
}
