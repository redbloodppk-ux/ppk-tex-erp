# GSTR-1 CSV Export — Design

## Problem

The GSTR-1 Export page (`app/app/app/reports/gstr1/`) currently produces a single JSON file matching the GST portal's Returns Offline Tool upload format. The owner uploads returns via the Offline Tool's **CSV import**, which expects one CSV file per section (B2B, B2CL, B2CS, CDNR, CDNUR, HSN summary, Docs Issued) — not a combined JSON. The JSON export is not usable for this workflow and should be replaced.

## Goal

Replace the JSON download with a single "Download CSVs" button that produces one ZIP file containing one CSV per non-empty GSTR-1 section, ready to import into the Offline Tool's "Import CSV — One section at a time" flow.

## Non-goals

- No change to how the return data itself is computed (`lib/gstr1.ts` stays as-is — it already builds the `Gstr1Return` object with all sections).
- No server-side zip generation or storage — the zip is built entirely client-side from data already loaded into the page, matching the existing JSON button's pattern.
- No attempt to replicate the Excel/XLSX workbook format the Offline Tool also accepts — CSV only, per the owner's request.

## Architecture

**New file: `lib/gstr1-csv.ts`**

Pure functions, no DB/network access, mirroring the style of `lib/gstr1.ts`. Takes the already-built `Gstr1Return` object and returns CSV text (string) per section. One function per section:

- `toB2bCsv(b2b: B2bGroup[]): string`
- `toB2clCsv(b2cl: B2clGroup[]): string`
- `toB2csCsv(b2cs: B2csEntry[]): string`
- `toCdnrCsv(cdnr: CdnrGroup[]): string`
- `toCdnurCsv(cdnur: CdnurNote[]): string`
- `toHsnCsv(hsn: HsnRow[]): string`
- `toDocsCsv(docDet: DocDet[]): string`

Each returns `string | null` — `null` when the input array is empty, a full CSV string (header row + data rows) otherwise — so the caller only zips sections that have data, matching the existing "only non-empty sections appear" behavior of the JSON export.

The section types (`B2bGroup`, `B2clGroup`, `B2csEntry`, `CdnrGroup`, `CdnurNote`, `HsnRow`, `DocDet`) are currently defined but not exported from `lib/gstr1.ts` — they'll need `export` added so `gstr1-csv.ts` can import them.

**CSV headers** (best-known stable Offline Tool template headers — see verification note below):

| File | Headers |
|---|---|
| `b2b.csv` | GSTIN/UIN of Recipient, Receiver Name, Invoice Number, Invoice date, Invoice Value, Place Of Supply, Reverse Charge, Applicable % of Tax Rate, Invoice Type, Rate, Taxable Value, Cess Amount |
| `b2cl.csv` | Invoice Number, Invoice date, Invoice Value, Place Of Supply, Applicable % of Tax Rate, Rate, Taxable Value, Cess Amount |
| `b2cs.csv` | Type, Place Of Supply, Applicable % of Tax Rate, Rate, Taxable Value, Cess Amount |
| `cdnr.csv` | GSTIN/UIN of Recipient, Receiver Name, Note Number, Note Date, Note Type, Place Of Supply, Reverse Charge, Note Supply Type, Applicable % of Tax Rate, Note Value, Rate, Taxable Value, Cess Amount, Pre GST |
| `cdnur.csv` | UR Type, Note Number, Note Date, Note Type, Place Of Supply, Note Value, Applicable % of Tax Rate, Rate, Taxable Value, Cess Amount, Pre GST |
| `hsn.csv` | HSN, Description, UQC, Total Quantity, Total Value, Rate, Taxable Value, Integrated Tax Amount, Central Tax Amount, State/UT Tax Amount, Cess Amount |
| `docs.csv` | Nature of Document, Sr. No. From, Sr. No. To, Total Number, Cancelled, Net Issued |

Row-building notes:
- `b2b`/`cdnr` are grouped by recipient GSTIN (`ctin`) with a nested list of invoices/notes each with `itms` (one row per tax-rate block) — CSV emits one row per (invoice × tax-rate item), repeating the invoice-level fields.
- `Receiver Name` is not tracked in the current `Gstr1Invoice` shape — leave blank (empty string). This matches the portal's tolerance for optional fields but should be called out to the owner as a known gap.
- `Invoice Type` for b2b is always `Regular` (matches the existing JSON's fixed `inv_typ: 'R'`).
- `Reverse Charge` is always `N` (matches existing JSON's fixed `rchrg: 'N'`).
- Dates already come through as `idt`/`nt_dt` in `DD-MM-YYYY` (via `toGstDate`) from the upstream builder — reuse as-is.
- CSV field escaping: wrap any field containing a comma, quote, or newline in double quotes, doubling internal quotes (standard CSV escaping). Needed mainly for `Description` in `hsn.csv`.

**New file: `app/app/app/reports/gstr1/download-csv-button.tsx`**

Replaces `download-json-button.tsx` (which is deleted). Client component, same prop shape as today (`data`, `fp`, `gstin`, `disabled`) but `data` is typed as `Gstr1Return` instead of `unknown`. On click:

1. For each section, call the matching `lib/gstr1-csv.ts` function; skip sections that return empty.
2. Add each non-empty CSV as a file to a `JSZip` instance (new dependency — see below), named `b2b.csv`, `b2cl.csv`, `b2cs.csv`, `cdnr.csv`, `cdnur.csv`, `hsn.csv`, `docs.csv`.
3. Generate the zip as a Blob (`zip.generateAsync({ type: 'blob' })`), trigger a download named `GSTR1_<gstin>_<fp>.zip`, same download-link pattern the JSON button already uses.
4. Same disabled / done-state UX as today (`Download GSTR-1 CSVs` label, checkmark on completion).

**New dependency:** `jszip` added to `package.json` `dependencies`. No `@types/jszip` needed — JSZip ships its own TypeScript types.

**`page.tsx` changes:**
- Import `DownloadCsvButton` instead of `DownloadJsonButton`.
- Swap the `FileJson` icon for `FileSpreadsheet` (already available from `lucide-react`, same package already in use).
- Update the subtitle and the closing "Notes" card: replace the JSON-upload instructions with CSV-import instructions ("unzip and import each CSV under GSTR-1 → Import Data Using Excel and CSV Import → one section at a time").

## Testing

**New file: `lib/gstr1-csv.test.ts`**, same conventions as the existing `lib/gstr1.test.ts` (which already provides good example fixtures for `Gstr1Return` shapes). For each of the 7 section functions:
- Empty input → `null` result.
- One-row fixture → exact header line + exact data line, asserted as full string equality (not just "contains"), so a header typo fails the test immediately.
- Where a section groups multiple tax-rate blocks per document (b2b, cdnr), a two-rate fixture → two CSV rows sharing the same invoice-level fields.
- CSV-escaping case: an `hsn.csv` row whose `desc` contains a comma → asserted as properly quoted in the output.

No changes needed to `lib/gstr1.test.ts` — the underlying return-builder isn't changing.

## Known limitation / verification needed

The CSV headers above are the commonly-documented, stable GSTN Offline Tool template headers (same ones used by Tally/ClearTax/Zoho exports), reconstructed from memory since GSTN doesn't publish them on a fetchable web page — they ship inside the tool's own bundled template files. **Recommend the owner test-import the first month's generated ZIP into the actual Offline Tool** (the same screen shown in their screenshot: GSTR-1/IFF → Import Data Using Excel and CSV Import → one section at a time) before relying on this for real filing. If any section is rejected or misread, report which file/column and it can be corrected quickly — the header list lives in one place (`lib/gstr1-csv.ts`) so a fix is localized.
