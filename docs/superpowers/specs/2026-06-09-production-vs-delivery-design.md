# Production vs Delivery — Design Spec

**Date:** 2026-06-09
**Author:** PPK TEX ERP
**Status:** Approved (brainstorming complete)

## Goal

A period-scoped report that surfaces per-quality variance between what the mill produced (or had returned to it by a jobwork / outsource party) and what physically left the gate as Delivery Challans, broken down by production mode (in-house, jobwork, outsource). Operators use it to spot qualities where production and dispatch are drifting out of sync.

## Constraints

- The existing `/app/reports/stock-on-hand` page is NOT modified.
- One new SQL view holds all the math so the page is a thin renderer.
- Quality on the production side comes from real columns — no manual quality tagging on `production_shift_log` (which doesn't carry it).
- Default behaviour follows the codebase pattern: reuse the same date-range preset shape as `/app/reports/pnl`.

## Decisions

1. **Name: "Production vs Delivery"** — names both inputs the report compares. Rejected alternative: "Delivery Variance" (loses the production half).
2. **Quality attribution per mode**:
   - **In-house** = `production_shift_log.metres_woven` resolved to a quality via the loom's active `production_batch` (loom_id + log_date in [start_date, end_date]).
   - **Jobwork** = `fabric_receipt_item.received_metres` where the receipt's DC has `production_mode='jobwork'` (fabric_quality_id is on the receipt item directly).
   - **Outsource** = same as jobwork but `production_mode='outsource'`.
3. **Delivered side** = `delivery_challan_item.metres` summed where the DC's `production_mode` matches the row's mode AND `dc.status IN ('confirmed','invoiced')`.
4. **Screen layout: row per (quality, mode)**, sortable, with filter pills. Rejected alternatives: row-per-quality with side-by-side mode columns (too wide), quality-grouped sections (too vertical for scanning).
5. **Excel export layout: quality-grouped sections** — each quality is a section header with three sub-rows (in-house / jobwork / outsource) and a quality total, plus a grand total. Better for printed sharing.
6. **Time window**: date-range picker reusing the P&L page's preset set (This month / Last month / This quarter / FY-to-date / Last 30d / custom). Rejected: all-time (totals grow without bound and obscure recent drift).
7. **Variance** = `produced − delivered`. **Variance %** = `variance / produced × 100` when produced > 0; null otherwise. Positive variance = stock building; negative = stock depleting.

## Data Sources

### In-house production (quality-resolved shift log)

```
WITH batch_overlap AS (
  SELECT
    psl.id           AS shift_log_id,
    psl.log_date,
    psl.metres_woven,
    pb.costing_id,
    cm.quality_code,
    cm.quality_name
  FROM public.production_shift_log psl
  JOIN public.production_batch    pb
    ON pb.loom_id = psl.loom_id
   AND psl.log_date BETWEEN pb.start_date AND pb.end_date
  JOIN public.costing_master      cm ON cm.id = pb.costing_id
  WHERE psl.log_date BETWEEN p_from AND p_to
)
```

A shift log row with no overlapping `production_batch` is left out of the joined set (its metres land in the "unattributed" tail described under Edge Cases).

### Jobwork / Outsource production (fabric receipts)

```
SELECT
  fri.fabric_quality_id,
  SUM(fri.received_metres) AS produced_m
FROM public.fabric_receipt_item fri
JOIN public.fabric_receipt fr ON fr.id = fri.receipt_id
JOIN public.delivery_challan dc ON dc.id = fr.dc_id
WHERE dc.production_mode IN ('jobwork','outsource')
  AND fr.receipt_date BETWEEN p_from AND p_to
GROUP BY fri.fabric_quality_id, dc.production_mode
```

### Delivered side (DC items, all three modes)

```
SELECT
  dci.fabric_quality_id,
  dc.production_mode,
  SUM(dci.metres) AS delivered_m,
  MAX(dc.dc_date) AS last_dc_date
FROM public.delivery_challan_item dci
JOIN public.delivery_challan      dc ON dc.id = dci.dc_id
WHERE dc.status IN ('confirmed','invoiced')
  AND dc.dc_date BETWEEN p_from AND p_to
GROUP BY dci.fabric_quality_id, dc.production_mode
```

### Final shape — `fn_production_vs_delivery(p_from date, p_to date)`

A SQL function (NOT a view, since it takes a parameterised window) returns:

| Column | Type | Notes |
|---|---|---|
| `fabric_quality_id` | bigint | NULL for the "unattributed" row |
| `quality_code` | text | derived from `fabric_quality` master |
| `quality_name` | text | derived |
| `production_mode` | text | `inhouse` / `jobwork` / `outsource` / `unattributed` |
| `produced_m` | numeric(14,2) | sum from the matching source above |
| `delivered_m` | numeric(14,2) | sum from DC items |
| `variance_m` | numeric(14,2) | produced − delivered |
| `variance_pct` | numeric(8,2) | null when produced ≤ 0 |
| `last_activity` | date | latest of last_shift_log_date / last_receipt_date / last_dc_date for this (quality, mode) |

The page calls `fn_production_vs_delivery` via `supabase.rpc` and renders the rows.

## UI

### Page route

`/app/reports/production-vs-delivery`.

### Filters / period picker

Reuse the P&L page's exact UI: from/to date inputs + Quick preset row (This month, Last month, Quarter, FY-to-date, Last 30d). URL state via `?from=&to=&preset=`. Default = current month.

### KPI strip (four cards)

- **Total Produced (m)** — sum of all `produced_m`.
- **Total Delivered (m)** — sum of all `delivered_m`.
- **Net Variance (m)** — produced − delivered (positive emerald, negative rose).
- **Lines** — distinct (quality, mode) lines in the result.

### Table (Option B — row per (quality, mode))

| Quality | Mode pill | Produced (m) | Delivered (m) | Variance (m) | Var % | Last activity |
|---|---|---|---|---|---|---|

- Default sort: `|variance_m|` descending so the biggest swings surface first.
- Filter pills above the table: `All / In-house / Jobwork / Outsource`. URL state via `?mode=`.
- Variance cell tinted: positive (stock building) emerald, negative (stock depleting) rose, exactly zero ink-soft.
- Click a quality cell to drill into `/app/warehouse/fabric/[qualityId]` (already exists, ties into the existing fabric ledger).

### Excel export (Option C — quality-grouped)

`ExcelExportButton` produces a workbook with one sheet "Production vs Delivery". For each fabric_quality_id present:

```
=== <quality_code> — <quality_name> ===
  In-house    | produced | delivered | variance | var %
  Jobwork     | produced | delivered | variance | var %
  Outsource   | produced | delivered | variance | var %
  ─────────
  Quality TOTAL | sum     | sum       | sum      | %
(blank row)
```

then a Grand TOTAL row at the bottom. Implementation uses the existing `xlsx` writer + bold rows; no new export library.

### Reports index card

Add a card on `/app/reports` linking to the new page. Card description: "Per-quality comparison of mill production (shift logs / jobwork & outsource receipts) vs DC dispatches. Variance flags qualities where production is drifting from delivery."

## Edge Cases

- **Shift log with no matching production_batch** — metres roll up into a `production_mode = 'unattributed'` row at the bottom of the table so they're visible without polluting quality-attributed totals. The KPI Total Produced INCLUDES them so totals reconcile.
- **Batch spanning the period boundary** — shifts inside the [p_from, p_to] window are counted; shifts outside are not. The view filters on `psl.log_date BETWEEN p_from AND p_to` before the join, so partial-period overlap is handled automatically.
- **Quality with no activity in the period** — excluded from the table to keep it focused. The KPI strip and table both reflect only rows produced by the function.
- **DC with no items** — contributes 0 metres (LEFT JOIN absorbs it).
- **`status='draft'` DC** — excluded (cloth hasn't shipped yet).
- **Receipt before period, DC inside period** — produced_m won't include those metres (filtered by receipt_date); delivered_m will. Result is a large negative variance, which is the correct alarm (you shipped more than you produced THIS PERIOD).
- **Negative variance** — rendered in rose. The "Last activity" column helps the operator track whether the depletion is recent or coasting on prior stock.
- **All-zero row** — possible if produced and delivered both are zero for a (quality, mode) the system somehow returns; filter out in the SQL by `produced_m + delivered_m > 0`.

## Implementation Plan (Files)

- `app/db/migrations/149_production_vs_delivery_fn.sql` — defines `fn_production_vs_delivery(p_from date, p_to date)`.
- `app/app/app/reports/production-vs-delivery/page.tsx` — new report page (Server Component, follows the pnl page pattern).
- `app/app/app/reports/page.tsx` — adds a link card for the new report.

No other files touched. No changes to `production_shift_log`, `production_batch`, `delivery_challan`, `delivery_challan_item`, `fabric_receipt_item`, `fabric_quality`, the existing `/app/reports/stock-on-hand` page, or any other report.

## Testing

Manual verification against a known period:

1. Pick a recent month with known shift-log + DC activity.
2. By hand: pick one quality, sum the `metres_woven` for in-house batches mapped to that quality, sum the DC items where `dc.production_mode='inhouse'` for the same quality. Variance = produced − delivered.
3. Compare to the report row for that quality. Numbers should match within rounding (0.01 m).
4. Switch to a "jobwork only" filter, pick a JW party's quality, manually sum fabric receipts (jobwork DC) vs jobwork DCs out. Same reconciliation.
5. Excel export: open the .xlsx, confirm each quality has the three mode rows + a quality total + grand total.

## Out of Scope

- Loom-level breakdown — only quality + mode.
- Multi-period comparison (this month vs last month side-by-side).
- Forecasting / projected variance.
- Quality-level cost variance (already covered by `/app/reports/variance`).
- Changes to the existing stock-on-hand page.

## Risk / Open Questions

- **Shift logs predating the production_batch model** — if any historical shift logs don't have a matching batch, they land on the "unattributed" row. Volume should be small; the row is visible so the operator can fix the underlying batch.
- **Pro-rating by overlap is exact for shift logs** (each row has a single log_date) but if a batch's date window covers many shifts on the same loom, the join attributes ALL of those shifts' metres to that batch's quality. If a loom switches between two batches mid-window without splitting the batch in the data, both batches will appear in the join and metres will be double-counted. The data model relies on the operator closing one batch before opening the next on the same loom — same assumption the loom-utilisation report already makes.
