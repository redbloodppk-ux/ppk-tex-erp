/**
 * Edit expense entry.
 *
 * Loads the row and renders the reusable ExpenseEntryForm in edit mode.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  ExpenseEntryForm,
  type InitialExpense,
} from '../new/expense-entry-form';

export const metadata = { title: 'Edit Expense' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditExpensePage({ params }: PageProps): Promise<React.ReactElement> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const supabase = await createClient();
  // expense_entry from migration 035; types not regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('expense_entry')
    .select('id, category, amount, pay_date, notes')
    .eq('id', id)
    .maybeSingle();

  if (!row) notFound();
  const initial = row as unknown as InitialExpense;

  return (
    <div>
      <PageHeader
        title="Edit Expense"
        crumbs={[
          { label: 'Expenses', href: '/app/expenses' },
          { label: `#${initial.id}` },
        ]}
      />
      <ExpenseEntryForm initial={initial} />
    </div>
  );
}
