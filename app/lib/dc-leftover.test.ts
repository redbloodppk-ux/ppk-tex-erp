import {
  leftoverBundles,
  selFromBundles,
  groupSelectionToBundles,
  type PieceSel,
} from './dc-leftover';

function eq(label: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`FAIL ${label}\n  got:  ${a}\n  want: ${b}`);
  console.log(`ok   ${label}`);
}

// 1. Partial bundle: ship 82 and one 79 from a 5-piece bundle.
eq(
  'leftover partial bundle',
  leftoverBundles(
    [{ sno: 1, pieces: [82, 80.5, 79, 79.5, 79] }],
    [82, 79],
  ),
  { bundles: [{ sno: 1, pieces: [80.5, 79.5, 79] }], pieces: 3 },
);

// 2. Duplicate shipped values each remove one piece.
eq(
  'leftover duplicates',
  leftoverBundles([{ sno: 1, pieces: [79, 79, 79] }], [79, 79]),
  { bundles: [{ sno: 1, pieces: [79] }], pieces: 1 },
);

// 3. Whole bundle shipped drops the bundle entirely.
eq(
  'leftover whole bundle gone',
  leftoverBundles(
    [{ sno: 1, pieces: [10, 11] }, { sno: 2, pieces: [12] }],
    [10, 11],
  ),
  { bundles: [{ sno: 2, pieces: [12] }], pieces: 1 },
);

// 4. Unmatched shipped value (data drift) is ignored, piece stays.
eq(
  'leftover unmatched ignored',
  leftoverBundles([{ sno: 1, pieces: [10] }], [999]),
  { bundles: [{ sno: 1, pieces: [10] }], pieces: 1 },
);

// 5. Rounding: 414.70 matches 414.7.
eq(
  'leftover 2dp rounding',
  leftoverBundles([{ sno: 1, pieces: [414.7, 5] }], [414.7]),
  { bundles: [{ sno: 1, pieces: [5] }], pieces: 1 },
);

// 6. selFromBundles seeds every piece selected, dcBundle = origSno.
eq(
  'selFromBundles',
  selFromBundles([{ sno: 2, pieces: [10, 11] }]),
  [
    { origSno: 2, metres: 10, selected: true, dcBundle: 2 },
    { origSno: 2, metres: 11, selected: true, dcBundle: 2 },
  ],
);

// 7. groupSelectionToBundles: regroup two origin bundles into DC bundle 1,
//    drop deselected pieces, renumber 1..n.
const sel: PieceSel[] = [
  { origSno: 1, metres: 10, selected: true, dcBundle: 1 },
  { origSno: 1, metres: 11, selected: false, dcBundle: 1 }, // deselected
  { origSno: 3, metres: 12, selected: true, dcBundle: 1 },  // moved into 1
  { origSno: 3, metres: 13, selected: true, dcBundle: 5 },  // own bundle
];
eq(
  'groupSelectionToBundles',
  groupSelectionToBundles(sel),
  [
    { sno: 1, pieces: ['10', '12'] },
    { sno: 2, pieces: ['13'] },
  ],
);

console.log('ALL PASS');
