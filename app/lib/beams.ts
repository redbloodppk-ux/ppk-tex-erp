/**
 * Empty beam position (migration 314). Count based: beams carry no
 * number, so where they are is worked out from the entries on the Beams
 * screen plus the paavu records the app already keeps.
 *
 *   total          = opening qty + added - removed
 *   at each mill   = opening/adjust + sent - returned empty
 *                    - paavus received from that mill's sizing jobs
 *                      (entered after the opening count)
 *   paavu in stock = paavus in stock (in-house AND job-work paavus —
 *                    both are wound on our beams) + stock offset
 *   on looms       = paavus on loom (same)               + loom offset
 *   empty in godown= total - the rest
 *
 * The offsets come from physical counts: they cover looms / paavus the
 * app has no record of. A fresh physical count resets everything to
 * what is really there.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any;

export type BeamKind = 'opening' | 'sent_to_sizing' | 'returned_from_sizing' | 'added' | 'removed';

export const BEAM_KIND_LABEL: Record<BeamKind, string> = {
  opening: 'Opening count',
  sent_to_sizing: 'Empty beams sent to sizing',
  returned_from_sizing: 'Empty beams returned from sizing',
  added: 'New beams added',
  removed: 'Beams scrapped / removed',
};

export interface BeamMove {
  id: number; code: string | null; move_date: string; kind: BeamKind; qty: number;
  at_sizing_qty: number; party_id: number | null; vehicle_no: string | null; notes: string | null; created_at: string;
  loom_offset: number; stock_offset: number; sizing_adjust: number; is_recount: boolean;
}

export interface Mill { id: number; name: string }

export interface BeamPosition {
  hasOpening: boolean;
  total: number;
  atSizing: number;
  /** Empty beams at each sizing mill. */
  byMill: Array<{ mill: Mill; count: number; sent: number; received: number }>;
  inStock: number;
  onLoom: number;
  godown: number;
  /** Raw counts from paavu records (before offsets). */
  appInStock: number;
  appOnLoom: number;
}

export async function loadBeamPosition(sb: Sb): Promise<{ pos: BeamPosition; moves: BeamMove[]; mills: Mill[] }> {
  const [mRes, stockRes, loomRes, millRes, jobMillRes] = await Promise.all([
    sb.from('beam_movement').select('*').order('move_date', { ascending: false }).order('id', { ascending: false }),
    sb.from('pavu').select('id', { count: 'exact', head: true }).eq('status', 'in_stock'),
    sb.from('pavu').select('id', { count: 'exact', head: true }).eq('status', 'on_loom'),
    sb.from('party').select('id, name').ilike('name', '%sizing%').order('name'),
    sb.from('sizing_job').select('party:party_id ( id, name )').not('party_id', 'is', null),
  ]);
  const moves = (mRes.data ?? []) as BeamMove[];

  const millMap = new Map<number, Mill>();
  for (const p of (millRes.data ?? []) as Mill[]) millMap.set(p.id, p);
  for (const j of (jobMillRes.data ?? []) as any[]) if (j.party) millMap.set(j.party.id, j.party);

  const opening = moves.filter((m) => m.kind === 'opening')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  // Paavus received from sizing after the opening count, per mill.
  const receivedByMill = new Map<number, number>();
  if (opening) {
    // In-house paavus name their mill through the sizing job; job-work
    // paavus through the warp-beam-given row (supplier = sizing mill).
    const { data } = await sb.from('pavu').select('id, sizing_job:sizing_job_id ( party_id )')
      .gt('created_at', opening.created_at);
    const rows = (data ?? []) as any[];
    const noJob = rows.filter((p) => !p.sizing_job).map((p) => p.id);
    const jwMill = new Map<number, number>();
    if (noJob.length > 0) {
      const { data: jw } = await sb.from('jobwork_warp_beam').select('pavu_id, supplier_party_id').in('pavu_id', noJob);
      for (const r of (jw ?? []) as any[]) if (r.supplier_party_id) jwMill.set(r.pavu_id, r.supplier_party_id);
    }
    for (const p of rows) {
      const mid = Number(p.sizing_job?.party_id ?? jwMill.get(p.id) ?? 0);
      receivedByMill.set(mid, (receivedByMill.get(mid) ?? 0) + 1);
    }
  }

  let total = 0; let loomOff = 0; let stockOff = 0;
  const atMill = new Map<number, { count: number; sent: number }>();
  const bump = (mid: number | null, d: number, sent = 0): void => {
    const k = Number(mid ?? 0);
    const cur = atMill.get(k) ?? { count: 0, sent: 0 };
    cur.count += d; cur.sent += sent;
    atMill.set(k, cur);
  };
  for (const m of moves) {
    const q = Number(m.qty) || 0;
    loomOff += Number(m.loom_offset) || 0;
    stockOff += Number(m.stock_offset) || 0;
    if (m.kind === 'opening' || m.kind === 'added') total += q;
    else if (m.kind === 'removed') total -= q;
    else if (m.kind === 'sent_to_sizing') bump(m.party_id, q, q);
    else if (m.kind === 'returned_from_sizing') bump(m.party_id, -q);
    const fix = (Number(m.at_sizing_qty) || 0) + (Number(m.sizing_adjust) || 0);
    if (fix !== 0) bump(m.party_id, fix);
  }
  for (const [mid, n] of receivedByMill) bump(mid, -n);

  const byMill = Array.from(atMill.entries())
    .filter(([mid, v]) => v.count !== 0 || v.sent !== 0 || (receivedByMill.get(mid) ?? 0) > 0)
    .map(([mid, v]) => ({
      mill: millMap.get(mid) ?? { id: mid, name: mid ? `Mill #${mid}` : '(no mill)' },
      count: v.count, sent: v.sent, received: receivedByMill.get(mid) ?? 0,
    }))
    .sort((a, b) => a.mill.name.localeCompare(b.mill.name));
  const atSizing = byMill.reduce((s, r) => s + r.count, 0);

  const appInStock = stockRes.count ?? 0;
  const appOnLoom = loomRes.count ?? 0;
  const inStock = appInStock + stockOff;
  const onLoom = appOnLoom + loomOff;
  return {
    moves,
    mills: Array.from(millMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    pos: {
      hasOpening: !!opening, total, atSizing, byMill, inStock, onLoom,
      godown: total - atSizing - inStock - onLoom, appInStock, appOnLoom,
    },
  };
}

/** Rows that bring the position to a physical count. First time: the
 *  opening rows. Later: correction rows (is_recount). */
export function physicalCountRows(
  pos: BeamPosition,
  real: { godown: number; onLoom: number; inStock: number; byMill: Map<number, number> },
  date: string,
): Array<Record<string, unknown>> {
  const millTotal = Array.from(real.byMill.values()).reduce((s, n) => s + n, 0);
  const newTotal = real.godown + real.onLoom + real.inStock + millTotal;
  const rows: Array<Record<string, unknown>> = [];
  const mills = Array.from(real.byMill.entries());
  if (!pos.hasOpening) {
    const [first, ...rest] = mills;
    rows.push({
      move_date: date, kind: 'opening', qty: newTotal,
      at_sizing_qty: first ? first[1] : 0, party_id: first ? first[0] : null,
      loom_offset: real.onLoom - pos.appOnLoom, stock_offset: real.inStock - pos.appInStock,
      notes: 'Opening physical count',
    });
    for (const [mid, n] of rest) {
      rows.push({ move_date: date, kind: 'opening', qty: 0, at_sizing_qty: n, party_id: mid, notes: 'Opening physical count' });
    }
    return rows;
  }
  const diff = newTotal - pos.total;
  rows.push({
    move_date: date, kind: diff < 0 ? 'removed' : 'added', qty: Math.abs(diff), is_recount: true,
    loom_offset: real.onLoom - pos.onLoom, stock_offset: real.inStock - pos.inStock,
    notes: 'Physical count check',
  });
  const cur = new Map(pos.byMill.map((r) => [r.mill.id, r.count]));
  const ids = new Set<number>([...cur.keys(), ...real.byMill.keys()]);
  for (const mid of ids) {
    const d = (real.byMill.get(mid) ?? 0) - (cur.get(mid) ?? 0);
    if (d !== 0) rows.push({ move_date: date, kind: 'added', qty: 0, party_id: mid, sizing_adjust: d, is_recount: true, notes: 'Physical count check' });
  }
  return rows;
}
