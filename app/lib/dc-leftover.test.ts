/**
 * Leftover / selection helpers for batch-sourced delivery challans.
 *
 * These cases were already here, written as a hand-rolled script with a
 * custom eq() that threw on mismatch. They ran at import time, so vitest
 * collected the file, executed every assertion, and then reported
 * "No test suite found" because there was no describe/it in it — a pass
 * that looked like a failure, and a failure that would have looked like
 * a collection error rather than naming the case that broke.
 *
 * Same seven cases, unchanged; only the reporting is different.
 */
import { describe, it, expect } from 'vitest';
import {
  leftoverBundles,
  selFromBundles,
  groupSelectionToBundles,
  type PieceSel,
} from './dc-leftover';

describe('leftoverBundles', () => {
  it('ships some pieces out of a bundle and keeps the rest', () => {
    expect(
      leftoverBundles([{ sno: 1, pieces: [82, 80.5, 79, 79.5, 79] }], [82, 79]),
    ).toEqual({ bundles: [{ sno: 1, pieces: [80.5, 79.5, 79] }], pieces: 3 });
  });

  it('removes one piece per duplicate shipped value, not all matches', () => {
    expect(
      leftoverBundles([{ sno: 1, pieces: [79, 79, 79] }], [79, 79]),
    ).toEqual({ bundles: [{ sno: 1, pieces: [79] }], pieces: 1 });
  });

  it('drops a bundle entirely once every piece in it has shipped', () => {
    expect(
      leftoverBundles(
        [{ sno: 1, pieces: [10, 11] }, { sno: 2, pieces: [12] }],
        [10, 11],
      ),
    ).toEqual({ bundles: [{ sno: 2, pieces: [12] }], pieces: 1 });
  });

  it('ignores a shipped value that matches nothing, rather than guessing', () => {
    // Data drift: the DC names a length the batch does not contain. The
    // piece stays put — silently discarding one would lose cloth.
    expect(
      leftoverBundles([{ sno: 1, pieces: [10] }], [999]),
    ).toEqual({ bundles: [{ sno: 1, pieces: [10] }], pieces: 1 });
  });

  it('matches on 2 decimal places, so 414.70 cancels 414.7', () => {
    expect(
      leftoverBundles([{ sno: 1, pieces: [414.7, 5] }], [414.7]),
    ).toEqual({ bundles: [{ sno: 1, pieces: [5] }], pieces: 1 });
  });
});

describe('selFromBundles', () => {
  it('seeds every piece selected and in its own origin bundle', () => {
    expect(selFromBundles([{ sno: 2, pieces: [10, 11] }])).toEqual([
      { origSno: 2, metres: 10, selected: true, dcBundle: 2 },
      { origSno: 2, metres: 11, selected: true, dcBundle: 2 },
    ]);
  });
});

describe('groupSelectionToBundles', () => {
  it('regroups across origins, drops deselected pieces and renumbers 1..n', () => {
    const sel: PieceSel[] = [
      { origSno: 1, metres: 10, selected: true,  dcBundle: 1 },
      { origSno: 1, metres: 11, selected: false, dcBundle: 1 }, // deselected
      { origSno: 3, metres: 12, selected: true,  dcBundle: 1 }, // moved into 1
      { origSno: 3, metres: 13, selected: true,  dcBundle: 5 }, // own bundle
    ];
    expect(groupSelectionToBundles(sel)).toEqual([
      { sno: 1, pieces: ['10', '12'] },
      { sno: 2, pieces: ['13'] },
    ]);
  });
});
