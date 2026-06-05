'use client';
/**
 * LedgerViewTab — chronological transaction view for a single ledger.
 *
 * The operator picks a ledger by name from the dropdown, and we list
 * every payment that touches that ledger in date order with a running
 * balance column. A payment touches the ledger in one of two ways:
 *
 *   1. The payment's party is the ledger's owner (e.g. picking a
 *      CUSTOMER ledger shows every receipt from that customer; picking
 *      a SUPPLIER ledger shows every payment to that supplier).
 *
 *   2. The payment's mode (Bank / Cash ledger) is this ledger (e.g.
 *      picking the "HDFC Current A/C" BANK ledger shows every receipt
 *      or payment that flowed through that bank account).
 *
 * Running balance convention:
 *   inflow  → +
 *   outflow → -
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LedgerOpt {
  id: number;
  code: string;
  name: string;
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
  // Joined party (for the "Counterparty" column)
  party: { id: number; code: string; name: string } | null;
  // Joined mode ledger (for the "Bank / Cash" column)
  mode_ledger: { id: number; name: string } | null;
}

interface PartyByLedger {
  id: number;
  ledger_id: number;
}

interface Props {
  /** Pre-loaded ledger list (id, code, name, type) sourced server-side
   *  so the dropdown renders without an extra round-trip. */
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ledgerId = searchParams.get('ledger') ?? '';

  function pickLedger(next: string): void {
    const sp = new URLSearchParams(searchParams.toString());
    if (next) sp.set('ledger', next);
    else      sp.delete('ledger');
    router.push(`${pathname}?${sp.toString()}`);
  }

  const supabase = createClient();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading,  setLoading]  = useState<boolean>(false);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ledgerId) { setPayments([]); return; }
    setLoading(true);
    setError(null);

    const numericId = Number(ledgerId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Step 1: find every party whose ledger_id == picked ledger. Their
    // payment rows count as activity against this ledger via the
    // party-side. Most parties only have one ledger; a few share (e.g.
    // joint ventures) — we union all matching party ids.
    const { data: matchingParties, error: partyErr } = await sb
      .from('party')
      .select('id, ledger_id')
      .eq('ledger_id', numericId);
    if (partyErr) { setError(partyErr.message); setLoading(false); return; }
    const partyIds: number[] = ((matchingParties ?? []) as PartyByLedger[])
      .map((p) => p.id);

    // Step 2: pull every payment where:
    //   - mode_ledger_id == picked ledger (BANK/CASH side), OR
    //   - party_id IN partyIds (party-side, e.g. CUSTOMER/SUPPLIER)
    // Supabase's .or() lets us combine the two conditions in one query.
    const orParts: string[] = [`mode_ledger_id.eq.${numericId}`];
    if (partyIds.length > 0) {
      orParts.push(`party_id.in.(${partyIds.join(',')})`);
    }
    const { data, error: payErr } = await sb
      .from('payment')
      .select(`
        id, payment_no, payment_date, direction, amount, reference, notes,
        party_id, mode_ledger_id,
        party:party_id ( id, code, name ),
        mode_ledger:mode_ledger_id ( id, name )
      `)
      .eq('status', 'active')
      .or(orParts.join(','))
      .order('payment_date', { ascending: true })
      .order('id', { ascending: true });

    if (payErr) { setError(payErr.message); setLoading(false); return; }
    setPayments((data ?? []) as unknown as PaymentRow[]);
    setLoading(false);
  }, [ledgerId, supabase]);

  useEffect(() => { void load(); }, [load]);

  // Compute running balance. Sign convention:
  //   - For the SELECTED ledger:
  //     - 'in'  payments increase the running balance (money flowing in)
  //     - 'out' payments decrease it
  //   This holds true for both the party-side view (e.g. a customer's
  //   inflow is money coming IN to us = customer's account decreases)
  //   and the bank-side view (a receipt is money INTO the bank).
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
    const inflow  = ledger.reduce((s, r) => s + r.inflow,  0);
    const outflow = ledger.reduce((s, r) => s + r.outflow, 0);
    return { inflow, outflow, balance: inflow - outflow };
  }, [ledger]);

  const pickedLedger = useMemo(
    () => ledgers.find((l) => String(l.id) === ledgerId) ?? null,
    [ledgers, ledgerId],
  );

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="label">Ledger *</label>
        <select
          className="input"
          value={ledgerId}
          onChange={(e) => pickLedger(e.target.value)}
        >
          <option value="">— Pick a ledger to see its transaction history —</option>
          {ledgers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}{l.type_name ? ` (${l.type_name})` : ''}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-ink-mute mt-2">
          Shows every payment that touches the chosen ledger — whether it&apos;s the party (customer / supplier / vendor) or the bank / cash account the money moved through.
        </p>
      </div>

      {error && <div className="card p-3 text-sm text-err">{error}</div>}

      {!ledgerId ? (
        <div className="card p-6 text-sm text-ink-soft">
          Pick a ledger above to see its inflow / outflow history.
        </div>
      ) : loading ? (
        <div className="card p-6 flex items-center gap-2 text-sm text-ink-mute">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : ledger.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No payments recorded yet for <span className="font-semibold">{pickedLedger?.name ?? 'this ledger'}</span>.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/40 bg-cloud/40">
            <div className="text-xs uppercase tracking-wider text-ink-mute">Transaction ledger for</div>
            <div className="font-semibold text-ink">
              {pickedLedger?.name}
              {pickedLedger?.type_name && (
                <span className="ml-2 pill bg-indigo-50 text-indigo-700">{pickedLedger.type_name}</span>
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
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-3 text-ink-soft">{fmtDate(r.payment_date)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{r.payment_no}</td>
                    <td className="px-3 py-3 hidden md:table-cell text-ink-soft">
                      {r.party?.name ?? '-'}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell text-xs text-ink-soft">
                      {r.mode_ledger?.name ?? '-'}
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell text-xs text-ink-soft">
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
            Sorted oldest → newest. Inflows are payments received; outflows are payments paid out. The running balance is the cumulative inflow minus outflow.
          </div>
        </div>
      )}
    </div>
  );
}
