/**
 * Fabric Receipt - server shell. Loads the confirmed jobwork DC, its
 * items + fabric_quality master rows + linked ends / weft / porvai /
 * bobbin info so the client form can render fully populated from the
 * first paint.
 *
 * URL: /app/jobwork/fabric-receipt/new?dc=<id>
 */
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { FabricReceiptForm, type ReceiptItemSeed, type DcInfo } from './fabric-receipt-form';

export const metadata = { title: 'New Fabric Receipt' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ dc?: string }>;
}

export default async function NewFabricReceiptPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const dcId = sp.dc ? Number(sp.dc) : NaN;
  if (!Number.isInteger(dcId) || dcId <= 0) {
    redirect('/app/jobwork');
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [dcRes, itemsRes] = await Promise.all([
    sb.from('delivery_challan')
      .select('id, code, dc_date, status, production_mode, party_id, bill_to_name, vehicle_no, total_metres, total_pieces, total_bundles, fabric_receipt_id, party:party_id ( id, name, code )')
      .eq('id', dcId)
      .eq('production_mode', 'jobwork')
      .maybeSingle(),
    sb.from('delivery_challan_item')
      .select('id, sno, fabric_quality_id, description, hsn, metres, pieces, bundles')
      .eq('dc_id', dcId)
      .order('sno'),
  ]);

  const dc = dcRes.data;
  if (!dc) notFound();

  // Already received? Redirect back to the jobwork DC tab.
  if (dc.fabric_receipt_id !== null) {
    redirect(`/app/jobwork?already_received=${dc.code}`);
  }

  const items = (itemsRes.data ?? []) as Array<{
    id: number; sno: number; fabric_quality_id: number | null;
    description: string | null; hsn: string | null;
    metres: number | string | null; pieces: number | null; bundles: number | null;
  }>;

  // Load fabric_quality master rows for every quality on the DC.
  // We also pull calc_snapshot - the Fabric Quality master form persists
  // ends / weft / warp / bobbin assignments INSIDE this jsonb column,
  // not into the fabric_quality_ends / fabric_quality_weft link tables.
  // The receipt form falls back to calc_snapshot when the link tables
  // are empty so existing FQ rows just work.
  const qIds = Array.from(new Set(items.map((r) => r.fabric_quality_id).filter((x): x is number => x != null)));
  interface FqRow {
    id: number; code: string; name: string;
    weft_kg_per_m: number | string | null;
    porvai_kg_per_m: number | string | null;
    bobbin_pcs_per_m: number | string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    calc_snapshot: Record<string, any> | null;
  }
  const fqById = new Map<number, FqRow>();
  if (qIds.length > 0) {
    const { data: fqRows } = await sb
      .from('fabric_quality')
      .select('id, code, name, weft_kg_per_m, porvai_kg_per_m, bobbin_pcs_per_m, calc_snapshot')
      .in('id', qIds);
    for (const row of (fqRows ?? []) as FqRow[]) fqById.set(row.id, row);
  }

  // Ends-master link per fabric quality. Try the link table first; if
  // empty, fall back to calc_snapshot.endsId.
  const fqEndsById = new Map<number, { ends_id: number; ends_count: number; ends_code: string } | null>();
  const endsToLookup = new Set<number>();
  if (qIds.length > 0) {
    const { data: feRows } = await sb
      .from('fabric_quality_ends')
      .select('fabric_quality_id, ends:ends_id ( id, code, ends_count )')
      .in('fabric_quality_id', qIds)
      .order('sno');
    for (const r of (feRows ?? [])) {
      if (fqEndsById.has(r.fabric_quality_id)) continue;
      const e = r.ends;
      fqEndsById.set(r.fabric_quality_id, e ? { ends_id: e.id, ends_count: e.ends_count, ends_code: e.code } : null);
    }
    // Collect ends_ids from calc_snapshot for qualities not yet resolved.
    for (const qId of qIds) {
      if (fqEndsById.has(qId)) continue;
      const snap = fqById.get(qId)?.calc_snapshot;
      const endsId = snap?.endsId;
      if (endsId != null && endsId !== '') {
        endsToLookup.add(Number(endsId));
      }
    }
    if (endsToLookup.size > 0) {
      const { data: extra } = await sb
        .from('ends_master')
        .select('id, code, ends_count')
        .in('id', Array.from(endsToLookup));
      const extraById = new Map<number, { id: number; code: string; ends_count: number }>();
      for (const e of (extra ?? []) as Array<{ id: number; code: string; ends_count: number }>) {
        extraById.set(e.id, e);
      }
      for (const qId of qIds) {
        if (fqEndsById.has(qId)) continue;
        const endsId = fqById.get(qId)?.calc_snapshot?.endsId;
        const e = endsId != null && endsId !== '' ? extraById.get(Number(endsId)) ?? null : null;
        fqEndsById.set(qId, e ? { ends_id: e.id, ends_count: e.ends_count, ends_code: e.code } : null);
      }
    }
  }

  // Weft yarn-count per fabric quality. Same pattern - link table first,
  // calc_snapshot.weftCountId as fallback.
  const fqWeftById = new Map<number, { yarn_count_id: number; code: string } | null>();
  const weftIdsToLookup = new Set<number>();
  if (qIds.length > 0) {
    const { data: fwRows } = await sb
      .from('fabric_quality_weft')
      .select('fabric_quality_id, yarn_count:yarn_count_id ( id, code )')
      .in('fabric_quality_id', qIds)
      .order('sno');
    for (const r of (fwRows ?? [])) {
      if (fqWeftById.has(r.fabric_quality_id)) continue;
      const y = r.yarn_count;
      fqWeftById.set(r.fabric_quality_id, y ? { yarn_count_id: y.id, code: y.code } : null);
    }
    for (const qId of qIds) {
      if (fqWeftById.has(qId)) continue;
      const weftId = fqById.get(qId)?.calc_snapshot?.weftCountId;
      if (weftId != null && weftId !== '') {
        weftIdsToLookup.add(Number(weftId));
      }
    }
    if (weftIdsToLookup.size > 0) {
      const { data: ycRows } = await sb
        .from('yarn_count')
        .select('id, code')
        .in('id', Array.from(weftIdsToLookup));
      const ycById = new Map<number, { id: number; code: string }>();
      for (const y of (ycRows ?? []) as Array<{ id: number; code: string }>) {
        ycById.set(y.id, y);
      }
      for (const qId of qIds) {
        if (fqWeftById.has(qId)) continue;
        const weftId = fqById.get(qId)?.calc_snapshot?.weftCountId;
        const y = weftId != null && weftId !== '' ? ycById.get(Number(weftId)) ?? null : null;
        fqWeftById.set(qId, y ? { yarn_count_id: y.id, code: y.code } : null);
      }
    }
  }

  const seeds: ReceiptItemSeed[] = items.map((it) => {
    const fq = it.fabric_quality_id != null ? fqById.get(it.fabric_quality_id) ?? null : null;
    const ends = it.fabric_quality_id != null ? fqEndsById.get(it.fabric_quality_id) ?? null : null;
    const weft = it.fabric_quality_id != null ? fqWeftById.get(it.fabric_quality_id) ?? null : null;
    return {
      dc_item_id: it.id,
      sno: it.sno,
      fabric_quality_id: it.fabric_quality_id,
      fabric_quality_code: fq?.code ?? '',
      fabric_quality_name: fq?.name ?? '',
      ends_id: ends?.ends_id ?? null,
      ends_count: ends?.ends_count ?? null,
      ends_code: ends?.ends_code ?? null,
      weft_yarn_count_id: weft?.yarn_count_id ?? null,
      weft_yarn_count_code: weft?.code ?? null,
      weft_kg_per_m: fq ? Number(fq.weft_kg_per_m ?? 0) : 0,
      porvai_kg_per_m: fq ? Number(fq.porvai_kg_per_m ?? 0) : 0,
      bobbin_pcs_per_m: fq ? Number(fq.bobbin_pcs_per_m ?? 0) : 0,
      dc_metres: Number(it.metres ?? 0),
      dc_pieces: it.pieces ?? 0,
      dc_bundles: it.bundles ?? 0,
      hsn: it.hsn ?? '',
    };
  });

  const dcInfo: DcInfo = {
    id: dc.id,
    code: dc.code,
    dc_date: dc.dc_date,
    vehicle_no: dc.vehicle_no ?? '',
    party_id: dc.party_id,
    party_name: dc.party?.name ?? dc.bill_to_name ?? '',
    party_code: dc.party?.code ?? '',
    total_metres: Number(dc.total_metres ?? 0),
    total_pieces: dc.total_pieces ?? 0,
    total_bundles: dc.total_bundles ?? 0,
  };

  return (
    <div>
      <PageHeader
        title="New Fabric Receipt"
        subtitle={`From DC ${dc.code} \u00b7 ${dcInfo.party_name}`}
        crumbs={[
          { label: 'Job Work', href: '/app/jobwork' },
          { label: 'Fabric Receipt' },
        ]}
      />
      <FabricReceiptForm dc={dcInfo} seeds={seeds} />
    </div>
  );
}
