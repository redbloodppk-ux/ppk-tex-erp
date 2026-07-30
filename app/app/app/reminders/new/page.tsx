/**
 * New reminder — server component shell around the client ReminderForm.
 */
import { PageHeader } from '@/app/components/page-header';
import { ReminderForm } from './reminder-form';

export const metadata = { title: 'New Reminder' };
export const dynamic = 'force-dynamic';

export default async function NewReminderPage(): Promise<React.ReactElement> {
  return (
    <div>
      <PageHeader
        title="New Reminder"
        crumbs={[{ label: 'Reminders', href: '/app/reminders' }, { label: 'New' }]}
      />
      <ReminderForm />
    </div>
  );
}
