/**
 * Bundle/piece set math for building a Delivery Challan from a production
 * batch. Pure — no React, no Supabase — so it can be unit-tested directly.
 *
 * A "piece" is a metre value (or a towel-pcs count). A batch's detailed
 * layout is Array<{ sno, pieces[] }>. When a DC ships some pieces, the
 * leftover is computed by removing those piece VALUES from the batch's
 * bundles (not by bundle number), so partial bundles and DC-side
 * renumbering both work.
 */

export interface LeftoverBundle {
  sno: number;
  pieces: number[];
}

export interface LeftoverResult {
  bundles: LeftoverBundle[];
  pieces: number;
}

/** One selectable piece sourced from a batch's leftover bundles. */
export interface PieceSel {
  /** Bundle number in the batch this piece came from. */
  origSno: number;
  /** Piece length in metres (or pcs for towel batches). */
  metres: number;
  /** Whether this piece is ticked for the current DC. */
  selected: boolean;
  /** Bundle number this piece sits in ON THE DC (defaults to origSno). */
  dcBundle: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Remove each shipped piece value (rounded to 2dp) from the batch's
 * bundles, greedily, first match in sno order. Surviving pieces keep their
 * original bundle grouping. Unmatched shipped values are ignored.
 */
export function leftoverBundles(
  allBundles: ReadonlyArray<{ sno: number; pieces: ReadonlyArray<number> }>,
  shipped: ReadonlyArray<number>,
): LeftoverResult {
  const work: LeftoverBundle[] = allBundles.map((b) => ({
    sno: b.sno,
    pieces: b.pieces.map((p) => Number(p)),
  }));
  for (const sv of shipped) {
    const target = round2(Number(sv));
    for (const b of work) {
      const i = b.pieces.findIndex((p) => round2(p) === target);
      if (i >= 0) {
        b.pieces.splice(i, 1);
        break;
      }
    }
  }
  const bundles = work.filter((b) => b.pieces.length > 0);
  const pieces = bundles.reduce((n, b) => n + b.pieces.length, 0);
  return { bundles, pieces };
}

/** Seed a selection from leftover bundles: every piece selected, on its
 *  own original bundle number. */
export function selFromBundles(
  bundles: ReadonlyArray<{ sno: number; pieces: ReadonlyArray<number> }>,
): PieceSel[] {
  const out: PieceSel[] = [];
  for (const b of bundles) {
    for (const m of b.pieces) {
      out.push({ origSno: b.sno, metres: Number(m), selected: true, dcBundle: b.sno });
    }
  }
  return out;
}

/** Group the SELECTED pieces by their DC bundle number, sort the bundle
 *  numbers ascending, and renumber them 1..n. Pieces stay strings so they
 *  drop straight into the form's Bundle[] shape. */
export function groupSelectionToBundles(
  sel: ReadonlyArray<PieceSel>,
): Array<{ sno: number; pieces: string[] }> {
  const byBundle = new Map<number, number[]>();
  for (const p of sel) {
    if (!p.selected) continue;
    const arr = byBundle.get(p.dcBundle) ?? [];
    arr.push(p.metres);
    byBundle.set(p.dcBundle, arr);
  }
  const ordered = [...byBundle.keys()].sort((a, b) => a - b);
  return ordered.map((k, i) => ({
    sno: i + 1,
    pieces: (byBundle.get(k) ?? []).map((m) => String(m)),
  }));
}
