/**
 * Employee Loan Statement
 *
 * Per-worker loan ledger. Two underlying sources:
 *   - employee_loan       â†’ cash advances GIVEN to the worker  (disbursement, +)
 *   - wage_entry.loan_deduction â†’ repayment WITHHELD from wages (repayment, âˆ’)
 *
 * Outstanding for an employee = SUM(disbursements) âˆ’ SUM(repayments).
 * There is no separate repayments table.
 *
 * Top section: per-employee summary (disbursed / repaid in the window, plus
 * the true all-time outstanding). Pick an employee to drill into a dated
 * ledger with a running outstanding balance (opening balance carried in).
 *
 * Filters via querystring:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (defaults: start of FY â†’ today)
 *   ?emp=123                         (optional â€” opens the drill-down)
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { Users, HandCoins, Wallet, AlertCircle } from 'lucide-react';
import { recordDateBounds, clampDate, ALL_SOURCES } from '@/lib/reports/record-bounds';

export const metadata = { title: 'Employee Loan Statement' };
export const dynamic = 'force-dynamic';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ source row shapes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface LoanRow {
  id: number;
  loan_date: string;
  amount: number | null;
  notes: string | null;
  employee_id: number;
  employee: { code: string | null; full_name: string | null } | null;
}

interface DeductionRow {
  id: number;
  pay_date: string;
  loan_deduction: number | null;
  employee_id: number;
  employee: { code: string | null; full_name: string | null } | null;
}

/* a single ledger event, normalised across the two sources */
interface LedgerEvent {
  kind: 'loan' | 'repay';
  date: string;
  amount: number; // always positive; kind decides the sign
  notes: string | null;
  employee_id: number;
}

interface EmpSummary {
  employee_id: number;
  code: string | null;
  full_name: string | null;
  disbursedWin: number;
  repaidWin: number;
  outstandingAll: number; // true all-time balance
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function startOfFinYearISO(): string {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return 'â€”';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  return (
    sign +
    'â‚¹' +
    Math.abs(num).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return 'â€”';
  return Number(n).toLocaleString('en-IN');
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'â€”';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    emp?: string;
  }>;
}

export default async function EmployeeLoanStatement({ searchParams }: PageProps) {
  const sp = await searchParams;
  const fromRaw = sp.from ?? startOfFinYearISO();
  const toRaw = sp.to ?? todayISO();
  const empParam = sp.emp ?? '';
  const empId = empParam && /^\d+$/.test(empParam) ? Number(empParam) : null;

  const supabase = await createClient();

  // Keep the pickers inside the dates the books actually reach.
  // See lib/reports/record-bounds.
  const bounds = await recordDateBounds(supabase, ALL_SOURCES);
  const from = clampDate(fromRaw, bounds);
  const to = clampDate(toRaw, bounds);

  // employee_loan / wage_entry.loan_deduction added in migration 219 â€” types
  // not yet regenerated, cast through any. Runtime shapes asserted below.
  // We pull the FULL history (no date filter) so the all-time outstanding and
  // the opening balance for the drill-down are correct. Window filtering is
  // done in memory.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loansRes = await (supabase as any)
    .from('employee_loan')
    .select('id, loan_date, amount, notes, employee_id, employee:employee_id ( code, full_name )')
    .order('loan_date', { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dedRes = await (supabase as any)
    .from('wage_entry')
    .select('id, pay_date, loan_deduction, employee_id, employee:employee_id ( code, full_name )')
    .gt('loan_deduction', 0)
    .order('pay_date', { ascending: true });

  const error = loansRes.error ?? dedRes.error;
  const loans = (loansRes.data as unknown as LoanRow[]) ?? [];
  const deductions = (dedRes.data as unknown as DeductionRow[]) ?? [];

  /* normalise into a single all-time event list */
  const allEvents: LedgerEvent[] = [
    ...loans.map((l) => ({
      kind: 'loan' as const,
      date: l.loan_date,
      amount: Number(l.amount ?? 0),
      notes: l.notes,
      employee_id: l.employee_id,
    })),
    ...deductions.map((d) => ({
      kind: 'repay' as const,
      date: d.pay_date,
      amount: Number(d.loan_deduction ?? 0),
      notes: null,
      employee_id: d.employee_id,
    })),
  ];

  /* employee name lookup (prefer loan rows, fall back to deduction rows) */
  const nameById = new Map<number, { code: string | null; full_name: string | null }>();
  for (const l of loans) {
    if (l.employee && !nameById.has(l.employee_id)) nameById.set(l.employee_id, l.employee);
  }
  for (const d of deductions) {
    if (d.employee && !nameById.has(d.employee_id)) nameById.set(d.employee_id, d.employee);
  }

  /* per-employee roll-up */
  const byEmp = new Map<number, EmpSummary>();
  function ensureEmp(id: number): EmpSummary {
    let e = byEmp.get(id);
    if (!e) {
      const nm = nameById.get(id) ?? null;
      e = {
        employee_id: id,
        code: nm?.code ?? null,
        full_name: nm?.full_name ?? null,
        disbursedWin: 0,
        repaidWin: 0,
        outstandingAll: 0,
      };
      byEmp.set(id, e);
    }
    return e;
  }

  for (const ev of allEvents) {
    const e = ensureEmp(ev.employee_id);
    // all-time outstanding
    e.outstandingAll += ev.kind === 'loan' ? ev.amount : -ev.amount;
    // window figures
    if (ev.date >= from && ev.date <= to) {
      if (ev.kind === 'loan') e.disbursedWin += ev.amount;
      else e.repaidWin += ev.amount;
    }
  }

  // Only show employees that have any loan history; sort by outstanding desc.
  const emps = Array.from(byEmp.values())
    .filter((e) => e.disbursedWin > 0 || e.repaidWin > 0 || e.outstandingAll !== 0)
    .sort((a, b) => b.outstandingAll - a.outstandingAll);

  /* totals */
  const tDisbursedWin = emps.reduce((s, e) => s + e.disbursedWin, 0);
  const tRepaidWin = emps.reduce((s, e) => s + e.repaidWin, 0);
  const tOutstanding = emps.reduce((s, e) => s + e.outstandingAll, 0);

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ drill-down for a selected employee â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const selected = empId != null ? byEmp.get(empId) ?? null : null;

  // opening balance = net of all events strictly before `from`
  let opening = 0;
  const windowEvents: LedgerEvent[] = [];
  if (empId != null) {
    for (const ev of allEvents) {
      if (ev.employee_id !== empId) continue;
      if (ev.date < from) {
        opening += ev.kind === 'loan' ? ev.amount : -ev.amount;
      } else if (ev.date <= to) {
        windowEvents.push(ev);
      }
    }
    windowEvents.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      // disbursement before repayment on the same date
      return a.kind === b.kind ? 0 : a.kind === 'loan' ? -1 : 1;
    });
  }

  // build running-balance rows
  let running = opening;
  const ledgerRows = windowEvents.map((ev) => {
    running += ev.kind === 'loan' ? ev.amount : -ev.amount;
    return { ev, balance: running };
  });

  const dateQs = `from=${from}&to=${to}`;

  return (
    <div>
      <PageHeader
        title="Employee Loan Statement"
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Employee Loan Statement' },
        ]}
        subtitle={`Cash advances given to workers and repayments withheld from their wages between ${from} and ${to}. Outstanding is the true running balance: total ever disbursed minus total ever repaid.`}
      />

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Filter strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <form className="card p-3 mb-4 flex flex-wrap gap-3 items-end text-sm" action="">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">From</span>
          <input type="date" name="from" defaultValue={from} min={bounds?.min} max={bounds?.max} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={to} min={from || bounds?.min} max={bounds?.max} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Employee</span>
          <select name="emp" defaultValue={empParam} className="input min-w-[200px]">
            <option value="">All employees</option>
            {emps.map((e) => (
              <option key={e.employee_id} value={e.employee_id}>
                {e.code ? `${e.code} â€” ${e.full_name}` : e.full_name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
        <a
          href="/app/reports/employee-loan-statement"
          className="text-xs text-ink-mute self-center hover:text-ink underline"
        >
          Reset
        </a>
      </form>

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ KPI strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi
          icon={<Users className="w-4 h-4" />}
          label="Workers with loans"
          value={fmtNum(emps.length)}
        />
        <Kpi
          icon={<HandCoins className="w-4 h-4" />}
          label="Disbursed (window)"
          value={fmtRupees(tDisbursedWin)}
          sub={`given between ${from} and ${to}`}
        />
        <Kpi
          icon={<Wallet className="w-4 h-4" />}
          label="Repaid (window)"
          value={fmtRupees(tRepaidWin)}
          sub="withheld from wages"
        />
        <Kpi
          icon={<Wallet className="w-4 h-4" />}
          label="Outstanding (all-time)"
          value={fmtRupees(tOutstanding)}
          sub="still owed by workers"
        />
      </div>

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Error / empty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {error && (
        <div className="card p-4 text-sm text-err mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load loan data.</div>
            <div className="text-xs opacity-80 mt-1">{error.message}</div>
          </div>
        </div>
      )}

      {!error && emps.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No employee loans recorded.{' '}
          <Link href="/app/loans/new" className="text-indigo font-semibold">
            Issue the first one â†’
          </Link>
        </div>
      ) : null}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Per-employee summary (mobile cards) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {emps.length > 0 && (
        <CardFilter placeholder="Search workersâ€¦" className="mb-6">
          {emps.map((e) => {
            const isSel = e.employee_id === empId;
            return (
              <div key={e.employee_id} className={`card p-3 ${isSel ? 'bg-haze/60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/app/reports/employee-loan-statement?${dateQs}&emp=${e.employee_id}`}
                      className="font-semibold text-indigo hover:underline break-words"
                    >
                      {e.full_name ?? 'â€”'}
                    </Link>
                    {e.code ? (
                      <span className="ml-1 text-xs text-ink-mute">({e.code})</span>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">
                      Outstanding
                    </div>
                    <div className="num font-semibold text-base text-rose-700">
                      {fmtRupees(e.outstandingAll, 2)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-ink-soft mt-2 pt-2 border-t border-line/40">
                  <div>
                    Disbursed: <span className="num">{fmtRupees(e.disbursedWin, 2)}</span>
                  </div>
                  <div className="text-emerald-700">
                    Repaid: <span className="num">{fmtRupees(e.repaidWin, 2)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </CardFilter>
      )}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Per-employee summary (desktop table) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {emps.length > 0 && (
        <div className="card p-0 overflow-x-auto mb-6 hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Worker</th>
                <th className="text-right px-3 py-2">Disbursed (window)</th>
                <th className="text-right px-3 py-2">Repaid (window)</th>
                <th className="text-right px-3 py-2">Outstanding (all-time)</th>
              </tr>
            </thead>
            <tbody>
              {emps.map((e) => {
                const isSel = e.employee_id === empId;
                return (
                  <tr
                    key={e.employee_id}
                    className={`border-t border-line/40 ${isSel ? 'bg-haze/60' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/app/reports/employee-loan-statement?${dateQs}&emp=${e.employee_id}`}
                        className="font-medium text-indigo hover:underline"
                      >
                        {e.full_name ?? 'â€”'}
                      </Link>
                      {e.code ? (
                        <span className="ml-1 text-xs text-ink-mute">({e.code})</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right num text-ink-soft">
                      {fmtRupees(e.disbursedWin, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-emerald-700">
                      {fmtRupees(e.repaidWin, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold text-rose-700">
                      {fmtRupees(e.outstandingAll, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-cloud/40 font-semibold text-xs">
              <tr className="border-t-2 border-line">
                <td className="px-3 py-2">Totals ({emps.length} workers)</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tDisbursedWin, 2)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tRepaidWin, 2)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tOutstanding, 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Drill-down ledger for a selected worker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {selected && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">
              {selected.full_name}
              {selected.code ? (
                <span className="ml-1 text-sm text-ink-mute">({selected.code})</span>
              ) : null}{' '}
              â€” loan ledger
            </h2>
            <a
              href={`/app/reports/employee-loan-statement?${dateQs}`}
              className="text-xs text-ink-mute hover:text-ink underline"
            >
              Close
            </a>
          </div>

          {/* Mobile cards */}
          <CardFilter placeholder="Search ledgerâ€¦">
            <div className="card p-3 bg-cloud/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-mute">Opening balance (before {from})</span>
                <span className="num font-semibold">{fmtRupees(opening, 2)}</span>
              </div>
            </div>
            {ledgerRows.length ? (
              ledgerRows.map(({ ev, balance }, i) => (
                <div key={i} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span
                        className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                          ev.kind === 'loan'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {ev.kind === 'loan' ? 'Loan given' : 'Repaid'}
                      </span>
                      <div className="text-xs text-ink-soft mt-1 num">{fmtDate(ev.date)}</div>
                      {ev.notes ? (
                        <div className="text-xs text-ink-mute mt-0.5">{ev.notes}</div>
                      ) : null}
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`num font-semibold ${
                          ev.kind === 'loan' ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {ev.kind === 'loan' ? '+' : 'âˆ’'}
                        {fmtRupees(ev.amount, 2)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-ink-mute mt-0.5">
                        Balance
                      </div>
                      <div className="num text-sm">{fmtRupees(balance, 2)}</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="card p-6 text-center text-sm text-ink-mute">
                No loan activity in this window. Closing balance {fmtRupees(opening, 2)}.
              </div>
            )}
          </CardFilter>

          {/* Desktop table */}
          <div className="card p-0 overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Notes</th>
                  <th className="text-right px-3 py-2">Given</th>
                  <th className="text-right px-3 py-2">Repaid</th>
                  <th className="text-right px-3 py-2">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line/40 bg-cloud/20">
                  <td className="px-3 py-2 text-ink-mute" colSpan={5}>
                    Opening balance (before {from})
                  </td>
                  <td className="px-3 py-2 text-right num font-medium">
                    {fmtRupees(opening, 2)}
                  </td>
                </tr>
                {ledgerRows.length ? (
                  ledgerRows.map(({ ev, balance }, i) => (
                    <tr key={i} className="border-t border-line/40">
                      <td className="px-3 py-2 whitespace-nowrap num">{fmtDate(ev.date)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                            ev.kind === 'loan'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                        >
                          {ev.kind === 'loan' ? 'Loan given' : 'Repaid'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-soft">{ev.notes ?? 'â€”'}</td>
                      <td className="px-3 py-2 text-right num text-rose-700">
                        {ev.kind === 'loan' ? fmtRupees(ev.amount, 2) : 'â€”'}
                      </td>
                      <td className="px-3 py-2 text-right num text-emerald-700">
                        {ev.kind === 'repay' ? fmtRupees(ev.amount, 2) : 'â€”'}
                      </td>
                      <td className="px-3 py-2 text-right num font-semibold">
                        {fmtRupees(balance, 2)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-mute">
                      No loan activity in this window.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-cloud/40 font-semibold text-xs">
                <tr className="border-t-2 border-line">
                  <td className="px-3 py-2" colSpan={3}>
                    Window: {selected.full_name}
                  </td>
                  <td className="px-3 py-2 text-right num">
                    {fmtRupees(selected.disbursedWin, 2)}
                  </td>
                  <td className="px-3 py-2 text-right num">{fmtRupees(selected.repaidWin, 2)}</td>
                  <td className="px-3 py-2 text-right num">
                    {fmtRupees(selected.outstandingAll, 2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-mute mt-4">
        Disbursements come from the Loans page (<span className="font-mono">employee_loan</span>);
        repayments are the Loan repayment field on each wage entry
        (<span className="font-mono">wage_entry.loan_deduction</span>). Outstanding is total ever
        given minus total ever repaid, so it is unaffected by the date window. Pick a worker to see
        their dated ledger with the running balance carried in from before the window.
      </p>
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ presentational helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function Kpi({ icon, label, value, sub }: KpiProps) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-mute">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub ? <div className="text-[11px] text-ink-mute mt-0.5">{sub}</div> : null}
    </div>
  );
}
