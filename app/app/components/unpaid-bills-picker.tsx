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
import { STREAM_META, type PartyStream } from '@/lib/party-streams';
import { loadPartyBills, DOC_TYPE_LABEL, billKey, type OpenBill } from '@/lib/party-bills';

// ── Public types ───────────────────────────────────────────────────

export type BillAllocation =
  | { kind: 'invoice'; invoice_id:        number; amount: number }
  | { kind: 'opening'; opening_ledger_id: number; amount: number }
  | { kind: 'sizing';  sizing_job_id:     number; amount: number }
  | { kind: 'bobbin';  bobbin_purchase_id: number; amount: number }
  | { kind: 'yarn';    yarn_lot_id:       number; amount: number }
  | { kind: 'fabric';  fabric_purchase_id: number; amount: number }
  | { kind: 'agent';   agent_commission_id: number; amount: number }
  | { kind: 'warp_beam'; warp_beam_purchase_id: number; amount: number };

/** Lightweight identifier for a ticked bill — emitted regardless of
 *  the per-bill amount so callers can react to the TICK event itself
 *  (e.g. pre-fill credit-note lines from the ticked invoice). */
export interface SelectedBill {
  kind: BillAllocation['kind'];
  id: number;
  balance: number;
}

export interface UnpaidBillsPickerProps {
  /** Party whose unpaid bills we should fetch. Null clears the list. */
  partyId: number | null;
  /** How much money is being allocated (fabric value / credit value / payment amount). */
  totalAmount: number;
  /** Affects the heading text only. Derive it with
   *  directionForStream(stream) rather than hardcoding a literal. */
  direction: 'in' | 'out';
  /** Which party account these bills belong to. Bills outside this
   *  stream are NOT loaded: a receipt must never be able to settle a
   *  payable. A party can be customer, jobwork party and supplier at
   *  once (BMPT TEXTILES is all three), so without this every one of
   *  their bills appears on every screen. */
  stream: PartyStream;
  /** Emits the current allocations array to the parent every time it changes. */
  onAllocationsChange: (allocs: BillAllocation[]) => void;
  /** Optional: emits the list of TICKED bills regardless of amount.
   *  Fires immediately when the operator checks/unchecks a row, so
   *  parents can react to the selection even before an allocation
   *  amount is known (e.g. credit-note line pre-fill). */
  onSelectionChange?: (sel: SelectedBill[]) => void;
  /** Show the "Advance / On account" hint row in the footer. Default true. */
  showAdvanceHint?: boolean;
  /** Heading prefix override (defaults to "Unpaid bills"). */
  heading?: string;
}

// ── Internal types ─────────────────────────────────────────────────

/** Rows come straight from the shared loader. */
type UnpaidBill = OpenBill;

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
  stream,
  onAllocationsChange,
  onSelectionChange,
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
  // Bills come from the SHARED loader (lib/party-bills.ts) so this
  // picker, the Payments page and the contra tab can never disagree
  // about what a party owes. This component used to carry its own copy
  // of the query set and was missing agent_commission entirely
  // (Rs 9,247.19 across 38 rows at the 2026-08-20 audit), so a credit
  // note raised here could not be adjusted against a commission though
  // a payment on the Payments page could.
  const loadBills = useCallback(async (): Promise<void> => {
    if (partyId == null) { setBills([]); setCheckedBills(new Set()); setAlloc({}); return; }
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const partyRes = await sb.from('party').select('name').eq('id', partyId).maybeSingle();
    const partyName: string = partyRes?.data?.name ?? '';

    const { bills: all, error: loadErr } = await loadPartyBills(sb, partyId, partyName);
    if (loadErr) { setError(loadErr); setLoading(false); return; }

    // Keep only the account being settled — a receipt must never be able
    // to settle a payable.
    setBills(all.filter((b) => b.stream === stream));
    setCheckedBills(new Set());
    setAlloc({});
    setLoading(false);
  }, [partyId, supabase, stream]);

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
        case 'fabric':  out.push({ kind: 'fabric',  fabric_purchase_id: b.id, amount }); break;
        case 'agent':   out.push({ kind: 'agent',   agent_commission_id: b.id, amount }); break;
        case 'warp_beam': out.push({ kind: 'warp_beam', warp_beam_purchase_id: b.id, amount }); break;
      }
    }
    return out;
  }, [bills, checkedBills, alloc]);

  // Emit allocations every time they change.
  useEffect(() => {
    onAllocationsChange(allocations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocations]);

  // Emit ticked-bill selection independently of amount. This fires on
  // every checkbox toggle — useful for parents that need to act on
  // the TICK itself (e.g. credit-note line pre-fill, which needs the
  // ticked invoice id before any allocation amount is known).
  const selection = useMemo<SelectedBill[]>(() => {
    const out: SelectedBill[] = [];
    for (const b of bills) {
      if (!checkedBills.has(billKey(b))) continue;
      out.push({ kind: b.kind, id: b.id, balance: Number(b.balance) });
    }
    return out;
  }, [bills, checkedBills]);

  useEffect(() => {
    if (onSelectionChange) onSelectionChange(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

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

  // Name the account so it is obvious which of a multi-role party's
  // balances is being settled.
  const title = heading ?? `Unpaid ${STREAM_META[stream].label} bills`;

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
  agents:   { agent_commission_id: number; amount: number }[];
  warpBeams: { warp_beam_purchase_id: number; amount: number }[];
} {
  const invoices: { invoice_id: number;         amount: number }[] = [];
  const openings: { opening_ledger_id: number;  amount: number }[] = [];
  const sizings:  { sizing_job_id: number;      amount: number }[] = [];
  const bobbins:  { bobbin_purchase_id: number; amount: number }[] = [];
  const yarns:    { yarn_lot_id: number;        amount: number }[] = [];
  const fabrics:  { fabric_purchase_id: number; amount: number }[] = [];
  const agents:   { agent_commission_id: number; amount: number }[] = [];
  const warpBeams: { warp_beam_purchase_id: number; amount: number }[] = [];
  for (const a of allocations) {
    switch (a.kind) {
      case 'invoice': invoices.push({ invoice_id:         a.invoice_id,         amount: a.amount }); break;
      case 'opening': openings.push({ opening_ledger_id:  a.opening_ledger_id,  amount: a.amount }); break;
      case 'sizing':  sizings .push({ sizing_job_id:      a.sizing_job_id,      amount: a.amount }); break;
      case 'bobbin':  bobbins .push({ bobbin_purchase_id: a.bobbin_purchase_id, amount: a.amount }); break;
      case 'yarn':    yarns   .push({ yarn_lot_id:        a.yarn_lot_id,        amount: a.amount }); break;
      case 'fabric':  fabrics .push({ fabric_purchase_id: a.fabric_purchase_id, amount: a.amount }); break;
      case 'agent':   agents  .push({ agent_commission_id: a.agent_commission_id, amount: a.amount }); break;
      case 'warp_beam': warpBeams.push({ warp_beam_purchase_id: a.warp_beam_purchase_id, amount: a.amount }); break;
    }
  }
  return { invoices, openings, sizings, bobbins, yarns, fabrics, agents, warpBeams };
}
