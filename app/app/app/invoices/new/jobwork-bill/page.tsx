/**
 * /app/invoices/new/jobwork-bill — Create a Jobwork Bill (JB/26-27/NNNN)
 * by combining one or more confirmed jobwork DCs from a single jobwork
 * party. Auto-aggregates metres / pieces / bundles per fabric quality
 * and prices each line at fabric_quality.pick_cost_per_m. No editable
 * rate or quantity field — those are snapshots of the DC + master rate.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { JobworkBillForm } from './jobwork-bill-form';

export const metadata = { title: 'New Jobwork Bill' };
export const dynamic = 'force-dynamic';

interface PartyRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  address: string | null;
  state: string | null;
  state_code: string | null;
  party_type_ids: number[] | null;
}

export default async function NewJobworkBillPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Look up the Jobwork Party type id so we can show only jobwork parties
  // in the dropdown.
  const { data: ptRows } = await sb
    .from('party_type_master')
    .select('id, name')
    .eq('name', 'Jobwork Party')
    .maybeSingle();
  const jobworkTypeId: number | null = ptRows?.id ?? null;

  let parties: PartyRow[] = [];
  if (jobworkTypeId != null) {
    const { data } = await sb
      .from('party')
      .select('id, code, name, gstin, address, state, state_code, party_type_ids')
      .eq('status', 'active')
      .contains('party_type_ids', [jobworkTypeId])
      .order('name');
    parties = (data ?? []) as PartyRow[];
  } else {
    // Fallback: party_type_master not seeded yet, show every active party.
    const { data } = await sb
      .from('party')
      .select('id, code, name, gstin, address, state, state_code, party_type_ids')
      .eq('status', 'active')
      .order('name');
    parties = (data ?? []) as PartyRow[];
  }

  return (
    <div>
      <PageHeader
        title="New Jobwork Bill"
        subtitle="Combine one or more confirmed jobwork DCs from a single party into one billable invoice (JB/...)."
        crumbs={[
          { label: 'Invoices', href: '/app/invoices' },
          { label: 'New Jobwork Bill' },
        ]}
      />
      <JobworkBillForm parties={parties} />
    </div>
  );
}
