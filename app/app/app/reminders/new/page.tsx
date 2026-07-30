/**
 * New reminder — server component shell around the client ReminderForm.
 * Categories are fetched here (server-side, RLS-gated) and passed down as
 * a prop since they're now owner-managed (migration 246) rather than a
 * compile-time list the client form can import directly.
 */
import { PageHeader } from '@/app/components/page-header';
import { createClient } from '@/lib/supabase/server';
import { fetchActiveCategories } from '@/lib/reminders/constants';
import { ReminderForm } from './reminder-form';

export const metadata = { title: 'New Reminder' };
export const dynamic = 'force-dynamic';

export default async function NewReminderPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = await fetchActiveCategories(supabase as any);

  return (
    <div>
      <PageHeader
        title="New Reminder"
        crumbs={[{ label: 'Reminders', href: '/app/reminders' }, { label: 'New' }]}
      />
      <ReminderForm categories={categories} />
    </div>
  );
}
