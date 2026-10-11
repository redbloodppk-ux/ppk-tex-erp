/**
 * Bobbin transfer (migration 317) — move IN-STOCK bobbins between our
 * in-house stock, an outsource weaver and a job-work party, either way.
 * All bobbin stock is DERIVED in metres (pieces x m/pc), so a transfer
 * only adds rows:
 *   from in-house  -> stock_ledger bobbin OUT, no party (same as in-house
 *                     receipt consumption)
 *   from a party   -> stock_ledger bobbin OUT for that party
 *   to a party     -> jobwork_bobbin_issue (bobbin given to that party)
 *   to in-house    -> opening_stock row (bucket bobbin, mode inhouse) —
 *                     an inflow that is not a purchase, so payables and
 *                     GST are untouched
 * Undo deletes the rows it created.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PartyOpt, PavuOwner } from './pavu-transfer';
type Sb = any;

export interface BobbinOpt { id: number; code: string; ends_per_bobbin: number | null; bobbin_metre: number | null; production_mode: string | null }

const n = (v: unknown): number => Number(v ?? 0) || 0;

/** Balance in METRES per bobbin id at one place. */
export async function bobbinBalances(sb: Sb, kind: PavuOwner, party: PartyOpt | null, bobbins: BobbinOpt[]): Promise<Map<number, number>> {
  const per = new Map(bobbins.map((b) => [b.id, n(b.bobbin_metre)]));
  const bal = new Map<number, number>();
  const add = (id: number | null, m: number): void => { if (id != null) bal.set(id, (bal.get(id) ?? 0) + m); };
  if (kind === 'in_house') {
    const [o, pu, out] = await Promise.all([
      sb.from('opening_stock').select('bobbin_id, quantity').eq('bucket', 'bobbin').eq('mode', 'inhouse').eq('status', 'active'),
      sb.from('bobbin_purchase').select('bobbin_id, pieces_purchased, bobbin_metre'),
      sb.from('stock_ledger').select('bobbin_id, quantity').eq('bucket', 'bobbin').eq('direction', 'out').is('jobwork_party_id', null),
    ]);
    for (const r of (o.data ?? [])) add(r.bobbin_id, n(r.quantity));
    for (const r of (pu.data ?? [])) add(r.bobbin_id, n(r.pieces_purchased) * (n(r.bobbin_metre) || per.get(r.bobbin_id) || 0));
    for (const r of (out.data ?? [])) add(r.bobbin_id, -n(r.quantity));
    return bal;
  }
  if (!party) return bal;
  const [is, out] = await Promise.all([
    sb.from('jobwork_bobbin_issue').select('bobbin_id, pieces_issued, original_pieces').eq('status', 'active').eq('jobwork_party_id', party.id),
    sb.from('stock_ledger').select('bobbin_id, quantity').eq('bucket', 'bobbin').eq('direction', 'out').eq('jobwork_party_id', party.id),
  ]);
  for (const r of (is.data ?? [])) add(r.bobbin_id, n(r.original_pieces ?? r.pieces_issued) * (per.get(r.bobbin_id) || 1));
  for (const r of (out.data ?? [])) add(r.bobbin_id, -n(r.quantity));
  return bal;
}

export interface BobbinTransferInput {
  date: string;
  fromKind: PavuOwner; fromParty: PartyOpt | null;
  toKind: PavuOwner; toParty: PartyOpt | null;
  bobbin: BobbinOpt; toBobbin: BobbinOpt;
  pieces: number; vehicleNo: string; notes: string;
}

const placeLabel = (k: PavuOwner, p: PartyOpt | null): string =>
  k === 'in_house' ? 'In-house stock' : `${k === 'outsource' ? 'Outsource weaver' : 'Job work'}: ${p?.name ?? '?'}`;

export async function createBobbinTransfer(sb: Sb, inp: BobbinTransferInput): Promise<{ id?: number; error?: string }> {
  if (!(inp.pieces > 0)) return { error: 'Enter the number of bobbins.' };
  if (inp.fromKind === inp.toKind && (inp.fromParty?.id ?? null) === (inp.toParty?.id ?? null)) return { error: 'From and To are the same.' };
  const mpp = n(inp.bobbin.bobbin_metre);
  const metres = Math.round(inp.pieces * (mpp || 1) * 100) / 100;
  const { data: hdr, error } = await sb.from('bobbin_transfer').insert({
    transfer_date: inp.date,
    from_kind: inp.fromKind, from_party_id: inp.fromParty?.id ?? null,
    to_kind: inp.toKind, to_party_id: inp.toParty?.id ?? null,
    bobbin_id: inp.bobbin.id, to_bobbin_id: inp.toBobbin.id,
    pieces: inp.pieces, metre_per_pc: mpp || null, metres,
    vehicle_no: inp.vehicleNo.trim().toUpperCase() || null, notes: inp.notes.trim() || null,
  }).select('id, code').single();
  if (error) return { error: error.message };
  const id = Number(hdr.id); const code = String(hdr.code);
  const patch: Record<string, unknown> = {};

  const { data: led, error: lErr } = await sb.from('stock_ledger').insert({
    bucket: 'bobbin', direction: 'out', jobwork_party_id: inp.fromKind === 'in_house' ? null : inp.fromParty?.id,
    bobbin_id: inp.bobbin.id, quantity: metres, unit: 'm', event_date: inp.date,
    source_kind: 'bobbin_transfer', source_id: id, reference_no: code,
    notes: `${inp.pieces} bobbins (${inp.bobbin.code}) to ${placeLabel(inp.toKind, inp.toParty)}`,
  }).select('id').single();
  if (lErr) return { id, error: lErr.message };
  patch.ledger_row_id = led.id;

  const toMpp = n(inp.toBobbin.bobbin_metre) || mpp;
  if (inp.toKind === 'in_house') {
    const { data: op, error: oErr } = await sb.from('opening_stock').insert({
      bucket: 'bobbin', mode: 'inhouse', bobbin_id: inp.toBobbin.id, ends_per_bobbin: inp.toBobbin.ends_per_bobbin,
      quantity: Math.round(inp.pieces * (toMpp || 1) * 100) / 100, unit: 'm', open_date: inp.date,
      reference_no: code, notes: `Bobbin transfer from ${placeLabel(inp.fromKind, inp.fromParty)} (${inp.pieces} pcs)`, status: 'active',
    }).select('id').single();
    if (oErr) return { id, error: oErr.message };
    patch.created_opening_id = op.id;
  } else {
    const { data: is, error: iErr } = await sb.from('jobwork_bobbin_issue').insert({
      jobwork_party_id: inp.toParty?.id, bobbin_id: inp.toBobbin.id, issue_date: inp.date,
      pieces_issued: inp.pieces, original_pieces: inp.pieces, metre_per_pc: toMpp || null,
      reference_no: code, notes: `Bobbin transfer from ${placeLabel(inp.fromKind, inp.fromParty)}`, status: 'active',
    }).select('id').single();
    if (iErr) return { id, error: iErr.message };
    patch.created_issue_id = is.id;
  }
  await sb.from('bobbin_transfer').update(patch).eq('id', id);
  return { id };
}

export async function deleteBobbinTransfer(sb: Sb, id: number): Promise<string | null> {
  const { data: t } = await sb.from('bobbin_transfer').select('*').eq('id', id).maybeSingle();
  if (!t) return 'Transfer not found.';
  if (t.created_issue_id) await sb.from('jobwork_bobbin_issue').delete().eq('id', t.created_issue_id);
  if (t.created_opening_id) await sb.from('opening_stock').delete().eq('id', t.created_opening_id);
  if (t.ledger_row_id) await sb.from('stock_ledger').delete().eq('id', t.ledger_row_id);
  const { error } = await sb.from('bobbin_transfer').delete().eq('id', id);
  return error ? error.message : null;
}
