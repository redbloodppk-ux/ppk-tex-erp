/**
 * Pavu → warp-beam-given sync.
 *
 * When a pavu row is routed to outsource via Pavu Master (tabs page or
 * bulk-routing form), we mirror the assignment into the warp-beam-
 * given list on /app/outsource by upserting a jobwork_warp_beam row
 * tagged with `pavu_id`. When the pavu is routed back to in-house we
 * delete the mirrored row.
 *
 * The mapping:
 *   jobwork_warp_beam.jobwork_party_id    ← party (party.ledger_id = pavu.outsource_ledger_id)
 *   jobwork_warp_beam.warp_count_id       ← sizing_job.warp_count_id
 *   jobwork_warp_beam.fabric_quality_id   ← null (no direct link from pavu)
 *   jobwork_warp_beam.total_ends          ← pavu.ends
 *   jobwork_warp_beam.beam_count          ← 1 (one pavu = one beam)
 *   jobwork_warp_beam.total_metres        ← pavu.meters
 *   jobwork_warp_beam.original_metres     ← pavu.meters
 *   jobwork_warp_beam.given_date          ← sizing_job.date_sent or today
 *   jobwork_warp_beam.reference_no        ← pavu.pavu_code
 *   jobwork_warp_beam.supplier_party_id   ← null (sizing party isn't tracked at pavu level)
 *   jobwork_warp_beam.pavu_id             ← pavu.id (the link)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

export interface SyncResult {
  ok: boolean;
  error?: string;
  action: 'inserted' | 'updated' | 'deleted' | 'noop';
}

/** Sync a single pavu row's outsource assignment to jobwork_warp_beam.
 *  Call after any UPDATE on pavu.production_mode / outsource_ledger_id. */
export async function syncWarpBeamFromPavu(sb: Sb, pavuId: number): Promise<SyncResult> {
  // 1. Re-read the pavu row in its post-update state, plus the sizing
  //    job context we need to populate the warp-beam-given row.
  const { data: pavu, error: pavuErr } = await sb
    .from('pavu')
    .select(`
      id, pavu_code, beam_no, ends, meters,
      production_mode, outsource_ledger_id,
      sizing_job:sizing_job_id ( id, date_sent, warp_count_id )
    `)
    .eq('id', pavuId)
    .maybeSingle();
  if (pavuErr) return { ok: false, error: pavuErr.message, action: 'noop' };
  if (!pavu)   return { ok: false, error: 'pavu row not found', action: 'noop' };

  // 2. If the pavu isn't outsource any more (or the ledger is missing),
  //    drop any existing mirror row.
  if (pavu.production_mode !== 'outsource' || pavu.outsource_ledger_id == null) {
    const { error: delErr } = await sb
      .from('jobwork_warp_beam')
      .delete()
      .eq('pavu_id', pavuId);
    if (delErr) return { ok: false, error: delErr.message, action: 'noop' };
    return { ok: true, action: 'deleted' };
  }

  // 3. Resolve the outsource weaver party from the ledger link. Pavu
  //    Master stores party.ledger_id as the outsource_ledger_id value,
  //    so the reverse lookup gets us back to the party row.
  const { data: party } = await sb
    .from('party')
    .select('id')
    .eq('ledger_id', pavu.outsource_ledger_id)
    .maybeSingle();
  if (!party) {
    return { ok: false, error: 'No party tagged with this ledger — set up the Outsource Weaver party first.', action: 'noop' };
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const payload = {
    jobwork_party_id:  party.id,
    fabric_quality_id: null,
    warp_count_id:     pavu.sizing_job?.warp_count_id ?? null,
    given_date:        pavu.sizing_job?.date_sent ?? todayIso,
    total_ends:        Number(pavu.ends ?? 0) || null,
    beam_count:        1,
    total_metres:      Number(pavu.meters ?? 0) || null,
    original_metres:   Number(pavu.meters ?? 0) || null,
    reference_no:      pavu.pavu_code ?? null,
    notes:             null,
    supplier_party_id: null,
    pavu_id:           pavuId,
    status:            'active',
  };

  // 4. UPSERT — does the mirror row exist already?
  const { data: existing } = await sb
    .from('jobwork_warp_beam')
    .select('id')
    .eq('pavu_id', pavuId)
    .maybeSingle();

  if (existing && existing.id != null) {
    const { error: updErr } = await sb
      .from('jobwork_warp_beam')
      .update(payload)
      .eq('id', existing.id);
    if (updErr) return { ok: false, error: updErr.message, action: 'noop' };
    return { ok: true, action: 'updated' };
  }
  const { error: insErr } = await sb
    .from('jobwork_warp_beam')
    .insert(payload);
  if (insErr) return { ok: false, error: insErr.message, action: 'noop' };
  return { ok: true, action: 'inserted' };
}

/** Sync many pavu rows in sequence. Returns the first failure, if any. */
export async function syncWarpBeamFromPavus(sb: Sb, pavuIds: ReadonlyArray<number>): Promise<SyncResult> {
  for (const id of pavuIds) {
    const r = await syncWarpBeamFromPavu(sb, id);
    if (!r.ok) return r;
  }
  return { ok: true, action: 'noop' };
}
