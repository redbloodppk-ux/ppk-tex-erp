/**
 * Edit a sizing job. Loaded via the Edit pencil on the Jobs tab.
 *
 * Every field on the sizing job is editable here — header, yarn lot,
 * beams, bill section, status, notes. The new form (/app/sizing/new)
 * is mirrored exactly so the operator sees a consistent UI.
 *
 * Stock side-effects on save are handled by the form: changing the
 * yarn lot or yarn-sent kg credits the original lot and debits the
 * new one. Beam re-sync is delete-then-insert against the pavu
 * table.
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

interface Vendor   { id: number; code?: string | null; name: string; vendor_type?: string }
interface Supplier { id: number; code: string; name: string }
interface YarnCount { id: number; code: string; display_name: string }
interface YarnLot  {
  id: number; lot_code: string;
  current_kg: number; received_kg: number;
  yarn_count_id: number; supplier_party_id: number | null;
  delivery_destination: 'in_house' | 'sizing' | null;
}

export default async function EditSizingJobPage({ params }: PageProps) {
  const p = await params;
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Resolve "Mill / Yarn Supplier" party type once so we can scope
  // the supplier dropdown.
  const { data: ptRow } = await sb
    .from('party_type_master')
    .select('id')
    .eq('name', 'Mill / Yarn Supplier')
    .maybeSingle();
  const supplierTypeId: number | null = ptRow?.id ?? null;

  // Parallel master-data loads + the job itself + its pavu rows.
  const [
    jobRes,
    pavuRes,
    sizingVendorsRes,
    weavingVendorsRes,
    suppliersRes,
    countsRes,
    lotsRes,
  ] = await Promise.all([
    sb.from('sizing_job').select(`
      id, job_code, set_no, status, notes,
      sizing_ledger_id, yarn_supplier_party_id, warp_count_id,
      avg_count, yarn_lot_id, yarn_sent_kg, yarn_used_kg,
      sizing_rate_per_kg, gst_pct, bill_no, bill_date,
      default_production_mode, default_outsource_ledger_id
    `).eq('id', id).maybeSingle(),
    sb.from('pavu').select('id, beam_no, ends, meters, production_mode, outsource_ledger_id').eq('sizing_job_id', id).order('beam_no'),
    sb.from('ledger').select('id, code, name, ledger_type:type_id!inner(name)')
      .eq('active', true).eq('ledger_type.name', 'SIZING(VENDOR)').order('name'),
    sb.from('ledger').select('id, code, name, ledger_type:type_id!inner(name)')
      .eq('active', true).eq('ledger_type.name', 'WEAVING(VENDOR)').order('name'),
    supplierTypeId == null
      ? Promise.resolve({ data: [] })
      : sb.from('party').select('id, code, name')
          .contains('party_type_ids', [supplierTypeId])
          .eq('status', 'active')
          .order('name'),
    sb.from('yarn_count').select('id, code, display_name').eq('status', 'active').order('code'),
    sb.from('yarn_lot').select('id, lot_code, current_kg, received_kg, yarn_count_id, supplier_party_id, delivery_destination'),
  ]);

  if (jobRes.error || !jobRes.data) notFound();
  const job = jobRes.data;

  // Lots: include every lot that's either still in stock OR is the
  // currently-attached lot for this job (so the dropdown can show
  // it even if it's depleted).
  const lotsAll = (lotsRes.data ?? []) as YarnLot[];
  const lots = lotsAll.filter((l) =>
    Number(l.current_kg) > 0 || l.id === job.yarn_lot_id,
  );

  const seedBeams = ((pavuRes.data ?? []) as Array<{
    id: number; beam_no: string; ends: number; meters: number;
    production_mode: 'in_house' | 'outsource';
    outsource_ledger_id: number | null;
  }>).map((b) => ({
    pavu_id: b.id,
    beam_no: b.beam_no,
    ends:    Number(b.ends),
    meters:  Number(b.meters),
    production_mode: b.production_mode,
    outsource_ledger_id: b.outsource_ledger_id,
  }));

  const seed: JobEditSeed = {
    id:                     job.id,
    job_code:               job.job_code ?? `Job #${job.id}`,
    set_no:                 job.set_no ?? '',
    status:                 job.status ?? 'received',
    notes:                  job.notes ?? '',
    sizing_ledger_id:       job.sizing_ledger_id ?? null,
    yarn_supplier_party_id: job.yarn_supplier_party_id ?? null,
    warp_count_id:          job.warp_count_id ?? null,
    avg_count:              job.avg_count != null ? Number(job.avg_count) : null,
    yarn_source:            // The legacy form stored 'warehouse' for both
                            // physical sources; lots carry the real
                            // delivery_destination so we read it from
                            // the linked lot when possible.
                            (lotsAll.find((l) => l.id === job.yarn_lot_id)?.delivery_destination ?? 'in_house'),
    yarn_lot_id:            job.yarn_lot_id ?? null,
    yarn_sent_kg:           Number(job.yarn_sent_kg ?? 0),
    yarn_used_kg:           Number(job.yarn_used_kg ?? 0),
    default_production_mode: (job.default_production_mode ?? (seedBeams.every((b) => b.production_mode === 'outsource') ? 'outsource' : 'in_house')),
    default_outsource_ledger_id: job.default_outsource_ledger_id ?? null,
    bill_no:                job.bill_no ?? '',
    bill_date:              job.bill_date ?? '',
    sizing_rate_per_kg:     Number(job.sizing_rate_per_kg ?? 0),
    gst_pct:                Number(job.gst_pct ?? 0),
    beams:                  seedBeams,
  };

  return (
    <div>
      <PageHeader
        title={`Edit Sizing Job · ${seed.job_code}`}
        crumbs={[
          { label: 'Sizing', href: '/app/sizing' },
          { label: 'Jobs',   href: '/app/sizing?tab=jobs' },
          { label: 'Edit' },
        ]}
      />
      <JobEditForm
        seed={seed}
        masters={{
          sizingVendors:  (sizingVendorsRes.data  ?? []) as Vendor[],
          weavingVendors: (weavingVendorsRes.data ?? []) as Vendor[],
          suppliers:      (suppliersRes.data      ?? []) as Supplier[],
          counts:         (countsRes.data         ?? []) as YarnCount[],
          lots:           lots,
        }}
      />
    </div>
  );
}
