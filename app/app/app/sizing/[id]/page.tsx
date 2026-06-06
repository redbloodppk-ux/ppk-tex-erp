/**
 * Edit a sizing job. Loaded via the Edit pencil on the Jobs tab.
 *
 * Yarn lot draw + beams are locked at creation time; the form here
 * covers the safe-to-edit job-level fields (set no, yarn used,
 * status, notes) plus the bill section. To replace yarn or beams,
 * delete the job and re-create it.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { JobEditForm, type JobEditSeed } from './job-edit-form';

export const metadata = { title: 'Edit Sizing Job' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditSizingJobPage({ params }: PageProps) {
  const p = await params;
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data, error } = await sb
    .from('sizing_job')
    .select(`
      id, job_code, set_no, status, notes,
      yarn_sent_kg, yarn_used_kg, no_of_paavu,
      sizing_rate_per_kg, gst_pct,
      bill_no, bill_date,
      sizing_vendor:sizing_ledger_id ( name ),
      yarn_supplier:yarn_supplier_party_id ( name ),
      warp_count:warp_count_id ( code )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) notFound();

  const seed: JobEditSeed = {
    id:                 data.id,
    job_code:           data.job_code ?? `Job #${data.id}`,
    sizing_vendor_name: data.sizing_vendor?.name ?? '—',
    yarn_supplier_name: data.yarn_supplier?.name ?? '—',
    warp_count_code:    data.warp_count?.code ?? '—',
    yarn_sent_kg:       Number(data.yarn_sent_kg ?? 0),
    yarn_used_kg:       Number(data.yarn_used_kg ?? 0),
    no_of_paavu:        Number(data.no_of_paavu ?? 0),
    set_no:             data.set_no ?? '',
    status:             data.status ?? 'received',
    notes:              data.notes ?? '',
    bill_no:            data.bill_no ?? '',
    bill_date:          data.bill_date ?? '',
    sizing_rate_per_kg: Number(data.sizing_rate_per_kg ?? 0),
    gst_pct:            Number(data.gst_pct ?? 0),
  };

  return (
    <div>
      <PageHeader
        title={`Edit Sizing Job · ${seed.job_code}`}
        subtitle={`${seed.sizing_vendor_name} · ${seed.warp_count_code}`}
        crumbs={[
          { label: 'Sizing', href: '/app/sizing' },
          { label: 'Jobs',   href: '/app/sizing?tab=jobs' },
          { label: 'Edit' },
        ]}
      />
      <JobEditForm seed={seed} />
    </div>
  );
}
