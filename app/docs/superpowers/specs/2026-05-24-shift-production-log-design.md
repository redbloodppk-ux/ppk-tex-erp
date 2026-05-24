# Shift-Production Log + CORR-P4 Loom Utilisation Dashboard — Design

Date: 2026-05-24
Cards: foundation for CORR-P4 (Loom utilisation dashboard)
Status: approved design, ready for implementation plan

## Background

CORR-P4 asks for a loom utilisation dashboard with "per-loom % uptime and
metres-per-shift". The existing Loom Utilisation report (CORR-R8) already
documents that the database has no shift log and no downtime capture, so a
true uptime number cannot be calculated from current data.

The owner chose to build the missing data capture first. This design covers
that foundation — a shift-production log — and then how CORR-P4 sits on top
of it.

## Scope

Two pieces, built in order.

Piece 1, the shift-production log, is the foundation: a new table plus an
entry screen so the business records, per loom per shift, how many metres
were woven and how long the loom was stopped.

Piece 2 is CORR-P4 itself: a roll-up view and a dashboard tile that turn the
logged data into real utilisation figures.

This design fully specifies Piece 1. Piece 2 is described at a high level and
will get its own plan once Piece 1 is working.

## Decisions captured from the owner

The unit runs two shifts a day, named day and night. Each shift is 12 hours,
which is 720 minutes — this is the denominator for the uptime calculation.

For each loom in each shift the operator records: good metres woven, downtime
minutes, a downtime reason, and the weaver's name. Rejected metres are not
captured at shift level (they are already tracked per batch).

The downtime reason comes from a fixed list: warp break, no weft,
maintenance, power cut, other.

The entry screen works as one grid per shift. The user picks a date and a
shift, then sees every loom in one table and fills the row for each. Saving
writes all rows at once. Re-opening the same date and shift loads the
existing rows so they can be corrected.

Shift is kept as a fixed two-value choice (day, night) rather than a separate
shift-master table. A full shift master with rosters is a later card
(CORR-A2, Attendance group) and should not be built twice.

## Piece 1 — Shift-production log

### Data model

A new table `production_shift_log`. One row is one loom on one date in one
shift.

Columns:

- `id` — bigint, primary key
- `log_date` — date, the production date, required
- `shift` — text, either `day` or `night`, required, enforced by a CHECK
  constraint
- `loom_id` — bigint, references `loom(id)`, required
- `weaver_name` — text, optional (a free-text name; not yet linked to an
  employee record)
- `metres_woven` — numeric(14,2), good metres produced, default 0, must be
  zero or positive
- `downtime_minutes` — integer, minutes the loom was stopped, default 0, must
  be between 0 and 720
- `downtime_reason` — text, one of warp_break, no_weft, maintenance,
  power_cut, other; required only when `downtime_minutes` is greater than 0,
  otherwise left empty
- `notes` — text, optional
- `created_at`, `created_by`, `updated_at`, `updated_by` — standard audit
  columns, matching the pattern already used on `production_batch`

A unique constraint on (`log_date`, `shift`, `loom_id`) guarantees the same
loom cannot be logged twice for the same shift. This is also what lets the
entry screen safely re-save (upsert) a shift.

The constant 720 minutes per shift is not stored on every row. It lives in
one place in code as a named constant, so it can be changed later if shift
length changes.

### Migration

A new file `db/migrations/020_shift_production_log.sql`, following the style
of the existing migrations: safe to re-run, creates the table if it does not
exist, adds the indexes, and enables row-level security with the same
policy shape used by other owner-facing tables in this project.

### Entry screen

A new page at `/app/production/shift-log`.

At the top, two controls: a date picker (defaults to today) and a day/night
toggle. Below them, a table with one row per loom, ordered by loom code.
Every loom in the registry appears, even idle ones.

Each row shows the loom code and type as read-only labels, then editable
fields for metres woven, downtime minutes, downtime reason (a dropdown,
enabled only when downtime minutes is above zero), and weaver name.

One Save button at the bottom writes every row for the selected date and
shift in a single action. Rows left completely blank (no metres, no
downtime, no weaver) are skipped rather than saved as empty records.

When the page loads for a date and shift that already has entries, those
values populate the grid so the user is editing, not duplicating.

A short link to the existing Loom Utilisation report sits on the page for
context.

The page is added to the Production section of the sidebar navigation.

### Validation

Metres woven cannot be negative. Downtime minutes must be between 0 and 720.
A downtime reason is required when downtime minutes is above zero. These
checks run both in the screen (friendly messages) and in the database
(CHECK constraints), so bad data cannot be saved even if the screen is
bypassed.

## Piece 2 — CORR-P4 loom utilisation dashboard (high level)

Once the shift log holds data, a new database view rolls it up per loom:
shifts logged, total metres woven, total downtime, and uptime percent
computed as (720 minus downtime) divided by 720, averaged across the loom's
logged shifts. Metres-per-shift is total metres divided by shifts logged.

This view feeds two things: a Loom Utilisation summary tile on the main
dashboard (`/app/dashboard`), and an additional section in the existing R8
report showing the real uptime figures alongside the batch-based workload it
already displays.

Piece 2 gets its own implementation plan after Piece 1 is built, verified,
and has at least sample data to test against.

## Out of scope

A shift-master table with timings and rosters (left for CORR-A2). RPM and
pick-rate readings. Linking the weaver name to an employee or attendance
record (possible later once the Attendance module exists). Editing or
deleting historic shift logs beyond re-saving a shift through the same grid.

## Testing

Unit-level: the uptime and metres-per-shift calculations, and the
blank-row-skipping logic, are covered by tests.

Integration: a typecheck pass and a production build pass, consistent with
how every prior card in this project was verified.

Manual: enter a day shift for all looms, re-open it to confirm the values
reload, change one value and re-save, and confirm the unique constraint
prevents duplicates.
