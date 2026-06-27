# DC bundle/piece selection from a production batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When building a Delivery Challan from a production batch, let the operator pick specific bundles and specific pieces, and move pieces between bundles on the DC, while the batch keeps its own layout and only the unshipped pieces stay available.

**Architecture:** Pure leftover/selection logic moves to a new testable module `app/lib/dc-leftover.ts`. `dc-form.tsx` gets (a) a loader change that computes "what's left" by subtracting already-shipped piece values instead of whole bundle numbers, and (b) a per-batch selection panel backed by a `PieceSel[]` model that rebuilds the seeded DC item on every change. No DB migration; save and print are unchanged.

**Tech Stack:** Next.js 15 (App Router), React client component, TypeScript strict, Supabase JS, Tailwind. Repo has no React test runner; the pure module is unit-tested with `npx tsx`, UI is verified with `npx tsc --noEmit` plus a live check.

---

## Background the engineer needs

- The form file is `app/app/app/delivery-challan/dc-form.tsx`. Run all commands from `C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app` (PowerShell). The environment's plain `bash` tool is unavailable — use Desktop Commander PowerShell (`start_process` + `read_process_output`).
- Type-lag workaround already used throughout: `const sb = supabase as any;` with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. Keep that pattern.
- A **piece** is just a metre value (number). A batch's detailed layout lives in `production_batch.bundles_detail`, shape `Array<{ sno: number; pieces: number[] }>`. The same shape is stored per DC line in `delivery_challan_item.bundles_detail`.
- On save, the form already writes `delivery_challan_item.bundles_detail` from `item.bundles` (pieces > 0 only), rolls `metres/pieces/bundles` from those, and depletes stock by the item metres. So a smaller/regrouped selection automatically produces the right outflow and DC — **do not touch the save path.**
- `BatchOpt` (interface ~line 99) already carries `bundles_detail`, `total_pieces`, `total_bundles`, `entry_mode`, `available`, `unit`. The loader effect is ~lines 476–777. `toggleBatchPick` is ~lines 896–960. The picker JSX is ~lines 1834–1897.
- Current (wrong) leftover logic trims by bundle `sno` (`deliveredSnosByBatch`) and only on the in-house branch; jobwork/outsource does no bundle trimming at all. This plan replaces both with one piece-value helper.
- "Keep ticked while editing" rule stays: a batch already picked on the current DC shows its full bundle set (no subtraction) so the live selection isn't hidden.

---

## File Structure

- **Create** `app/lib/dc-leftover.ts` — pure helpers + types: `PieceSel`, `LeftoverResult`, `leftoverBundles()`, `selFromBundles()`, `groupSelectionToBundles()`. One responsibility: bundle/piece set math, no React.
- **Create** `app/lib/dc-leftover.test.ts` — node assertion script for the pure helpers.
- **Modify** `app/app/app/delivery-challan/dc-form.tsx` — import helpers; rewire loader leftover computation; add `batchSel` + `expandedBundles` state; init/clear in `toggleBatchPick`; add `applySelection`; render the selection panel.

---

### Task 1: Pure leftover + selection module

**Files:**
- Create: `app/lib/dc-leftover.ts`
- Test: `app/lib/dc-leftover.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/dc-leftover.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"; npx tsx app/lib/dc-leftover.test.ts 2>&1`
Expected: FAIL — `Cannot find module './dc-leftover'` (the module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `app/lib/dc-leftover.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"; npx tsx app/lib/dc-leftover.test.ts 2>&1`
Expected: prints `ok ...` for each case then `ALL PASS`. If `tsx` is not installed, run `npx --yes tsx@latest app/lib/dc-leftover.test.ts 2>&1`.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
git add app/lib/dc-leftover.ts app/lib/dc-leftover.test.ts
git commit -m "feat(dc): pure leftover + selection helpers for batch-sourced DCs"
```

---

### Task 2: Rewire the loader to compute leftovers by piece value

**Files:**
- Modify: `app/app/app/delivery-challan/dc-form.tsx`

This task changes how `batchOpts` are built so both the jobwork/outsource branch and the in-house branch trim already-shipped pieces using `leftoverBundles`. No UI yet.

- [ ] **Step 1: Add the import**

Find the existing import near the top:

```ts
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
```

Add directly below it:

```ts
import {
  leftoverBundles,
  selFromBundles,
  groupSelectionToBundles,
  type PieceSel,
} from '@/lib/dc-leftover';
```

- [ ] **Step 2: Add a shared shipped-pieces loader helper inside the effect**

In the loader effect (the `useEffect` that starts with `if (itemsSource !== 'production_batch')`), the inner async IIFE begins with `const sb = supabase as any;`. Immediately after that line, add this helper so both branches can call it:

```ts
      // Pieces already shipped per batch across NON-cancelled DCs. Used to
      // trim each batch down to its leftover bundles (by piece value, so
      // partial bundles and DC-side renumbering both work). Cancelled DCs
      // are excluded because their stock has been restored.
      const loadShippedByBatch = async (batchIds: number[]): Promise<Map<number, number[]>> => {
        const out = new Map<number, number[]>();
        if (batchIds.length === 0) return out;
        const { data: dciRows } = await sb
          .from('delivery_challan_item')
          .select('production_batch_id, bundles_detail, delivery_challan!inner(status)')
          .in('production_batch_id', batchIds);
        for (const d of (dciRows ?? []) as Array<{
          production_batch_id: number | null;
          bundles_detail: Array<{ sno: number; pieces: number[] }> | null;
          delivery_challan: { status: string } | Array<{ status: string }> | null;
        }>) {
          if (d.production_batch_id == null) continue;
          const dc = Array.isArray(d.delivery_challan) ? d.delivery_challan[0] : d.delivery_challan;
          if (dc?.status === 'cancelled') continue;
          const arr = out.get(d.production_batch_id) ?? [];
          for (const bd of (d.bundles_detail ?? [])) {
            for (const p of (bd.pieces ?? [])) arr.push(Number(p));
          }
          out.set(d.production_batch_id, arr);
        }
        return out;
      };
```

- [ ] **Step 3: Use it in the jobwork/outsource branch**

In the `if (mode === 'jobwork' || mode === 'outsource') {` branch, find the `opts` build:

```ts
        const opts: BatchOpt[] = batches.map((b) => {
          const cm = cmById.get(b.costing_id);
          const fq = fqByCostingId.get(b.costing_id);
          const avail = availByBatch.get(b.id) ?? 0;
          return {
            id: b.id,
            batch_code: b.batch_code,
            costing_id: b.costing_id,
            quality_code: cm?.quality_code ?? null,
            quality_name: cm?.quality_name ?? null,
            fabric_quality_id: fq?.id ?? null,
            fabric_quality_hsn: fq?.hsn ?? null,
            entry_mode: (b.entry_mode === 'detailed' ? 'detailed' : 'summary'),
            // Seed the delivered metres from what's available (unit='m'), so
            // toggleBatchPick fills the line with the remaining metres.
            produced_m: avail > 0.0001 ? avail : Number(b.produced_m ?? 0),
            total_pieces: b.total_pieces,
            total_bundles: b.total_bundles,
            bundles_detail: (b.bundles_detail ?? []),
            available: avail,
            unit: 'm',
          };
        });
        if (!cancelled) { setBatchOpts(opts); setBatchesLoading(false); }
        return;
```

Replace that whole block with:

```ts
        const shippedByBatch = await loadShippedByBatch(liveIds);
        if (cancelled) { setBatchesLoading(false); return; }
        const opts: BatchOpt[] = batches.map((b) => {
          const cm = cmById.get(b.costing_id);
          const fq = fqByCostingId.get(b.costing_id);
          const avail = availByBatch.get(b.id) ?? 0;
          const allBundles = (b.bundles_detail ?? []) as Array<{ sno: number; pieces: number[] }>;
          // Batches already picked on THIS DC keep their full bundle set so
          // the live selection isn't hidden; others are trimmed to leftovers.
          const lo = pickedBatchIds.has(b.id)
            ? { bundles: allBundles, pieces: allBundles.reduce((n, x) => n + x.pieces.length, 0) }
            : leftoverBundles(allBundles, shippedByBatch.get(b.id) ?? []);
          const trimmed = !pickedBatchIds.has(b.id) && (shippedByBatch.get(b.id)?.length ?? 0) > 0;
          return {
            id: b.id,
            batch_code: b.batch_code,
            costing_id: b.costing_id,
            quality_code: cm?.quality_code ?? null,
            quality_name: cm?.quality_name ?? null,
            fabric_quality_id: fq?.id ?? null,
            fabric_quality_hsn: fq?.hsn ?? null,
            entry_mode: (b.entry_mode === 'detailed' ? 'detailed' : 'summary'),
            produced_m: avail > 0.0001 ? avail : Number(b.produced_m ?? 0),
            total_pieces: trimmed ? lo.pieces : b.total_pieces,
            total_bundles: trimmed ? lo.bundles.length : b.total_bundles,
            bundles_detail: lo.bundles,
            available: avail,
            unit: 'm',
          };
        });
        if (!cancelled) { setBatchOpts(opts); setBatchesLoading(false); }
        return;
```

- [ ] **Step 4: Remove the old sno-based delivered tracking in the in-house branch**

In the in-house branch, find the block that builds `deliveredSnosByBatch` (it queries `delivery_challan_item` for `id, production_batch_id, bundles_detail` and fills `dciToBatch` + `deliveredSnosByBatch`). Replace this exact block:

```ts
      const dciToBatch = new Map<number, number>();
      const deliveredSnosByBatch = new Map<number, Set<number>>();
      if (dciIds.length > 0) {
        const { data: dciRows } = await sb
          .from('delivery_challan_item')
          .select('id, production_batch_id, bundles_detail')
          .in('id', dciIds);
        for (const d of (dciRows ?? []) as Array<{
          id: number;
          production_batch_id: number | null;
          bundles_detail: Array<{ sno: number; pieces: number[] }> | null;
        }>) {
          if (d.production_batch_id == null) continue;
          dciToBatch.set(d.id, d.production_batch_id);
          const set = deliveredSnosByBatch.get(d.production_batch_id) ?? new Set<number>();
          for (const bd of (d.bundles_detail ?? [])) set.add(bd.sno);
          deliveredSnosByBatch.set(d.production_batch_id, set);
        }
      }
```

with (drop the snos map; keep only the dci→batch map used for the net-metres subtraction):

```ts
      const dciToBatch = new Map<number, number>();
      if (dciIds.length > 0) {
        const { data: dciRows } = await sb
          .from('delivery_challan_item')
          .select('id, production_batch_id')
          .in('id', dciIds);
        for (const d of (dciRows ?? []) as Array<{
          id: number;
          production_batch_id: number | null;
        }>) {
          if (d.production_batch_id == null) continue;
          dciToBatch.set(d.id, d.production_batch_id);
        }
      }
```

- [ ] **Step 5: Use the piece-value helper in the in-house opts build**

In the in-house branch find the final `opts` build that currently reads `deliveredSnosByBatch`:

```ts
      const opts: BatchOpt[] = batches.map((b) => {
        const cm = cmById.get(b.costing_id);
        const fq = fqByCostingId.get(b.costing_id);
        const slot = perBatch.get(b.id) ?? { net: 0, unit: 'm' as 'm' | 'pcs' };
        const allBundles = (b.bundles_detail ?? []) as Array<{ sno: number; pieces: number[] }>;
        // Show only the leftover bundles — drop any sno already delivered on
        // an earlier DC. Skip trimming for batches already picked on THIS DC
        // (their own delivery is in the ledger) so the selection stays intact.
        const deliveredSnos = pickedBatchIds.has(b.id)
          ? new Set<number>()
          : (deliveredSnosByBatch.get(b.id) ?? new Set<number>());
        const leftoverBundles = allBundles.filter((bd) => !deliveredSnos.has(bd.sno));
        const trimmed = deliveredSnos.size > 0;
        const leftoverPieces = leftoverBundles.reduce((n, bd) => n + bd.pieces.length, 0);
        return {
          id: b.id,
          batch_code: b.batch_code,
          costing_id: b.costing_id,
          quality_code: cm?.quality_code ?? null,
          quality_name: cm?.quality_name ?? null,
          fabric_quality_id: fq?.id ?? null,
          fabric_quality_hsn: fq?.hsn ?? null,
          entry_mode: (b.entry_mode === 'detailed' ? 'detailed' : 'summary'),
          produced_m: Number(b.produced_m ?? 0),
          total_pieces: trimmed ? leftoverPieces : b.total_pieces,
          total_bundles: trimmed ? leftoverBundles.length : b.total_bundles,
          bundles_detail: leftoverBundles,
          available: slot.net,
          unit: slot.unit,
        };
      });
      if (!cancelled) {
        setBatchOpts(opts);
        setBatchesLoading(false);
      }
```

Replace it with (note: the local variable is renamed away from `leftoverBundles` to avoid shadowing the imported function):

```ts
      const shippedByBatch = await loadShippedByBatch(liveIds);
      if (cancelled) { setBatchesLoading(false); return; }
      const opts: BatchOpt[] = batches.map((b) => {
        const cm = cmById.get(b.costing_id);
        const fq = fqByCostingId.get(b.costing_id);
        const slot = perBatch.get(b.id) ?? { net: 0, unit: 'm' as 'm' | 'pcs' };
        const allBundles = (b.bundles_detail ?? []) as Array<{ sno: number; pieces: number[] }>;
        // Trim to leftover pieces (by value). Batches already picked on THIS
        // DC keep their full set so the live selection isn't hidden.
        const lo = pickedBatchIds.has(b.id)
          ? { bundles: allBundles, pieces: allBundles.reduce((n, x) => n + x.pieces.length, 0) }
          : leftoverBundles(allBundles, shippedByBatch.get(b.id) ?? []);
        const trimmed = !pickedBatchIds.has(b.id) && (shippedByBatch.get(b.id)?.length ?? 0) > 0;
        return {
          id: b.id,
          batch_code: b.batch_code,
          costing_id: b.costing_id,
          quality_code: cm?.quality_code ?? null,
          quality_name: cm?.quality_name ?? null,
          fabric_quality_id: fq?.id ?? null,
          fabric_quality_hsn: fq?.hsn ?? null,
          entry_mode: (b.entry_mode === 'detailed' ? 'detailed' : 'summary'),
          produced_m: Number(b.produced_m ?? 0),
          total_pieces: trimmed ? lo.pieces : b.total_pieces,
          total_bundles: trimmed ? lo.bundles.length : b.total_bundles,
          bundles_detail: lo.bundles,
          available: slot.net,
          unit: slot.unit,
        };
      });
      if (!cancelled) {
        setBatchOpts(opts);
        setBatchesLoading(false);
      }
```

- [ ] **Step 6: Type-check**

Run: `cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"; npx tsc --noEmit 2>&1; "TSC_EXIT=$LASTEXITCODE"`
Expected: `TSC_EXIT=0`. If it reports `selFromBundles`/`groupSelectionToBundles`/`PieceSel` unused, that's expected — they're consumed in Task 3/4; leave the import as-is.
(If the unused-import lint fails the type-check in this repo, temporarily change the import to only `leftoverBundles` for this commit and restore the full import in Task 3 Step 1. Check by reading the tsc output.)

- [ ] **Step 7: Commit**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
git add app/app/app/delivery-challan/dc-form.tsx
git commit -m "feat(dc): compute batch leftovers by piece value (all modes)"
```

---

### Task 3: Selection state + rebuild on change

**Files:**
- Modify: `app/app/app/delivery-challan/dc-form.tsx`

- [ ] **Step 1: Ensure the full import is present**

Confirm the top of the file imports all four names (restore if Task 2 Step 6 trimmed them):

```ts
import {
  leftoverBundles,
  selFromBundles,
  groupSelectionToBundles,
  type PieceSel,
} from '@/lib/dc-leftover';
```

- [ ] **Step 2: Add component state**

Find the existing state declarations near `const [batchOpts, setBatchOpts] = useState<BatchOpt[]>([]);`. Directly below the `batchesLoading` state line, add:

```ts
  // Per-batch piece selection for batch-sourced DC items. Keyed by
  // production_batch.id. Each entry is the flat list of that batch's
  // leftover pieces with their tick state and the DC bundle they sit in.
  // Changing any of these rebuilds the matching DC item's bundles.
  const [batchSel, setBatchSel] = useState<Record<number, PieceSel[]>>({});
  // Which "batchId:origSno" bundle rows are expanded to show their pieces.
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Add the applySelection helper**

Find `function toggleBatchPick(batch: BatchOpt, checked: boolean): void {`. Directly ABOVE it, add:

```ts
  // Push a batch's current piece selection into its DC item: group the
  // selected pieces by DC bundle number, renumber, and refresh the totals.
  // Called on every tick / move in the selection panel.
  function applySelection(batchId: number, sel: PieceSel[]): void {
    setBatchSel((m) => ({ ...m, [batchId]: sel }));
    const grouped = groupSelectionToBundles(sel);
    const selPieces = sel.filter((p) => p.selected);
    const metres = selPieces.reduce((s, p) => s + p.metres, 0);
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => {
        if (it.production_batch_id !== batchId) return it;
        const bundles: Bundle[] = grouped.length > 0
          ? grouped.map((g) => ({ sno: g.sno, pieces: g.pieces.length > 0 ? g.pieces : [''] }))
          : [{ sno: 1, pieces: [''] }];
        return {
          ...it,
          bundles,
          summary_metres: metres > 0 ? String(metres) : '',
          summary_pieces: selPieces.length > 0 ? String(selPieces.length) : '',
          summary_bundles: grouped.length > 0 ? String(grouped.length) : '',
        };
      }),
    }));
  }
```

- [ ] **Step 4: Seed/clear the selection inside toggleBatchPick**

In `toggleBatchPick`, the uncheck branch starts with `if (!checked) {`. Add a `setBatchSel` cleanup as the FIRST line inside that `if` block (before the existing `const filtered = ...`):

```ts
      if (!checked) {
        setBatchSel((m) => {
          const next = { ...m };
          delete next[batch.id];
          return next;
        });
```

Then, in the check (seed) path, find where the seeded bundles are derived:

```ts
      const isDetailed = batch.entry_mode === 'detailed' && batch.bundles_detail.length > 0;
      const bundles: Bundle[] = isDetailed
        ? batch.bundles_detail.map((bd, i) => ({
            sno: i + 1,
            pieces: (bd.pieces ?? []).map((p) => String(p)),
          }))
        : [{ sno: 1, pieces: [''] }];
```

Directly AFTER that block, add (seed the piece selection for detailed batches so the panel opens fully selected):

```ts
      if (isDetailed) {
        setBatchSel((m) => ({ ...m, [batch.id]: selFromBundles(batch.bundles_detail) }));
      }
```

- [ ] **Step 5: Type-check**

Run: `cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"; npx tsc --noEmit 2>&1; "TSC_EXIT=$LASTEXITCODE"`
Expected: `TSC_EXIT=0`. `expandedBundles`/`applySelection` are used in Task 4 — if an unused-var lint blocks the build, proceed to Task 4 first and run tsc once after, but prefer to keep this commit clean by verifying tsc only errors (not lint warnings) gate it.

- [ ] **Step 6: Commit**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
git add app/app/app/delivery-challan/dc-form.tsx
git commit -m "feat(dc): selection state + rebuild DC item from picked pieces"
```

---

### Task 4: Selection panel UI

**Files:**
- Modify: `app/app/app/delivery-challan/dc-form.tsx`

- [ ] **Step 1: Add per-piece mutators above the render**

Find `function applySelection(batchId: number, sel: PieceSel[]): void {` (added in Task 3). Directly ABOVE it, add these helpers:

```ts
  // ---- Selection-panel mutators ----
  // Toggle one piece (identified by its index in the batch's sel array).
  function togglePiece(batchId: number, idx: number, checked: boolean): void {
    const cur = batchSel[batchId] ?? [];
    applySelection(batchId, cur.map((p, i) => (i === idx ? { ...p, selected: checked } : p)));
  }
  // Toggle every piece of one original bundle at once.
  function toggleBundle(batchId: number, origSno: number, checked: boolean): void {
    const cur = batchSel[batchId] ?? [];
    applySelection(batchId, cur.map((p) => (p.origSno === origSno ? { ...p, selected: checked } : p)));
  }
  // Move one piece onto a different DC bundle number.
  function movePiece(batchId: number, idx: number, dcBundle: number): void {
    const cur = batchSel[batchId] ?? [];
    applySelection(batchId, cur.map((p, i) => (i === idx ? { ...p, dcBundle } : p)));
  }
  // Select-all / clear for the whole batch.
  function setAllPieces(batchId: number, checked: boolean): void {
    const cur = batchSel[batchId] ?? [];
    applySelection(batchId, cur.map((p) => ({ ...p, selected: checked })));
  }
  function toggleExpand(key: string): void {
    setExpandedBundles((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
```

- [ ] **Step 2: Render the panel inside the picker row**

Find the picker row JSX. The batch `<label>` closes with this tail:

```tsx
                  </div>
                </label>
              );
            })}
```

Replace that tail with a fragment that keeps the label and appends the panel:

```tsx
                  </div>
                </label>
                {checked && b.entry_mode === 'detailed' && b.bundles_detail.length > 0 && (() => {
                  const sel = batchSel[b.id] ?? [];
                  const origSnos = Array.from(new Set(sel.map((p) => p.origSno))).sort((x, y) => x - y);
                  const bundleNumOptions = (() => {
                    const used = Array.from(new Set(sel.map((p) => p.dcBundle)));
                    const maxN = used.length > 0 ? Math.max(...used, ...origSnos) : Math.max(0, ...origSnos);
                    const opts = Array.from(new Set([...origSnos, ...used])).sort((x, y) => x - y);
                    return { opts, next: maxN + 1 };
                  })();
                  const selPieces = sel.filter((p) => p.selected);
                  const selMetres = selPieces.reduce((s, p) => s + p.metres, 0);
                  const selBundles = new Set(selPieces.map((p) => p.dcBundle)).size;
                  return (
                    <div className="ml-7 mb-1.5 rounded border border-indigo-200 bg-white p-2 text-xs">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-ink">Pick bundles / pieces</span>
                        <span className="flex gap-2">
                          <button type="button" className="text-indigo-600 hover:underline"
                            onClick={() => setAllPieces(b.id, true)}>Select all</button>
                          <button type="button" className="text-ink-mute hover:underline"
                            onClick={() => setAllPieces(b.id, false)}>Clear</button>
                        </span>
                      </div>
                      <div className="space-y-1">
                        {origSnos.map((osno) => {
                          const groupIdxs = sel
                            .map((p, i) => ({ p, i }))
                            .filter((x) => x.p.origSno === osno);
                          const allOn = groupIdxs.every((x) => x.p.selected);
                          const someOn = groupIdxs.some((x) => x.p.selected);
                          const key = `${b.id}:${osno}`;
                          const open = expandedBundles.has(key);
                          const grpMetres = groupIdxs
                            .filter((x) => x.p.selected)
                            .reduce((s, x) => s + x.p.metres, 0);
                          return (
                            <div key={osno} className="rounded border border-line/70">
                              <div className="flex items-center gap-2 px-2 py-1">
                                <input type="checkbox" checked={allOn}
                                  ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                                  onChange={(e) => toggleBundle(b.id, osno, e.target.checked)} />
                                <button type="button" className="flex-1 text-left font-medium text-ink-soft"
                                  onClick={() => toggleExpand(key)}>
                                  Bundle {osno}
                                  <span className="ml-2 text-ink-mute font-normal">
                                    ({groupIdxs.filter((x) => x.p.selected).length}/{groupIdxs.length} pcs
                                    {grpMetres > 0 ? ` · ${grpMetres.toFixed(2)} m` : ''})
                                  </span>
                                  <span className="ml-1 text-ink-mute">{open ? '▾' : '▸'}</span>
                                </button>
                              </div>
                              {open && (
                                <div className="px-2 pb-1.5 pt-0.5 space-y-1">
                                  {groupIdxs.map(({ p, i }, n) => (
                                    <div key={i} className="flex items-center gap-2 pl-5">
                                      <input type="checkbox" checked={p.selected}
                                        onChange={(e) => togglePiece(b.id, i, e.target.checked)} />
                                      <span className="w-16">Piece {n + 1}</span>
                                      <span className="font-mono w-20 text-right">{p.metres.toFixed(2)} m</span>
                                      {p.selected && (
                                        <label className="flex items-center gap-1 text-ink-mute">
                                          → DC bundle
                                          <select className="border border-line rounded px-1 py-0.5"
                                            value={p.dcBundle}
                                            onChange={(e) => movePiece(b.id, i, Number(e.target.value))}>
                                            {bundleNumOptions.opts.map((o) => (
                                              <option key={o} value={o}>{o}</option>
                                            ))}
                                            <option value={bundleNumOptions.next}>
                                              {bundleNumOptions.next} (new)
                                            </option>
                                          </select>
                                        </label>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 pt-1.5 border-t border-line/60 font-medium text-ink">
                        Selected: {selPieces.length} pcs · {selBundles} bundle{selBundles === 1 ? '' : 's'} ·{' '}
                        <span className="font-mono">{selMetres.toFixed(2)} m</span> → on this DC
                      </div>
                    </div>
                  );
                })()}
              </React.Fragment>
            );
          })}
```

- [ ] **Step 3: Wrap the mapped row in a Fragment with a key**

Because the row now returns a label **and** a panel, the `.map` must return a single keyed parent. Find the start of the row return inside `batchOpts.map((b) => {`:

```tsx
              return (
                <label
                  key={b.id}
                  className={'flex items-start gap-2 p-2 rounded border cursor-pointer ' +
```

Change it to open a Fragment and move the key onto the Fragment (drop `key={b.id}` from the label):

```tsx
              return (
                <React.Fragment key={b.id}>
                <label
                  className={'flex items-start gap-2 p-2 rounded border cursor-pointer ' +
```

(The matching `</React.Fragment>` was added in Step 2's replacement tail.)

- [ ] **Step 4: Confirm React is importable as a namespace**

The file already uses `React.ReactElement` in the component signature, so `React.Fragment` resolves. If tsc reports `React refers to a UMD global`, add `import * as React from 'react';` directly under the existing `import { useEffect, useMemo, useState } from 'react';` line. Decide based on the tsc output in the next step.

- [ ] **Step 5: Type-check**

Run: `cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"; npx tsc --noEmit 2>&1; "TSC_EXIT=$LASTEXITCODE"`
Expected: `TSC_EXIT=0`. Fix any reported errors (most likely the `React.Fragment` import from Step 4, or a stray duplicate `</label>`), then re-run until clean.

- [ ] **Step 6: Commit**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
git add app/app/app/delivery-challan/dc-form.tsx
git commit -m "feat(dc): bundle/piece selection panel in batch picker"
```

---

### Task 5: Verify end-to-end and push

**Files:** none (verification only)

- [ ] **Step 1: Re-run the pure tests + type-check together**

Run:
```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npx tsx app/lib/dc-leftover.test.ts 2>&1
npx tsc --noEmit 2>&1; "TSC_EXIT=$LASTEXITCODE"
```
Expected: `ALL PASS` then `TSC_EXIT=0`.

- [ ] **Step 2: Live smoke test (manual, with the dev server)**

Start the app (`npm run dev` if not already running) and open New Delivery Challan. Then:
1. Set a production mode that has a detailed batch with leftover stock; switch Items Source to "From production batches".
2. Tick a batch — confirm the panel appears, all pieces selected, and the seeded item below shows the full metres/pieces/bundles.
3. Untick one bundle and one piece of another bundle; expand a bundle; move a selected piece to a different "DC bundle" number — confirm the "Selected" line and the item totals below update live.
4. Save the DC. Confirm it saves without error and the printed/saved bundles match the selection.

- [ ] **Step 3: Leftover regression check**

Open a second New Delivery Challan from the SAME batch and confirm: the pieces you shipped on the first DC are gone, the unshipped pieces are still offered, and the bundle counts reflect the remainder. Cancel/leave this second DC without saving.

- [ ] **Step 4: Summary-batch check**

Tick a summary-mode batch (no `bundles_detail`) — confirm NO piece panel appears and the whole quantity seeds with an editable metres field, exactly as before.

- [ ] **Step 5: Push**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
git push 2>&1; "PUSH_EXIT=$LASTEXITCODE"
```
Expected: `PUSH_EXIT=0` and a `<oldhash>..<newhash>  main -> main` line. `git push` may print a `NativeCommandError` on stderr while still succeeding — verify via the `main -> main` line and `PUSH_EXIT=0`, not the absence of stderr.

---

## Self-Review notes

- **Spec coverage:** bundles+pieces selection → Task 4 panel; move pieces between bundles → `movePiece` + DC-bundle dropdown (Task 4) + `groupSelectionToBundles` (Task 1); only-the-DC-changes → no batch write anywhere, leftover derived from shipped DCIs (Task 2); leftover-by-piece → `leftoverBundles` (Tasks 1–2); summary batches unchanged → Task 3 Step 4 only seeds `batchSel` for detailed, Task 4 panel guarded by `entry_mode === 'detailed'`; keep editable grid → grid untouched; all three modes → both loader branches updated (Task 2).
- **Type consistency:** `PieceSel` fields (`origSno`, `metres`, `selected`, `dcBundle`) are identical across `dc-leftover.ts`, `batchSel` state, and every mutator. Helper names (`leftoverBundles`, `selFromBundles`, `groupSelectionToBundles`) match imports and call sites.
- **Known v1 limitation (acceptable):** editing the bundle grid below by hand after picking does not feed back into `batchSel`, so the panel's "Selected" line can go stale relative to manual grid edits. Save uses `item.bundles` (the grid), so the saved DC is still correct. Documented intentionally; out of scope to sync both directions.
