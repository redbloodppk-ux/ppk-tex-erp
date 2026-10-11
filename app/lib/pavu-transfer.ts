/**
 * Paavu transfer (migration 316) — move sized paavu (warp beams) that are
 * IN STOCK between our in-house stock, an outsource weaver and a job-work
 * party, in any direction.
 *
 *   from a party (outsource / job work)
 *     - stock_ledger warp_beam OUT row for that party (same shape the
 *       fabric-receipt reducer writes) so the party's warp pool drops
 *     - jobwork_warp_beam.total_metres reduced FIFO (the paavu's own row
 *       first) and the paavu unlinked from its old warp-given row, so the
 *       party's history stays but the paavu no longer belongs to it
 *   to a party
 *     - a new jobwork_warp_beam row for that party, linked to the paavu
 *   always
 *     - pavu.production_mode / ledger link / status updated
 *       (outsource = 'assigned' — the beam left our premises;
 *        in-house and job work = 'in_stock' — it is on our floor)
 *
 * Everything needed to undo is stored on pavu_transfer_item.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any;

export type PavuOwner = 'in_house' | 'outsource' | 'jobwork';

export interface PartyOpt { id: number; name: string; kind: string; ledger_id: number | null }

export interface TransferInput {
  date: string;
  fromKind: PavuOwner; fromParty: PartyOpt | null;
  toKind: PavuOwner; toParty: PartyOpt | null;
  fabricQualityId: number | null;
  vehicleNo: string; notes: string;
  pavuIds: number[];
}

const placeLabel = (k: PavuOwner, p: PartyOpt | null): string =>
  k === 'in_house' ? 'In-house stock' : `${k === 'outsource' ? 'Outsource weaver' : 'Job work'}: ${p?.name ?? '?'}`;

/** In-stock paavus currently held by an owner. */
export async function loadPavusAt(sb: Sb, kind: PavuOwner, party: PartyOpt | null): Promise<any[]> {
  let q = sb.from('pavu')
    .select('id, pavu_code, beam_no, ends, meters, status, production_mode, sizing_set_no, sizing_job:sizing_job_id ( job_code, warp_count_id )')
    .eq('production_mode', kind);
  if (kind === 'in_house') q = q.eq('status', 'in_stock');
  else if (kind === 'jobwork') q = q.eq('status', 'in_stock').eq('jobwork_ledger_id', party?.ledger_id ?? -1);
  else q = q.in('status', ['in_stock', 'assigned']).eq('outsource_ledger_id', party?.ledger_id ?? -1);
  const { data } = await q.order('pavu_code');
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return rows;
  const { data: wb } = await sb.from('jobwork_warp_beam')
    .select('pavu_id, fabric_quality_id, warp_count_id, quality:fabric_quality_id ( code, is_merged, merged_name )')
    .in('pavu_id', rows.map((r) => r.id));
  const byPavu = new Map(((wb ?? []) as any[]).map((w) => [w.pavu_id, w]));
  return rows.map((r) => ({ ...r, wb: byPavu.get(r.id) ?? null }));
}

export async function createPavuTransfer(sb: Sb, inp: TransferInput): Promise<{ id?: number; error?: string }> {
  if (inp.pavuIds.length === 0) return { error: 'Tick at least one paavu.' };
  if (inp.fromKind === inp.toKind && (inp.fromParty?.id ?? null) === (inp.toParty?.id ?? null)) return { error: 'From and To are the same.' };
  if (inp.toKind !== 'in_house' && !inp.toParty) return { error: 'Pick the party the paavu goes to.' };
  if (inp.fromKind !== 'in_house' && !inp.fromParty) return { error: 'Pick the party the paavu comes from.' };
  if (inp.toKind !== 'in_house' && !inp.toParty?.ledger_id) return { error: 'That party has no ledger linked — set it up on the party form first.' };

  const { data: hdr, error: hErr } = await sb.from('pavu_transfer').insert({
    transfer_date: inp.date,
    from_kind: inp.fromKind, from_party_id: inp.fromParty?.id ?? null,
    to_kind: inp.toKind, to_party_id: inp.toParty?.id ?? null,
    fabric_quality_id: inp.fabricQualityId,
    vehicle_no: inp.vehicleNo.trim().toUpperCase() || null,
    notes: inp.notes.trim() || null,
  }).select('id, code').single();
  if (hErr) return { error: hErr.message };
  const tid = Number(hdr.id); const code = String(hdr.code);

  for (const pid of inp.pavuIds) {
    const { data: p } = await sb.from('pavu')
      .select('id, pavu_code, beam_no, ends, meters, status, production_mode, outsource_ledger_id, jobwork_ledger_id, sizing_set_no, sizing_job:sizing_job_id ( warp_count_id )')
      .eq('id', pid).maybeSingle();
    if (!p) return { id: tid, error: `Paavu #${pid} not found.` };
    const metres = Number(p.meters ?? 0);
    const item: Record<string, unknown> = {
      transfer_id: tid, pavu_id: pid, pavu_code: p.pavu_code, beam_no: p.beam_no, ends: p.ends, metres,
      prev_mode: p.production_mode, prev_status: p.status,
      prev_outsource_ledger_id: p.outsource_ledger_id, prev_jobwork_ledger_id: p.jobwork_ledger_id,
    };

    // ── Source side: take it out of the party's warp pool ──
    let srcQuality: number | null = null; let srcCount: number | null = null;
    if (inp.fromKind !== 'in_house' && inp.fromParty) {
      const { data: own } = await sb.from('jobwork_warp_beam')
        .select('id, fabric_quality_id, warp_count_id').eq('pavu_id', pid).maybeSingle();
      srcQuality = own?.fabric_quality_id ?? null; srcCount = own?.warp_count_id ?? null;
      let pool = sb.from('jobwork_warp_beam').select('id, total_metres')
        .eq('jobwork_party_id', inp.fromParty.id).gt('total_metres', 0);
      pool = srcQuality != null ? pool.eq('fabric_quality_id', srcQuality) : pool;
      const { data: rows } = await pool.order('given_date').order('id');
      const ordered = ((rows ?? []) as Array<{ id: number; total_metres: number | string }>)
        .sort((a, b) => Number(b.id === own?.id) - Number(a.id === own?.id));
      let left = metres; const cuts: Array<{ id: number; m: number }> = [];
      for (const r of ordered) {
        if (left <= 0.0001) break;
        const avail = Number(r.total_metres); const cut = Math.min(avail, left);
        await sb.from('jobwork_warp_beam').update({ total_metres: Math.round((avail - cut) * 100) / 100 }).eq('id', r.id);
        cuts.push({ id: r.id, m: cut }); left -= cut;
      }
      item.source_cuts = cuts;
      const { data: led } = await sb.from('stock_ledger').insert({
        bucket: 'warp_beam', direction: 'out', jobwork_party_id: inp.fromParty.id,
        fabric_quality_id: srcQuality, quantity: metres, unit: 'm', event_date: inp.date,
        source_kind: 'pavu_transfer', source_id: tid, reference_no: code,
        notes: `Paavu ${p.pavu_code} (beam ${p.beam_no}) to ${placeLabel(inp.toKind, inp.toParty)}`,
      }).select('id').single();
      item.ledger_row_id = led?.id ?? null;
      if (own?.id) {
        await sb.from('jobwork_warp_beam').update({ pavu_id: null }).eq('id', own.id);
        item.unlinked_wb_id = own.id;
      }
    }

    // ── Destination side ──
    if (inp.toKind !== 'in_house' && inp.toParty) {
      const { data: bn, error: bnErr } = await sb.rpc('fn_next_warp_beam_batch_no');
      if (bnErr) return { id: tid, error: bnErr.message };
      const { data: wb, error: wbErr } = await sb.from('jobwork_warp_beam').insert({
        jobwork_party_id: inp.toParty.id,
        fabric_quality_id: inp.fabricQualityId ?? srcQuality,
        warp_count_id: p.sizing_job?.warp_count_id ?? srcCount,
        given_date: inp.date, total_ends: Number(p.ends ?? 0) || null, beam_count: 1,
        total_metres: metres, original_metres: metres,
        reference_no: `${code} ${p.pavu_code}`,
        notes: `Beam No ${p.beam_no} — paavu transfer from ${placeLabel(inp.fromKind, inp.fromParty)}`,
        pavu_id: pid, sizing_set_no: p.sizing_set_no ?? null, status: 'active', batch_no: Number(bn),
      }).select('id').single();
      if (wbErr) return { id: tid, error: `${p.pavu_code}: ${wbErr.message}` };
      item.created_wb_id = wb.id;
    }

    const { error: pErr } = await sb.from('pavu').update({
      production_mode: inp.toKind,
      outsource_ledger_id: inp.toKind === 'outsource' ? inp.toParty?.ledger_id : null,
      jobwork_ledger_id: inp.toKind === 'jobwork' ? inp.toParty?.ledger_id : null,
      status: inp.toKind === 'outsource' ? 'assigned' : 'in_stock',
    }).eq('id', pid);
    if (pErr) return { id: tid, error: `${p.pavu_code}: ${pErr.message}` };
    const { error: iErr } = await sb.from('pavu_transfer_item').insert(item);
    if (iErr) return { id: tid, error: iErr.message };
  }
  return { id: tid };
}

/** Undo a transfer — refused once any paavu has moved on (mounted, re-
 *  transferred) or its new warp-given row has been woven against. */
export async function deletePavuTransfer(sb: Sb, id: number): Promise<string | null> {
  const [{ data: t }, { data: items }] = await Promise.all([
    sb.from('pavu_transfer').select('*').eq('id', id).maybeSingle(),
    sb.from('pavu_transfer_item').select('*').eq('transfer_id', id),
  ]);
  if (!t) return 'Transfer not found.';
  const list = (items ?? []) as any[];
  for (const it of list) {
    const { data: p } = await sb.from('pavu').select('status, production_mode').eq('id', it.pavu_id).maybeSingle();
    const expect = t.to_kind === 'outsource' ? 'assigned' : 'in_stock';
    if (!p || p.production_mode !== t.to_kind || p.status !== expect) {
      return `Paavu ${it.pavu_code} has moved on since ${t.code} (now ${p?.production_mode ?? '?'} / ${p?.status ?? '?'}), so the transfer cannot be undone. Make a new transfer back instead.`;
    }
    if (it.created_wb_id) {
      const { data: wb } = await sb.from('jobwork_warp_beam').select('total_metres, original_metres').eq('id', it.created_wb_id).maybeSingle();
      if (wb && Number(wb.total_metres) < Number(wb.original_metres) - 0.01) {
        return `Fabric has already been received against paavu ${it.pavu_code} at the new party, so ${t.code} cannot be undone. Make a new transfer back instead.`;
      }
    }
  }
  for (const it of list) {
    if (it.created_wb_id) await sb.from('jobwork_warp_beam').delete().eq('id', it.created_wb_id);
    for (const c of (it.source_cuts ?? []) as Array<{ id: number; m: number }>) {
      const { data: r } = await sb.from('jobwork_warp_beam').select('total_metres').eq('id', c.id).maybeSingle();
      if (r) await sb.from('jobwork_warp_beam').update({ total_metres: Math.round((Number(r.total_metres) + Number(c.m)) * 100) / 100 }).eq('id', c.id);
    }
    if (it.unlinked_wb_id) await sb.from('jobwork_warp_beam').update({ pavu_id: it.pavu_id }).eq('id', it.unlinked_wb_id);
    if (it.ledger_row_id) await sb.from('stock_ledger').delete().eq('id', it.ledger_row_id);
    await sb.from('pavu').update({
      production_mode: it.prev_mode, status: it.prev_status,
      outsource_ledger_id: it.prev_outsource_ledger_id, jobwork_ledger_id: it.prev_jobwork_ledger_id,
    }).eq('id', it.pavu_id);
  }
  await sb.from('pavu_transfer_item').delete().eq('transfer_id', id);
  const { error } = await sb.from('pavu_transfer').delete().eq('id', id);
  return error ? error.message : null;
}
