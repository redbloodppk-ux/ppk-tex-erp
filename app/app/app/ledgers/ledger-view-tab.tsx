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
 * The result table merges three sources in date order with a running
 * balance column:
 *
 *   - payment         — receipts / payments to / from parties or via
 *                       BANK / CASH ledgers
 *   - wage_entry      — wages tagged to a WAGES-type ledger
 *   - expense_entry   — expenses tagged to an EXPENSES-type ledger
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
// from a payment, a wage_entry, or an expense_entry, we project it
// into this common shape so the table render is a single loop.
interface LedgerEntry {
  key:           string;
  source:        'payment' | 'wage' | 'expense';
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
    const { data: matchingParties, error: partyErr } = await sb
      .from('party')
      .select('id, ledger_id')
      .eq('ledger_id', numericId);
    if (partyErr) { setError(partyErr.message); setLoading(false); return; }
    const partyIds: number[] = ((matchingParties ?? []) as PartyByLedger[])
      .map((p) => p.id);

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
      .select('id, pay_date, amount, kind, notes, employee:employee_id ( name )')
      .eq('target_ledger_id', numericId);
    if (startDate) wagesQ = wagesQ.gte('pay_date', startDate);
    if (endDate)   wagesQ = wagesQ.lte('pay_date', endDate);

    let expensesQ = sb.from('expense_entry')
      .select('id, pay_date, amount, category, notes')
      .eq('target_ledger_id', numericId);
    if (startDate) expensesQ = expensesQ.gte('pay_date', startDate);
    if (endDate)   expensesQ = expensesQ.lte('pay_date', endDate);

    const [wagesRes, expensesRes] = await Promise.all([wagesQ, expensesQ]);
    if (wagesRes.error)    { setError(wagesRes.error.message);    setLoading(false); return; }
    if (expensesRes.error) { setError(expensesRes.error.message); setLoading(false); return; }

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
        counterparty: w.employee?.name ?? '-',
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
                                                 : 'bg-violet-50 text-violet-700',
                        )}>
                          {r.source}
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
            Sorted oldest → newest. Inflows are payments received; outflows are payments paid out (including wages and expenses tagged to this ledger).
          </div>
        </div>
      )}
    </div>
  );
}
