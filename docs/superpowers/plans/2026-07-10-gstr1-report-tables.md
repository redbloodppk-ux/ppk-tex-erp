# GSTR-1 Report Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Reports → GSTR-1 page's plain section-count table with real government-style tables (4A, 5, 7, 9B, 12, 13) showing actual invoice/HSN rows, expandable to invoice/note detail where the underlying data supports it, plus a Total Liability footer.

**Architecture:** Add a pure transform `buildReportTables()` to the existing `app/lib/gstr1.ts` that reshapes the already-computed `Gstr1Return` into per-table summaries. Render it with a new client component. No DB or query changes — the page already loads everything this needs.

**Tech Stack:** Next.js (existing app router page), React client component for expand/collapse state, Vitest for unit tests, lucide-react for icons (already a dependency — used elsewhere in this same page).

**Spec:** `docs/superpowers/specs/2026-07-10-gstr1-report-tables-design.md`

---

### Task 1: Extract `fmtRupees` into a shared helper

`page.tsx` already defines a local `fmtRupees()`. The new `ReportTables` component (Task 3) needs the same formatting, so pull it out once instead of duplicating it.

**Files:**
- Create: `app/lib/format.ts`
- Modify: `app/app/app/reports/gstr1/page.tsx:54-56` (remove local function), `app/app/app/reports/gstr1/page.tsx:13-19` (add import)

- [ ] **Step 1: Create the shared helper**

```ts
// app/lib/format.ts
/** Format a number as Indian-locale rupees with 2 decimal places, e.g. "₹1,23,456.78". */
export function fmtRupees(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

- [ ] **Step 2: Remove the local copy from `page.tsx` and import the shared one**

In `app/app/app/reports/gstr1/page.tsx`, delete these lines (the local function):

```ts
function fmtRupees(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

Add this import alongside the existing ones at the top of the file (after the `loadCompany` import):

```ts
import { fmtRupees } from '@/lib/format';
```

- [ ] **Step 3: Typecheck**

Run: `cd "app" && npm run build -- --no-lint 2>&1 | head -50` (or `npx tsc --noEmit` if that script isn't available) from the `ppk_tex_erp` project root.
Expected: no errors about `fmtRupees` being undefined or duplicated.

- [ ] **Step 4: Commit**

```bash
git add app/lib/format.ts app/app/app/reports/gstr1/page.tsx
git commit -m "refactor: extract fmtRupees into shared lib/format.ts"
```

---

### Task 2: `buildReportTables()` in `app/lib/gstr1.ts`

**Files:**
- Modify: `app/lib/gstr1.ts` (add exported types + function at the end of the file, after `summarise()`)
- Test: `app/lib/gstr1.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `app/lib/gstr1.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReportTables } from './gstr1';
import type { Gstr1Return } from './gstr1';

describe('buildReportTables', () => {
  it('builds table 4A from b2b groups with per-invoice detail', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      b2b: [
        {
          ctin: '33AYTPN1798B1Z4',
          inv: [
            {
              inum: 'INV/26-27/0037',
              idt: '01-06-2026',
              val: 62235,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 59271, rt: 5, iamt: 0, camt: 1481.78, samt: 1481.78, csamt: 0 } }],
            },
            {
              inum: 'INV/26-27/0041',
              idt: '06-06-2026',
              val: 78029,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 74313, rt: 5, iamt: 0, camt: 1857.83, samt: 1857.83, csamt: 0 } }],
            },
          ],
        },
      ],
    };

    const tables = buildReportTables(ret);
    const t4a = tables.find((t) => t.tableNo === '4A');
    expect(t4a).toBeDefined();
    expect(t4a?.rows).toHaveLength(1);
    expect(t4a?.rows[0].count).toBe(2);
    expect(t4a?.rows[0].taxableValue).toBeCloseTo(133584, 2);
    expect(t4a?.rows[0].detail).toHaveLength(2);
    expect(t4a?.rows[0].detail[0].docNo).toBe('INV/26-27/0037');
    expect(t4a?.totals.taxableValue).toBeCloseTo(133584, 2);
  });

  it('builds table 9B from cdnr with correct per-note detail', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      cdnr: [
        {
          ctin: '33AABHB4561N2ZB',
          nt: [
            {
              ntty: 'C',
              nt_num: 'CN/26-27/0003',
              nt_dt: '15-06-2026',
              val: 7326,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 6977.48, rt: 5, iamt: 0, camt: 174.44, samt: 174.44, csamt: 0 } }],
            },
          ],
        },
      ],
    };

    const tables = buildReportTables(ret);
    const t9b = tables.find((t) => t.tableNo === '9B');
    expect(t9b).toBeDefined();
    expect(t9b?.rows).toHaveLength(1);
    expect(t9b?.rows[0].label).toBe('33AABHB4561N2ZB');
    expect(t9b?.rows[0].taxableValue).toBeCloseTo(6977.48, 2);
  });

  it('builds table 12 from HSN rows with no expandable detail', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      hsn: {
        data: [
          {
            num: 1,
            hsn_sc: '5208',
            desc: 'Woven fabrics of cotton',
            uqc: 'PCS',
            qty: 21226.24,
            rt: 5,
            txval: 750900.3,
            iamt: 0,
            camt: 18772.5,
            samt: 18772.5,
            csamt: 0,
          },
        ],
      },
    };

    const tables = buildReportTables(ret);
    const t12 = tables.find((t) => t.tableNo === '12');
    expect(t12).toBeDefined();
    expect(t12?.rows[0].label).toBe('5208 — Woven fabrics of cotton');
    expect(t12?.rows[0].detail).toHaveLength(0);
    expect(t12?.rows[0].taxableValue).toBeCloseTo(750900.3, 2);
  });

  it('omits a table entirely when its source section is absent', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      b2b: [
        {
          ctin: '33AYTPN1798B1Z4',
          inv: [
            {
              inum: 'INV/26-27/0037',
              idt: '01-06-2026',
              val: 62235,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 59271, rt: 5, iamt: 0, camt: 1481.78, samt: 1481.78, csamt: 0 } }],
            },
          ],
        },
      ],
    };

    const tables = buildReportTables(ret);
    expect(tables.find((t) => t.tableNo === '5')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '7')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '9B')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '12')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '13')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "app" && npx vitest run lib/gstr1.test.ts` from the `ppk_tex_erp` project root.
Expected: FAIL — `buildReportTables` is not exported from `./gstr1` yet.

- [ ] **Step 3: Implement `buildReportTables()`**

Append this to the end of `app/lib/gstr1.ts` (after the existing `summarise()` function, using the file's existing internal types `B2bGroup`, `B2clGroup`, `B2csEntry`, `CdnrGroup`, `CdnurNote`, `HsnRow`, `DocDet`, `Itm`, and the existing `r2()` helper):

```ts
/* ─────────────────────────── report tables (on-screen) ───────────────────────── */

export interface ReportDetailRow {
  docNo: string;
  date: string; // portal format, DD-MM-YYYY
  rate: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface ReportTableRow {
  /** whatever this table groups by: recipient GSTIN, place-of-supply code, HSN code, etc. */
  key: string;
  label: string;
  count: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** underlying invoice/note rows for the expand view; empty when the source data has already been consolidated (tables 7, 12, 13) */
  detail: ReportDetailRow[];
}

export interface ReportTable {
  tableNo: string; // '4A' | '5' | '7' | '9B' | '12' | '13'
  title: string;
  rows: ReportTableRow[];
  totals: { count: number; taxableValue: number; igst: number; cgst: number; sgst: number };
}

function sumItms2(itms: Itm[]): { taxableValue: number; igst: number; cgst: number; sgst: number } {
  return itms.reduce(
    (a, it) => ({
      taxableValue: a.taxableValue + it.itm_det.txval,
      igst: a.igst + it.itm_det.iamt,
      cgst: a.cgst + it.itm_det.camt,
      sgst: a.sgst + it.itm_det.samt,
    }),
    { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
  );
}

function detailFromItms(docNo: string, date: string, itms: Itm[]): ReportDetailRow[] {
  return itms.map((it) => ({
    docNo,
    date,
    rate: it.itm_det.rt,
    taxableValue: r2(it.itm_det.txval),
    igst: r2(it.itm_det.iamt),
    cgst: r2(it.itm_det.camt),
    sgst: r2(it.itm_det.samt),
  }));
}

function totalsOfRows(rows: ReportTableRow[]): ReportTable['totals'] {
  return rows.reduce(
    (a, r) => ({
      count: a.count + r.count,
      taxableValue: r2(a.taxableValue + r.taxableValue),
      igst: r2(a.igst + r.igst),
      cgst: r2(a.cgst + r.cgst),
      sgst: r2(a.sgst + r.sgst),
    }),
    { count: 0, taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
  );
}

function build4A(b2b: B2bGroup[]): ReportTable | null {
  if (b2b.length === 0) return null;
  const rows: ReportTableRow[] = b2b.map((g) => {
    const detail = g.inv.flatMap((inv) => detailFromItms(inv.inum, inv.idt, inv.itms));
    const sums = sumItms2(g.inv.flatMap((inv) => inv.itms));
    return {
      key: g.ctin,
      label: g.ctin,
      count: g.inv.length,
      taxableValue: r2(sums.taxableValue),
      igst: r2(sums.igst),
      cgst: r2(sums.cgst),
      sgst: r2(sums.sgst),
      detail,
    };
  });
  return { tableNo: '4A', title: 'B2B Invoices (Registered)', rows, totals: totalsOfRows(rows) };
}

function build5(b2cl: B2clGroup[]): ReportTable | null {
  if (b2cl.length === 0) return null;
  const rows: ReportTableRow[] = b2cl.map((g) => {
    const detail = g.inv.flatMap((inv) => detailFromItms(inv.inum, inv.idt, inv.itms));
    const sums = sumItms2(g.inv.flatMap((inv) => inv.itms));
    return {
      key: g.pos,
      label: `POS ${g.pos}`,
      count: g.inv.length,
      taxableValue: r2(sums.taxableValue),
      igst: r2(sums.igst),
      cgst: r2(sums.cgst),
      sgst: r2(sums.sgst),
      detail,
    };
  });
  return { tableNo: '5', title: 'B2C (Large)', rows, totals: totalsOfRows(rows) };
}

function build7(b2cs: B2csEntry[]): ReportTable | null {
  if (b2cs.length === 0) return null;
  const rows: ReportTableRow[] = b2cs.map((e, i) => ({
    key: `${e.pos}-${e.rt}-${e.sply_ty}-${i}`,
    label: `POS ${e.pos} @ ${e.rt}%`,
    count: 1,
    taxableValue: r2(e.txval),
    igst: r2(e.iamt),
    cgst: r2(e.camt),
    sgst: r2(e.samt),
    detail: [],
  }));
  return { tableNo: '7', title: 'B2C (Others)', rows, totals: totalsOfRows(rows) };
}

function build9B(cdnr: CdnrGroup[], cdnur: CdnurNote[]): ReportTable | null {
  if (cdnr.length === 0 && cdnur.length === 0) return null;
  const rows: ReportTableRow[] = cdnr.map((g) => {
    const detail = g.nt.flatMap((n) => detailFromItms(n.nt_num, n.nt_dt, n.itms));
    const sums = sumItms2(g.nt.flatMap((n) => n.itms));
    return {
      key: g.ctin,
      label: g.ctin,
      count: g.nt.length,
      taxableValue: r2(sums.taxableValue),
      igst: r2(sums.igst),
      cgst: r2(sums.cgst),
      sgst: r2(sums.sgst),
      detail,
    };
  });
  if (cdnur.length > 0) {
    const detail = cdnur.flatMap((n) => detailFromItms(n.nt_num, n.nt_dt, n.itms));
    const sums = sumItms2(cdnur.flatMap((n) => n.itms));
    rows.push({
      key: 'UNREGISTERED',
      label: 'Unregistered',
      count: cdnur.length,
      taxableValue: r2(sums.taxableValue),
      igst: r2(sums.igst),
      cgst: r2(sums.cgst),
      sgst: r2(sums.sgst),
      detail,
    });
  }
  return { tableNo: '9B', title: 'Credit/Debit Notes (Registered & Unregistered)', rows, totals: totalsOfRows(rows) };
}

function build12(hsn: HsnRow[]): ReportTable | null {
  if (hsn.length === 0) return null;
  const rows: ReportTableRow[] = hsn.map((h) => ({
    key: `${h.hsn_sc}-${h.uqc}-${h.rt}`,
    label: `${h.hsn_sc} — ${h.desc}`,
    count: 1,
    taxableValue: r2(h.txval),
    igst: r2(h.iamt),
    cgst: r2(h.camt),
    sgst: r2(h.samt),
    detail: [],
  }));
  return { tableNo: '12', title: 'HSN-wise Summary', rows, totals: totalsOfRows(rows) };
}

function build13(docDet: DocDet[]): ReportTable | null {
  if (docDet.length === 0) return null;
  const rows: ReportTableRow[] = docDet.flatMap((d) =>
    d.docs.map((r, i) => ({
      key: `${d.doc_num}-${i}`,
      label: `${r.from} to ${r.to}`,
      count: r.totnum,
      taxableValue: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      detail: [] as ReportDetailRow[],
    })),
  );
  return { tableNo: '13', title: 'Documents Issued', rows, totals: totalsOfRows(rows) };
}

/** Reshape a built GSTR-1 return into official-form-style tables (only sections with data are included). */
export function buildReportTables(ret: Gstr1Return): ReportTable[] {
  const tables: (ReportTable | null)[] = [
    build4A(ret.b2b ?? []),
    build5(ret.b2cl ?? []),
    build7(ret.b2cs ?? []),
    build9B(ret.cdnr ?? [], ret.cdnur ?? []),
    build12(ret.hsn?.data ?? []),
    build13(ret.doc_issue?.doc_det ?? []),
  ];
  return tables.filter((t): t is ReportTable => t !== null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "app" && npx vitest run lib/gstr1.test.ts` from the `ppk_tex_erp` project root.
Expected: PASS — 4/4 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/gstr1.ts app/lib/gstr1.test.ts
git commit -m "feat: add buildReportTables() for GSTR-1 official-table view"
```

---

### Task 3: `ReportTables` display component

**Files:**
- Create: `app/app/app/reports/gstr1/report-tables.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fmtRupees } from '@/lib/format';
import type { ReportTable } from '@/lib/gstr1';

/** Tables where the source data still has per-invoice/note detail to drill into. */
const EXPANDABLE_TABLES = new Set(['4A', '5', '9B']);

interface ReportTablesProps {
  tables: ReportTable[];
}

export function ReportTables({ tables }: ReportTablesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (tables.length === 0) return null;

  const toggle = (rowKey: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const grandTotal = tables.reduce(
    (a, t) => ({
      taxableValue: a.taxableValue + t.totals.taxableValue,
      igst: a.igst + t.totals.igst,
      cgst: a.cgst + t.totals.cgst,
      sgst: a.sgst + t.totals.sgst,
    }),
    { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
  );

  return (
    <div className="space-y-4">
      {tables.map((table) => {
        const canExpand = EXPANDABLE_TABLES.has(table.tableNo);
        return (
          <div key={table.tableNo} className="card p-0 overflow-x-auto">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 bg-cloud/40 border-b border-line/40">
              <div className="text-sm font-medium">
                {table.tableNo} — {table.title}
              </div>
              <div className="text-xs text-ink-mute">
                {table.totals.count} record{table.totals.count === 1 ? '' : 's'} · Taxable{' '}
                {fmtRupees(table.totals.taxableValue)} · IGST {fmtRupees(table.totals.igst)} · CGST{' '}
                {fmtRupees(table.totals.cgst)} · SGST {fmtRupees(table.totals.sgst)}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-mute">
                <tr>
                  {canExpand && <th className="w-8" />}
                  <th className="text-left px-4 py-2">Description</th>
                  <th className="text-right px-4 py-2">Records</th>
                  <th className="text-right px-4 py-2">Taxable value</th>
                  <th className="text-right px-4 py-2">IGST</th>
                  <th className="text-right px-4 py-2">CGST</th>
                  <th className="text-right px-4 py-2">SGST</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => {
                  const rowKey = `${table.tableNo}-${row.key}`;
                  const isOpen = expanded.has(rowKey);
                  return (
                    <Fragment key={rowKey}>
                      <tr className="border-t border-line/40">
                        {canExpand && (
                          <td className="px-2 py-2">
                            {row.detail.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggle(rowKey)}
                                className="text-ink-mute hover:text-ink"
                                aria-label="Toggle details"
                              >
                                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-2">{row.label}</td>
                        <td className="px-4 py-2 text-right num">{row.count}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.taxableValue)}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.igst)}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.cgst)}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.sgst)}</td>
                      </tr>
                      {canExpand && isOpen && (
                        <tr className="bg-cloud/20">
                          <td />
                          <td colSpan={6} className="px-4 py-2">
                            <table className="w-full text-xs">
                              <thead className="text-ink-mute">
                                <tr>
                                  <th className="text-left py-1">Doc no.</th>
                                  <th className="text-left py-1">Date</th>
                                  <th className="text-right py-1">Rate</th>
                                  <th className="text-right py-1">Taxable value</th>
                                  <th className="text-right py-1">IGST</th>
                                  <th className="text-right py-1">CGST</th>
                                  <th className="text-right py-1">SGST</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.detail.map((d, i) => (
                                  <tr key={`${d.docNo}-${i}`} className="border-t border-line/20">
                                    <td className="py-1">{d.docNo}</td>
                                    <td className="py-1">{d.date}</td>
                                    <td className="py-1 text-right num">{d.rate}%</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.taxableValue)}</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.igst)}</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.cgst)}</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.sgst)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <div className="card p-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">Total Liability</div>
        <div className="text-sm font-semibold">
          Taxable {fmtRupees(grandTotal.taxableValue)} · IGST {fmtRupees(grandTotal.igst)} · CGST{' '}
          {fmtRupees(grandTotal.cgst)} · SGST {fmtRupees(grandTotal.sgst)} · Total tax{' '}
          {fmtRupees(grandTotal.igst + grandTotal.cgst + grandTotal.sgst)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "app" && npx tsc --noEmit` from the `ppk_tex_erp` project root.
Expected: no errors in `report-tables.tsx` (it isn't wired into the page yet, so this only checks the file compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add app/app/app/reports/gstr1/report-tables.tsx
git commit -m "feat: add ReportTables component for GSTR-1 official-table view"
```

---

### Task 4: Wire `ReportTables` into the GSTR-1 page

**Files:**
- Modify: `app/app/app/reports/gstr1/page.tsx`

- [ ] **Step 1: Update imports**

Change this line (currently importing only `buildGstr1, summarise`):

```ts
import { buildGstr1, summarise } from '@/lib/gstr1';
```

to:

```ts
import { buildGstr1, buildReportTables, summarise } from '@/lib/gstr1';
```

Add this new import right after the `DownloadJsonButton` import:

```ts
import { ReportTables } from './report-tables';
```

- [ ] **Step 2: Remove the now-dead `sections` array**

Delete this block (it fed the old section-count table being replaced):

```ts
  const sections: Array<{ key: string; label: string; count: number }> = [
    { key: 'b2b', label: 'B2B (registered)', count: sum.b2b },
    { key: 'b2cl', label: 'B2CL (interstate large)', count: sum.b2cl },
    { key: 'b2cs', label: 'B2CS (consolidated)', count: sum.b2cs },
    { key: 'cdnr', label: 'CDNR (credit notes — registered)', count: sum.cdnr },
    { key: 'cdnur', label: 'CDNUR (credit notes — unregistered)', count: sum.cdnur },
    { key: 'hsn', label: 'HSN summary rows', count: sum.hsn },
  ];
```

- [ ] **Step 3: Replace the "Section breakdown" block with the new tables**

Find this block:

```tsx
      {/* Section breakdown */}
      {nothing ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No billed invoices or credit notes in {label}.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-4 py-2">Section</th>
                <th className="text-right px-4 py-2">Entries</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <tr key={s.key} className="border-t border-line/40">
                  <td className="px-4 py-2">{s.label}</td>
                  <td className="px-4 py-2 text-right num font-semibold">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
```

and replace it with:

```tsx
      {/* GSTR-1 report tables (official form layout) */}
      {nothing ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No billed invoices or credit notes in {label}.
        </div>
      ) : (
        <ReportTables tables={buildReportTables(gstr1)} />
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd "app" && npx tsc --noEmit` from the `ppk_tex_erp` project root.
Expected: no errors. `sum` (from `summarise(gstr1)`) is still used elsewhere on the page (the totals strip), so it must NOT be removed — only the `sections` array is dead.

- [ ] **Step 5: Run the full test suite**

Run: `cd "app" && npx vitest run` from the `ppk_tex_erp` project root.
Expected: all tests pass, including the 4 new `gstr1.test.ts` tests from Task 2.

- [ ] **Step 6: Manual check**

Run: `cd "app" && npm run dev` (if not already running), then open `/app/reports/gstr1?period=2026-06` in a browser.
Expected: the page shows table 4A, 9B, 12, and 13 (matching the June 2026 data), each with correct totals; 4A and 9B rows expand to show individual invoices/notes when clicked; a "Total Liability" card appears at the bottom.

- [ ] **Step 7: Commit**

```bash
git add app/app/app/reports/gstr1/page.tsx
git commit -m "feat: wire GSTR-1 official-table report into the page"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full typecheck across the app**

Run: `cd "app" && npx tsc --noEmit` from the `ppk_tex_erp` project root.
Expected: no errors anywhere in the project.

- [ ] **Step 2: Full test suite**

Run: `cd "app" && npx vitest run` from the `ppk_tex_erp` project root.
Expected: all tests pass.

- [ ] **Step 3: Confirm the spec's out-of-scope items were respected**

Check: `download-json-button.tsx` and `buildGstr1()` are unchanged (only additive changes to `gstr1.ts`); no PDF generation code was added; no tables were added for sections `buildGstr1()` doesn't produce (4B, 6A-C, 8, 9A, 9C, 10, 11A-B, 14, 14A, 15, 15A).

- [ ] **Step 4: Push**

```bash
git push
```
