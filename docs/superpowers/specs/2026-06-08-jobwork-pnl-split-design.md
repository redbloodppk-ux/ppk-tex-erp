# Jobwork P&L Split — Design Spec

**Date:** 2026-06-08
**Author:** PPK TEX ERP
**Status:** Approved (brainstorming complete)

## Goal

Period-end P&L report split three ways: own-production, jobwork, and combined. Make jobwork's contribution visible so the owner can decide whether jobwork is paying its share of mill overhead.

## Constraints

- Must not break the existing `/app/reports/pnl` view — its current numbers should match the new "Combined" column exactly.
- No schema changes to `jobwork_order` or `production_batch` — the design uses what's already on the tables.
- Single SQL function so the math is computed in one place and the page is a thin renderer.

## Decisions

1. **Allocation basis: metres produced** — `jobwork_metres / (own_metres + jobwork_metres)`. Treats one jobwork metre as equivalent to one own-production metre for shared-cost absorption. Rejected alternative: tracking loom-hours on `jobwork_order` (more accurate but needs schema + data-entry change). Loom-hours can be added later if the metres approximation proves misleading.
2. **Cost split: all period costs split by metre ratio** — wages, factory expenses, bank expenses each split between own and jobwork by the share ratio. Rejected alternative: tagging each cost category individually (more accurate, more data-entry burden).
3. **Location: extend `/app/reports/pnl`** — Combined/Split toggle on the existing page rather than a new URL. Same period inputs, same data sources, same audience.

## Allocation Math

For the window `[p_from, p_to]`:

```
own_metres     = SUM(production_batch.produced_m  WHERE end_date BETWEEN p_from AND p_to)
jobwork_metres = SUM(jobwork_order.delivered_metres WHERE delivered_date BETWEEN p_from AND p_to)
total_metres   = own_metres + jobwork_metres

IF total_metres > 0:
  own_share = own_metres / total_metres
  jw_share  = jobwork_metres / total_metres
ELSE:
  own_share = 1
  jw_share  = 0
```

### Per-line treatment

| Line | Own | Jobwork | Combined | Source |
|---|---|---|---|---|
| Revenue | `invoice.taxable_value` where `doc_type IN ('tax_invoice','yarn_sale','general_sale')`, status not draft/cancelled, invoice_date in window | `invoice.taxable_value` where `doc_type IN ('jobwork_invoice','weaving_bill')`, same filters | own + jobwork | `invoice` |
| Credit Notes | `invoice.taxable_value` where `doc_type = 'credit_note'`, same filters (subtracted) | 0 | own | `invoice` |
| COGS | `SUM(produced_m × actual_true_cost_per_m)` where `end_date` in window | 0 (customer's yarn) | own | `production_batch` |
| **Gross Profit** | Revenue − Credit Notes − COGS | Jobwork Revenue | sum | derived |
| Wages | `wage_entry.amount × own_share` in window | `wage_entry.amount × jw_share` in window | full sum | `wage_entry` |
| Factory Expenses | `expense_entry.amount × own_share` in window | `expense_entry.amount × jw_share` in window | full sum | `expense_entry` |
| Bank Expenses | `bank_entry.amount × own_share` where `pl_treatment='expense'`, direction='out', status='active' | `bank_entry.amount × jw_share`, same filters | full sum | `bank_entry` × `bank_category` |
| Bank Income | full `bank_entry.amount` where `pl_treatment='income'`, direction='in', status='active' | 0 | full sum | `bank_entry` × `bank_category` |
| **Period Costs** | wages_own + factory_own + bank_exp_own | wages_jw + factory_jw + bank_exp_jw | sum | derived |
| **Net Profit** | Gross_own + Bank_income − Period_Costs_own | Gross_jw − Period_Costs_jw | sum | derived |

### Math invariant

`net_profit_own + net_profit_jobwork ≡ net_profit_combined`

The function asserts this internally — combined columns are sums of own + jobwork columns, not separate aggregates. This guarantees the Combined column always matches today's `fn_period_pnl` output.

## Edge Cases

- **Zero jobwork metres in window** — `jw_share = 0`. Jobwork column shows zero costs and (usually) zero revenue. No division by zero.
- **Zero own metres in window** — `own_share = 0`. All period costs land on jobwork. Rare but math holds.
- **Zero total metres but invoices exist** — Fallback `own_share = 1`, `jw_share = 0`. Revenue still classified by doc_type. UI shows a yellow note: "No production this period — period costs allocated 100% to own-production."
- **Negative bank entries / refunds** — handled by the `direction='out'` / `direction='in'` filter on `bank_entry`. Refunds reverse direction so don't double-count.
- **Draft / cancelled invoices** — excluded everywhere, same as existing `fn_period_pnl`.
- **Jobwork orders without `delivered_metres`** — treated as zero metres (no production yet). The labour invoice for that order may still land in jobwork revenue once raised, which is correct (revenue accrues when invoiced, costs allocate against produced metres).

## UI

`/app/reports/pnl` page changes:

1. **Toggle** above the period range pickers: two pill buttons `Combined` and `Split (Own / Jobwork)`. URL state via `?view=combined|split` (default: combined, so existing bookmarks behave unchanged).
2. **Combined mode** — page unchanged from today (single-column P&L from `fn_period_pnl`).
3. **Split mode** — three-column table with the lines above. Column headers: `Own Production`, `Job Work`, `Combined`. Same colour treatment for positives/negatives.
4. **Allocation footnote** below the table when in Split mode, with shares rounded to 1 decimal place:
   > Period metres: own {own_metres} m + jobwork {jobwork_metres} m = {total_metres} m. Shared period costs (wages, factory expenses, bank expenses) allocated by metre ratio: own {own_share×100}% / jobwork {jw_share×100}%.
5. **Excel / CSV export** — if the existing PnL page already exposes an export, update it to emit three columns in Split mode. If there is no current export, no new export work is in scope.

## Implementation Plan (Files)

- **`app/db/migrations/138_period_pnl_split_fn.sql`** — defines `fn_period_pnl_split(p_from date, p_to date)` returning the three columns per line.
- **`app/app/app/reports/pnl/page.tsx`** — read `?view=`, branch between single-column existing render and new three-column render. Call `fn_period_pnl` for combined, `fn_period_pnl_split` for split.
- **Excel export route / handler** — update if needed to emit three columns in Split mode.

No changes to: `jobwork_order` schema, `production_batch` schema, `bank_category`, existing `fn_period_pnl`, any other report.

## Testing

Manual verification against a known period:

1. Pick a month with known production_batch + jobwork_order activity.
2. Compute expected: own_metres, jobwork_metres, share ratios — by hand from the source tables.
3. Run `fn_period_pnl_split(p_from, p_to)`. Verify:
   - `own_metres + jobwork_metres` matches the table sums.
   - Combined column matches `fn_period_pnl(p_from, p_to)` exactly.
   - Sum of own column + jobwork column for every line equals combined column for that line.
4. Render `/app/reports/pnl?view=split&from=…&to=…` and visually confirm the same numbers.

## Out of Scope

- Loom-hour-based allocation (deferred; requires `jobwork_order` schema change + data entry).
- Per-cost-category attribution flags.
- Quality-level or order-level profitability (separate report).
- Forecasting / budgeting.

## Risk / Open Questions

- **LOOMS overhead double-count** — `production_batch.actual_true_cost_per_m` already includes `actual_overhead_per_m` (the LOOMS overhead snapshot). The existing `fn_period_pnl` then ALSO adds full `factory_expenses` and `wages` as period costs — so combined P&L overstates overhead by the absorbed amount. This is a pre-existing issue in `fn_period_pnl` and is preserved in `fn_period_pnl_split` (Combined column matches existing). A future pass can deduct absorbed overhead from period costs to fix both views simultaneously.
- **Metre allocation assumes equal loom-hour-per-metre across modes** — true on average if jobwork and own-production weave similar quality classes, less true if jobwork specialises in slower/faster cloth. Loom-hour tracking on `jobwork_order` is the upgrade path.
