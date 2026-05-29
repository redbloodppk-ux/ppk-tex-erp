import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { LedgerForm, type LedgerOption } from '../ledger-form';

export const metadata = { title: 'New Ledger' };
export const dynamic = 'force-dynamic';

export default async function NewLedgerPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [typesRes, groupsRes] = await Promise.all([
    sb.from('ledger_type').select('id, code, name').eq('active', true).order('name'),
    sb.from('ledger_group').select('id, code, name').eq('active', true).order('name'),
  ]);

  const types = (typesRes.data ?? []) as unknown as LedgerOption[];
  const groups = (groupsRes.data ?? []) as unknown as LedgerOption[];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="New Ledger"
        crumbs={[{ label: 'Ledgers', href: '/app/ledgers' }, { label: 'New' }]}
      />
      <LedgerForm types={types} groups={groups} />
    </div>
  );
}
