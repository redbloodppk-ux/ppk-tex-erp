# Pavu Mount History Report — Design

**Date:** 2026-07-18
**Status:** Approved

## Problem

The owner can see the *current* status of every pavu (Beam Stock Report,
`fn_pavu_stock_report`), but there's no way to look back at the history of
mount events — which beam went on which loom, when, and what came off it —
filtered to a chosen date range. This is needed under Reports.

## Data source

`pavu_assign` — the permanent record of every mount event (70 rows today:
52 `mounted`, 10 `completed`, 8 `removed`). No new table or migration is
needed; this is a straight read of existing data, following the same
pattern as the existing **Fabric Movements** report (server component,
direct Supabase joins, no stored function).

Key columns used: `pavu_id`, `loom_id`, `costing_id`, `start_date` (mount
date), `end_date` (unmount/removal date), `metres_produced`,
`actual_metres`, `status`, `notes`.

## Date-range filter

A row is included when its **mount date** (`pavu_assign.start_date`) falls
inside the chosen `[from, to]` range. Defaults to 1st-of-this-month →
today, matching Fabric Movements. Beams still mounted (no `end_date` yet)
are included as long as their mount date is in range.

## Columns

| Column | Source |
|---|---|
| Pavu code / beam no | `pavu.pavu_code`, `pavu.beam_no` |
| Ends | `pavu.ends` |
| Yarn count | `sizing_job.warp_count` (in-house) or `jobwork_warp_beam.warp_count_id` (jobwork) |
| Quality | `fabric_quality` via `costing_id` (merge-aware, same resolution as Beam Stock Report), falling back to `costing_master.quality_name` |
| Mode | `pavu.production_mode` (in-house / jobwork / outsource) |
| Loom + shed | `loom.loom_code`, `loom.shed_no` |
| Mount date | `pavu_assign.start_date` |
| Unmount date | `pavu_assign.end_date` (blank if still running) |
| Days mounted | `end_date − start_date` (or today − start_date if still running) |
| Metres produced | `pavu_assign.metres_produced` / `actual_metres` |
| Status | `pavu_assign.status` (mounted / completed / removed) |

## Filters

Date range (required, defaulted) plus: loom, shed, mode, quality, ends —
mirrors the filter set already on Beam Stock Report.

## Summary

A rollup strip above the table: mount count and total metres grouped by
quality, in the same style as Beam Stock Report's "Summary by ends & yarn
count" table.

## Export

Standard `ExcelExportButton`, as used on every other report in this app.

## Navigation

New card added to `app/app/reports/page.tsx` (the Reports index), placed
next to Fabric Movements.

## Non-goals

- No changes to how mounts/unmounts are recorded (`app/app/pavu/assign/page.tsx`
  is untouched).
- No new database objects — pure read query against existing tables.
