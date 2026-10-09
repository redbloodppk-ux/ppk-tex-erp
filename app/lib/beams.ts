/**
 * Empty beam position (migration 314). Count based: beams carry no
 * number, so where they are is worked out from the movements entered on
 * the Beams screen plus the paavu records the app already keeps.
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
}

export interface BeamPosition {
  hasOpening: boolean;
  total: number;
  atSizing: number;
  inStock: number;
  onLoom: number;
  godown: number;
  /** Paavus received from sizing since the opening (each = 1 beam back). */
  receivedSized: number;
  sent: number;
}

export async function loadBeamPosition(sb: Sb): Promise<{ pos: BeamPosition; moves: BeamMove[] }> {
  const [mRes, stockRes, loomRes] = await Promise.all([
    sb.from('beam_movement').select('*').order('move_date', { ascending: false }).order('id', { ascending: false }),
    sb.from('pavu').select('id', { count: 'exact', head: true }).eq('production_mode', 'in_house').eq('status', 'in_stock'),
    sb.from('pavu').select('id', { count: 'exact', head: true }).eq('production_mode', 'in_house').eq('status', 'on_loom'),
  ]);
  const moves = (mRes.data ?? []) as BeamMove[];
  const opening = [...moves].filter((m) => m.kind === 'opening')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  let receivedSized = 0;
  if (opening) {
    // Every in-house paavu entered from a sizing job after the opening
    // count is one of our beams coming back from the sizing mill.
    const { count } = await sb.from('pavu').select('id', { count: 'exact', head: true })
      .not('sizing_job_id', 'is', null).neq('production_mode', 'jobwork')
      .gt('created_at', opening.created_at);
    receivedSized = count ?? 0;
  }

  let total = 0; let atSizing = 0; let sent = 0;
  for (const m of moves) {
    const q = Number(m.qty) || 0;
    if (m.kind === 'opening') { total += q; atSizing += Number(m.at_sizing_qty) || 0; }
    else if (m.kind === 'added') total += q;
    else if (m.kind === 'removed') total -= q;
    else if (m.kind === 'sent_to_sizing') { atSizing += q; sent += q; }
    else if (m.kind === 'returned_from_sizing') atSizing -= q;
  }
  atSizing -= receivedSized;
  const inStock = stockRes.count ?? 0;
  const onLoom = loomRes.count ?? 0;
  return {
    moves,
    pos: {
      hasOpening: !!opening, total, atSizing, inStock, onLoom,
      godown: total - atSizing - inStock - onLoom, receivedSized, sent,
    },
  };
}
