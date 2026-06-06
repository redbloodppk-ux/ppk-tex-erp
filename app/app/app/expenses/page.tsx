/**
 * Expenses register.
 *
 * Lists expense_entry rows with category + pay date + amount. Provides
 * a link to add a new entry. Owner/accounts can write, mill_manager/auditor
 * can read.
 *
 * Each row's amount gets spread across in-house production_batch rows whose
 * production window includes pay_date, pro-rata by metres.
 * See v_batch_expense_allocation.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil } from 'lucide-react';
import { formatRupee } from '@/lib/utils';
import { DeleteExpenseButton } from './delete-expense-button';

export const metadata = { title: 'Expenses' };
export const dynamic = 'force-dynamic';

interface ExpenseRow {
  id: number;
  category: string;
  pay_date: string;
  amount: number;
  notes: string | null;
}

export default async function ExpensesPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // expense_entry from migrations 035/036 — types not regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('expense_entry')
    .select('id, category, pay_date, amount, notes')
    .order('pay_date', { ascending: false })
    .limit(200);

  const rows = (data as unknown as ExpenseRow[]) ?? [];
  const total = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Mill cash expenses — pick a category, enter amount and pay date. Each entry spreads pro-rata across in-house batches by metres."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/app/settings/expense-categories"
              className="btn-secondary"
            >
              Manage categories
            </Link>
            <Link href="/app/expenses/new" className="btn-primary">
              <Plus className="w-4 h-4" /> New Expense
            </Link>
          </div>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load expenses: {error.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Entries shown</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total paid (shown)</div>
          <div className="num text-xl font-bold">{formatRupee(total)}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Pay date</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3 hidden xl:table-cell">Notes</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 num text-xs">{r.pay_date}</td>
                <td className="px-4 py-3">
                  <span className="pill bg-slate-100 text-slate-700">
                    {r.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-right num font-semibold">
                  {formatRupee(Number(r.amount))}
                </td>
                <td className="px-4 py-3 hidden xl:table-cell text-xs text-ink-soft">
                  {r.notes ?? '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <Link
                      href={`/app/expenses/${r.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-haze/60"
                      title="Edit this expense"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Link>
                    <DeleteExpenseButton
                      id={r.id}
                      label={`${r.category} ${formatRupee(Number(r.amount))}`}
                    />
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No expense entries yet.{' '}
                  <Link href="/app/expenses/new" className="text-indigo font-semibold">
                    Add the first one →
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
