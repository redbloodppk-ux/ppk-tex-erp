# Shift-Log Quality/Rate Snapshot — Design

**Status:** Approved, ready for implementation planning
**Sub-project:** 1 of 2 (see "Relationship to the Weaver Wages by Quality report" below)

## Background

While investigating why SURESH S (EMP-0001)'s Weekly Wage Summary showed ₹3,023 instead of an
expected ₹3,285, we confirmed the app's wage math was correct (metres woven × loom rate, summed
per employee, rounded once) — the gap was missing shift-log entries for several days, not a bug.

While re-deriving that total grouped by fabric quality (`loom.fabric_quality_id`), we surfaced a
real data-model gap: `production_shift_log` (one row per date/shift/loom) does not store which
fabric quality or which wage rate was in effect on that date — it only has `loom_id`. Every report
that needs "quality" or "rate" for a historical shift-log row currently joins **live** to the
`loom` table's *current* values. That means:

- Grouping past production "by quality" silently uses whatever quality the loom happens to be set
  to today, which can be wrong if the loom's quality changed since then.
- Worse: `app/lib/wages/weekly-data.ts` computes **Wages Earned** the same way — joining live to
  `loom.default_rate_per_m`. Reopening a past week recalculates it at today's rate, so changing a
  loom's rate today silently rewrites the ₹ figures of already-closed, already-paid weeks.

This was not hypothetical: on 2026-07-05 the user changed quality and/or rate for 10 looms:

| Looms | What changed | Old | New | Cutover (log_date) |
|---|---|---|---|---|
| L-08, L-35, L-36, L-40, L-41 (ids 64, 91, 92, 96, 97) | quality **and** rate | quality `DOBBY-OE-TOWEL-31` (fabric_quality.id = 3, "OE THALAPATHY 62 X 46 = 30\""), rate 1.77 | quality `FQ-0007` "DOBBY KAVI DHOTIES" (fabric_quality.id = 13), rate 1.88 | `< '2026-07-05'` → old, `>= '2026-07-05'` → new |
| L-09, L-32, L-33, L-34, L-37 (ids 65, 88, 89, 90, 93) | rate only (quality unchanged, stays `DOBBY-OE-TOWEL-31` / id 3 throughout) | rate 1.77 | rate 2.15 | `< '2026-06-29'` → old, `>= '2026-06-29'` → new |

No audit trail exists for the `loom` table (checked `audit_log` and `information_schema.triggers`
— neither covers `loom`), so these old values only exist because the user recalled them. They must
be captured now, in this migration, or they are lost forever.

## Goals

1. Every `production_shift_log` row — past and future — carries its own frozen fabric quality and
   wage rate, independent of whatever the loom is set to later.
2. Fix the live-recalculation bug in Weekly Wage Summary (page, CSV export, PDF export — all three
   share `weekly-data.ts`) so past weeks stop changing when a loom's rate is edited today.
3. Fix the existing "Weaver Production by Quality" report so its quality grouping reflects what a
   loom was actually weaving on each date, not today's assignment.
4. Correctly backfill the 10 looms above with their real historical values.

## Non-goals

- The new "Weaver Wages by Quality" detailed report (the user's original request) is **not** part
  of this spec — it's sub-project 2, built on top of this snapshot once it ships. See below.
- No UI changes to the shift-log entry page (`app/app/app/production/shift-log/page.tsx`) — the
  snapshot is captured transparently by a database trigger, not by that page's code.
- No attempt to recover old quality/rate history for any loom other than the 10 listed above —
  every other loom's historical rows are backfilled with a best-effort copy of their current
  values (the same approximation already implicitly in use today).

## Schema changes (migration `233_shift_log_quality_rate_snapshot.sql`)

```sql
-- 1. New columns on the parent shift-log row.
ALTER TABLE production_shift_log
  ADD COLUMN fabric_quality_id integer REFERENCES fabric_quality(id),
  ADD COLUMN rate_per_m numeric;

-- 2. Trigger: stamp new rows from the loom's CURRENT values, but only when
--    the caller didn't already supply a value. This never fires on UPDATE,
--    so a row's snapshot is frozen at insert time and is not re-synced if
--    the loom's quality/rate changes later.
CREATE OR REPLACE FUNCTION fn_shift_log_snapshot_quality_rate()
RETURNS trigger AS $$
BEGIN
  IF NEW.fabric_quality_id IS NULL OR NEW.rate_per_m IS NULL THEN
    SELECT
      COALESCE(NEW.fabric_quality_id, l.fabric_quality_id),
      COALESCE(NEW.rate_per_m, l.default_rate_per_m)
    INTO NEW.fabric_quality_id, NEW.rate_per_m
    FROM loom l
    WHERE l.id = NEW.loom_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shift_log_snapshot_quality_rate
  BEFORE INSERT ON production_shift_log
  FOR EACH ROW
  EXECUTE FUNCTION fn_shift_log_snapshot_quality_rate();

-- 3. Backfill pass 1 (baseline): every existing row gets its loom's
--    CURRENT quality/rate as a best-effort historical value.
UPDATE production_shift_log psl
SET fabric_quality_id = l.fabric_quality_id,
    rate_per_m = l.default_rate_per_m
FROM loom l
WHERE l.id = psl.loom_id;

-- 4. Backfill pass 2: Group A looms, pre-change rows get the OLD
--    quality + OLD rate (quality AND rate both changed on 2026-07-05).
UPDATE production_shift_log
SET fabric_quality_id = 3,   -- DOBBY-OE-TOWEL-31
    rate_per_m = 1.77
WHERE loom_id IN (64, 91, 92, 96, 97)
  AND log_date < '2026-07-05';

-- 5. Backfill pass 3: Group B looms, pre-change rows get the OLD rate
--    only (quality never changed for this group, stays id 3 throughout,
--    already set correctly by pass 1).
UPDATE production_shift_log
SET rate_per_m = 1.77
WHERE loom_id IN (65, 88, 89, 90, 93)
  AND log_date < '2026-06-29';
```

After this migration, regenerate TypeScript types (`generate_typescript_types` MCP tool) so
`Database['public']['Tables']['production_shift_log']` picks up the two new columns.

## Application code changes

### `app/lib/wages/weekly-data.ts` — wages-earned computation

Currently (see excerpt in prior investigation): fetches `production_shift_log` rows selecting only
`id, loom_id`, then separately fetches `loom.default_rate_per_m` for every distinct `loom_id` and
joins in memory. Change:

- Parents query selects `id, loom_id, rate_per_m` instead of `id, loom_id`.
- Drop the separate `loom` fetch and `rateByLoom` map entirely for this computation — no longer
  needed.
- Build `rateByParent: Map<number, number>` from the parents query directly
  (`rateByParent.set(p.id, Number(p.rate_per_m ?? 0))`).
- In the weaver-entry loop, replace `const rate = rateByLoom.get(loomId) ?? 0;` with
  `const rate = rateByParent.get(k.shift_log_id) ?? 0;` (drop the `loomByParent` lookup for rate
  purposes — `loomByParent` may still be needed elsewhere in the file; only remove it if this was
  its only use).

This is the only code path that needs to change for the fix to apply everywhere Weekly Wage
Summary numbers are shown — the page, its CSV export, and its PDF export all call
`buildWeeklyWageData()`.

### `app/app/app/reports/weaver-production/page.tsx` — quality snapshot

Currently step 4 fetches `loom.fabric_quality:fabric_quality_id ( code, name )` live per loom and
uses it for every shift-log row on that loom, regardless of date. Change:

- Step 1's shift-log query adds `fabric_quality_id` to its `select`
  (`'id, loom_id, fabric_quality_id'`).
- Add a lookup of `fabric_quality` rows by the **distinct `fabric_quality_id` values appearing on
  the shift logs** (not by loom), building `qualityById: Map<number, { code: string; name: string }>`.
- Step 5's grouping loop resolves quality via
  `qualityById.get(shiftLog.fabric_quality_id) ?? { code: 'NO_QUALITY', name: 'No Quality Assigned' }`
  instead of `qualityByLoom.get(loomId)`. The `shed_no` lookup (`shedByLoom`) is unaffected — shed
  is a loom property, not a quality snapshot, so it still comes from `loom` directly.
- Rows with a `NULL` `fabric_quality_id` (shouldn't occur after the migration's baseline backfill,
  but defensively handled) fall back to "No Quality Assigned".

## Testing / verification plan

1. After applying the migration, spot-check via SQL:
   - `SELECT fabric_quality_id, rate_per_m FROM production_shift_log WHERE loom_id IN (64,91,92,96,97) AND log_date < '2026-07-05'` → all rows show `fabric_quality_id = 3`, `rate_per_m = 1.77`.
   - Same looms, `log_date >= '2026-07-05'` → `fabric_quality_id = 13`, `rate_per_m = 1.88`.
   - `SELECT rate_per_m FROM production_shift_log WHERE loom_id IN (65,88,89,90,93) AND log_date < '2026-06-29'` → `1.77`.
   - Same looms, `log_date >= '2026-06-29'` → `2.15`.
   - Any other loom, spot-check a row's `fabric_quality_id`/`rate_per_m` matches that loom's current values.
2. Insert a throwaway test row into `production_shift_log` without specifying `fabric_quality_id`/`rate_per_m` and confirm the trigger fills both from the loom, then delete the test row.
3. Re-run the Weekly Wage Summary for the week containing SURESH S and confirm the total is unchanged (₹3,023) — this change must not alter totals for weeks that didn't involve a rate change.
4. Load Weekly Wage Summary (or CSV/PDF export) for a week that includes production on one of the 10 changed looms, straddling its cutover date, and confirm the wage figure now reflects the old rate for days before cutover and the new rate for days on/after — this is the concrete bug this spec fixes.
5. Load "Weaver Production by Quality" for a week before 2026-06-29 that includes L-09/32/33/34/37 or before 2026-07-05 for L-08/35/36/40/41, and confirm those looms' metres now group under `DOBBY-OE-TOWEL-31` instead of today's quality.
6. Typecheck the whole app (new columns must not break existing `Database` type consumers).

## Relationship to the Weaver Wages by Quality report

The user's original request — a permanent "Weaver Wages by Quality" report page under Reports,
with a weekly filter, showing the detailed ₹-amount breakdown by quality (as manually demonstrated
for SURESH S) — is sub-project 2. It will be brainstormed and spec'd separately once this snapshot
infrastructure is live, so it can be built directly on `production_shift_log.fabric_quality_id` /
`rate_per_m` from day one instead of needing its own workaround.
