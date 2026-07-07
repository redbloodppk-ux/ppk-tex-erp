# Fabric Receipt Warp-Reduction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the fabric-receipt stock-reduction bug where warp beam, bobbin, weft, and porvai consumption for towel-type rows are all driven by the FULL fabric metres (`count × towel_length`) instead of a HALVED value, and add a confirm-before-save popup with an editable per-line reduction factor.

**Architecture:** Introduce one new nullable column `fabric_receipt_item.reduction_factor` (default = half the towel length, editable). Add one shared DB-side helper `halvedReceiptMetres()` used by the three places that independently subtract raw `received_metres` from the in-house warp pool (`stock-measure.ts`, `fabric-receipt/new/page.tsx`, `warehouse/page.tsx`), and a form-local `halvedMetres()` mirror inside `fabric-receipt-form.tsx` used to compute the value actually persisted at save time. A new `ReceiptConfirmDialog` component intercepts every save (towel or plain-yardage) to show the operator the computed values and let them edit the reduction factor before confirming. Total received metres (DC/pavu/invoicing) is untouched — only the four consumption pools switch from full `m` to `halvedM`.

**Tech Stack:** Next.js (App Router) + TypeScript + Supabase (Postgres), live project `cqyfbiecramujnzhgieg`, deploys to production via Vercel on push to `main`.

**Reference spec:** `docs/superpowers/specs/2026-07-06-fabric-receipt-warp-reduction-design.md`

---

### Task 1: Shared `halvedReceiptMetres()` helper

**Files:**
- Create: `app/lib/fabric-receipt/reduction.ts`

- [ ] **Step 1: Create the helper file**

```typescript
/**
 * Shared helper for computing the HALVED consumption metres from a
 * fabric_receipt_item row. Towel-type rows (length_per_pc > 0) store the
 * towel COUNT in received_metres; the four consumption pools (warp beam,
 * bobbin, weft, porvai) must be driven off a reduced metreage — see
 * docs/superpowers/specs/2026-07-06-fabric-receipt-warp-reduction-design.md.
 *
 *   count  = received_metres / length_per_pc
 *   halvedM = round2(count × reduction_factor)
 *
 * Falls back to the raw received_metres (no reduction, i.e. 1:1) when the
 * row has no length_per_pc (plain-yardage row) or no reduction_factor yet
 * (legacy row saved before this column existed) — preserving existing
 * behavior for those rows.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ReceiptMetresRow {
  received_metres: number | string | null;
  length_per_pc?: number | string | null;
  reduction_factor?: number | string | null;
}

export function halvedReceiptMetres(row: ReceiptMetresRow): number {
  const m = Number(row.received_metres ?? 0);
  const lengthPerPc = Number(row.length_per_pc ?? 0);
  const factor = Number(row.reduction_factor ?? 0);
  if (!(lengthPerPc > 0) || !(factor > 0)) {
    return round2(m);
  }
  const count = m / lengthPerPc;
  return round2(count * factor);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no new errors (this file has no external dependents yet).

- [ ] **Step 3: Commit**

```bash
git add app/lib/fabric-receipt/reduction.ts
git commit -m "feat(fabric-receipt): add shared halvedReceiptMetres helper"
```

---

### Task 2: Migration 235 — `reduction_factor` column

**Files:**
- Create: `app/db/migrations/235_fabric_receipt_reduction_factor.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Migration 235: fabric_receipt_item.reduction_factor
--
-- Adds an editable per-line "reduction factor" used to derive the HALVED
-- consumption metres (warp beam, bobbin, weft, porvai) for towel-type
-- fabric receipt rows. The app computes and defaults this to half the
-- towel length (length_per_pc / 2) at save time; the operator can
-- override it in the receipt confirm popup before saving.
--
-- See: docs/superpowers/specs/2026-07-06-fabric-receipt-warp-reduction-design.md
-- ============================================================================

ALTER TABLE public.fabric_receipt_item
  ADD COLUMN IF NOT EXISTS reduction_factor numeric(8,2);

COMMENT ON COLUMN public.fabric_receipt_item.reduction_factor IS
  'Towel-type rows only: metres consumed (warp/bobbin/weft/porvai) per towel piece. Defaults to half the towel length (length_per_pc / 2), editable by the operator at receipt-confirm time. Null for plain-yardage rows and legacy receipts saved before this column existed.';
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Use the Supabase MCP tool `apply_migration` with:
- `project_id`: `cqyfbiecramujnzhgieg`
- `name`: `235_fabric_receipt_reduction_factor`
- `query`: the SQL body above (the `ALTER TABLE` + `COMMENT ON COLUMN` statements)

Expected: tool returns success, no errors.

- [ ] **Step 3: Verify the column exists**

Use the Supabase MCP tool `execute_sql` with `project_id: cqyfbiecramujnzhgieg` and query:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'fabric_receipt_item' and column_name = 'reduction_factor';
```
Expected: one row, `data_type = numeric`, `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add app/db/migrations/235_fabric_receipt_reduction_factor.sql
git commit -m "feat(db): migration 235 - fabric_receipt_item.reduction_factor"
```

---

### Task 3: Regenerate TypeScript types

**Files:**
- Modify: `app/lib/database.types.ts`

- [ ] **Step 1: Regenerate types**

Use the Supabase MCP tool `generate_typescript_types` with `project_id: cqyfbiecramujnzhgieg`, then write its full output to `app/lib/database.types.ts` (overwrite the file's existing content with the tool's output).

- [ ] **Step 2: Confirm the new column is present**

Run: `grep -n "reduction_factor" "app/lib/database.types.ts"`
Expected: at least one match inside the `fabric_receipt_item` table's `Row`/`Insert`/`Update` type definitions, typed `number | null`.

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/database.types.ts
git commit -m "chore: regenerate database types for migration 235"
```

---

### Task 4: Export shared helpers + `reduction_factor` form state + local `halvedMetres()`

**Files:**
- Modify: `app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx`

- [ ] **Step 1: Export the small helpers and `ItemState`**

In `app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx`, add the `export` keyword to these existing declarations (no other change to their bodies):

Replace:
```typescript
interface ItemState {
  seed: ReceiptItemSeed;
  /** Length of each towel in metres. When > 0 we treat received_metres
   *  as a towel COUNT and the effective metres = received_metres ×
   *  towel_length. When 0/blank, received_metres is the actual metres. */
  towel_length: string;
  received_metres: string;
}
```
with:
```typescript
export interface ItemState {
  seed: ReceiptItemSeed;
  /** Length of each towel in metres. When > 0 we treat received_metres
   *  as a towel COUNT and the effective metres = received_metres ×
   *  towel_length. When 0/blank, received_metres is the actual metres. */
  towel_length: string;
  received_metres: string;
  /** Editable reduction factor for towel-type rows (metres consumed per
   *  towel, across warp/bobbin/weft/porvai). Defaults to half the towel
   *  length. Ignored (treated as 1) for plain-yardage rows. */
  reduction_factor: string;
}
```

Replace:
```typescript
function num(v: string): number {
```
with:
```typescript
export function num(v: string): number {
```

Replace:
```typescript
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```
with:
```typescript
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

Replace:
```typescript
function fmtMoney(v: unknown): string {
```
with:
```typescript
export function fmtMoney(v: unknown): string {
```

Replace:
```typescript
function resolvedMetres(it: ItemState): number {
  const m = num(it.received_metres);
  const t = num(it.towel_length);
  return round2(t > 0 ? m * t : m);
}
```
with:
```typescript
export function resolvedMetres(it: ItemState): number {
  const m = num(it.received_metres);
  const t = num(it.towel_length);
  return round2(t > 0 ? m * t : m);
}

/** The HALVED metres actually consumed against warp beam, bobbin, weft
 *  and porvai stock. For towel-type rows (towel_length > 0) this is
 *  count × reduction_factor, where count is the typed towel count and
 *  reduction_factor defaults to half the towel length but is editable
 *  in the confirm popup. For plain-yardage rows (towel_length blank) it
 *  is the same as resolvedMetres — a 1:1 ratio, no reduction. Falls
 *  back to resolvedMetres if the reduction factor is blank/invalid. */
export function halvedMetres(it: ItemState): number {
  const towelLen = num(it.towel_length);
  if (towelLen <= 0) {
    return resolvedMetres(it);
  }
  const factor = num(it.reduction_factor);
  if (!(factor > 0)) {
    return resolvedMetres(it);
  }
  const count = num(it.received_metres);
  return round2(count * factor);
}
```

- [ ] **Step 2: Seed `reduction_factor` in the `items` useState initializer**

Replace:
```typescript
  const [items, setItems] = useState<ItemState[]>(
    seeds.map((s) => ({
      seed: s,
      towel_length: s.towel_length != null && s.towel_length > 0 ? String(s.towel_length) : '',
      received_metres: String(s.dc_metres || 0),
    })),
  );
```
with:
```typescript
  const [items, setItems] = useState<ItemState[]>(
    seeds.map((s) => ({
      seed: s,
      towel_length: s.towel_length != null && s.towel_length > 0 ? String(s.towel_length) : '',
      received_metres: String(s.dc_metres || 0),
      reduction_factor: s.towel_length != null && s.towel_length > 0
        ? String(round2(s.towel_length / 2))
        : '1',
    })),
  );
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors (helpers are exported but not yet consumed differently; `reduction_factor` is a valid new field).

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx
git commit -m "feat(fabric-receipt): add reduction_factor form state + halvedMetres helper"
```

---

### Task 5: `totals` / `perQuality` useMemo — switch to halvedM, drop bobbin multiplier

**Files:**
- Modify: `app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx`

- [ ] **Step 1: Rewrite the `totals` useMemo**

Replace:
```typescript
  const totals = useMemo(() => {
    let metres = 0;
    let pieces = 0;
    let weftKg = 0;
    let porvaiKg = 0;
    let bobbinMtrs = 0;
    for (const it of items) {
      const m = resolvedMetres(it);
      metres += m;
      // When a towel length is set the typed received_metres is the
      // towel count - that's our piece count for the receipt.
      const towelLen = num(it.towel_length);
      pieces += towelLen > 0 ? Math.round(num(it.received_metres)) : 0;
      weftKg   += m * it.seed.weft_kg_per_m;
      porvaiKg += m * it.seed.porvai_kg_per_m;
      // Bobbin stock is reduced 1:1 in metres PER SELECTED BOBBIN against
      // the received fabric metres. bobbin_pcs_per_m on the master holds
      // the number of bobbins the quality runs (legacy rows hold 1), so
      // total bobbin metres = fabric metres × bobbin count.
      if (it.seed.bobbin_pcs_per_m > 0) bobbinMtrs += m * it.seed.bobbin_pcs_per_m;
    }
    return {
      metres: round2(metres),
      pieces,
      weftKg: round2(weftKg),
      porvaiKg: round2(porvaiKg),
      bobbinMtrs: round2(bobbinMtrs),
    };
  }, [items]);
```
with:
```typescript
  const totals = useMemo(() => {
    let metres = 0;
    let warpM = 0;
    let pieces = 0;
    let weftKg = 0;
    let porvaiKg = 0;
    let bobbinMtrs = 0;
    for (const it of items) {
      const m = resolvedMetres(it);
      const halvedM = halvedMetres(it);
      metres += m;
      warpM  += halvedM;
      // When a towel length is set the typed received_metres is the
      // towel count - that's our piece count for the receipt.
      const towelLen = num(it.towel_length);
      pieces += towelLen > 0 ? Math.round(num(it.received_metres)) : 0;
      weftKg   += halvedM * it.seed.weft_kg_per_m;
      porvaiKg += halvedM * it.seed.porvai_kg_per_m;
      // Bobbin stock is reduced 1:1 in metres against the HALVED fabric
      // metres — bobbin_pcs_per_m on the master is only a gate here
      // ("this quality has a bobbin to reduce"), not a multiplier.
      if (it.seed.bobbin_pcs_per_m > 0) bobbinMtrs += halvedM;
    }
    return {
      metres: round2(metres),
      warpM: round2(warpM),
      pieces,
      weftKg: round2(weftKg),
      porvaiKg: round2(porvaiKg),
      bobbinMtrs: round2(bobbinMtrs),
    };
  }, [items]);
```

- [ ] **Step 2: Rewrite the `perQuality` useMemo**

Replace:
```typescript
  const perQuality = useMemo(() => {
    return items
      .map((it) => {
        const m = resolvedMetres(it);
        const stock = it.seed.fabric_quality_id != null
          ? dc.per_quality_stock?.[it.seed.fabric_quality_id] ?? null
          : null;
        return {
          key: it.seed.dc_item_id,
          label: it.seed.fabric_quality_code || it.seed.fabric_quality_name,
          ends: it.seed.ends_count,
          weftCode: it.seed.weft_yarn_count_code,
          metres: m,
          weftKg: round2(m * it.seed.weft_kg_per_m),
          porvaiKg: round2(m * it.seed.porvai_kg_per_m),
          bobbinM: it.seed.bobbin_pcs_per_m > 0 ? round2(m * it.seed.bobbin_pcs_per_m) : 0,
          bobbinCount: it.seed.bobbin_pcs_per_m > 0 ? it.seed.bobbin_pcs_per_m : 0,
          stock,
        };
      })
      .filter((q) => q.metres > 0);
  }, [items, dc.per_quality_stock]);
```
with:
```typescript
  const perQuality = useMemo(() => {
    return items
      .map((it) => {
        const m = resolvedMetres(it);
        const halvedM = halvedMetres(it);
        const stock = it.seed.fabric_quality_id != null
          ? dc.per_quality_stock?.[it.seed.fabric_quality_id] ?? null
          : null;
        return {
          key: it.seed.dc_item_id,
          label: it.seed.fabric_quality_code || it.seed.fabric_quality_name,
          ends: it.seed.ends_count,
          weftCode: it.seed.weft_yarn_count_code,
          metres: m,
          warpM: halvedM,
          weftKg: round2(halvedM * it.seed.weft_kg_per_m),
          porvaiKg: round2(halvedM * it.seed.porvai_kg_per_m),
          bobbinM: it.seed.bobbin_pcs_per_m > 0 ? halvedM : 0,
          stock,
        };
      })
      .filter((q) => q.metres > 0);
  }, [items, dc.per_quality_stock]);
```

Note: `bobbinCount` is dropped entirely — bobbin reduction is now flatly 1:1 with the halved metres, so the "N bobbins × X m each" multiplier note it drove is gone (handled in Task 7).

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: errors referencing `q.bobbinCount` in the JSX (Stock impact card) — these are expected here and get fixed in Task 7. If your toolchain reports them, that's fine; proceed.

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx
git commit -m "feat(fabric-receipt): totals/perQuality use halved consumption metres"
```

---

### Task 6: Items table — remove dead bobbin vars, switch consumed preview to halvedM

**Files:**
- Modify: `app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx`

- [ ] **Step 1: Fix the per-row block**

Replace:
```typescript
            {items.map((it, idx) => {
              const m = resolvedMetres(it);
              const consumed = round2(m * it.seed.weft_kg_per_m);
              const hasBobbin = it.seed.bobbin_pcs_per_m > 0;
              const bobbinMtrs = hasBobbin ? round2(m * it.seed.bobbin_pcs_per_m) : 0;
              return (
```
with:
```typescript
            {items.map((it, idx) => {
              const m = resolvedMetres(it);
              const consumed = round2(halvedMetres(it) * it.seed.weft_kg_per_m);
              return (
```

(`hasBobbin` and `bobbinMtrs` were declared but never used anywhere in this row's JSX — confirmed against all 9 rendered columns — so they are deleted, not replaced.)

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors from this file for unused variables.

- [ ] **Step 3: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx
git commit -m "fix(fabric-receipt): remove dead bobbin vars, use halvedM for consumed preview"
```

---

### Task 7: Stock impact card — wire `warpM`, drop stale bobbin note

**Files:**
- Modify: `app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx`

- [ ] **Step 1: Fix the top Bucket table's Warp beam metres row**

Replace:
```typescript
              {([
                { label: 'Warp beam metres',  before: dc.stock.pavu_m,   used: totals.metres,     unit: 'm'  },
                { label: 'Weft yarn',          before: dc.stock.weft_kg,  used: totals.weftKg,     unit: 'kg' },
                { label: 'Porvai yarn',        before: dc.stock.porvai_kg, used: totals.porvaiKg,  unit: 'kg' },
                { label: 'Bobbin metres',      before: dc.stock.bobbin_m, used: totals.bobbinMtrs, unit: 'm'  },
              ] as const).map((b) => {
```
with:
```typescript
              {([
                { label: 'Warp beam metres',  before: dc.stock.pavu_m,   used: totals.warpM,      unit: 'm'  },
                { label: 'Weft yarn',          before: dc.stock.weft_kg,  used: totals.weftKg,     unit: 'kg' },
                { label: 'Porvai yarn',        before: dc.stock.porvai_kg, used: totals.porvaiKg,  unit: 'kg' },
                { label: 'Bobbin metres',      before: dc.stock.bobbin_m, used: totals.bobbinMtrs, unit: 'm'  },
              ] as const).map((b) => {
```

- [ ] **Step 2: Fix the per-quality Warp metres row**

Replace:
```typescript
                  <tr className="border-t border-line/40">
                    <td className="px-2 py-1.5 font-medium">
                      Warp metres
                      <div className="text-[10px] text-ink-mute font-normal">outflow on each ends column</div>
                    </td>
                    {perQuality.map((q) => (
                      <td key={q.key} className="px-2 py-1.5 text-right">
                        {qtyCell(q.stock?.warp_m ?? null, q.metres, 'm')}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right num font-semibold">{'\u2212 '}{fmtMoney(totals.metres)} m</td>
                  </tr>
```
with:
```typescript
                  <tr className="border-t border-line/40">
                    <td className="px-2 py-1.5 font-medium">
                      Warp metres
                      <div className="text-[10px] text-ink-mute font-normal">outflow on each ends column</div>
                    </td>
                    {perQuality.map((q) => (
                      <td key={q.key} className="px-2 py-1.5 text-right">
                        {qtyCell(q.stock?.warp_m ?? null, q.warpM, 'm')}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right num font-semibold">{'\u2212 '}{fmtMoney(totals.warpM)} m</td>
                  </tr>
```

- [ ] **Step 3: Drop the stale bobbin-count multiplier note**

Replace:
```typescript
                    {perQuality.map((q) => (
                      <td key={q.key} className="px-2 py-1.5 text-right">
                        {qtyCell(q.stock?.bobbin_m ?? null, q.bobbinM, 'm')}
                        {q.bobbinCount > 1 && (
                          <span className="block text-[10px] text-ink-mute">
                            {q.bobbinCount} bobbins × {fmtMoney(q.metres)} m each (1:1)
                          </span>
                        )}
                      </td>
                    ))}
```
with:
```typescript
                    {perQuality.map((q) => (
                      <td key={q.key} className="px-2 py-1.5 text-right">
                        {qtyCell(q.stock?.bobbin_m ?? null, q.bobbinM, 'm')}
                      </td>
                    ))}
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS with no errors (all `q.bobbinCount`/`totals.metres` misuses from Task 5 are now resolved).

- [ ] **Step 5: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx
git commit -m "fix(fabric-receipt): stock impact card uses warpM, drop stale bobbin note"
```

---

### Task 8: `handleSave()` — persist `reduction_factor`, switch consumption to halvedM

**Files:**
- Modify: `app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx`

- [ ] **Step 1: Fix `itemPayload`**

Replace:
```typescript
    const itemPayload = items.map((it, idx) => {
      const m = resolvedMetres(it);
      const weftKg   = round2(m * it.seed.weft_kg_per_m);
      const porvaiKg = round2(m * it.seed.porvai_kg_per_m);
      const hasBobbin = it.seed.bobbin_pcs_per_m > 0;
      // Total bobbin metres = fabric metres × number of bobbins the
      // quality runs (bobbin_pcs_per_m; legacy rows hold 1).
      const bobMtrs  = hasBobbin ? round2(m * it.seed.bobbin_pcs_per_m) : 0;
      // If towel length is set, the typed received_metres is the towel
      // count; otherwise it's actual metres and we save 0 as the count.
      const towelLen = round2(num(it.towel_length));
      const pieces   = towelLen > 0 ? Math.round(num(it.received_metres)) : 0;
      return {
        receipt_id: receiptId,
        sno: it.seed.sno || idx + 1,
        fabric_quality_id: it.seed.fabric_quality_id,
        ends_id: it.seed.ends_id,
        ends_count_snapshot: it.seed.ends_count,
        fd_pct: null,
        no_of_pieces: pieces,
        // Towel length is stored on the existing length_per_pc column so
        // we don't need a schema change. Detail page reads it back.
        length_per_pc: towelLen > 0 ? towelLen : null,
        received_metres: m,
        entry_mode: towelLen > 0 ? 'pcs' : 'mtr',
        weft_yarn_count_id: it.seed.weft_yarn_count_id,
        weft_kg_per_m:    it.seed.weft_kg_per_m   > 0 ? it.seed.weft_kg_per_m   : null,
        weft_consumed_kg: weftKg > 0 ? weftKg : null,
        porvai_yarn_count_id: null,
        porvai_kg_per_m:    it.seed.porvai_kg_per_m   > 0 ? it.seed.porvai_kg_per_m   : null,
        porvai_consumed_kg: porvaiKg > 0 ? porvaiKg : null,
        bobbin_id: null,
        bobbin_pcs_per_m:    hasBobbin ? it.seed.bobbin_pcs_per_m : null,
        bobbin_consumed_pcs: bobMtrs > 0 ? bobMtrs : null,
        product: null,
        qty: null,
      };
    });
```
with:
```typescript
    const itemPayload = items.map((it, idx) => {
      const m = resolvedMetres(it);
      const halvedM  = halvedMetres(it);
      const weftKg   = round2(halvedM * it.seed.weft_kg_per_m);
      const porvaiKg = round2(halvedM * it.seed.porvai_kg_per_m);
      const hasBobbin = it.seed.bobbin_pcs_per_m > 0;
      // Bobbin metres are 1:1 with the halved fabric metres —
      // bobbin_pcs_per_m only gates whether this row has a bobbin to
      // reduce, it no longer multiplies the quantity.
      const bobMtrs  = hasBobbin ? halvedM : 0;
      // If towel length is set, the typed received_metres is the towel
      // count; otherwise it's actual metres and we save 0 as the count.
      const towelLen = round2(num(it.towel_length));
      const pieces   = towelLen > 0 ? Math.round(num(it.received_metres)) : 0;
      const factor   = num(it.reduction_factor);
      return {
        receipt_id: receiptId,
        sno: it.seed.sno || idx + 1,
        fabric_quality_id: it.seed.fabric_quality_id,
        ends_id: it.seed.ends_id,
        ends_count_snapshot: it.seed.ends_count,
        fd_pct: null,
        no_of_pieces: pieces,
        // Towel length is stored on the existing length_per_pc column so
        // we don't need a schema change. Detail page reads it back.
        length_per_pc: towelLen > 0 ? towelLen : null,
        received_metres: m,
        reduction_factor: towelLen > 0 && factor > 0 ? factor : null,
        entry_mode: towelLen > 0 ? 'pcs' : 'mtr',
        weft_yarn_count_id: it.seed.weft_yarn_count_id,
        weft_kg_per_m:    it.seed.weft_kg_per_m   > 0 ? it.seed.weft_kg_per_m   : null,
        weft_consumed_kg: weftKg > 0 ? weftKg : null,
        porvai_yarn_count_id: null,
        porvai_kg_per_m:    it.seed.porvai_kg_per_m   > 0 ? it.seed.porvai_kg_per_m   : null,
        porvai_consumed_kg: porvaiKg > 0 ? porvaiKg : null,
        bobbin_id: null,
        bobbin_pcs_per_m:    hasBobbin ? it.seed.bobbin_pcs_per_m : null,
        bobbin_consumed_pcs: bobMtrs > 0 ? bobMtrs : null,
        product: null,
        qty: null,
      };
    });
```

- [ ] **Step 2: Fix `reductionItems`**

Replace:
```typescript
    const reductionItems: ReceiptItemForReduction[] = items.map((it) => {
      const m = resolvedMetres(it);
      return {
        fabric_quality_id: it.seed.fabric_quality_id,
        received_metres: m,
        weft_consumed_kg:   it.seed.weft_kg_per_m   > 0 ? round2(m * it.seed.weft_kg_per_m)   : null,
        porvai_consumed_kg: it.seed.porvai_kg_per_m > 0 ? round2(m * it.seed.porvai_kg_per_m) : null,
        // Bobbin rows are resolved inside reduceBobbin via the fabric
        // quality's calc_snapshot (bobbinIds / bobbinId). We signal
        // whether bobbin reduction should run and how many bobbins the
        // quality runs (each consumes 1 m per fabric metre).
        has_bobbin: it.seed.bobbin_pcs_per_m > 0,
        bobbin_factor: it.seed.bobbin_pcs_per_m > 0 ? it.seed.bobbin_pcs_per_m : 1,
      };
    });
```
with:
```typescript
    const reductionItems: ReceiptItemForReduction[] = items.map((it) => {
      // received_metres fed into the reduction engine is the HALVED
      // metres — it drives BOTH the warp/pavu reduction AND the bobbin
      // reduction (bobbin is 1:1 with this value; bobbin_factor below
      // only gates whether bobbin reduction runs at all, per the
      // approved design).
      const halvedM = halvedMetres(it);
      return {
        fabric_quality_id: it.seed.fabric_quality_id,
        received_metres: halvedM,
        weft_consumed_kg:   it.seed.weft_kg_per_m   > 0 ? round2(halvedM * it.seed.weft_kg_per_m)   : null,
        porvai_consumed_kg: it.seed.porvai_kg_per_m > 0 ? round2(halvedM * it.seed.porvai_kg_per_m) : null,
        has_bobbin: it.seed.bobbin_pcs_per_m > 0,
        bobbin_factor: it.seed.bobbin_pcs_per_m > 0 ? it.seed.bobbin_pcs_per_m : 1,
      };
    });
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx
git commit -m "fix(fabric-receipt): persist reduction_factor, save halvedM consumption"
```

---

### Task 9: `ReceiptConfirmDialog` component

**Files:**
- Create: `app/app/app/jobwork/fabric-receipt/new/receipt-confirm-dialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { Loader2 } from 'lucide-react';
import {
  type ItemState,
  resolvedMetres,
  halvedMetres,
  round2,
  num,
  fmtMoney,
} from './fabric-receipt-form';

interface ReceiptConfirmDialogProps {
  items: ItemState[];
  onChangeReductionFactor: (idx: number, value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

/** Confirm-before-save popup. Shown for EVERY receipt (towel or plain
 *  yardage) before it is written to the database. Lets the operator
 *  review — and, for towel-type rows, edit — the reduction factor that
 *  drives warp beam / bobbin / weft / porvai consumption, with the
 *  computed values recalculating live as they type. */
export function ReceiptConfirmDialog({
  items,
  onChangeReductionFactor,
  onConfirm,
  onCancel,
  busy,
}: ReceiptConfirmDialogProps): React.ReactElement {
  const rows = items.map((it, idx) => {
    const m = resolvedMetres(it);
    const towelLen = num(it.towel_length);
    const isTowel = towelLen > 0;
    const halvedM = halvedMetres(it);
    const weftKg = round2(halvedM * it.seed.weft_kg_per_m);
    const porvaiKg = round2(halvedM * it.seed.porvai_kg_per_m);
    return { idx, it, m, isTowel, halvedM, weftKg, porvaiKg };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="card max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <h2 className="font-display font-bold text-base">Confirm fabric receipt</h2>
        <p className="text-xs text-ink-soft">
          Review the stock that will be consumed before saving. Towel-type
          rows use an editable reduction factor (metres consumed per
          towel) — adjust it below if this batch differs from the
          default, then confirm.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-2 py-2">Quality</th>
                <th className="text-right px-2 py-2">Received</th>
                <th className="text-right px-2 py-2">Reduction factor</th>
                <th className="text-right px-2 py-2">Warp/Bobbin (m)</th>
                <th className="text-right px-2 py-2">Weft (kg)</th>
                <th className="text-right px-2 py-2">Porvai (kg)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.idx} className="border-t border-line/40">
                  <td className="px-2 py-2">
                    <div className="font-medium">{r.it.seed.fabric_quality_code || '-'}</div>
                  </td>
                  <td className="px-2 py-2 text-right num">
                    {r.isTowel ? `${r.it.received_metres} towels = ${fmtMoney(r.m)} m` : `${fmtMoney(r.m)} m`}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {r.isTowel ? (
                      <input
                        type="number" step="0.01" min="0"
                        value={r.it.reduction_factor}
                        onChange={(e) => onChangeReductionFactor(r.idx, e.target.value)}
                        className="input h-7 text-xs num w-20 text-right"
                      />
                    ) : (
                      <span className="text-ink-mute">1 (n/a)</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right num font-semibold">{fmtMoney(r.halvedM)}</td>
                  <td className="px-2 py-2 text-right num">{r.weftKg > 0 ? fmtMoney(r.weftKg) : '-'}</td>
                  <td className="px-2 py-2 text-right num">{r.porvaiKg > 0 ? fmtMoney(r.porvaiKg) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary text-xs">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary text-xs">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Confirm &amp; save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors (component is not yet imported anywhere — Task 10 wires it in).

- [ ] **Step 3: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/receipt-confirm-dialog.tsx
git commit -m "feat(fabric-receipt): add ReceiptConfirmDialog component"
```

---

### Task 10: Wire the confirm dialog into the form

**Files:**
- Modify: `app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx`

- [ ] **Step 1: Import the dialog**

Replace:
```typescript
import { measureStock, buildSnapshot } from '@/lib/fabric-receipt/stock-measure';
import { cancelFabricReceipt } from '../[id]/actions';
```
with:
```typescript
import { measureStock, buildSnapshot } from '@/lib/fabric-receipt/stock-measure';
import { cancelFabricReceipt } from '../[id]/actions';
import { ReceiptConfirmDialog } from './receipt-confirm-dialog';
```

- [ ] **Step 2: Add `showConfirm` state next to the other form state**

Replace:
```typescript
  const [busy, setBusy]   = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
```
with:
```typescript
  const [busy, setBusy]   = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  /** Confirm-before-save popup — every save (towel or plain-yardage)
   *  goes through this dialog so the operator can review/edit the
   *  reduction factor before the receipt is written. */
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
```

- [ ] **Step 3: Add `openConfirm()` and `handleConfirmSave()`, right before `handleSave()`**

Replace:
```typescript
  async function handleSave(): Promise<void> {
    setError(null);
    if (dcConflict) {
      setError(`${dc.code} is already receipted by ${dcConflict}. Pick a free DC from the Source DC list before saving.`);
      return;
    }
    if (totals.metres <= 0) {
      setError('Total received metres must be greater than zero.');
      return;
    }

    setBusy(true);
```
with:
```typescript
  /** Runs the pre-save validation, then opens the confirm popup instead
   *  of saving directly. This is what the form's onSubmit calls now. */
  function openConfirm(): void {
    setError(null);
    if (dcConflict) {
      setError(`${dc.code} is already receipted by ${dcConflict}. Pick a free DC from the Source DC list before saving.`);
      return;
    }
    if (totals.metres <= 0) {
      setError('Total received metres must be greater than zero.');
      return;
    }
    setShowConfirm(true);
  }

  async function handleConfirmSave(): Promise<void> {
    setShowConfirm(false);
    await handleSave();
  }

  async function handleSave(): Promise<void> {
    setError(null);
    if (dcConflict) {
      setError(`${dc.code} is already receipted by ${dcConflict}. Pick a free DC from the Source DC list before saving.`);
      return;
    }
    if (totals.metres <= 0) {
      setError('Total received metres must be greater than zero.');
      return;
    }

    setBusy(true);
```

- [ ] **Step 4: Change the form's `onSubmit` to open the popup instead of saving directly**

Replace:
```typescript
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
```
with:
```typescript
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); openConfirm(); }}>
```

- [ ] **Step 5: Render the dialog**

Replace:
```typescript
      <div className="flex items-center gap-2">
        {savedReceipt === null ? (
```
with:
```typescript
      {showConfirm && (
        <ReceiptConfirmDialog
          items={items}
          onChangeReductionFactor={(idx, value) => patch(idx, { reduction_factor: value })}
          onConfirm={() => void handleConfirmSave()}
          onCancel={() => setShowConfirm(false)}
          busy={busy}
        />
      )}

      <div className="flex items-center gap-2">
        {savedReceipt === null ? (
```

- [ ] **Step 6: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/fabric-receipt-form.tsx
git commit -m "feat(fabric-receipt): wire ReceiptConfirmDialog into save flow"
```

---

### Task 11: Fix `stock-measure.ts`'s `measureInhouseStock()`

**Files:**
- Modify: `app/lib/fabric-receipt/stock-measure.ts`

- [ ] **Step 1: Import the shared helper**

Add near the top of the file, after the existing `type Sb = any;` line:

Replace:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;
```
with:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

import { halvedReceiptMetres } from './reduction';
```

- [ ] **Step 2: Select the extra columns and use the helper**

Replace:
```typescript
      sb.from('fabric_receipt_item')
        .select('received_metres, receipt:receipt_id!inner ( status, dc:dc_id!inner ( production_mode ) )')
        .in('fabric_quality_id', pooledQIds),
    ]);
```
with:
```typescript
      sb.from('fabric_receipt_item')
        .select('received_metres, length_per_pc, reduction_factor, receipt:receipt_id!inner ( status, dc:dc_id!inner ( production_mode ) )')
        .in('fabric_quality_id', pooledQIds),
    ]);
```

Replace:
```typescript
    for (const r of ((outRes.data ?? []) as Array<{ received_metres: number | string | null; receipt: { status: string; dc: { production_mode: string | null } | null } | null }>)) {
      if (r.receipt?.dc?.production_mode !== 'inhouse') continue;
      if (r.receipt?.status === 'draft') continue;
      result.warp_m -= Number(r.received_metres ?? 0);
    }
```
with:
```typescript
    for (const r of ((outRes.data ?? []) as Array<{ received_metres: number | string | null; length_per_pc: number | string | null; reduction_factor: number | string | null; receipt: { status: string; dc: { production_mode: string | null } | null } | null }>)) {
      if (r.receipt?.dc?.production_mode !== 'inhouse') continue;
      if (r.receipt?.status === 'draft') continue;
      result.warp_m -= halvedReceiptMetres(r);
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/fabric-receipt/stock-measure.ts
git commit -m "fix(fabric-receipt): measureInhouseStock uses halvedReceiptMetres"
```

---

### Task 12: Fix `fabric-receipt/new/page.tsx`'s in-house per-quality Before-stock loop

**Files:**
- Modify: `app/app/app/jobwork/fabric-receipt/new/page.tsx`

- [ ] **Step 1: Import the shared helper**

Find the top import block of `app/app/app/jobwork/fabric-receipt/new/page.tsx` and add:
```typescript
import { halvedReceiptMetres } from '@/lib/fabric-receipt/reduction';
```
(Place it alongside the other `@/lib/...` imports already in that file.)

- [ ] **Step 2: Select the extra columns and use the helper**

Replace:
```typescript
          sb.from('fabric_receipt_item')
            .select('received_metres, fabric_quality_id, receipt:receipt_id!inner ( id, status, dc:dc_id!inner ( production_mode ) )')
            .in('fabric_quality_id', pool),
        ]);
```
with:
```typescript
          sb.from('fabric_receipt_item')
            .select('received_metres, length_per_pc, reduction_factor, fabric_quality_id, receipt:receipt_id!inner ( id, status, dc:dc_id!inner ( production_mode ) )')
            .in('fabric_quality_id', pool),
        ]);
```

Replace:
```typescript
        for (const r of ((outRes.data ?? []) as Array<{ received_metres: number | string | null; receipt: { status: string; dc: { production_mode: string | null } | null } | null }>)) {
          if (r.receipt?.dc?.production_mode !== 'inhouse') continue;
          if (r.receipt?.status === 'draft') continue; // parked for edit — already reversed
          warp -= Number(r.received_metres ?? 0);
        }
```
with:
```typescript
        for (const r of ((outRes.data ?? []) as Array<{ received_metres: number | string | null; length_per_pc: number | string | null; reduction_factor: number | string | null; receipt: { status: string; dc: { production_mode: string | null } | null } | null }>)) {
          if (r.receipt?.dc?.production_mode !== 'inhouse') continue;
          if (r.receipt?.status === 'draft') continue; // parked for edit — already reversed
          warp -= halvedReceiptMetres(r);
        }
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/fabric-receipt/new/page.tsx
git commit -m "fix(fabric-receipt): Before-stock loop uses halvedReceiptMetres"
```

---

### Task 13: Fix `warehouse/page.tsx`'s in-house warp-beam pivot

**Files:**
- Modify: `app/app/app/warehouse/page.tsx`

- [ ] **Step 1: Import the shared helper**

Find the top import block of `app/app/app/warehouse/page.tsx` and add:
```typescript
import { halvedReceiptMetres } from '@/lib/fabric-receipt/reduction';
```
(Place it alongside the other `@/lib/...` imports already in that file.)

- [ ] **Step 2: Select the extra columns and use the helper**

Replace:
```typescript
    const receipts = await safeSelect<{
      id: number; code: string | null; receipt_date: string | null;
      total_metres: number | string | null;
      dc: { id: number; code: string | null; production_mode: string | null } | null;
      items: Array<{ fabric_quality_id: number | null; ends_count_snapshot: number | null; received_metres: number | string | null }>;
    }>(
      supabase.from('fabric_receipt')
        .select(`
          id, code, receipt_date, total_metres,
          dc:dc_id!inner ( id, code, production_mode ),
          items:fabric_receipt_item ( fabric_quality_id, ends_count_snapshot, received_metres )
        `)
        .eq('dc.production_mode', 'inhouse'),
    );
```
with:
```typescript
    const receipts = await safeSelect<{
      id: number; code: string | null; receipt_date: string | null;
      total_metres: number | string | null;
      dc: { id: number; code: string | null; production_mode: string | null } | null;
      items: Array<{
        fabric_quality_id: number | null;
        ends_count_snapshot: number | null;
        received_metres: number | string | null;
        length_per_pc: number | string | null;
        reduction_factor: number | string | null;
      }>;
    }>(
      supabase.from('fabric_receipt')
        .select(`
          id, code, receipt_date, total_metres,
          dc:dc_id!inner ( id, code, production_mode ),
          items:fabric_receipt_item ( fabric_quality_id, ends_count_snapshot, received_metres, length_per_pc, reduction_factor )
        `)
        .eq('dc.production_mode', 'inhouse'),
    );
```

Replace:
```typescript
    for (const r of receipts) {
      const items = Array.isArray(r.items) ? r.items : [];
      for (const it of items) {
        const ends = Number(it.ends_count_snapshot ?? 0);
        const m    = Number(it.received_metres ?? 0);
        if (m <= 0) continue;
```
with:
```typescript
    for (const r of receipts) {
      const items = Array.isArray(r.items) ? r.items : [];
      for (const it of items) {
        const ends = Number(it.ends_count_snapshot ?? 0);
        const m    = halvedReceiptMetres(it);
        if (m <= 0) continue;
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/app/app/warehouse/page.tsx
git commit -m "fix(warehouse): in-house warp-beam pivot uses halvedReceiptMetres"
```

---

### Task 14: Final verification and push

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS, zero errors.

- [ ] **Step 2: Manual review checklist**

Confirm each of the following by reading the final state of the changed files:
- `fabric_receipt_item.received_metres` (the DB column) is still saved as the FULL metres `m` in `itemPayload` (Task 8) — unchanged for DC/invoicing/piece-count purposes.
- `reductionItems[].received_metres` (fed to `applyFabricReceiptStockReductions`) is the HALVED value — this is what actually reduces pavu/warp and bobbin stock.
- `weft_consumed_kg` / `porvai_consumed_kg` / `bobbin_consumed_pcs` persisted on `fabric_receipt_item` are all halvedM-based.
- Plain-yardage rows (`towel_length` blank) behave exactly as before: `halvedMetres(it) === resolvedMetres(it)`.
- The confirm popup opens on every Save click (towel and plain-yardage receipts alike) and blocks the actual `handleSave()` call until Confirm is clicked.
- `app/app/app/jobwork/fabric-receipt/[id]/page.tsx` (detail/view page) was NOT modified — confirm it still only reads persisted values, so it automatically reflects the fix.
- `stock-reductions.ts` was NOT modified — confirm the fix is entirely in the values fed into it.

- [ ] **Step 3: Push to main**

```bash
git push origin main
```
Expected: push succeeds; Vercel picks up the new commits and deploys automatically.

- [ ] **Step 4: Post-deploy smoke check**

Open a towel-type in-house DC's fabric receipt entry screen in the browser, confirm:
- The confirm popup appears on Save with an editable reduction-factor input defaulting to half the towel length.
- The Stock impact card's "Warp beam metres" and "Bobbin metres" rows show the halved figure, not the full received metres.
- Saving succeeds and the Warehouse dashboard's in-house warp-beam pivot reflects the same halved outflow.

---

## Self-Review Notes

- **Spec coverage:** every formula in the design spec (halvedM derivation, warp = halvedM, bobbin = halvedM 1:1, weft = halvedM × rate, porvai = halvedM × rate, plain-yardage unchanged, confirm popup, schema column) is implemented by a task above. The three duplicated in-house-pool call sites discovered during research (`stock-measure.ts`, `fabric-receipt/new/page.tsx`, `warehouse/page.tsx`) are each fixed via the same shared helper (Tasks 11–13), preventing drift between screens.
- **Placeholder scan:** no task contains "TBD", "similar to Task N", or unimplemented stubs — every step shows the complete before/after code.
- **Type consistency:** `halvedMetres(it: ItemState)` (form-state variant, Task 4) and `halvedReceiptMetres(row: ReceiptMetresRow)` (DB-row variant, Task 1) are intentionally two distinct functions with the same rounding/fallback semantics, since one operates on form state (`ItemState`, string fields) and the other on DB query results (nullable numeric/string columns) — both are used consistently by name across every task that references them, and `reduction_factor` is spelled identically everywhere (form state, DB payload, DB row type).
