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
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Search, FileDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Combobox, type ComboOption } from '@/app/components/combobox';
import { CardFilter } from '@/app/components/card-filter';
import { fetchLedgerView, withRunningBalance, ledgerTotals, type LedgerEntry } from './ledger-view-query';
import { ALL_STREAMS, STREAM_META, type PartyStream } from '@/lib/party-streams';

interface LedgerOpt {
  id: number;
  code: string;
  name: string;
  type_id: number | null;
  type_name: string | null;
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
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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

  // When a ledger is picked, back-fill its type so the operator can jump
  // straight to a ledger without first choosing a type.
  function onLedgerPick(next: string): void {
    setLedgerId(next);
    if (next) {
      const picked = ledgers.find((l) => String(l.id) === next);
      if (picked?.type_id != null && String(picked.type_id) !== typeId) {
        setTypeId(String(picked.type_id));
      }
    }
  }

  // Options for the two comboboxes. Ledger rows carry their code as a
  // muted hint so two ledgers sharing a name stay distinguishable.
  const typeOptions: ComboOption[] = useMemo(
    () => types.map((t) => ({ id: String(t.id), label: t.name })),
    [types],
  );
  const ledgerOptions: ComboOption[] = useMemo(
    () => filteredLedgers.map((l) => ({ id: String(l.id), label: l.name, hint: l.code })),
    [filteredLedgers],
  );

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

    try {
      const all = await fetchLedgerView(supabase, { ledgerId: numericId, startDate, endDate });
      setEntries(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Compute running balance per row + grand totals.
  const ledger = useMemo(() => withRunningBalance(entries), [entries]);
  const totals = useMemo(() => ledgerTotals(entries), [entries]);

  /** Per-account split of the rows that belong to a party account.
   *  A party can trade with us in several capacities at once and those
   *  balances are settled separately, so a single running total can
   *  hide that they owe us on one account while we owe them on another.
   *  Rows with no stream (wages, expenses, loans, direct bank movements)
   *  are not party-account rows and are excluded. */
  const streamSplit = useMemo(() => {
    const acc = new Map<PartyStream, { inflow: number; outflow: number }>();
    for (const e of entries) {
      if (!e.stream) continue;
      const cur = acc.get(e.stream) ?? { inflow: 0, outflow: 0 };
      cur.inflow  += Number(e.inflow  ?? 0);
      cur.outflow += Number(e.outflow ?? 0);
      acc.set(e.stream, cur);
    }
    return ALL_STREAMS
      .filter((s) => acc.has(s))
      .map((s) => {
        const v = acc.get(s)!;
        return {
          stream: s,
          label: STREAM_META[s].label,
          inflow: v.inflow,
          outflow: v.outflow,
          balance: Math.round((v.inflow - v.outflow) * 100) / 100,
        };
      });
  }, [entries]);

  // Display order: running balances are always computed oldest→newest,
  // but the table can show newest→oldest without changing the math.
  const displayLedger = useMemo(
    () => (sortDir === 'desc' ? [...ledger].reverse() : ledger),
    [ledger, sortDir],
  );

  return (
    <div className="space-y-4">
      {/* ── Cascading filter form ─────────────────────────────────────── */}
      <form onSubmit={handleShow} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div>
          <label className="label">Ledger type *</label>
          <Combobox
            options={typeOptions}
            value={typeId}
            onChange={onTypeChange}
            placeholder="Type or pick a type…"
            emptyText="No types"
          />
        </div>
        <div>
          <label className="label">Ledger *</label>
          <Combobox
            options={ledgerOptions}
            value={ledgerId}
            onChange={onLedgerPick}
            placeholder={typeId ? 'Type or pick a ledger…' : 'Type a name or pick…'}
            emptyText="No ledgers"
          />
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
          <div className="px-4 py-3 border-b border-line/40 bg-cloud/40 flex items-start justify-between gap-3">
            <div>
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
            {shownLedger && (
              <Link
                href={`/app/ledgers/print?ledger_id=${shownLedger.id}${startDate ? `&from=${startDate}` : ''}${endDate ? `&to=${endDate}` : ''}`}
                target="_blank"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
              >
                <FileDown className="w-3.5 h-3.5" />
                Download PDF
              </Link>
            )}
          </div>
          {/* Mobile / PWA: card view. The running-balance table is wide;
              below md each transaction renders as a tap-friendly card. The
              table is hidden on mobile and shown from md upward. */}
          <div className="p-3 md:hidden space-y-3">
            {/* Totals summary card — Total In / Out / Balance, matching the
                pivot column cards. The table's tfoot totals are hidden on
                mobile, so this surfaces the same figures up top. */}
            <div className="card p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total In</div>
                  <div className="num text-sm text-emerald-700">{fmtINR(totals.inflow)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total Out</div>
                  <div className="num text-sm text-rose-700">{fmtINR(totals.outflow)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Balance</div>
                  <div className={cn(
                    'num text-sm font-bold',
                    totals.balance > 0 ? 'text-emerald-700' : totals.balance < 0 ? 'text-rose-700' : 'text-ink-soft',
                  )}>
                    {fmtINR(totals.balance)}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                className="pill bg-cloud text-ink-soft text-[11px]"
              >
                Date {sortDir === 'asc' ? 'Oldest first ↑' : 'Newest first ↓'}
              </button>
            </div>
            <CardFilter placeholder="Search transactions…">
              {displayLedger.map((r) => (
                <div key={r.key} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-ink break-words">
                        {r.voucher}
                        {r.source !== 'payment' && (
                          <span className={cn(
                            'ml-1 pill text-[9px]',
                            r.source === 'wage'    ? 'bg-amber-50 text-amber-700'
                            : r.source === 'expense' ? 'bg-violet-50 text-violet-700'
                            : r.source === 'bill'  ? 'bg-indigo-50 text-indigo-700'
                            : r.source === 'bank'  ? 'bg-sky-50 text-sky-700'
                            : r.source === 'loan'  ? 'bg-rose-50 text-rose-700'
                                                   : 'bg-cloud text-ink-soft',
                          )}>
                            {r.source === 'bill'
                              ? (r.bill_kind ?? 'bill')
                              : r.source === 'bank'
                                ? (r.bill_kind === 'bank_in' ? 'bank in' : 'bank out')
                                : r.source}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-soft mt-0.5">{fmtDate(r.date)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wide text-ink-mute">Balance</div>
                      <div className={cn(
                        'num font-semibold',
                        r.balance > 0 ? 'text-emerald-700' : r.balance < 0 ? 'text-rose-700' : 'text-ink-soft',
                      )}>
                        {fmtINR(r.balance)}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-ink-soft mt-2">
                    {r.counterparty}
                    {r.mode && r.mode !== '-' && <span className="text-ink-mute"> · {r.mode}</span>}
                  </div>
                  {r.reference && (
                    <div className="text-xs text-ink-soft mt-0.5">
                      <span className="text-ink-mute">Ref: </span>{r.reference}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4 mt-2 pt-2 border-t border-line/40 text-xs">
                    <span>
                      <span className="text-ink-mute">Debit: </span>
                      <span className="num text-emerald-700">{r.inflow > 0 ? fmtINR(r.inflow) : '-'}</span>
                    </span>
                    <span>
                      <span className="text-ink-mute">Credit: </span>
                      <span className="num text-rose-700">{r.outflow > 0 ? fmtINR(r.outflow) : '-'}</span>
                    </span>
                  </div>
                </div>
              ))}
            </CardFilter>
          </div>

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left  px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink"
                      title="Click to toggle date sort order"
                    >
                      Date <span className="text-ink-mute">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    </button>
                  </th>
                  <th className="text-left  px-3 py-3">Voucher</th>
                  <th className="text-left  px-3 py-3 hidden md:table-cell">Counterparty</th>
                  <th className="text-left  px-3 py-3 hidden md:table-cell">Bank / Cash</th>
                  <th className="text-left  px-3 py-3 hidden lg:table-cell">Reference</th>
                  <th className="text-right px-3 py-3">Debit (₹)</th>
                  <th className="text-right px-3 py-3">Credit (₹)</th>
                  <th className="text-right px-3 py-3">Running balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {displayLedger.map((r) => (
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
                          : r.source === 'loan'  ? 'bg-rose-50 text-rose-700'
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
          {/* Per-account split — only when the bills on this ledger span
              more than one of the party's accounts, which is exactly when
              a single running total stops being actionable. */}
          {streamSplit.length > 1 && (
            <div className="px-4 py-3 border-t border-line/40 bg-amber-50/50">
              <div className="text-[10px] uppercase tracking-wide text-amber-900 font-semibold mb-2">
                This party trades with us on more than one account — settled separately
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {streamSplit.map((s) => (
                    <tr key={s.stream} className="border-t border-amber-200/60">
                      <td className="py-1.5 font-semibold">{s.label}</td>
                      <td className="py-1.5 text-right num text-emerald-700 w-32">{fmtINR(s.inflow)}</td>
                      <td className="py-1.5 text-right num text-rose-700 w-32">{fmtINR(s.outflow)}</td>
                      <td className={cn(
                        'py-1.5 text-right num font-bold w-32',
                        s.balance > 0 ? 'text-emerald-700' : s.balance < 0 ? 'text-rose-700' : 'text-ink-soft',
                      )}>
                        {fmtINR(s.balance)}
                      </td>
                      <td className="py-1.5 pl-3 text-[10px] text-ink-mute w-24">
                        {s.balance > 0 ? 'they owe' : s.balance < 0 ? 'we owe' : 'settled'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-3 border-t border-line/40 bg-cloud/20 text-[11px] text-ink-mute">
            Showing {sortDir === 'asc' ? 'oldest → newest' : 'newest → oldest'} (running balance is always built oldest → newest). Debit raises the running balance (Dr); Credit lowers it (Cr). A positive running balance means the party owes you (Dr); negative means you owe the party (Cr).
          </div>
        </div>
      )}
    </div>
  );
}
