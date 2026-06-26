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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allLoans } = await (supabase as any)
    .from('employee_loan')
    .select('amount');
  const totalDisbursedAll = ((allLoans ?? []) as Array<{ amount: number }>)
    .reduce((acc, r) => acc + Number(r.amount || 0), 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allDeductions } = await (supabase as any)
    .from('wage_entry')
    .select('loan_deduction');
  const totalRepaidAll = ((allDeductions ?? []) as Array<{ loan_deduction: number | null }>)
    .reduce((acc, r) => acc + Number(r.loan_deduction || 0), 0);

  const totalOutstanding = totalDisbursedAll - totalRepaidAll;
  const shownTotal = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);

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
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Outstanding (all)</div>
          <div className="num text-xl font-bold text-rose-700">{formatRupee(totalOutstanding)}</div>
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
    </div>
  );
}
