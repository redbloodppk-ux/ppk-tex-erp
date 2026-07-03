/**
 * Pavu → warp-beam-given sync.
 *
 * When a pavu row is routed to outsource OR jobwork via Pavu Master
 * (tabs page or bulk-routing form), we mirror the assignment into the
 * warp-beam-given list (on /app/outsource or /app/jobwork respectively)
 * by upserting a jobwork_warp_beam row tagged with `pavu_id`. When the
 * pavu is routed back to in-house we delete the mirrored row.
 *
 * The mapping:
 *   jobwork_warp_beam.jobwork_party_id    ← outsource: party (party.ledger_id = pavu.outsource_ledger_id)
 *                                            jobwork:   jobwork_party (jobwork_party.ledger_id = pavu.jobwork_ledger_id)
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

/** Sync a single pavu row's outsource/jobwork assignment to jobwork_warp_beam.
 *  Call after any UPDATE on pavu.production_mode / outsource_ledger_id / jobwork_ledger_id. */
export async function syncWarpBeamFromPavu(sb: Sb, pavuId: number): Promise<SyncResult> {
  // 1. Re-read the pavu row in its post-update state, plus the sizing
  //    job context we need to populate the warp-beam-given row.
  const { data: pavu, error: pavuErr } = await sb
    .from('pavu')
    .select(`
      id, pavu_code, beam_no, ends, meters,
      production_mode, outsource_ledger_id, jobwork_ledger_id,
      sizing_job:sizing_job_id ( id, date_sent, warp_count_id )
    `)
    .eq('id', pavuId)
    .maybeSingle();
  if (pavuErr) return { ok: false, error: pavuErr.message, action: 'noop' };
  if (!pavu)   return { ok: false, error: 'pavu row not found', action: 'noop' };

  const isOutsource = pavu.production_mode === 'outsource' && pavu.outsource_ledger_id != null;
  const isJobwork   = pavu.production_mode === 'jobwork'   && pavu.jobwork_ledger_id   != null;

  // 2. If the pavu isn't routed to outsource or jobwork any more (or
  //    the matching ledger link is missing), drop any existing mirror row.
  if (!isOutsource && !isJobwork) {
    const { error: delErr } = await sb
      .from('jobwork_warp_beam')
      .delete()
      .eq('pavu_id', pavuId);
    if (delErr) return { ok: false, error: delErr.message, action: 'noop' };
    return { ok: true, action: 'deleted' };
  }

  // Mark the pavu as assigned the moment it gets routed out — status
  // drives the lock on the Pavu Master inline editor so the operator
  // can't accidentally re-route a pavu that's already committed. The
  // lock is released from the matching Warp Beam Given page.
  await sb.from('pavu').update({ status: 'assigned' }).eq('id', pavuId);

  // 3. Resolve the receiving party from the ledger link.
  let jobworkPartyId: number | null = null;
  if (isOutsource) {
    // Pavu Master stores party.ledger_id as the outsource_ledger_id
    // value, so the reverse lookup gets us back to the party row.
    const { data: party } = await sb
      .from('party')
      .select('id')
      .eq('ledger_id', pavu.outsource_ledger_id)
      .maybeSingle();
    if (!party) {
      return { ok: false, error: 'No party tagged with this ledger — set up the Outsource Weaver party first.', action: 'noop' };
    }
    jobworkPartyId = party.id;
  } else {
    const { data: jp } = await sb
      .from('jobwork_party')
      .select('id')
      .eq('ledger_id', pavu.jobwork_ledger_id)
      .maybeSingle();
    if (!jp) {
      return { ok: false, error: 'No jobwork party tagged with this ledger — check Jobwork Party Master.', action: 'noop' };
    }
    jobworkPartyId = jp.id;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const payload = {
    jobwork_party_id:  jobworkPartyId,
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
