import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  FabricQualityForm,
  type EndsRowOption, type YarnCountOption,
  type FabricQualityHeader, type FQEndsLine, type FQWarpLine, type FQWeftLine, type FQRateLine,
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

  const [hdrRes, endsRowsRes, warpRowsRes, weftRowsRes, rateRowsRes, endsOptRes, countOptRes] =
    await Promise.all([
      sb.from('fabric_quality').select('*').eq('id', numericId).maybeSingle(),
      sb.from('fabric_quality_ends').select('sno, ends_id').eq('fabric_quality_id', numericId).order('sno'),
      sb.from('fabric_quality_warp_count').select('sno, yarn_count_id').eq('fabric_quality_id', numericId).order('sno'),
      sb.from('fabric_quality_weft').select('sno, yarn_count_id, wgt_per_mtr_actual, meter_per_kg, wgt_per_mtr_manual').eq('fabric_quality_id', numericId).order('sno'),
      sb.from('fabric_quality_weaving_rate').select('sno, fabric_type, rate_per_meter').eq('fabric_quality_id', numericId).order('sno'),
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
    active:            fq.active,
    status:            fq.active ? 'active' : 'inactive',
    notes:             fq.notes ?? '',
  };

  const endsLines: FQEndsLine[] = (endsRowsRes.data ?? []).map(
    (r: { sno: number; ends_id: number | null }) => ({ sno: r.sno, ends_id: r.ends_id }),
  );
  const warpLines: FQWarpLine[] = (warpRowsRes.data ?? []).map(
    (r: { sno: number; yarn_count_id: number | null }) => ({ sno: r.sno, yarn_count_id: r.yarn_count_id }),
  );
  const weftLines: FQWeftLine[] = (weftRowsRes.data ?? []).map(
    (r: {
      sno: number;
      yarn_count_id: number | null;
      wgt_per_mtr_actual: number | string | null;
      meter_per_kg: number | string | null;
      wgt_per_mtr_manual: number | string | null;
    }) => ({
      sno: r.sno,
      yarn_count_id: r.yarn_count_id,
      wgt_per_mtr_actual: s(r.wgt_per_mtr_actual),
      meter_per_kg: s(r.meter_per_kg),
      wgt_per_mtr_manual: s(r.wgt_per_mtr_manual),
    }),
  );
  const rateLines: FQRateLine[] = (rateRowsRes.data ?? []).map(
    (r: { sno: number; fabric_type: string | null; rate_per_meter: number | string | null }) => ({
      sno: r.sno,
      fabric_type: r.fabric_type ?? '',
      rate_per_meter: s(r.rate_per_meter),
    }),
  );

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
        endsLines={endsLines}
        warpLines={warpLines}
        weftLines={weftLines}
        rateLines={rateLines}
        endsOptions={endsOptions}
        countOptions={countOptions}
      />
    </div>
  );
}
