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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
import { Loader2, Save, CheckCircle2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
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
}
/** An unpaid (or part-paid) bill of the selected party, offered for
 *  bill-to-bill adjustment when recording a payment. Invoices are
 *  matched to the unified party master by the party_name stamped on
 *  every invoice. */
interface UnpaidBill {
  id: number;
  invoice_no: string;
  invoice_date: string;
  doc_type: string;
  total: number | string;
  amount_paid: number | string;
  balance: number | string;
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
  tax_invoice:     'Fabric Sale',
  yarn_sale:       'Yarn Sale',
  general_sale:    'General Sale',
  credit_note:     'Credit Note',
  debit_note:      'Debit Note',
  jobwork_invoice: 'Jobwork Bill',
  weaving_bill:    'Weaving Bill',
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

  const [direction,    setDirection]   = useState<Direction>(initialDirection);
  const [partyTypeId,  setPartyTypeId] = useState<string>('');
  const [partyId,      setPartyId]     = useState<string>(initialParty);
  const [date,         setDate]        = useState<string>(todayISO());
  const [amount,       setAmount]      = useState<string>('');
  // Replaces the old free-text Mode enum. The picked ledger is what
  // gets saved; the legacy `mode` text column is auto-derived by a DB
  // trigger from the ledger's type ('cash' / 'bank_transfer').
  const [modeLedgerId, setModeLedgerId] = useState<string>('');
  const [reference,    setReference]   = useState<string>('');
  const [notes,        setNotes]       = useState<string>('');

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
  const [checkedBills, setCheckedBills] = useState<Set<number>>(new Set());
  const [alloc,        setAlloc]        = useState<Record<number, string>>({});
  /** Operator's explicit confirmation that this payment is an ADVANCE
   *  to the party ledger (no bill adjusted). Required for the party
   *  types in BILL_ADJUST_REQUIRED_TYPES. */
  const [advanceOk,    setAdvanceOk]    = useState<boolean>(false);

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
    // Drop the picked party when the type filter narrows it out of view.
    if (partyId && !filteredParties.some((p) => String(p.id) === partyId)) {
      setPartyId('');
    }
  }, [filteredParties, partyId]);

  // ── Load the party's unpaid bills whenever the party changes ─────────────
  // Invoices stamp party_name at creation, so we match the picked party
  // by name (case-insensitive). Only open bills with a balance left.
  const loadBills = useCallback(async (): Promise<void> => {
    setCheckedBills(new Set());
    setAlloc({});
    setAdvanceOk(false);
    if (!partyId) { setBills([]); return; }
    const party = parties.find((p) => String(p.id) === partyId);
    if (!party) { setBills([]); return; }
    setBillsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data, error: err } = await sb.from('invoice')
      .select('id, invoice_no, invoice_date, doc_type, total, amount_paid, balance')
      .ilike('party_name', party.name)
      .in('status', ['issued', 'partial_paid', 'overdue'])
      .gt('balance', 0)
      .order('invoice_date', { ascending: true })
      .order('id', { ascending: true });
    setBillsLoading(false);
    if (err) { setError(err.message); return; }
    setBills((data ?? []) as UnpaidBill[]);
  }, [partyId, parties, supabase]);

  useEffect(() => { void loadBills(); }, [loadBills]);

  /** Spread `amt` across the given bills oldest-first (each bill takes
   *  up to its open balance). Returns the invoice-id → amount map. */
  function distribute(amt: number, billIds: Set<number>): Record<number, string> {
    const next: Record<number, string> = {};
    let remaining = amt;
    for (const b of bills) {
      if (!billIds.has(b.id)) continue;
      const bal = Number(b.balance);
      const take = Math.min(bal, Math.max(remaining, 0));
      next[b.id] = take > 0 ? String(Math.round(take * 100) / 100) : '';
      remaining -= take;
    }
    return next;
  }

  function toggleBill(b: UnpaidBill): void {
    const next = new Set(checkedBills);
    if (next.has(b.id)) next.delete(b.id);
    else next.add(b.id);
    setCheckedBills(next);

    const amt = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(amt) || amt <= 0) {
      // No amount typed yet → bill-to-bill mode: amount becomes the sum
      // of the ticked bills' balances, fully adjusted.
      const sum = bills.filter((x) => next.has(x.id))
        .reduce((s, x) => s + Number(x.balance), 0);
      setAmount(sum > 0 ? String(Math.round(sum * 100) / 100) : '');
      setAlloc(distribute(sum, next));
    } else {
      // Amount already typed → spread it across the ticked bills.
      setAlloc(distribute(amt, next));
    }
  }

  function handleAmountChange(v: string): void {
    setAmount(v);
    const amt = Number(v);
    if (checkedBills.size > 0 && Number.isFinite(amt)) {
      setAlloc(distribute(amt, checkedBills));
    }
  }

  function handleAllocChange(billId: number, v: string): void {
    setAlloc((a) => ({ ...a, [billId]: v }));
  }

  const allocatedTotal = useMemo<number>(() => {
    let s = 0;
    for (const b of bills) {
      if (!checkedBills.has(b.id)) continue;
      const n = Number(alloc[b.id] ?? '');
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
    const allocations: { invoice_id: number; amount: number }[] = [];
    for (const b of bills) {
      if (!checkedBills.has(b.id)) continue;
      const raw = (alloc[b.id] ?? '').trim();
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
      allocations.push({ invoice_id: b.id, amount: Math.round(n * 100) / 100 });
    }
    // Supplier-type parties (and customers): no save without either a
    // bill adjustment or an explicit "advance payment" confirmation.
    if (billAdjustRequired && allocations.length === 0 && !advanceOk) {
      setError(bills.length > 0
        ? 'Tick the bill(s) this payment settles — or tick "Advance payment" to post it to the party ledger without adjusting a bill.'
        : 'This party has no unpaid bills. Tick "Advance payment" to confirm posting this amount to the party ledger.');
      return;
    }

    const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
    if (allocSum > amt + 0.005) {
      setError(`Adjusted total ₹${fmtINR(allocSum)} is more than the payment amount ₹${fmtINR(amt)}. Reduce the bill adjustments or raise the amount.`);
      return;
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
    setBusy(false);
    setSavedMsg(
      allocations.length > 0
        ? `Saved ${data?.payment_no ?? 'payment'} — adjusted against ${allocations.length} bill${allocations.length === 1 ? '' : 's'}${allocSum < amt ? `, ₹${fmtINR(amt - allocSum)} kept on account` : ''}.`
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
                    const isChecked = checkedBills.has(b.id);
                    const allocNum = Number(alloc[b.id] ?? '');
                    const adj = isChecked && Number.isFinite(allocNum) && allocNum > 0 ? allocNum : 0;
                    const leftAfter = Math.round((Number(b.balance) - adj) * 100) / 100;
                    const overAlloc = adj > Number(b.balance) + 0.005;
                    return (
                      <tr key={b.id} className={cn('border-t border-line/40', isChecked ? 'bg-indigo-50/40' : 'hover:bg-haze/60')}>
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
                            value={isChecked ? (alloc[b.id] ?? '') : ''}
                            onChange={(e) => handleAllocChange(b.id, e.target.value)}
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

  const [partyTypes, setPartyTypes] = useState<PartyTypeOpt[]>([]);
  const [parties,    setParties]    = useState<PartyOpt[]>([]);
  const [payments,   setPayments]   = useState<PaymentRow[]>([]);
  const [loading,    setLoading]    = useState<boolean>(true);
  const [error,      setError]      = useState<string | null>(null);

  const [partyTypeId, setPartyTypeId] = useState<string>('');
  const [partyId,     setPartyId]     = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [ptRes, pRes] = await Promise.all([
      sb.from('party_type_master').select('id, name').eq('active', true).order('name'),
      sb.from('party')
        .select('id, code, name, party_type_ids')
        .eq('status', 'active')
        .order('name'),
    ]);
    if (ptRes.error)    { setError(ptRes.error.message); setLoading(false); return; }
    if (pRes.error)     { setError(pRes.error.message); setLoading(false); return; }
    setPartyTypes((ptRes.data ?? []) as PartyTypeOpt[]);
    setParties((pRes.data ?? []) as PartyOpt[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // Filter parties by selected type.
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

  // Pull payments whenever the party filter changes.
  useEffect(() => {
    if (!partyId) { setPayments([]); return; }
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error: err } = await sb.from('payment')
        .select('id, payment_no, payment_date, direction, amount, mode, mode_ledger_id, mode_ledger:mode_ledger_id ( id, name ), reference, notes')
        .eq('party_id', Number(partyId))
        .eq('status', 'active')
        .order('payment_date', { ascending: true })
        .order('id', { ascending: true });
      if (err) { setError(err.message); return; }
      setPayments((data ?? []) as PaymentRow[]);
    })();
  }, [partyId, supabase]);

  // Compute running balance. Convention:
  //   Inflow  → +ve to "running balance" (money flowing TO us = party owes us less)
  //   Outflow → -ve.
  // For a CUSTOMER ledger, a positive running balance means the customer
  // has paid more than we've billed (rare credit). For a SUPPLIER, a
  // negative running balance means we still owe them. The narrative
  // depends on the party type; here we just present the raw signed sum
  // and let the operator interpret.
  const ledger = useMemo(() => {
    let running = 0;
    return payments.map((p) => {
      const amt = Number(p.amount);
      const inflow  = p.direction === 'in'  ? amt : 0;
      const outflow = p.direction === 'out' ? amt : 0;
      running += inflow - outflow;
      return { ...p, inflow, outflow, balance: running };
    });
  }, [payments]);

  const totals = useMemo(() => {
    const inflow  = ledger.reduce((s, r) => s + r.inflow, 0);
    const outflow = ledger.reduce((s, r) => s + r.outflow, 0);
    return { inflow, outflow, balance: inflow - outflow };
  }, [ledger]);

  const partyName = useMemo(() => {
    const p = parties.find((x) => String(x.id) === partyId);
    return p ? `${p.code} — ${p.name}` : '';
  }, [parties, partyId]);

  return (
    <div className="space-y-4">
      <div className="card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="label">Party type</label>
          <select className="input" value={partyTypeId} onChange={(e) => setPartyTypeId(e.target.value)}>
            <option value="">All types</option>
            {partyTypes.map((pt) => (
              <option key={pt.id} value={pt.id}>{pt.name}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">Party *</label>
          <SearchSelect
            options={filteredParties.map((p): SearchSelectOption => ({
              value: String(p.id),
              label: `${p.code} — ${p.name}`,
            }))}
            value={partyId}
            onChange={setPartyId}
            placeholder="Type party name to see its ledger…"
          />
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-err">{error}</div>}

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-sm text-ink-mute">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : !partyId ? (
        <div className="card p-6 text-sm text-ink-soft">
          Pick a party above to see its payment ledger.
        </div>
      ) : ledger.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No payments yet for <span className="font-semibold">{partyName}</span>. Record one from the
          New Payment tab.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/40 bg-cloud/40">
            <div className="text-xs uppercase tracking-wider text-ink-mute">Ledger for</div>
            <div className="font-semibold text-ink">{partyName}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left  px-3 py-3">Date</th>
                  <th className="text-left  px-3 py-3">Voucher</th>
                  <th className="text-left  px-3 py-3 hidden md:table-cell">Bank / Cash</th>
                  <th className="text-left  px-3 py-3 hidden md:table-cell">Reference</th>
                  <th className="text-right px-3 py-3">Inflow (₹)</th>
                  <th className="text-right px-3 py-3">Outflow (₹)</th>
                  <th className="text-right px-3 py-3">Running balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-3 text-ink-soft">{fmtDate(r.payment_date)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{r.payment_no}</td>
                    <td className="px-3 py-3 hidden md:table-cell text-xs text-ink-soft">
                      {/* Prefer the ledger name (e.g. "HDFC Current",
                          "Petty Cash") since that's what the operator
                          actually picked. Fall back to the raw mode
                          text for legacy rows that have no
                          mode_ledger_id stamped. */}
                      {r.mode_ledger?.name ?? (r.mode ?? '').replace('_', ' ')}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell text-xs text-ink-soft">
                      {r.reference ?? '-'}
                    </td>
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
                  <td className="px-3 py-3" colSpan={4}>Totals</td>
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
            Positive balance = party has paid more than received from us.
            Negative balance = we still owe / need to receive from this party.
            Sorted oldest → newest.
          </div>
        </div>
      )}
    </div>
  );
}
