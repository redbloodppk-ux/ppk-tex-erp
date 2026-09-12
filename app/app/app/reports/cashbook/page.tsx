/**
 * Daily Cash Book
 *
 * PPK, 2026-09-12: "we need daily cashbook register in reports."
 *
 * One day of the cash drawer: opening brought forward, every movement in
 * the order it was entered, and the balance after each one. Shown as a
 * running-balance list rather than the traditional two-sided cash book —
 * PPK picked that layout from the two mock-ups because it reads on a
 * phone, where the two-sided form has to be scrolled sideways.
 *
 * Every figure comes from fn_cash_book_day (migration 295), which is built
 * on fn_cash_movements — the same rows fn_cash_in_hand adds up for the
 * dashboard card. Nothing is recomputed here, so the report and the card
 * cannot disagree.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { formatRupee } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Wallet, AlertTriangle } from 'lucide-react';

export const metadata = { title: 'Daily Cash Book' };
export const dynamic = 'force-dynamic';

interface BookRow {
  seq: number;
  voucher: string | null;
  particulars: string | null;
  cash_in: number | string | null;
  cash_out: number | string | null;
  running: number | string | null;
  ref_kind: string | null;
  ref_id: number | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Whole rupees, grouped Indian-style. Cash is counted in notes, so paise
 *  are never meaningful and they cost width on a phone. */
function rupees(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '';
  return Math.round(Number(v)).toLocaleString('en-IN');
}

/** Where a row's voucher lives, so a figure can be traced back to what
 *  created it. Wages and advances have no single-record screen, so those
 *  land on the list filtered to the day. */
function hrefFor(r: BookRow, date: string): string | null {
  switch (r.ref_kind) {
    case 'payment':      return `/app/payments?id=${r.ref_id}`;
    case 'bank_entry':   return `/app/bank-entries?id=${r.ref_id}`;
    case 'expense_entry':return `/app/expenses?date=${date}`;
    case 'wage_entry':   return `/app/wages?date=${date}`;
    // Employee advances have no per-record screen; the statement report is
    // where they are read.
    case 'employee_loan':return `/app/reports/employee-loan-statement`;
    default:             return null;
  }
}

export default async function CashBookReport({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();

  const supabase = await createClient();

  // Cast because database.types.ts predates migration 295 and does not know
  // this function yet. Regenerate and drop the cast next time the types are
  // refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('fn_cash_book_day', {
    p_date: date,
  });

  const rows: BookRow[] = Array.isArray(data) ? (data as BookRow[]) : [];
  const opening = rows.find((r) => r.seq === 0);
  const movements = rows.filter((r) => r.seq > 0);

  const openingBal = Number(opening?.running ?? 0);
  const totalIn = movements.reduce((s, r) => s + Number(r.cash_in ?? 0), 0);
  const totalOut = movements.reduce((s, r) => s + Number(r.cash_out ?? 0), 0);
  const lastRow = movements[movements.length - 1];
  const closing = lastRow ? Number(lastRow.running ?? 0) : openingBal;

  const prev = shiftDay(date, -1);
  const next = shiftDay(date, 1);
  const canGoNext = next <= today();

  const exportColumns: ExcelColumn[] = [
    { key: 'voucher', label: 'Voucher', type: 'text' },
    { key: 'particulars', label: 'Particulars', type: 'text' },
    { key: 'cash_in', label: 'Cash in', type: 'number' },
    { key: 'cash_out', label: 'Cash out', type: 'number' },
    { key: 'running', label: 'Balance', type: 'number' },
  ];

  return (
    <div>
      <PageHeader
        title="Daily Cash Book"
        subtitle="Opening, every movement through the drawer, and the balance after each one."
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Cash Book' }]}
        actions={
          movements.length > 0 ? (
            <ExcelExportButton
              filename={`cash-book-${date}`}
              sheetName="Cash Book"
              title={`Cash Book — ${fmtDate(date)}`}
              columns={exportColumns}
              rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
            />
          ) : undefined
        }
      />

      {/* Day picker. Arrows are plain links so the page stays a server
          component; the date box submits as a normal GET. */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/app/reports/cashbook?date=${prev}`}
          aria-label="Previous day"
          className="btn-ghost min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <form method="GET" className="flex items-center gap-2">
          <input
            name="date"
            type="date"
            defaultValue={date}
            max={today()}
            className="input"
            aria-label="Date"
          />
          <button type="submit" className="btn-primary min-h-[44px]">
            Show
          </button>
        </form>
        {canGoNext ? (
          <Link
            href={`/app/reports/cashbook?date=${next}`}
            aria-label="Next day"
            className="btn-ghost min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
        ) : (
          <span className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-mute opacity-40">
            <ChevronRight className="w-4 h-4" />
          </span>
        )}
        <span className="text-xs text-ink-mute ml-1">{fmtDate(date)}</span>
      </div>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load the cash book: {error.message}
        </div>
      )}

      {/* Closing first and large — it is the one number PPK checks against
          the notes in the drawer. */}
      <div
        className={`card p-4 mb-3 ${
          closing < 0 ? 'border border-rose-200 bg-rose-50/50' : ''
        }`}
      >
        <div className="flex items-center gap-2 text-xs text-ink-mute">
          <Wallet className="w-4 h-4" />
          Cash in hand at close
        </div>
        <div
          className={`text-3xl font-semibold mt-1 break-words ${
            closing < 0 ? 'text-rose-700' : 'text-ink'
          }`}
        >
          {formatRupee(closing, { decimals: 0 })}
        </div>
        {closing < 0 && (
          <div className="flex items-start gap-2 text-xs text-rose-700 mt-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              A negative drawer is not possible — a receipt is missing, or an
              opening balance is wrong.
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Opening</div>
          <div className="text-base font-semibold mt-1 break-words">
            {rupees(openingBal)}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Cash in</div>
          <div className="text-base font-semibold mt-1 text-emerald-700 break-words">
            {rupees(totalIn)}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Cash out</div>
          <div className="text-base font-semibold mt-1 text-rose-700 break-words">
            {rupees(totalOut)}
          </div>
        </div>
      </div>

      {movements.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No cash moved on {fmtDate(date)} — the drawer opened and closed at{' '}
          {formatRupee(openingBal, { decimals: 0 })}.
        </div>
      ) : (
        <>
          {/* Phone: one row per voucher, amount on the right with the
              running balance under it. */}
          <div className="md:hidden card p-0 divide-y divide-line/40">
            <div className="flex items-start justify-between gap-3 p-3">
              <div className="text-sm text-ink-mute">Opening balance</div>
              <div className="text-sm text-ink-mute tabular-nums shrink-0">
                {rupees(openingBal)}
              </div>
            </div>
            {movements.map((r) => {
              const href = hrefFor(r, date);
              const body = (
                <div className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ink break-words">
                      {r.particulars ?? '—'}
                    </div>
                    {r.voucher && (
                      <div className="text-xs text-ink-mute mt-0.5">
                        {r.voucher}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm font-semibold tabular-nums ${
                        r.cash_in ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {r.cash_in
                        ? `+${rupees(r.cash_in)}`
                        : `−${rupees(r.cash_out)}`}
                    </div>
                    <div className="text-xs text-ink-mute tabular-nums mt-0.5">
                      {rupees(r.running)}
                    </div>
                  </div>
                </div>
              );
              return href ? (
                <Link
                  key={r.seq}
                  href={href}
                  className="block hover:bg-cloud/20"
                >
                  {body}
                </Link>
              ) : (
                <div key={r.seq}>{body}</div>
              );
            })}
          </div>

          {/* Desktop: the same rows as a table. */}
          <div className="card p-0 overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
                <tr>
                  <th className="text-left px-3 py-2 w-40">Voucher</th>
                  <th className="text-left px-3 py-2">Particulars</th>
                  <th className="text-right px-3 py-2 w-28">Cash in</th>
                  <th className="text-right px-3 py-2 w-28">Cash out</th>
                  <th className="text-right px-3 py-2 w-32">Balance</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-line/40 text-ink-mute">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">Opening balance</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">{rupees(openingBal)}</td>
                </tr>
                {movements.map((r) => {
                  const href = hrefFor(r, date);
                  return (
                    <tr
                      key={r.seq}
                      className="border-t border-line/40 hover:bg-cloud/20"
                    >
                      <td className="px-3 py-2 text-xs">
                        {href && r.voucher ? (
                          <Link href={href} className="text-sky-700 hover:underline">
                            {r.voucher}
                          </Link>
                        ) : (
                          (r.voucher ?? '')
                        )}
                      </td>
                      <td className="px-3 py-2">{r.particulars ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">
                        {rupees(r.cash_in)}
                      </td>
                      <td className="px-3 py-2 text-right text-rose-700">
                        {rupees(r.cash_out)}
                      </td>
                      <td className="px-3 py-2 text-right">{rupees(r.running)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-line font-semibold">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">Closing — cash in hand</td>
                  <td className="px-3 py-2 text-right">{rupees(totalIn)}</td>
                  <td className="px-3 py-2 text-right">{rupees(totalOut)}</td>
                  <td className="px-3 py-2 text-right">{rupees(closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
