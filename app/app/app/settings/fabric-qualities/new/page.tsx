import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { FabricQualityForm, type EndsRowOption, type YarnCountOption } from '../fabric-quality-form';

export const metadata = { title: 'New Fabric Quality' };
export const dynamic = 'force-dynamic';

export default async function NewFabricQualityPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [endsRes, countRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('ends_master')
      .select('id, code, name')
      .eq('active', true)
      .order('ends_count'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('yarn_count')
      .select('id, code, display_name')
      .neq('status', 'archived')
      .order('code'),
  ]);

  const endsOptions = (endsRes.data ?? []) as unknown as EndsRowOption[];
  const countOptions = (countRes.data ?? []) as unknown as YarnCountOption[];

  return (
    <div>
      <PageHeader
        title="New Fabric Quality"
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Fabric Qualities', href: '/app/settings/fabric-qualities' },
          { label: 'New' },
        ]}
      />
      <FabricQualityForm endsOptions={endsOptions} countOptions={countOptions} />
    </div>
  );
}
