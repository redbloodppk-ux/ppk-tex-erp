# GSTR-1 CSV Export (Offline Tool ZIP) — Design

**Date:** 2026-07-10
**Status:** Approved pending final user sign-off on this document

## Problem

The ERP's `Reports → GSTR-1` page only exports the GST portal's native JSON upload format. Filing via the GST Offline Tool (V3.2.4) requires CSV files in the tool's own import templates. This month's CSVs (`GSTR1_June2026_cdnr.csv`, `GSTR1_June2026_hsn.csv`) were built and fixed by hand after several "Data Invalid" errors. This feature makes that repeatable for every future month without manual CSV editing.

## Confirmed Offline Tool CSV quirks (empirically verified this month)

- **CDNR**: 13 columns, no "Invoice/Advance Receipt Number/date" columns. Note supply type must read `Regular B2B` (not `Regular`).
- **HSN (B2B)**: 11 columns, `Rate` is the **last** column, not the 6th.
- **Services (SAC codes)**: UQC must be `NA` with **blank** quantity — not a physical unit like `NOS-NUMBERS`. SAC codes are identified by HSN/SAC starting with `99` (e.g. `997212`). Source: Tally Solutions support article confirming this exact rule for the Offline Tool.

## Scope

- Permanent feature added to the existing `Reports → GSTR-1` page (not a one-off script).
- Output: a single ZIP file per month, named `GSTR1_<YYYY-MM>.zip` (e.g. `GSTR1_2026-06.zip`), containing:
  - `b2b.csv`
  - `cdnr.csv`
  - `hsn.csv`
  - `docs.csv` (Documents Issued)
- Does not touch the existing JSON export or its underlying `buildGstr1()` logic.

## UI

Add a second button, **"Download CSV (ZIP)"**, next to the existing **"Download JSON"** button on `app/app/app/reports/gstr1/page.tsx`. Same period selection applies to both buttons. Add a short caption under the CSV button: "Downloads to your browser's Downloads folder — move it into `ERP\GSTR1\<month>\` afterward."

## Architecture

- **New file:** `app/lib/gstr1-csv.ts` — CSV-row builders, kept separate from `app/lib/gstr1.ts` (617 lines already; JSON and CSV are structurally different output shapes and shouldn't share one file).
- **Reuses** the `Gstr1Invoice[]` array already fetched and mapped on the Reports page — no duplicate data fetching.
- **Data query change:** add `party_name` to the existing Supabase `select` in `page.tsx` (column already exists on `invoice`, confirmed in `database.types.ts`). Used as "Receiver Name" in B2B/CDNR CSVs.
- **ZIP generation:** client-side, using a JS zip library (e.g. JSZip via CDN import) to bundle the 4 CSV strings into one `.zip` blob, triggered by a click handler, downloaded via a standard anchor-download — no server route changes needed.

## CSV builders (`app/lib/gstr1-csv.ts`)

Each builder takes the same `Gstr1Invoice[]` / `Gstr1Company` / period data already available on the page and returns a CSV string matching the Offline Tool V3.2.4 template exactly:

- `buildB2bCsv(invoices, company)` → `b2b.csv`
- `buildCdnrCsv(notes, company)` → `cdnr.csv` (13 columns, `Regular B2B` literal, no invoice-number columns)
- `buildHsnCsv(invoices, notes)` → `hsn.csv` (11 columns, `Rate` last; SAC-detection rule below)
- `buildDocIssueCsv(invoices, notes)` → `docs.csv`

**Service UQC rule (CSV-only):** in `buildHsnCsv`, if the HSN/SAC code starts with `99`, set UQC to `NA` and leave quantity blank, regardless of the line's unit-of-measure. This mirrors today's manual fix and matches the Tally-documented Offline Tool requirement. This rule is NOT applied to the JSON export — the portal's JSON schema has its own (already-working) quantity handling, and changing it isn't needed or requested.

## Out of scope

- Auto-placing the ZIP into `ERP\GSTR1\<month>\` — browser downloads cannot write to an arbitrary folder on disk. The user moves the file manually (or asks Claude to move it in a Cowork session where the ERP folder is mounted).
- Any change to the existing JSON export, `buildGstr1()`, or the shared `uqcOf()` default-mapping logic.
- Scheduling/automation (e.g. auto-generating the ZIP on the 1st of each month) — not requested.

## Testing

- Unit tests for each CSV builder against a small fixture invoice set, asserting exact header row and column order match the Offline Tool template.
- A specific test case for a service line (HSN `997212`) asserting UQC `NA` and blank quantity in the HSN CSV.
- A specific test case for a credit note asserting `Regular B2B` literal and column count (13) in the CDNR CSV.
- Manual verification: generate a ZIP for June 2026, re-run the same 4 CSVs through the actual Offline Tool import, confirm no "Data Invalid" errors (regression check against this month's hand-fixed files).
