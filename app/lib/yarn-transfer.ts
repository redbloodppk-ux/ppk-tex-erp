/**
 * Yarn transfer helpers (migration 313).
 *
 * A transfer moves weft yarn between the Sizing warehouse, the In-house
 * warehouse and an Outsource / Job-work weaver. Creating one is done by
 * the DB function fn_yarn_transfer_create (atomic). This file holds the
 * balance check shown on the form and the delete / undo action.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any;

export type YarnLoc = 'sizing' | 'in_house' | 'outsource';

const n = (v: unknown): number => Number(v ?? 0) || 0;

/** Live kg of one count at one place — same rules as the Warehouse page. */
export async function measureYarnAt(sb: Sb, loc: YarnLoc, countId: number, partyId?: number | null): Promise<number> {
  if (loc === 'in_house') {
    const [o, l, out] = await Promise.all([
      sb.from('opening_stock').select('quantity').eq('bucket', 'weft_yarn').eq('mode', 'inhouse').eq('status', 'active').eq('yarn_count_id', countId),
      sb.from('yarn_lot').select('received_kg').eq('yarn_count_id', countId).eq('delivery_destination', 'in_house').eq('yarn_kind', 'yarn'),
      sb.from('stock_ledger').select('quantity').eq('bucket', 'weft_yarn').eq('direction', 'out').is('jobwork_party_id', null).eq('yarn_count_id', countId),
    ]);
    let kg = 0;
    for (const r of (o.data ?? [])) kg += n(r.quantity);
    for (const r of (l.data ?? [])) kg += n(r.received_kg);
    for (const r of (out.data ?? [])) kg -= n(r.quantity);
    return kg;
  }
  if (loc === 'sizing') {
    const [o, l, t] = await Promise.all([
      sb.from('opening_stock').select('quantity').eq('mode', 'sizing').eq('status', 'active').eq('yarn_count_id', countId),
      sb.from('yarn_lot').select('id, received_kg').eq('yarn_count_id', countId).eq('delivery_destination', 'sizing'),
      sb.from('yarn_transfer').select('kg').eq('from_loc', 'sizing').eq('yarn_count_id', countId),
    ]);
    const lotIds = ((l.data ?? []) as Array<{ id: number }>).map((x) => x.id);
    let kg = 0;
    for (const r of (o.data ?? [])) kg += n(r.quantity);
    for (const r of (l.data ?? [])) kg += n(r.received_kg);
    for (const r of (t.data ?? [])) kg -= n(r.kg);
    if (lotIds.length > 0) {
      const { data: jobs } = await sb.from('sizing_job').select('yarn_sent_kg, yarn_used_kg').in('yarn_lot_id', lotIds);
      for (const j of (jobs ?? [])) kg -= n(j.yarn_used_kg) > 0 ? n(j.yarn_used_kg) : n(j.yarn_sent_kg);
    }
    return kg;
  }
  if (partyId == null) return 0;
  const [b, out] = await Promise.all([
    sb.from('jobwork_weft_bag').select('total_kg, original_kg').eq('jobwork_party_id', partyId).eq('yarn_count_id', countId),
    sb.from('stock_ledger').select('quantity').in('bucket', ['weft_yarn', 'porvai_yarn']).eq('direction', 'out').eq('jobwork_party_id', partyId).eq('yarn_count_id', countId),
  ]);
  let kg = 0;
  for (const r of (b.data ?? [])) kg += n(r.original_kg ?? r.total_kg);
  for (const r of (out.data ?? [])) kg -= n(r.quantity);
  return kg;
}

/** Undo a transfer. Refused once the yarn at the destination has been
 *  used (then the user records a reverse transfer instead). */
export async function deleteYarnTransfer(sb: Sb, id: number): Promise<string | null> {
  const { data: t, error } = await sb.from('yarn_transfer').select('*').eq('id', id).maybeSingle();
  if (error) return error.message;
  if (!t) return 'Transfer not found.';
  const code = t.transfer_code ?? `#${id}`;

  if (t.created_lot_id != null) {
    const [{ data: lot }, { data: jobs }] = await Promise.all([
      sb.from('yarn_lot').select('received_kg, current_kg').eq('id', t.created_lot_id).maybeSingle(),
      sb.from('sizing_job').select('id').eq('yarn_lot_id', t.created_lot_id).limit(1),
    ]);
    if ((lot && n(lot.current_kg) < n(lot.received_kg) - 0.001) || (jobs ?? []).length > 0) {
      return `The yarn from ${code} is already partly used, so it cannot be deleted. Record a reverse transfer instead.`;
    }
    const { count } = await sb.from('stock_ledger').select('id', { count: 'exact', head: true })
      .eq('bucket', 'weft_yarn').eq('direction', 'out').is('jobwork_party_id', null)
      .ilike('notes', `%yarn lot #${t.created_lot_id} %`);
    if ((count ?? 0) > 0) return `The yarn from ${code} is already used in a fabric receipt, so it cannot be deleted. Record a reverse transfer instead.`;
  }
  if (t.created_bag_id != null) {
    const { data: bag } = await sb.from('jobwork_weft_bag').select('total_kg, original_kg').eq('id', t.created_bag_id).maybeSingle();
    if (bag && n(bag.total_kg) < n(bag.original_kg ?? bag.total_kg) - 0.001) {
      return `The weaver has already used part of ${code}, so it cannot be deleted. Record a reverse transfer instead.`;
    }
  }

  // Remove the destination copy first, then give the cut kg back to the
  // source lots / bags, then the ledger row and the transfer itself.
  if (t.created_lot_id != null) {
    const { error: e } = await sb.from('yarn_lot').delete().eq('id', t.created_lot_id);
    if (e) return e.message;
  }
  if (t.created_bag_id != null) {
    const { error: e } = await sb.from('jobwork_weft_bag').delete().eq('id', t.created_bag_id);
    if (e) return e.message;
  }
  for (const c of ((t.source_cuts ?? []) as Array<{ t: 'lot' | 'bag'; id: number; kg: number }>)) {
    const table = c.t === 'lot' ? 'yarn_lot' : 'jobwork_weft_bag';
    const col = c.t === 'lot' ? 'current_kg' : 'total_kg';
    const { data: row } = await sb.from(table).select(col).eq('id', c.id).maybeSingle();
    if (!row) continue;
    await sb.from(table).update({ [col]: n(row[col]) + n(c.kg) }).eq('id', c.id);
  }
  await sb.from('stock_ledger').delete().eq('source_kind', 'yarn_transfer').eq('source_id', id);
  const { error: e2 } = await sb.from('yarn_transfer').delete().eq('id', id);
  return e2 ? e2.message : null;
}

/** Tamil Nadu intra-state e-way bill limit (consignment value, ₹).
 *  Above this a movement of goods — job work included — needs an
 *  e-way bill. Change here if the state revises the limit. */
export const EWAY_BILL_LIMIT = 100000;
