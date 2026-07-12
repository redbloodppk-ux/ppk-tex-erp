/**
 * Employee loans register
 *
 * Server component. Lists employee_loan rows (cash disbursements given to
 * workers) with a per-employee outstanding summary. Repayments are NOT
 * stored here — they are loan_deduction values on wage_entry rows. So
 * outstanding for an employee = SUM(employee_loan.amount) -
 * SUM(wage_entry.loan_deduction). Owner/accounts write; mill_manager/auditor
 * read.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil } from 'lucide-react';
import { formatRupee } from '@/lib/utils';
import { DeleteLoanButton } from './delete-loan-button';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Loans' };
export const dynamic = 'force-dynamic';

interface LoanRow {
  id: number;
  loan_date: string;
  amount: number;
  notes: string | null;
  employee: { code: string; full_name: string } | null;
  source: { name: string } | null;
}

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ emp?: string }>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const empId = sp.emp != null && /^\d+$/.test(sp.emp) ? Number(sp.emp) : null;

  const supabase = await createClient();

  // employee_loan was added in migration 219 — types not yet regenerated,
  // cast through any. Runtime shape asserted via LoanRow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('employee_loan')
    .select(`
      id, loan_date, amount, notes,
      employee:employee_id ( code, full_name ),
      source:source_ledger_id ( name )
    `)
    .order('loan_date', { ascending: false })
    .limit(300);

  if (empId != null) query = query.eq('employee_id', empId);

  const { data, error } = await query;
  const rows = (data as unknown as LoanRow[]) ?? [];

  // Employee dropdown options.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: empData } = await (supabase as any)
    .from('employee')
    .select('id, code, full_name')
    .order('full_name', { ascending: true });
  const employees = ((empData ?? []) as Array<{ id: number; code: string; full_name: string }>);

  // Outstanding = total disbursed - total repaid (loan_deduction on wages).
  // Fetched with employee_id so we can also break both down per employee.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allLoans } = await (supabase as any)
    .from('employee_loan')
    .select('employee_id, amount, loan_date');
  const loanAgg = (allLoans ?? []) as Array<{ employee_id: number; amount: number; loan_date: string }>;
  const totalDisbursedAll = loanAgg.reduce((acc, r) => acc + Number(r.amount || 0), 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allDeductions } = await (supabase as any)
    .from('wage_entry')
    .select('id, employee_id, loan_deduction, pay_date');
  const dedAgg = (allDeductions ?? []) as Array<{ id: number; employee_id: number; loan_deduction: number | null; pay_date: string }>;
  const totalRepaidAll = dedAgg.reduce((acc, r) => acc + Number(r.loan_deduction || 0), 0);

  const totalOutstanding = totalDisbursedAll - totalRepaidAll;
  const shownTotal = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);

  // Per-employee summary: disbursed / repaid / outstanding. Only employees
  // with at least one loan appear.
  const empById = new Map(employees.map((e) => [e.id, e]));
  const perEmp = new Map<number, { disbursed: number; repaid: number }>();
  for (const r of loanAgg) {
    const s = perEmp.get(r.employee_id) ?? { disbursed: 0, repaid: 0 };
    s.disbursed += Number(r.amount || 0);
    perEmp.set(r.employee_id, s);
  }
  for (const r of dedAgg) {
    const ded = Number(r.loan_deduction || 0);
    if (!ded) continue;
    const s = perEmp.get(r.employee_id);
    if (!s) continue; // repayment without a loan row — ignore in this table
    s.repaid += ded;
  }
  const empSummary = Array.from(perEmp.entries())
    .filter(([id]) => empId == null || id === empId)
    .map(([id, s]) => ({
      id,
      code: empById.get(id)?.code ?? '',
      name: empById.get(id)?.full_name ?? `#${id}`,
      ...s,
      outstanding: s.disbursed - s.repaid,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // When a single employee is selected in the filter, the Outstanding card
  // shows THAT employee's outstanding (disbursed − repaid) instead of the
  // all-employees total, so the number matches the person you're looking at.
  const selectedEmpName = empId != null ? (empById.get(empId)?.full_name ?? null) : null;
  const selectedOutstanding = empId != null
    ? empSummary.reduce((acc, s) => acc + s.outstanding, 0)
    : null;

  // Running "outstanding after this repayment" per wage entry, shown as a
  // column in the Repayments table. Walk all deductions oldest-first:
  // outstanding after a repayment = loans disbursed up to that date
  // − repayments made up to and including that entry.
  const outstandingAfterByWageId = new Map<number, number>();
  const cumRepaidByEmp = new Map<number, number>();
  const dedSorted = dedAgg
    .filter((r) => Number(r.loan_deduction || 0) > 0)
    .sort((a, b) => (a.pay_date < b.pay_date ? -1 : a.pay_date > b.pay_date ? 1 : a.id - b.id));
  for (const r of dedSorted) {
    const repaidSoFar = (cumRepaidByEmp.get(r.employee_id) ?? 0) + Number(r.loan_deduction || 0);
    cumRepaidByEmp.set(r.employee_id, repaidSoFar);
    const disbursedUpTo = loanAgg
      .filter((l) => l.employee_id === r.employee_id && l.loan_date <= r.pay_date)
      .reduce((acc, l) => acc + Number(l.amount || 0), 0);
    outstandingAfterByWageId.set(r.id, disbursedUpTo - repaidSoFar);
  }

  // Repayment history — wage entries that withheld a loan deduction.
  interface RepaymentRow {
    id: number;
    pay_date: string;
    loan_deduction: number;
    employee: { code: string; full_name: string } | null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repayQuery = (supabase as any)
    .from('wage_entry')
    .select('id, pay_date, loan_deduction, employee:employee_id ( code, full_name )')
    .gt('loan_deduction', 0)
    .order('pay_date', { ascending: false })
    .limit(200);
  if (empId != null) repayQuery = repayQuery.eq('employee_id', empId);
  const { data: repayData } = await repayQuery;
  const repayments = ((repayData ?? []) as unknown as RepaymentRow[]);

  return (
    <div>
      <PageHeader
        title="Loans"
        subtitle="Cash advances given to workers. Each row is one disbursement and records a Credit (outflow) on the Cash/Bank account it came from. Repayments happen on the New Wage Entry form via the Loan repayment field."
        actions={
          <Link href="/app/loans/new" className="btn-primary">
            <Plus className="w-4 h-4" /> Issue Loan
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load loans: {error.message}
        </div>
      )}

      <form method="GET" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="emp">Employee</label>
          <select id="emp" name="emp" defaultValue={empId != null ? String(empId) : ''} className="input min-w-[200px]">
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.code} — {e.full_name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary min-h-[40px]">Apply</button>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Loans shown</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Disbursed (shown)</div>
          <div className="num text-xl font-bold">{formatRupee(shownTotal)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">
            {selectedEmpName ? `Outstanding — ${selectedEmpName}` : 'Outstanding (all)'}
          </div>
          <div className="num text-xl font-bold text-rose-700">
            {formatRupee(selectedOutstanding ?? totalOutstanding)}
          </div>
        </div>
      </div>

      {/* Mobile / PWA: card view. Hidden from md up. */}
      <CardFilter placeholder="Search loans…">
        {rows.length ? rows.map((r) => (
          <div key={r.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/app/loans/${r.id}`} className="font-semibold text-ink hover:text-indigo break-words">
                  {r.employee?.full_name ?? '—'}
                </Link>
                <div className="font-mono text-[11px] text-ink-mute mt-0.5">{r.employee?.code ?? ''}</div>
              </div>
              <div className="num font-semibold text-base text-right shrink-0">
                {formatRupee(Number(r.amount))}
              </div>
            </div>

            <div className="text-xs text-ink-soft mt-2">
              <span className="num">{r.loan_date}</span>
              {r.source?.name && <> · <span className="text-ink-mute">From: </span>{r.source.name}</>}
            </div>
            {r.notes && (
              <div className="text-xs text-ink-soft mt-1">
                <span className="text-ink-mute">Notes: </span>{r.notes}
              </div>
            )}

            <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
              <Link
                href={`/app/loans/${r.id}`}
                className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold"
                title="Edit this loan"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
              <DeleteLoanButton
                id={r.id}
                label={`${r.employee?.full_name ?? ''} ${formatRupee(Number(r.amount))}`.trim()}
              />
            </div>
          </div>
        )) : (
          <div className="card p-6 text-center text-sm text-ink-soft">
            No loans yet.{' '}
            <Link href="/app/loans/new" className="text-indigo font-semibold">
              Issue the first one →
            </Link>
          </div>
        )}
      </CardFilter>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Paid from</th>
              <th className="text-left px-4 py-3 hidden xl:table-cell">Notes</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 num text-xs">{r.loan_date}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.employee?.full_name ?? '—'}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{r.employee?.code ?? ''}</div>
                </td>
                <td className="px-4 py-3 text-right num font-semibold">
                  {formatRupee(Number(r.amount))}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                  {r.source?.name ?? '—'}
                </td>
                <td className="px-4 py-3 hidden xl:table-cell text-xs text-ink-soft">
                  {r.notes ?? '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <Link
                      href={`/app/loans/${r.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-haze/60"
                      title="Edit this loan"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Link>
                    <DeleteLoanButton
                      id={r.id}
                      label={`${r.employee?.full_name ?? ''} ${formatRupee(Number(r.amount))}`.trim()}
                    />
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No loans yet.{' '}
                  <Link href="/app/loans/new" className="text-indigo font-semibold">
                    Issue the first one →
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Per-employee position: disbursed vs repaid vs outstanding. */}
      {empSummary.length > 0 && (
        <div className="card overflow-x-auto mt-4">
          <div className="px-4 pt-3 pb-1 text-sm font-semibold text-ink">Per-employee position</div>
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-4 py-2">Employee</th>
                <th className="text-right px-4 py-2">Disbursed</th>
                <th className="text-right px-4 py-2">Repaid</th>
                <th className="text-right px-4 py-2">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {empSummary.map((s) => (
                <tr key={s.id} className="border-t border-line/40">
                  <td className="px-4 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] text-ink-mute font-mono">{s.code}</div>
                  </td>
                  <td className="px-4 py-2 text-right num">{formatRupee(s.disbursed)}</td>
                  <td className="px-4 py-2 text-right num text-emerald-700">{formatRupee(s.repaid)}</td>
                  <td className={`px-4 py-2 text-right num font-semibold ${s.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {formatRupee(s.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Repayment history — loan deductions withheld on wage entries. */}
      <div className="card overflow-x-auto mt-4">
        <div className="px-4 pt-3 pb-1 text-sm font-semibold text-ink">Repayments (withheld on wages)</div>
        <table className="w-full text-sm min-w-[480px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Employee</th>
              <th className="text-right px-4 py-2">Repaid</th>
              <th className="text-right px-4 py-2">Outstanding after</th>
              <th className="text-right px-4 py-2">Wage entry</th>
            </tr>
          </thead>
          <tbody>
            {repayments.length ? repayments.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-2 num text-xs">{r.pay_date}</td>
                <td className="px-4 py-2">
                  <div className="font-medium">{r.employee?.full_name ?? '—'}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{r.employee?.code ?? ''}</div>
                </td>
                <td className="px-4 py-2 text-right num font-semibold text-emerald-700">
                  {formatRupee(Number(r.loan_deduction))}
                </td>
                <td className={`px-4 py-2 text-right num font-semibold ${(outstandingAfterByWageId.get(r.id) ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {formatRupee(outstandingAfterByWageId.get(r.id) ?? 0)}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/app/wages/${r.id}`} className="text-xs text-indigo font-semibold">
                    View →
                  </Link>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-soft">
                  No repayments yet. Repayments are recorded on the New Wage Entry form via the Loan repayment field.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
