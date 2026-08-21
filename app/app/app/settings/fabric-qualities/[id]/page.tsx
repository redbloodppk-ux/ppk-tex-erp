import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  FabricQualityForm,
  type EndsRowOption, type YarnCountOption,
  type FabricQualityHeader,
} from '../fabric-quality-form';

export const metadata = { title: 'Edit Fabric Quality' };
export const dynamic = 'force-dynamic';

interface FQRow {
  id: number;
  code: string;
  name: string;
  quality_for_sales: string | null;
  hsn: string | null;
  pick_per_inch: number | string | null;
  reed: number | string | null;
  reed_space: number | string | null;
  width_in: number | string | null;
  meter_per_pc: number | string | null;
  output_unit: string | null;
  output_value: number | string | null;
  crimp_pct: number | string | null;
  gst_pct: number | string | null;
  weight_gsm: number | string | null;
  rate_per_m: number | string | null;
  pick_cost_per_m: number | string | null;
  active: boolean;
  notes: string | null;
}

function s(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export default async function EditFabricQualityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // The fabric_quality_ends / _warp_count / _weft / _weaving_rate link
  // tables were queried here and passed to the form as endsLines /
  // warpLines / weftLines / rateLines. Both halves were dead: the tables
  // are permanently empty (the form writes only to calc_snapshot and
  // never inserts into them), AND the form declared those props without
  // ever reading them — it rebuilds its state from calc_snapshot.
  // Four queries removed in the 2026-08-20 audit.
  const [hdrRes, endsOptRes, countOptRes] =
    await Promise.all([
      sb.from('fabric_quality').select('*').eq('id', numericId).maybeSingle(),
      sb.from('ends_master').select('id, code, name').eq('active', true).order('ends_count'),
      sb.from('yarn_count').select('id, code, display_name').neq('status', 'archived').order('code'),
    ]);

  const fq = hdrRes.data as unknown as FQRow | null;
  if (!fq) notFound();

  const header: FabricQualityHeader = {
    name:              fq.name ?? '',
    quality_for_sales: fq.quality_for_sales ?? '',
    hsn:               fq.hsn ?? '',
    pick_per_inch:     s(fq.pick_per_inch),
    reed:              s(fq.reed),
    reed_space:        s(fq.reed_space),
    width_in:          s(fq.width_in),
    meter_per_pc:      s(fq.meter_per_pc),
    output_unit:       (fq.output_unit === 'per_day_m' || fq.output_unit === 'per_shift_m') ? fq.output_unit : '',
    output_value:      s(fq.output_value),
    crimp_pct:         s(fq.crimp_pct),
    gst_pct:           s(fq.gst_pct),
    weight_gsm:        s(fq.weight_gsm),
    rate_per_m:        s(fq.rate_per_m),
    pick_cost_per_m:   s(fq.pick_cost_per_m),
    is_merged:         false,
    merged_name:       '',
    active:            fq.active,
    status:            fq.active ? 'active' : 'inactive',
    notes:             fq.notes ?? '',
  };

  const endsOptions = (endsOptRes.data ?? []) as unknown as EndsRowOption[];
  const countOptions = (countOptRes.data ?? []) as unknown as YarnCountOption[];

  return (
    <div>
      <PageHeader
        title={fq.name}
        subtitle={`${fq.code} - edit fabric quality`}
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Fabric Qualities', href: '/app/settings/fabric-qualities' },
          { label: fq.name },
        ]}
      />
      <FabricQualityForm
        fabricQualityId={fq.id}
        code={fq.code}
        header={header}
        endsOptions={endsOptions}
        countOptions={countOptions}
      />
    </div>
  );
}
