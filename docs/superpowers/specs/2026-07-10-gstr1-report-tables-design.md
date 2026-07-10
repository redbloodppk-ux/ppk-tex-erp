# GSTR-1 Report Tables Design

**Goal:** Redesign the Reports → GSTR-1 page so it shows real government-style tables (4A, 5, 7, 9B, 12, 13) with actual invoice/HSN rows, instead of just a section-count summary — matching the official GST portal's "Draft GSTR-1" PDF, while staying expandable so the user can drill into the underlying invoices before filing.

**Architecture:** Reuse the existing `buildGstr1()` output (already computed server-side on the page — no DB or query changes). Add one new pure function, `buildReportTables()`, in `app/lib/gstr1.ts` that reshapes that same data into per-table summaries. A new client component renders each table as an expandable card. Only tables with at least one row are rendered — always-empty tables (exports/SEZ, e-commerce, advances, amendments, etc.) never appear, since PPK TEX's invoice set never produces them.

**Tech Stack:** Next.js server component (existing page) + one new client component for expand/collapse state, Vitest for unit tests. No new dependencies.

---

## Table mapping

The official form has ~19 tables; PPK TEX's data only ever populates six of them, because `buildGstr1()` only emits `b2b`, `b2cl`, `b2cs`, `cdnr`, `cdnur`, `hsn`, `doc_issue` sections. Mapping:

| Official table | Title | Source section(s) | Grouped by |
|---|---|---|---|
| 4A | B2B Invoices (Registered) | `b2b` | recipient GSTIN (`ctin`) |
| 5 | B2C (Large) | `b2cl` | place of supply (`pos`) |
| 7 | B2C (Others) | `b2cs` | place of supply + rate |
| 9B | Credit/Debit Notes (Registered + Unregistered) | `cdnr` + `cdnur` | recipient GSTIN (or "Unregistered") |
| 12 | HSN-wise Summary | `hsn` | HSN code |
| 13 | Documents Issued | `doc_issue` | document type |

Tables 4B, 6A–6C, 8, 9A, 9C, 10, 11A–11B, 14, 14A, 15, 15A are never rendered — `buildGstr1()` has no code path that produces them, and none of PPK TEX's invoice types (`tax_invoice`, `jobwork_invoice`, `general_sale`, `yarn_sale`, `credit_note`) map to reverse charge, exports, SEZ, e-commerce, or advances.

## Data layer: `buildReportTables()`

New function in `app/lib/gstr1.ts`:

```ts
export interface ReportTableRow {
  /** e.g. recipient GSTIN, HSN code, place-of-supply code — whatever this table groups by */
  key: string;
  label: string;
  count: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** underlying invoice/note/HSN rows for the expand view */
  detail: ReportDetailRow[];
}

export interface ReportDetailRow {
  docNo: string;
  date: string; // DD-MM-YYYY, portal format
  rate: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface ReportTable {
  tableNo: string; // '4A', '5', '7', '9B', '12', '13'
  title: string;
  rows: ReportTableRow[];
  totals: { count: number; taxableValue: number; igst: number; cgst: number; sgst: number };
}

export function buildReportTables(ret: Gstr1Return): ReportTable[];
```

`buildReportTables()` takes the already-built `Gstr1Return` (same object the page already passes to `summarise()`) and, for each of the six sections present, produces one `ReportTable` with per-group summary rows.

**Expand-to-detail is only available for 4A, 5, and 9B** — those sections (`b2b`, `b2cl`, `cdnr`/`cdnur`) keep each invoice/note as a distinct record (`inv`/`nt` arrays) all the way through, so a per-row `detail` array can be built straight from that data. **Tables 7 (B2CS) and 12 (HSN) are totals-only, no expand** — `buildB2cs()` and `buildHsn()` already consolidate every contributing invoice into running sums with no reference back to the source invoice, so there is nothing to drill into without a separate, larger change to how those two sections are built. This matches how B2CS and HSN behave on the actual GST portal too — both are inherently consolidated sections, not itemized ones. Table 13 (Documents Issued) is also totals-only, since `doc_issue` is already a serial-range summary.

## UI

New client component `ReportTables` (`app/app/app/reports/gstr1/report-tables.tsx`), rendered on the existing page below the current totals strip (the section-count table it replaces is removed).

Each table renders as a card:
- Header: table number + title (e.g. "4A — B2B Invoices (Registered)") and a totals line (records, taxable value, IGST, CGST, SGST).
- One row per group (e.g. one row per recipient GSTIN for 4A) with the same columns.
- For 4A, 5, and 9B: a "Details" toggle per row expands a nested table of the underlying invoices/notes. Client-side only (`useState` for expanded keys) — no new data fetching, since all detail data is already present in the page's props.
- For 7 and 12 (and 13): no toggle — these rows are already the finest detail available (see "Data layer" above).

After all tables, a **Total Liability** footer row sums taxable value + IGST + CGST + SGST across every rendered table — mirroring the PDF's final row.

## Out of scope

- No changes to the JSON export/download button or `buildGstr1()`'s existing output shape — `buildReportTables()` is a pure additional transform, read-only.
- No PDF generation — this is the on-screen page only (per user's explicit choice).
- No tables for sections PPK TEX never produces (see mapping above) — if that changes in the future (e.g. the business starts exporting goods), a new table can be added the same way.
- No changes to the underlying CSV/HSN-import bug being debugged separately for the GST Offline Tool.

## Testing

Vitest unit tests for `buildReportTables()` in `app/lib/gstr1.test.ts` (new file), covering:
- 4A grouping/totals against the known June 2026 return figures (B2B taxable total ₹11,75,705.38 across the sample invoices).
- 9B (CDNR) sign and total against the known credit-note figures (net −₹10,805.08 taxable across 4 notes).
- 12 (HSN) row shape and rate/description passthrough.
- A table with zero rows in the source section is simply absent from the returned array (confirms the "only show tables with data" rule).
