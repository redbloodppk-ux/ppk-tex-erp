/**
 * Edit only the bill section of a sizing job.
 *
 * Loaded via the Edit icon on the Bills tab (/app/sizing?tab=bills).
 * The form touches bill_no, bill_date, sizing_rate_per_kg, gst_pct
 * and recomputes charges_amount + total_amount; the job's yarn-lot
 * movement, beams, and status are left alone.
 *
 * Delete is intentionally absent — bills can only be removed by
 * deleting the parent sizing job from the Jobs tab.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { BillEditForm, type BillEditSeed } from './bill-edit-form';

export const metadata = { title: 'Edit Sizing Bill' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditSizingBillPage({ params }: PageProps) {
  const p = await params;
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data, error } = await sb
    .from('sizing_job')
    .select(`
      id, job_code, yarn_used_kg, bill_no, bill_date,
      sizing_rate_per_kg, gst_pct,
      sizing_vendor:sizing_ledger_id ( name )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) notFound();

  const seed: BillEditSeed = {
    id:                 data.id,
    job_code:           data.job_code ?? `Job #${data.id}`,
    sizing_vendor_name: data.sizing_vendor?.name ?? '—',
    yarn_used_kg:       Number(data.yarn_used_kg ?? 0),
    bill_no:            data.bill_no ?? '',
    bill_date:          data.bill_date ?? '',
    sizing_rate_per_kg: Number(data.sizing_rate_per_kg ?? 0),
    gst_pct:            Number(data.gst_pct ?? 0),
  };

  return (
    <div>
      <PageHeader
        title={`Edit Sizing Bill · ${seed.job_code}`}
        subtitle={`Bill no ${seed.bill_no || '(not set)'} · ${seed.sizing_vendor_name}`}
        crumbs={[
          { label: 'Sizing', href: '/app/sizing?tab=bills' },
          { label: 'Bills',  href: '/app/sizing?tab=bills' },
          { label: 'Edit' },
        ]}
      />
      <BillEditForm seed={seed} />
    </div>
  );
}
