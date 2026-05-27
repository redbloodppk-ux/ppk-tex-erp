/**
 * New expense entry.
 *
 * Server component shell. The form INSERTs into expense_entry which feeds
 * v_batch_expense_allocation so any in-house batch whose window overlaps the
 * picked period picks up its pro-rata share.
 */
import { PageHeader } from '@/app/components/page-header';
import { ExpenseEntryForm } from './expense-entry-form';

export const metadata = { title: 'New Expense' };
export const dynamic = 'force-dynamic';

export default async function NewExpensePage(): Promise<React.ReactElement> {
  return (
    <div>
      <PageHeader
        title="New Expense"
        crumbs={[{ label: 'Expenses', href: '/app/expenses' }, { label: 'New' }]}
      />
      <ExpenseEntryForm />
    </div>
  );
}
