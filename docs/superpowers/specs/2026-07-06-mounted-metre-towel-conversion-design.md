# Mounted-Metre Towel-Length Conversion — Design Spec

**Date:** 2026-07-06
**Status:** Approved by user, pending implementation plan

## Problem

`pavu_assign.metres_produced` ("mounted metre") is computed by `fn_recompute_pavu_assign_metres`,
which sums raw operator-entered metres from `production_shift_log_weaver.metres_woven` and
`production_shift_log.adjustment_metres`. For towel products, the operator's raw entered metre
figure needs to be converted using a "towel length / 2" (TL/2) factor before it counts toward
mounted metre — e.g. towel length 1.7 → multiplier 0.85. Today no such conversion exists; the
raw figure is used as-is regardless of product type.

## Decisions (confirmed with user)

1. **Shift log stays raw.** The operator's entered `metres_woven` value is never altered. Only
   the mounted-metre aggregation (`fn_recompute_pavu_assign_metres`) applies the TL/2 conversion.
2. **Towel-length source: snapshot on `production_shift_log`, not a live join.** This project
   already has a precedent for this exact problem: migration `233_shift_log_quality_rate_snapshot.sql`
   freezes `fabric_quality_id` and `rate_per_m` onto `production_shift_log` at insert time (via a
   `BEFORE INSERT` trigger, `fn_shift_log_snapshot_quality_rate`), sourced from the loom's
   `fabric_quality_id` at that moment. This avoids two separate ambiguities:
   - **Which `fabric_quality` row to use**, when multiple `fabric_quality` rows can share one
     `costing_master.id` (no unique constraint on `fabric_quality.costing_id`). Using the loom's
     specific `fabric_quality_id` (a direct row reference) sidesteps the costing_id-based lookup
     ambiguity entirely.
   - **Historical correctness when towel length changes over time.** A quality's `meter_per_pc`
     can be edited later for future orders. If mounted-metre used a live lookup, editing TL today
     would retroactively change the conversion applied to all historical shifts already logged
     under that quality. Freezing the value at entry time (matching how `rate_per_m` is already
     frozen for wage purposes) prevents this.
3. **"Is towel" check**: reuse the condition already established in migration
   `216_so_refresh_status_towel_by_type.sql`: `fabric_quality.fabric_type = 'towel' AND
   COALESCE(fabric_quality.meter_per_pc, 0) > 0`. (`fabric_quality.meter_per_pc` alone is not
   sufficient — some non-towel qualities also carry a `meter_per_pc` value.)
4. **Both `metres_woven` (per weaver) and `adjustment_metres` (per shift-log row) get the TL/2
   conversion** when the row is towel. Both live conceptually on the same shift-log entry and the
   user confirmed adjustments should convert the same way as woven metres.
5. **Backfill for historical rows**: existing `production_shift_log` rows predate this feature and
   have no frozen towel snapshot. Backfill using current `fabric_quality` values as the default,
   **except** for the quality "DOBBY-OE-TOWEL-31 / OE THALAPATHY 62 X 46 = 30"", whose towel length
   changed from 1.4 to 1.7 starting **2026-06-30**. For that quality: rows logged before 2026-06-30
   get `towel_meter_per_pc = 1.4`; rows on/after 2026-06-30 get the current value (1.7). All other
   qualities: backfill with their current `fabric_quality.meter_per_pc`/`fabric_type` regardless of
   log date (accepted limitation — no earlier history exists for other qualities).
6. After backfilling `production_shift_log`, `fn_recompute_pavu_assign_metres` must be re-run for
   every loom that has any shift-log history, so existing `pavu_assign.metres_produced` values pick
   up the retroactive conversion.

## Schema Changes

Add two columns to `production_shift_log`:
- `is_towel boolean NOT NULL DEFAULT false`
- `towel_meter_per_pc numeric` (nullable; only meaningful when `is_towel = true`)

Both are populated exclusively by the DB trigger at insert time — application code never sets
them directly (same pattern as the existing `fabric_quality_id`/`rate_per_m` snapshot).

## Trigger Changes

Extend `fn_shift_log_snapshot_quality_rate()` (fires `BEFORE INSERT` on `production_shift_log`).
After resolving `NEW.fabric_quality_id` (existing logic, unchanged), add a lookup against
`fabric_quality` to also freeze:
```
is_towel := (fq.fabric_type = 'towel' AND COALESCE(fq.meter_per_pc, 0) > 0)
towel_meter_per_pc := fq.meter_per_pc
```
This only runs on INSERT, so historical rows are never touched by the trigger itself — they are
handled separately by the one-time backfill below.

## Recompute Function Changes

`fn_recompute_pavu_assign_metres(p_loom_id)`: both the weaver-metres sum and the adjustment sum
change from flat `SUM(...)` to a conditional multiplier using each row's own frozen values:

```
SUM(w.metres_woven * CASE WHEN s.is_towel THEN s.towel_meter_per_pc / 2.0 ELSE 1 END)
```
```
SUM(s.adjustment_metres * CASE WHEN s.is_towel THEN s.towel_meter_per_pc / 2.0 ELSE 1 END)
```
Non-towel rows keep multiplier 1 (unchanged behavior). All other filtering logic (date window,
per-`pavu_assign` looping) stays exactly as-is.

## Backfill (one-time data migration)

For every existing `production_shift_log` row lacking `is_towel`/`towel_meter_per_pc`:
1. Join to the loom's `fabric_quality_id` at the time (already frozen via migration 233's
   existing `fabric_quality_id` column on the same row — no need to re-derive it).
2. Compute `is_towel`/`towel_meter_per_pc` from that `fabric_quality` row's current
   `fabric_type`/`meter_per_pc`.
3. **Special case**: for rows whose frozen `fabric_quality_id` matches "OE THALAPATHY 62 X 46 =
   30"" (DOBBY-OE-TOWEL-31) AND `log_date < '2026-06-30'`, override `towel_meter_per_pc` to `1.4`
   instead of the current value.
4. After backfilling, call `fn_recompute_pavu_assign_metres` for every distinct `loom_id` present
   in `production_shift_log` to refresh all `pavu_assign.metres_produced` values.

## Out of Scope

- Fabric Receipt's own warp-reduction logic (separate, already-paused feature — no changes here).
- `app/lib/wages/weekly-data.ts` — confirmed in prior research to read
  `production_shift_log`/`production_shift_log_weaver.metres_woven` directly, with no reference to
  `pavu_assign` or the new towel columns. This change does not affect wage calculations.
- Changing `pavu_assign.costing_id` semantics — that field remains what it is today (the specific
  quality/costing being woven for that assignment, used for costing/reporting), independent of the
  new towel-conversion mechanism, which instead uses the loom's `fabric_quality_id` snapshot on
  `production_shift_log`.
