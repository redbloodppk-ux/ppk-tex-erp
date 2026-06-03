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
      .select('id, code, name, weft_kg_per_m, porvai_kg_per_m, bobbin_pcs_per_m, calc_snapshot, is_merged, merged_name')
      .in('id', qIds);
    for (const row of (fqRows ?? []) as Array<FqRow & { is_merged: boolean; merged_name: string | null }>) fqById.set(row.id, row);
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
  // calc_snapshot.weftCountId as fallback. We also pull the count's `ne`
  // (English count number, e.g. 39) so the form shows the count instead
  // of the master code (YC-0001).
  const fqWeftById = new Map<number, { yarn_count_id: number; code: string; ne: number | null } | null>();
  const weftIdsToLookup = new Set<number>();
  if (qIds.length > 0) {
    const { data: fwRows } = await sb
      .from('fabric_quality_weft')
      .select('fabric_quality_id, yarn_count:yarn_count_id ( id, code, ne )')
      .in('fabric_quality_id', qIds)
      .order('sno');
    for (const r of (fwRows ?? [])) {
      if (fqWeftById.has(r.fabric_quality_id)) continue;
      const y = r.yarn_count;
      fqWeftById.set(r.fabric_quality_id, y ? { yarn_count_id: y.id, code: y.code, ne: y.ne != null ? Number(y.ne) : null } : null);
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
        .select('id, code, ne')
        .in('id', Array.from(weftIdsToLookup));
      const ycById = new Map<number, { id: number; code: string; ne: number | string | null }>();
      for (const y of (ycRows ?? []) as Array<{ id: number; code: string; ne: number | string | null }>) {
        ycById.set(y.id, y);
      }
      for (const qId of qIds) {
        if (fqWeftById.has(qId)) continue;
        const weftId = fqById.get(qId)?.calc_snapshot?.weftCountId;
        const y = weftId != null && weftId !== '' ? ycById.get(Number(weftId)) ?? null : null;
        fqWeftById.set(qId, y ? { yarn_count_id: y.id, code: y.code, ne: y.ne != null ? Number(y.ne) : null } : null);
      }
    }
  }

  // ── Stock snapshot (before-receipt totals across this DC's items) ──
  // We sum pavu metres available for any of the receipt's quality's
  // warp counts, weft yarn kg available for the weft counts, porvai kg
  // available across yarn_lot rows tagged kind='porvai', and bobbin
  // metres available for bobbins assigned via calc_snapshot.bobbinId.
  const warpCountIds = new Set<number>();
  const weftCountIds = new Set<number>();
  const bobbinIds    = new Set<number>();
  for (const qId of qIds) {
    const snap = fqById.get(qId)?.calc_snapshot;
    if (snap) {
      if (snap.warpCountId != null && snap.warpCountId !== '') warpCountIds.add(Number(snap.warpCountId));
      if (snap.bobbinId    != null && snap.bobbinId    !== '') bobbinIds.add(Number(snap.bobbinId));
    }
    const weft = fqWeftById.get(qId);
    if (weft?.yarn_count_id != null) weftCountIds.add(weft.yarn_count_id);
  }

  let stock_pavu_m   = 0;
  let stock_weft_kg  = 0;
  let stock_porvai_kg = 0;
  let stock_bobbin_m = 0;

  // Warp stock = sum of jobwork_warp_beam.total_metres for the qualities
  // on this receipt's DC, POOLED across any merged-delivery siblings.
  // For each quality on the DC, if it has is_merged=true we also pull
  // every other fabric_quality row with the same merged_name and treat
  // their beams as part of the same stock pool.
  const pooledQIds = new Set<number>(qIds);
  const mergedNamesSeen = new Set<string>();
  for (const qId of qIds) {
    const fq = fqById.get(qId) as (FqRow & { is_merged?: boolean; merged_name?: string | null }) | undefined;
    if (fq?.is_merged && fq.merged_name && fq.merged_name.trim() !== '') {
      mergedNamesSeen.add(fq.merged_name.trim());
    }
  }
  if (mergedNamesSeen.size > 0) {
    const { data: siblingRows } = await sb
      .from('fabric_quality')
      .select('id, merged_name')
      .eq('is_merged', true)
      .in('merged_name', Array.from(mergedNamesSeen));
    for (const r of ((siblingRows ?? []) as Array<{ id: number }>)) pooledQIds.add(r.id);
  }

  if (pooledQIds.size > 0) {
    const { data: wbRows } = await sb
      .from('jobwork_warp_beam')
      .select('total_metres')
      .in('fabric_quality_id', Array.from(pooledQIds))
      .gt('total_metres', 0);
    stock_pavu_m = ((wbRows ?? []) as Array<{ total_metres: number | string | null }>)
      .reduce((s, r) => s + Number(r.total_metres ?? 0), 0);
  }

  // Weft yarn stock = sum of jobwork_weft_bag.total_kg for the matching
  // weft yarn count(s). Same workflow as warp: yarn handed out for this
  // quality that hasn't come back yet as fabric.
  if (weftCountIds.size > 0) {
    const { data: wbagRows } = await sb
      .from('jobwork_weft_bag')
      .select('total_kg')
      .in('yarn_count_id', Array.from(weftCountIds))
      .gt('total_kg', 0);
    stock_weft_kg = ((wbagRows ?? []) as Array<{ total_kg: number | string | null }>)
      .reduce((s, r) => s + Number(r.total_kg ?? 0), 0);
  }

  // Porvai yarn stock = same jobwork_weft_bag table, filtered to the
  // porvai yarn count from calc_snapshot.porvaiCountId.
  const porvaiCountIds = new Set<number>();
  for (const qId of qIds) {
    const snap = fqById.get(qId)?.calc_snapshot;
    const pId = snap?.porvaiCountId;
    if (pId != null && pId !== '') porvaiCountIds.add(Number(pId));
  }
  if (porvaiCountIds.size > 0) {
    const { data: pBagRows } = await sb
      .from('jobwork_weft_bag')
      .select('total_kg')
      .in('yarn_count_id', Array.from(porvaiCountIds))
      .gt('total_kg', 0);
    stock_porvai_kg = ((pBagRows ?? []) as Array<{ total_kg: number | string | null }>)
      .reduce((s, r) => s + Number(r.total_kg ?? 0), 0);
  }

  // Bobbin stock = sum of (quantity x bobbin_metre) across ALL jobwork
  // bobbins whose spec (ends_per_bobbin + bobbin_metre) matches the
  // bobbin assigned to the fabric quality in calc_snapshot.bobbinId.
  // Same idea as warp beam given: multiple batches of the same bobbin
  // spec accumulate to a single stock total. FIFO reduction by
  // purchase_date is wired in stock-reductions.ts.
  const bobbinEndsByQId = new Map<number, number | null>();
  if (bobbinIds.size > 0) {
    // Step 1 - look up the assigned bobbin's spec (ends + metre).
    const { data: assignedRows } = await sb
      .from('bobbin')
      .select('id, ends_per_bobbin, bobbin_metre')
      .in('id', Array.from(bobbinIds));
    const assignedById = new Map<number, { ends_per_bobbin: number | null; bobbin_metre: number | string | null }>();
    for (const r of (assignedRows ?? []) as Array<{ id: number; ends_per_bobbin: number | null; bobbin_metre: number | string | null }>) {
      assignedById.set(r.id, r);
    }
    // Map each fabric_quality to its bobbin's ends_per_bobbin.
    const specsKey = new Set<string>();
    const specs: Array<{ ends_per_bobbin: number; bobbin_metre: number }> = [];
    for (const qId of qIds) {
      const bId = fqById.get(qId)?.calc_snapshot?.bobbinId;
      if (bId == null || bId === '') continue;
      const a = assignedById.get(Number(bId));
      if (!a) continue;
      bobbinEndsByQId.set(qId, a.ends_per_bobbin ?? null);
      const e = Number(a.ends_per_bobbin ?? 0);
      const m = Number(a.bobbin_metre ?? 0);
      if (e > 0 && m > 0) {
        const key = e + ':' + m;
        if (!specsKey.has(key)) {
          specsKey.add(key);
          specs.push({ ends_per_bobbin: e, bobbin_metre: m });
        }
      }
    }
    // Step 2 - sum stock across every jobwork bobbin matching any spec.
    for (const spec of specs) {
      const { data: bobs } = await sb
        .from('bobbin')
        .select('quantity, bobbin_metre')
        .eq('production_mode', 'jobwork')
        .eq('ends_per_bobbin', spec.ends_per_bobbin)
        .eq('bobbin_metre', spec.bobbin_metre)
        .gt('quantity', 0);
      for (const r of (bobs ?? []) as Array<{ quantity: number | null; bobbin_metre: number | string | null }>) {
        stock_bobbin_m += Number(r.quantity ?? 0) * Number(r.bobbin_metre ?? 0);
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
      weft_count_ne: weft?.ne ?? null,
      weft_kg_per_m: fq ? Number(fq.weft_kg_per_m ?? 0) : 0,
      porvai_kg_per_m: fq ? Number(fq.porvai_kg_per_m ?? 0) : 0,
      bobbin_pcs_per_m: fq ? Number(fq.bobbin_pcs_per_m ?? 0) : 0,
      bobbin_ends: it.fabric_quality_id != null ? bobbinEndsByQId.get(it.fabric_quality_id) ?? null : null,
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
    stock: {
      pavu_m:    Math.round(stock_pavu_m   * 100) / 100,
      weft_kg:   Math.round(stock_weft_kg  * 100) / 100,
      porvai_kg: Math.round(stock_porvai_kg * 100) / 100,
      bobbin_m:  Math.round(stock_bobbin_m * 100) / 100,
    },
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
