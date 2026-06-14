'use client';
/**
 * UnpaidBillsPicker — reusable "tick the unpaid bills this money
 * settles" checkbox table.
 *
 * Extracted from /app/payments so the same UX can be dropped into
 * Fabric Stock (customer-adjustment mode) and Credit Note (spread
 * mode). The component owns the data fetch, the checkbox state, and
 * the auto-spread logic; it emits the resulting allocations to the
 * parent through `onAllocationsChange`. The parent does its own
 * Supabase writes — this component never touches the DB.
 *
 * Sources of unpaid bills (mirrors /app/payments):
 *   - invoice                (kind 'invoice', balance > 0)
 *   - party_opening_ledger   (kind 'opening')
 *   - sizing_job             (kind 'sizing',  total - amount_paid > 0)
 *   - bobbin_purchase        (kind 'bobbin')
 *   - yarn_lot               (kind 'yarn')
 *
 * Allocations are emitted as a discriminated union so the parent
 * knows which child table to write each row into.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Public types ───────────────────────────────────────────────────

export type BillAllocation =
  | { kind: 'invoice'; invoice_id:        number; amount: number }
  | { kind: 'opening'; opening_ledger_id: number; amount: number }
  | { kind: 'sizing';  sizing_job_id:     number; amount: number }
  | { kind: 'bobbin';  bobbin_purchase_id: number; amount: number }
  | { kind: 'yarn';    yarn_lot_id:       number; amount: number }
  | { kind: 'fabric';  fabric_purchase_id: number; amount: number };

export interface UnpaidBillsPickerProps {
  /** Party whose unpaid bills we should fetch. Null clears the list. */
  partyId: number | null;
  /** How much money is being allocated (fabric value / credit value / payment amount). */
  totalAmount: number;
  /** Affects the heading text only. */
  direction: 'in' | 'out';
  /** Emits the current allocations array to the parent every time it changes. */
  onAllocationsChange: (allocs: BillAllocation[]) => void;
  /** Show the "Advance / On account" hint row in the footer. Default true. */
  showAdvanceHint?: boolean;
  /** Heading prefix override (defaults to "Unpaid bills"). */
  heading?: string;
}

// ── Internal types ─────────────────────────────────────────────────

interface UnpaidBill {
  kind: 'invoice' | 'opening' | 'sizing' | 'bobbin' | 'yarn' | 'fabric';
  id: number;
  doc_no: string;
  doc_date: string;
  doc_type: string;
  total: number;
  amount_paid: number;
  balance: number;
}

const DOC_TYPE_LABEL: Record<string, string> = {
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
};

function billKey(b: UnpaidBill): string { return `${b.kind}-${b.id}`; }

function fmtINR(n: number | string | null | undefined): string {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return '0.00';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear());
}

// ── Component ──────────────────────────────────────────────────────

export function UnpaidBillsPicker({
  partyId,
  totalAmount,
  direction,
  onAllocationsChange,
  showAdvanceHint = true,
  heading,
}: UnpaidBillsPickerProps): React.ReactElement | null {
  const supabase = useMemo(() => createClient(), []);

  const [bills,        setBills]        = useState<UnpaidBill[]>([]);
  const [loading,      setLoading]      = useState<boolean>(false);
  const [error,        setError]        = useState<string | null>(null);
  const [checkedBills, setCheckedBills] = useState<Set<string>>(new Set());
  const [alloc,        setAlloc]        = useState<Record<string, string>>({});

  // ── Fetch ────────────────────────────────────────────────────────
  const loadBills = useCallback(async (): Promise<void> => {
    if (partyId == null) { setBills([]); setCheckedBills(new Set()); setAlloc({}); return; }
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Pull invoices by party_name (legacy) — we look up the party name
    // first so the existing ilike-by-name path keeps working.
    const partyRes = await sb.from('party').select('name').eq('id', partyId).maybeSingle();
    const partyName: string = partyRes?.data?.name ?? '';

    const [invRes, openRes, sizRes, bobRes, yarnRes, fabRes] = await Promise.all([
      sb.from('invoice')
        .select('id, invoice_no, invoice_date, doc_type, total, amount_paid, balance')
        .ilike('party_name', partyName)
        .in('status', ['issued', 'partial_paid', 'overdue'])
        .gt('balance', 0)
        .order('invoice_date', { ascending: true })
        .order('id', { ascending: true }),
      sb.from('party_opening_ledger')
        .select('id, invoice_no, invoice_date, direction, amount, amount_paid, balance')
        .eq('party_id', partyId)
        .eq('status', 'active')
        .gt('balance', 0)
        .order('invoice_date', { ascending: true })
        .order('id', { ascending: true }),
      sb.from('sizing_job')
        .select('id, bill_no, bill_date, total_amount, amount_paid')
        .eq('party_id', partyId)
        .not('bill_no', 'is', null)
        .gt('total_amount', 0),
      sb.from('bobbin_purchase')
        .select('id, invoice_no, purchase_date, total_amount, amount_paid')
        .eq('vendor_id', partyId)
        .gt('total_amount', 0),
      sb.from('yarn_lot')
        .select('id, lot_code, invoice_no, received_date, total_amount, amount_paid')
        .eq('supplier_party_id', partyId)
        .gt('total_amount', 0),
      // Supplier-purchase fabric_purchase rows are payables to the
      // fabric supplier. Customer-adjustment rows (source='customer')
      // are excluded — they're already accounted for via the
      // synthetic payment created at the time of entry.
      sb.from('fabric_purchase')
        .select('id, code, invoice_no, received_date, total_amount, amount_paid')
        .eq('supplier_party_id', partyId)
        .eq('source', 'supplier')
        .eq('status', 'active')
        .gt('total_amount', 0),
    ]);

    if (invRes.error) { setError(invRes.error.message); setLoading(false); return; }

    const liveBills: UnpaidBill[] = ((invRes.data ?? []) as Array<{
      id: number; invoice_no: string; invoice_date: string; doc_type: string;
      total: number | string; amount_paid: number | string; balance: number | string;
    }>).map((r) => ({
      kind: 'invoice',
      id: r.id,
      doc_no: r.invoice_no,
      doc_date: r.invoice_date,
      doc_type: r.doc_type,
      total: Number(r.total ?? 0),
      amount_paid: Number(r.amount_paid ?? 0),
      balance: Number(r.balance ?? 0),
    }));

    const openBills: UnpaidBill[] = ((openRes?.data ?? []) as Array<{
      id: number; invoice_no: string; invoice_date: string; direction: string;
      amount: number | string; amount_paid: number | string; balance: number | string;
    }>).map((r) => ({
      kind: 'opening',
      id: r.id,
      doc_no: r.invoice_no,
      doc_date: r.invoice_date,
      doc_type: `opening_${r.direction}`,
      total: Number(r.amount ?? 0),
      amount_paid: Number(r.amount_paid ?? 0),
      balance: Number(r.balance ?? 0),
    }));

    const sizingBills: UnpaidBill[] = ((sizRes?.data ?? []) as Array<{
      id: number; bill_no: string | null; bill_date: string | null;
      total_amount: number | string; amount_paid: number | string;
    }>)
      .filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
      .map((r) => ({
        kind: 'sizing',
        id: r.id,
        doc_no: r.bill_no ?? `SZ-${r.id}`,
        doc_date: r.bill_date ?? '',
        doc_type: 'sizing_bill',
        total: Number(r.total_amount ?? 0),
        amount_paid: Number(r.amount_paid ?? 0),
        balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
      }));

    const bobbinBills: UnpaidBill[] = ((bobRes?.data ?? []) as Array<{
      id: number; invoice_no: string | null; purchase_date: string | null;
      total_amount: number | string; amount_paid: number | string;
    }>)
      .filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
      .map((r) => ({
        kind: 'bobbin',
        id: r.id,
        doc_no: r.invoice_no ?? `BB-${r.id}`,
        doc_date: r.purchase_date ?? '',
        doc_type: 'bobbin_purchase',
        total: Number(r.total_amount ?? 0),
        amount_paid: Number(r.amount_paid ?? 0),
        balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
      }));

    const yarnBills: UnpaidBill[] = ((yarnRes?.data ?? []) as Array<{
      id: number; lot_code: string | null; invoice_no: string | null;
      received_date: string | null; total_amount: number | string; amount_paid: number | string;
    }>)
      .filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
      .map((r) => ({
        kind: 'yarn',
        id: r.id,
        doc_no: r.invoice_no ?? r.lot_code ?? `YL-${r.id}`,
        doc_date: r.received_date ?? '',
        doc_type: 'yarn_purchase',
        total: Number(r.total_amount ?? 0),
        amount_paid: Number(r.amount_paid ?? 0),
        balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
      }));

    const fabricBills: UnpaidBill[] = ((fabRes?.data ?? []) as Array<{
      id: number; code: string; invoice_no: string | null;
      received_date: string | null; total_amount: number | string; amount_paid: number | string;
    }>)
      .filter((r) => Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0) > 0.005)
      .map((r) => ({
        kind: 'fabric',
        id: r.id,
        doc_no: r.invoice_no ?? r.code ?? `FP-${r.id}`,
        doc_date: r.received_date ?? '',
        doc_type: 'fabric_purchase',
        total: Number(r.total_amount ?? 0),
        amount_paid: Number(r.amount_paid ?? 0),
        balance: Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0),
      }));

    const merged = [...liveBills, ...openBills, ...sizingBills, ...bobbinBills, ...yarnBills, ...fabricBills]
      .sort((a, b) => {
        const dc = (a.doc_date ?? '').localeCompare(b.doc_date ?? '');
        return dc !== 0 ? dc : a.id - b.id;
      });
    setBills(merged);
    setCheckedBills(new Set());
    setAlloc({});
    setLoading(false);
  }, [partyId, supabase]);

  useEffect(() => { void loadBills(); }, [loadBills]);

  // ── Spread / toggle helpers ──────────────────────────────────────
  const distribute = useCallback((amt: number, keys: Set<string>): Record<string, string> => {
    const next: Record<string, string> = {};
    let remaining = amt;
    for (const b of bills) {
      const k = billKey(b);
      if (!keys.has(k)) continue;
      const bal = Number(b.balance);
      const take = Math.min(bal, Math.max(remaining, 0));
      next[k] = take > 0 ? String(Math.round(take * 100) / 100) : '';
      remaining -= take;
    }
    return next;
  }, [bills]);

  function toggleBill(b: UnpaidBill): void {
    const k = billKey(b);
    const next = new Set(checkedBills);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setCheckedBills(next);
    setAlloc(distribute(totalAmount, next));
  }

  function patchAlloc(k: string, v: string): void {
    setAlloc((a) => ({ ...a, [k]: v }));
  }

  // Re-spread whenever the totalAmount changes from outside.
  useEffect(() => {
    if (checkedBills.size === 0) return;
    setAlloc(distribute(totalAmount, checkedBills));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  // ── Allocations out to parent ───────────────────────────────────
  const allocations = useMemo<BillAllocation[]>(() => {
    const out: BillAllocation[] = [];
    for (const b of bills) {
      const k = billKey(b);
      if (!checkedBills.has(k)) continue;
      const raw = (alloc[k] ?? '').trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      const amount = Math.round(n * 100) / 100;
      switch (b.kind) {
        case 'invoice': out.push({ kind: 'invoice', invoice_id:         b.id, amount }); break;
        case 'opening': out.push({ kind: 'opening', opening_ledger_id:  b.id, amount }); break;
        case 'sizing':  out.push({ kind: 'sizing',  sizing_job_id:      b.id, amount }); break;
        case 'bobbin':  out.push({ kind: 'bobbin',  bobbin_purchase_id: b.id, amount }); break;
        case 'yarn':    out.push({ kind: 'yarn',    yarn_lot_id:        b.id, amount }); break;
      }
    }
    return out;
  }, [bills, checkedBills, alloc]);

  // Emit allocations every time they change.
  useEffect(() => {
    onAllocationsChange(allocations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocations]);

  const allocatedTotal = useMemo<number>(() =>
    allocations.reduce((s, a) => s + a.amount, 0)
  , [allocations]);

  const unallocated = Math.round((totalAmount - allocatedTotal) * 100) / 100;

  // ── Render ───────────────────────────────────────────────────────
  if (partyId == null) return null;
  if (loading) {
    return (
      <div className="border border-line/40 rounded-md p-4 flex items-center gap-2 text-sm text-ink-mute">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading unpaid bills…
      </div>
    );
  }
  if (error) {
    return (
      <div className="border border-rose-200 rounded-md p-4 text-sm text-err">
        Could not load unpaid bills: {error}
      </div>
    );
  }
  if (bills.length === 0) {
    return (
      <div className="border border-line/40 rounded-md p-4 text-sm text-ink-soft">
        No unpaid bills for this party — this amount will be saved as advance credit on their ledger.
      </div>
    );
  }

  const title = heading ?? 'Unpaid bills';

  return (
    <div className="border border-line/40 rounded-md overflow-hidden">
      <div className="px-3 py-2 bg-cloud/40 border-b border-line/40 flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {title} — tick to adjust this {direction === 'in' ? 'receipt' : 'payment'} against them
        </span>
        <span className="text-xs text-ink-mute">
          Allocation auto-spreads oldest first; override per row if needed.
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
                  <td className="px-3 py-2 font-mono text-xs">{b.doc_no}</td>
                  <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(b.doc_date)}</td>
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
                      onChange={(e) => patchAlloc(k, e.target.value)}
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
                    showAdvanceHint
                      ? <span className="text-amber-700">On account (advance): ₹ {fmtINR(unallocated)}</span>
                      : <span className="text-amber-700">Unallocated: ₹ {fmtINR(unallocated)}</span>
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
  );
}

/**
 * Helper: turn an allocations array into the per-table insert arrays
 * for the parent's save flow. Returns one array per allocation table,
 * matching the payment_* tables in the DB.
 */
export function splitAllocationsByKind(allocations: BillAllocation[]): {
  invoices: { invoice_id: number;         amount: number }[];
  openings: { opening_ledger_id: number;  amount: number }[];
  sizings:  { sizing_job_id: number;      amount: number }[];
  bobbins:  { bobbin_purchase_id: number; amount: number }[];
  yarns:    { yarn_lot_id: number;        amount: number }[];
  fabrics:  { fabric_purchase_id: number; amount: number }[];
} {
  const invoices: { invoice_id: number;         amount: number }[] = [];
  const openings: { opening_ledger_id: number;  amount: number }[] = [];
  const sizings:  { sizing_job_id: number;      amount: number }[] = [];
  const bobbins:  { bobbin_purchase_id: number; amount: number }[] = [];
  const yarns:    { yarn_lot_id: number;        amount: number }[] = [];
  const fabrics:  { fabric_purchase_id: number; amount: number }[] = [];
  for (const a of allocations) {
    switch (a.kind) {
      case 'invoice': invoices.push({ invoice_id:         a.invoice_id,         amount: a.amount }); break;
      case 'opening': openings.push({ opening_ledger_id:  a.opening_ledger_id,  amount: a.amount }); break;
      case 'sizing':  sizings .push({ sizing_job_id:      a.sizing_job_id,      amount: a.amount }); break;
      case 'bobbin':  bobbins .push({ bobbin_purchase_id: a.bobbin_purchase_id, amount: a.amount }); break;
      case 'yarn':    yarns   .push({ yarn_lot_id:        a.yarn_lot_id,        amount: a.amount }); break;
      case 'fabric':  fabrics .push({ fabric_purchase_id: a.fabric_purchase_id, amount: a.amount }); break;
    }
  }
  return { invoices, openings, sizings, bobbins, yarns, fabrics };
}
