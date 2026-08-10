/**
 * GSTR-1 CSV builder.
 *
 * Turns an already-built `Gstr1Return` (see `lib/gstr1.ts`) into the
 * per-section CSV text the GST portal's Returns Offline Tool accepts via
 * "Import Data Using Excel and CSV Import → One section at a time".
 *
 * Pure functions only — no DB / network / DOM here, so they're easy to
 * unit-test and to call from the client-side download button
 * (`app/app/app/reports/gstr1/download-csv-button.tsx`).
 *
 * Each function returns `null` when its section has no rows, so the caller
 * only zips files for sections that actually have data that period —
 * matching the JSON export's existing "only non-empty sections appear"
 * behaviour.
 *
 * Header set: the commonly-documented, stable Offline Tool CSV template
 * headers (the same ones Tally / ClearTax / Zoho export to). GSTN doesn't
 * publish these on a fetchable web page — they ship inside the tool's own
 * bundled templates — so test-import the first month's ZIP into the real
 * Offline Tool before relying on it for actual filing.
 */
import type {
  B2bGroup,
  B2clGroup,
  B2csEntry,
  CdnrGroup,
  CdnurNote,
  HsnRow,
  DocDet,
} from './gstr1';

/* ────────────────────────────── helpers ──────────────────────────────── */

function r2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** Escape one CSV field per RFC 4180: quote if it contains a comma, quote, or newline. */
function csvField(v: string | number): string {
  const s = String(v);
  if (/["\n,]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

/** CRLF-joined CSV text: header row + data rows. */
function csvText(header: string[], rows: (string | number)[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n');
}

/** Whether a note/invoice's tax split (by its first tax-rate block) is inter-state. */
function isInterState(itms: { itm_det: { iamt: number } }[]): boolean {
  return (itms[0]?.itm_det.iamt ?? 0) > 0;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Convert the portal-JSON date format ('DD-MM-YYYY', e.g. '05-07-2026') to the
 * Returns Offline Tool's CSV/Excel import date format ('DD-Mon-YYYY', e.g.
 * '05-Jul-2026'). The offline tool rejects the whole file ("Data Invalid")
 * if dates aren't in this format — it doesn't accept numeric months.
 */
function csvDate(d: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
  if (!m) return d;
  const [, dd, mm, yyyy] = m;
  const mon = MONTH_ABBR[Number(mm) - 1] ?? mm;
  return `${dd}-${mon}-${yyyy}`;
}

/* ─────────────────────────── section builders ────────────────────────── */

const B2B_HEADER = [
  'GSTIN/UIN of Recipient',
  'Receiver Name',
  'Invoice Number',
  'Invoice date',
  'Invoice Value',
  'Place Of Supply',
  'Reverse Charge',
  'Applicable % of Tax Rate',
  'Invoice Type',
  'E-Commerce GSTIN',
  'Rate',
  'Taxable Value',
  'Cess Amount',
];

export function toB2bCsv(b2b: B2bGroup[]): string | null {
  if (b2b.length === 0) return null;
  const rows: (string | number)[][] = [];
  for (const g of b2b) {
    for (const inv of g.inv) {
      for (const it of inv.itms) {
        rows.push([
          g.ctin,
          '',
          inv.inum,
          csvDate(inv.idt),
          r2(inv.val),
          inv.pos,
          inv.rchrg,
          '',
          inv.inv_typ === 'R' ? 'Regular' : inv.inv_typ,
          '',
          it.itm_det.rt,
          r2(it.itm_det.txval),
          r2(it.itm_det.csamt),
        ]);
      }
    }
  }
  return csvText(B2B_HEADER, rows);
}

const B2CL_HEADER = [
  'Invoice Number',
  'Invoice date',
  'Invoice Value',
  'Place Of Supply',
  'E-Commerce GSTIN',
  'Applicable % of Tax Rate',
  'Rate',
  'Taxable Value',
  'Cess Amount',
];

export function toB2clCsv(b2cl: B2clGroup[]): string | null {
  if (b2cl.length === 0) return null;
  const rows: (string | number)[][] = [];
  for (const g of b2cl) {
    for (const inv of g.inv) {
      for (const it of inv.itms) {
        rows.push([
          inv.inum,
          csvDate(inv.idt),
          r2(inv.val),
          g.pos,
          '',
          '',
          it.itm_det.rt,
          r2(it.itm_det.txval),
          r2(it.itm_det.csamt),
        ]);
      }
    }
  }
  return csvText(B2CL_HEADER, rows);
}

const B2CS_HEADER = [
  'Type',
  'Place Of Supply',
  'E-Commerce GSTIN',
  'Applicable % of Tax Rate',
  'Rate',
  'Taxable Value',
  'Cess Amount',
];

export function toB2csCsv(b2cs: B2csEntry[]): string | null {
  if (b2cs.length === 0) return null;
  const rows = b2cs.map((e) => [e.typ, e.pos, '', '', e.rt, r2(e.txval), r2(e.csamt)]);
  return csvText(B2CS_HEADER, rows);
}

const CDNR_HEADER = [
  'GSTIN/UIN of Recipient',
  'Receiver Name',
  'Note Number',
  'Note Date',
  'Note Type',
  'Place Of Supply',
  'Reverse Charge',
  'Note Supply Type',
  'Applicable % of Tax Rate',
  'Note Value',
  'Rate',
  'Taxable Value',
  'Cess Amount',
  'Pre GST',
];

export function toCdnrCsv(cdnr: CdnrGroup[]): string | null {
  if (cdnr.length === 0) return null;
  const rows: (string | number)[][] = [];
  for (const g of cdnr) {
    for (const nt of g.nt) {
      const supplyType = isInterState(nt.itms) ? 'Inter-State' : 'Intra-State';
      for (const it of nt.itms) {
        rows.push([
          g.ctin,
          '',
          nt.nt_num,
          csvDate(nt.nt_dt),
          'Credit Note',
          nt.pos,
          nt.rchrg,
          supplyType,
          '',
          r2(nt.val),
          it.itm_det.rt,
          r2(it.itm_det.txval),
          r2(it.itm_det.csamt),
          'N',
        ]);
      }
    }
  }
  return csvText(CDNR_HEADER, rows);
}

const CDNUR_HEADER = [
  'UR Type',
  'Note Number',
  'Note Date',
  'Note Type',
  'Place Of Supply',
  'Note Value',
  'Applicable % of Tax Rate',
  'Rate',
  'Taxable Value',
  'Cess Amount',
  'Pre GST',
];

export function toCdnurCsv(cdnur: CdnurNote[]): string | null {
  if (cdnur.length === 0) return null;
  const rows: (string | number)[][] = [];
  for (const n of cdnur) {
    for (const it of n.itms) {
      rows.push([
        n.typ,
        n.nt_num,
        csvDate(n.nt_dt),
        'Credit Note',
        n.pos,
        r2(n.val),
        '',
        it.itm_det.rt,
        r2(it.itm_det.txval),
        r2(it.itm_det.csamt),
        'N',
      ]);
    }
  }
  return csvText(CDNUR_HEADER, rows);
}

const HSN_HEADER = [
  'HSN',
  'Description',
  'UQC',
  'Total Quantity',
  'Total Value',
  'Rate',
  'Taxable Value',
  'Integrated Tax Amount',
  'Central Tax Amount',
  'State/UT Tax Amount',
  'Cess Amount',
];

export function toHsnCsv(hsn: HsnRow[]): string | null {
  if (hsn.length === 0) return null;
  const rows = hsn.map((h) => {
    const totalValue = r2(h.txval + h.iamt + h.camt + h.samt + h.csamt);
    return [h.hsn_sc, h.desc, h.uqc, r2(h.qty), totalValue, h.rt, r2(h.txval), r2(h.iamt), r2(h.camt), r2(h.samt), r2(h.csamt)];
  });
  return csvText(HSN_HEADER, rows);
}

const DOCS_HEADER = ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled', 'Net Issued'];

/** doc_num → human label, per the GSTR-1 "Documents Issued" table (1 = outward invoices, 5 = credit notes). */
function docNatureLabel(docNum: number): string {
  if (docNum === 1) return 'Invoices for outward supply';
  if (docNum === 5) return 'Credit Note';
  return `Doc type ${docNum}`;
}

export function toDocsCsv(docDet: DocDet[]): string | null {
  if (docDet.length === 0) return null;
  const rows: (string | number)[][] = [];
  for (const d of docDet) {
    for (const r of d.docs) {
      rows.push([docNatureLabel(d.doc_num), r.from, r.to, r.totnum, r.cancel, r.net_issue]);
    }
  }
  if (rows.length === 0) return null;
  return csvText(DOCS_HEADER, rows);
}
