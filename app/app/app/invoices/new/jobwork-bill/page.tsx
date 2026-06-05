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

export const metadata = { title: 'New Weaving Bill' };
export const dynamic = 'force-dynamic';

interface PartyRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  billing_address: string | null;
  state: string | null;
  state_code: string | null;
  party_type_ids: number[] | string[] | null;
  /** 'jobwork' = Jobwork Party (bills go to JB/26-27/NNNN),
   *  'outsource' = Outsource Weaver (bills go to WB/26-27/NNNN). */
  kind: 'jobwork' | 'outsource';
}

export default async function NewJobworkBillPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Look up the Jobwork Party + Outsource Weaver type ids so the
  // dropdown shows BOTH categories — a single Weaving Bill flow now
  // covers jobwork and outsource activity.
  const { data: ptRows } = await sb
    .from('party_type_master')
    .select('id, name')
    .in('name', ['Jobwork Party', 'Outsource Weaver']);
  const ptList = (ptRows ?? []) as Array<{ id: number; name: string }>;
  const jobworkTypeId:   number | null = ptList.find((t) => t.name === 'Jobwork Party')?.id ?? null;
  const outsourceTypeId: number | null = ptList.find((t) => t.name === 'Outsource Weaver')?.id ?? null;
  const allowedTypeIds: Set<number> = new Set<number>();
  if (jobworkTypeId   != null) allowedTypeIds.add(jobworkTypeId);
  if (outsourceTypeId != null) allowedTypeIds.add(outsourceTypeId);

  // Fetch every active party - cheap on a textile-mill scale (max few
  // hundred rows). Then filter in JS by party_type_ids OR the legacy
  // singular party_type_id. This dodges the PostgREST array-contains
  // edge case and is also resilient if some old rows still only have
  // the singular column populated.
  const { data: partyData } = await sb
    .from('party')
    .select('id, code, name, gstin, billing_address, state, state_code, party_type_ids, party_type_id')
    .eq('status', 'active')
    .order('name');
  const allActiveParties = (partyData ?? []) as Array<PartyRow & { party_type_id: number | null }>;

  // Tag each surviving party with its kind so the form can route the
  // bill to the right sequence (JB for jobwork parties, WB for
  // outsource weavers).
  function resolveKind(p: PartyRow & { party_type_id: number | null }): 'jobwork' | 'outsource' {
    const ids = Array.isArray(p.party_type_ids) ? p.party_type_ids.map((x) => Number(x)) : [];
    const single = p.party_type_id != null ? Number(p.party_type_id) : null;
    const isOutsource = (outsourceTypeId != null) && (
      ids.includes(outsourceTypeId) || single === outsourceTypeId
    );
    return isOutsource ? 'outsource' : 'jobwork';
  }

  let parties: PartyRow[] = allActiveParties.map((p) => ({ ...p, kind: resolveKind(p) }));
  if (allowedTypeIds.size > 0) {
    parties = parties.filter((p) => {
      const ids = Array.isArray(p.party_type_ids) ? p.party_type_ids.map((x) => Number(x)) : [];
      const single = (p as PartyRow & { party_type_id: number | null }).party_type_id;
      const singleNum = single != null ? Number(single) : null;
      return ids.some((id) => allowedTypeIds.has(id))
          || (singleNum != null && allowedTypeIds.has(singleNum));
    });
  }

  return (
    <div>
      <PageHeader
        title="New Weaving Bill"
        subtitle="Combine one or more confirmed DCs from a single jobwork / outsource party into one billable invoice (JB/...)."
        crumbs={[
          { label: 'Invoices', href: '/app/invoices' },
          { label: 'New Weaving Bill' },
        ]}
      />
      <JobworkBillForm parties={parties} />
    </div>
  );
}
