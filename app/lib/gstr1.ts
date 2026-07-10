/**
 * GSTR-1 JSON builder.
 *
 * Turns PPK TEX invoices + their lines into the JSON shape the GST portal's
 * "Returns Offline Tool" / GSTR-1 upload accepts. Pure functions only — no
 * DB / network here, so it's easy to unit-test and to call from a server
 * component. The report page (app/reports/gstr1) loads the rows and the
 * company profile, then hands them to `buildGstr1()`.
 *
 * Sections produced (only non-empty ones are emitted):
 *   b2b      — sales to GST-registered buyers
 *   b2cl     — interstate sales to unregistered buyers above the B2CL limit
 *   b2cs     — all other sales to unregistered buyers, consolidated
 *   cdnr     — credit notes issued to registered buyers
 *   cdnur    — credit notes issued to unregistered buyers
 *   hsn      — HSN/SAC summary (credit notes netted out)
 *   doc_issue— serial ranges of invoices / credit notes issued
 *
 * Money is rounded to 2 decimals. `pos` (place of supply) is the 2-digit
 * state code: taken from the buyer GSTIN where possible, else mapped from
 * the place-of-supply state name.
 */

/** Buyer-facing line as stored in `invoice_line`. */
export interface Gstr1Line {
  hsn_sac: string | null;
  description: string | null;
  quantity: number | null;
  uom: string | null;
  gst_rate_pct: number | null;
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
}

/** Invoice header + its lines. */
export interface Gstr1Invoice {
  invoice_no: string;
  invoice_date: string; // ISO 'YYYY-MM-DD'
  doc_type: string;
  party_gstin: string | null;
  party_state: string | null;
  place_of_supply: string | null;
  is_interstate: boolean | null;
  total: number | null;
  lines: Gstr1Line[];
}

export interface Gstr1Company {
  /** 15-char supplier GSTIN. */
  gstin: string;
  /** 2-digit home state code (e.g. '33' for Tamil Nadu). */
  stateCode: string;
}

/* ───────────────────────── tax-rate item block ───────────────────────── */

interface ItmDet {
  txval: number;
  rt: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}
interface Itm {
  num: number;
  itm_det: ItmDet;
}

interface B2bInv {
  inum: string;
  idt: string;
  val: number;
  pos: string;
  rchrg: 'N';
  inv_typ: 'R';
  itms: Itm[];
}
interface B2bGroup {
  ctin: string;
  inv: B2bInv[];
}

interface B2clInv {
  inum: string;
  idt: string;
  val: number;
  itms: Itm[];
}
interface B2clGroup {
  pos: string;
  inv: B2clInv[];
}

interface B2csEntry {
  sply_ty: 'INTRA' | 'INTER';
  pos: string;
  typ: 'OE';
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

interface Note {
  ntty: 'C';
  nt_num: string;
  nt_dt: string;
  val: number;
  pos: string;
  rchrg: 'N';
  inv_typ: 'R';
  itms: Itm[];
}
interface CdnrGroup {
  ctin: string;
  nt: Note[];
}
interface CdnurNote {
  typ: 'B2CL' | 'B2CS';
  ntty: 'C';
  nt_num: string;
  nt_dt: string;
  val: number;
  pos: string;
  itms: Itm[];
}

interface HsnRow {
  num: number;
  hsn_sc: string;
  desc: string;
  uqc: string;
  qty: number;
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}
interface DocRange {
  num: number;
  from: string;
  to: string;
  totnum: number;
  cancel: number;
  net_issue: number;
}
interface DocDet {
  doc_num: number;
  docs: DocRange[];
}

export interface Gstr1Return {
  gstin: string;
  fp: string;
  version: string;
  hash: string;
  b2b?: B2bGroup[];
  b2cl?: B2clGroup[];
  b2cs?: B2csEntry[];
  cdnr?: CdnrGroup[];
  cdnur?: CdnurNote[];
  hsn?: { data: HsnRow[] };
  doc_issue?: { doc_det: DocDet[] };
}

/* ───────────────────────────── constants ─────────────────────────────── */

/**
 * Interstate B2C invoices above this value go in B2CL (itemised); the rest
 * fold into the consolidated B2CS. The limit was reduced from ₹2.5 lakh to
 * ₹1 lakh — change here if the rule changes again.
 */
const B2CL_THRESHOLD = 100000;

/** Doc types that are outward "invoices" for GSTR-1. */
const INVOICE_DOC_TYPES = new Set([
  'tax_invoice',
  'jobwork_invoice',
  'general_sale',
  'yarn_sale',
]);

/** State name → 2-digit GST state code (all states + UTs). */
const STATE_CODE_BY_NAME: Record<string, string> = {
  'JAMMU AND KASHMIR': '01',
  'HIMACHAL PRADESH': '02',
  'PUNJAB': '03',
  'CHANDIGARH': '04',
  'UTTARAKHAND': '05',
  'HARYANA': '06',
  'DELHI': '07',
  'RAJASTHAN': '08',
  'UTTAR PRADESH': '09',
  'BIHAR': '10',
  'SIKKIM': '11',
  'ARUNACHAL PRADESH': '12',
  'NAGALAND': '13',
  'MANIPUR': '14',
  'MIZORAM': '15',
  'TRIPURA': '16',
  'MEGHALAYA': '17',
  'ASSAM': '18',
  'WEST BENGAL': '19',
  'JHARKHAND': '20',
  'ODISHA': '21',
  'ORISSA': '21',
  'CHHATTISGARH': '22',
  'MADHYA PRADESH': '23',
  'GUJARAT': '24',
  'DAMAN AND DIU': '25',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU': '26',
  'MAHARASHTRA': '27',
  'ANDHRA PRADESH': '37',
  'KARNATAKA': '29',
  'GOA': '30',
  'LAKSHADWEEP': '31',
  'KERALA': '32',
  'TAMIL NADU': '33',
  'TAMILNADU': '33',
  'PUDUCHERRY': '34',
  'PONDICHERRY': '34',
  'ANDAMAN AND NICOBAR ISLANDS': '35',
  'TELANGANA': '36',
  'LADAKH': '38',
  'OTHER TERRITORY': '97',
};

/** Loose unit → GST UQC code. Defaults to OTH-OTHERS. */
const UQC_BY_UOM: Record<string, string> = {
  mtr: 'MTR',
  meter: 'MTR',
  metre: 'MTR',
  m: 'MTR',
  kg: 'KGS',
  kgs: 'KGS',
  pcs: 'PCS',
  pc: 'PCS',
  piece: 'PCS',
  nos: 'NOS',
  no: 'NOS',
  bag: 'BAG',
  bags: 'BAG',
  box: 'BOX',
  set: 'SET',
  roll: 'ROL',
  rolls: 'ROL',
  ton: 'TON',
  unit: 'UNT',
};

/* ────────────────────────────── helpers ──────────────────────────────── */

function r2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function num(n: number | null | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Convert ISO 'YYYY-MM-DD' → portal 'DD-MM-YYYY'. */
function toGstDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

function isValidGstin(g: string | null | undefined): boolean {
  return !!g && /^[0-9]{2}[A-Z0-9]{13}$/.test(g.trim().toUpperCase());
}

/** Place-of-supply 2-digit code: buyer GSTIN prefix wins, else state name. */
function posCode(inv: Gstr1Invoice): string {
  const g = (inv.party_gstin ?? '').trim().toUpperCase();
  if (/^[0-9]{2}/.test(g)) return g.slice(0, 2);
  const name = (inv.place_of_supply ?? inv.party_state ?? '').trim().toUpperCase();
  return STATE_CODE_BY_NAME[name] ?? '';
}

function uqcOf(uom: string | null | undefined): string {
  const key = (uom ?? '').trim().toLowerCase();
  return UQC_BY_UOM[key] ?? 'OTH';
}

function interstateOf(inv: Gstr1Invoice): boolean {
  if (typeof inv.is_interstate === 'boolean') return inv.is_interstate;
  return inv.lines.some((l) => num(l.igst_amount) > 0);
}

/** Group an invoice's lines into tax-rate item blocks (`itms`). */
function lineItems(inv: Gstr1Invoice): Itm[] {
  const inter = interstateOf(inv);
  const byRate = new Map<number, ItmDet>();
  for (const l of inv.lines) {
    const rt = num(l.gst_rate_pct);
    const cur = byRate.get(rt) ?? { txval: 0, rt, iamt: 0, camt: 0, samt: 0, csamt: 0 };
    cur.txval += num(l.taxable_amount);
    if (inter) {
      cur.iamt += num(l.igst_amount);
    } else {
      cur.camt += num(l.cgst_amount);
      cur.samt += num(l.sgst_amount);
    }
    byRate.set(rt, cur);
  }
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, d], i) => ({
      num: i + 1,
      itm_det: {
        txval: r2(d.txval),
        rt: d.rt,
        iamt: r2(d.iamt),
        camt: r2(d.camt),
        samt: r2(d.samt),
        csamt: 0,
      },
    }));
}

/* ─────────────────────────── section builders ────────────────────────── */

function buildB2b(invoices: Gstr1Invoice[]): B2bGroup[] {
  const groups = new Map<string, B2bInv[]>();
  for (const inv of invoices) {
    const ctin = (inv.party_gstin ?? '').trim().toUpperCase();
    const list = groups.get(ctin) ?? [];
    list.push({
      inum: inv.invoice_no,
      idt: toGstDate(inv.invoice_date),
      val: r2(num(inv.total)),
      pos: posCode(inv),
      rchrg: 'N',
      inv_typ: 'R',
      itms: lineItems(inv),
    });
    groups.set(ctin, list);
  }
  return [...groups.entries()].map(([ctin, inv]) => ({ ctin, inv }));
}

function buildB2cl(invoices: Gstr1Invoice[]): B2clGroup[] {
  const groups = new Map<string, B2clInv[]>();
  for (const inv of invoices) {
    const pos = posCode(inv);
    const list = groups.get(pos) ?? [];
    list.push({
      inum: inv.invoice_no,
      idt: toGstDate(inv.invoice_date),
      val: r2(num(inv.total)),
      itms: lineItems(inv),
    });
    groups.set(pos, list);
  }
  return [...groups.entries()].map(([pos, inv]) => ({ pos, inv }));
}

function buildB2cs(invoices: Gstr1Invoice[]): B2csEntry[] {
  // Consolidate by place-of-supply + rate.
  const map = new Map<string, B2csEntry>();
  for (const inv of invoices) {
    const pos = posCode(inv);
    const inter = interstateOf(inv);
    for (const l of inv.lines) {
      const rt = num(l.gst_rate_pct);
      const key = `${pos}|${rt}|${inter ? 'I' : 'L'}`;
      const cur =
        map.get(key) ??
        ({
          sply_ty: inter ? 'INTER' : 'INTRA',
          pos,
          typ: 'OE',
          rt,
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0,
        } as B2csEntry);
      cur.txval += num(l.taxable_amount);
      if (inter) cur.iamt += num(l.igst_amount);
      else {
        cur.camt += num(l.cgst_amount);
        cur.samt += num(l.sgst_amount);
      }
      map.set(key, cur);
    }
  }
  return [...map.values()].map((e) => ({
    ...e,
    txval: r2(e.txval),
    iamt: r2(e.iamt),
    camt: r2(e.camt),
    samt: r2(e.samt),
  }));
}

function buildCdnr(notes: Gstr1Invoice[]): CdnrGroup[] {
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const ctin = (n.party_gstin ?? '').trim().toUpperCase();
    const list = groups.get(ctin) ?? [];
    list.push({
      ntty: 'C',
      nt_num: n.invoice_no,
      nt_dt: toGstDate(n.invoice_date),
      val: r2(num(n.total)),
      pos: posCode(n),
      rchrg: 'N',
      inv_typ: 'R',
      itms: lineItems(n),
    });
    groups.set(ctin, list);
  }
  return [...groups.entries()].map(([ctin, nt]) => ({ ctin, nt }));
}

function buildCdnur(notes: Gstr1Invoice[]): CdnurNote[] {
  return notes.map((n) => ({
    typ: interstateOf(n) && num(n.total) > B2CL_THRESHOLD ? 'B2CL' : 'B2CS',
    ntty: 'C',
    nt_num: n.invoice_no,
    nt_dt: toGstDate(n.invoice_date),
    val: r2(num(n.total)),
    pos: posCode(n),
    itms: lineItems(n),
  }));
}

/** HSN summary across invoices (+) and credit notes (−). */
function buildHsn(invoices: Gstr1Invoice[], notes: Gstr1Invoice[]): HsnRow[] {
  interface Agg {
    hsn: string;
    uqc: string;
    rt: number;
    desc: string;
    qty: number;
    txval: number;
    iamt: number;
    camt: number;
    samt: number;
  }
  const map = new Map<string, Agg>();
  const add = (inv: Gstr1Invoice, sign: number): void => {
    const inter = interstateOf(inv);
    for (const l of inv.lines) {
      const hsn = (l.hsn_sac ?? '').trim();
      if (hsn === '') continue;
      const rt = num(l.gst_rate_pct);
      // 0% GST lines (e.g. jobwork weaving billed without GST — kept
      // for the business's own records) are NOT part of the GSTR-1
      // HSN summary, per the owner's filing practice.
      if (rt === 0) continue;
      const uqc = uqcOf(l.uom);
      const key = `${hsn}|${uqc}|${rt}`;
      const cur =
        map.get(key) ??
        ({ hsn, uqc, rt, desc: (l.description ?? '').trim().slice(0, 30), qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0 } as Agg);
      cur.qty += sign * num(l.quantity);
      cur.txval += sign * num(l.taxable_amount);
      if (inter) cur.iamt += sign * num(l.igst_amount);
      else {
        cur.camt += sign * num(l.cgst_amount);
        cur.samt += sign * num(l.sgst_amount);
      }
      map.set(key, cur);
    }
  };
  for (const inv of invoices) add(inv, 1);
  for (const n of notes) add(n, -1);
  return [...map.values()].map((a, i) => ({
    num: i + 1,
    hsn_sc: a.hsn,
    desc: a.desc,
    uqc: a.uqc,
    qty: r2(a.qty),
    rt: a.rt,
    txval: r2(a.txval),
    iamt: r2(a.iamt),
    camt: r2(a.camt),
    samt: r2(a.samt),
    csamt: 0,
  }));
}

/** Serial range of a set of document numbers (sorted). */
function docRange(docNum: number, nums: string[]): DocRange[] {
  if (nums.length === 0) return [];
  const sorted = [...nums].sort();
  return [
    {
      num: docNum,
      from: sorted[0] ?? '',
      to: sorted[sorted.length - 1] ?? '',
      totnum: sorted.length,
      cancel: 0,
      net_issue: sorted.length,
    },
  ];
}

function buildDocIssue(invoices: Gstr1Invoice[], notes: Gstr1Invoice[]): DocDet[] {
  const det: DocDet[] = [];
  const invDocs = docRange(1, invoices.map((i) => i.invoice_no)); // 1 = Invoices for outward supply
  const cnDocs = docRange(5, notes.map((n) => n.invoice_no)); // 5 = Credit note
  if (invDocs.length) det.push({ doc_num: 1, docs: invDocs });
  if (cnDocs.length) det.push({ doc_num: 5, docs: cnDocs });
  return det;
}

/* ────────────────────────────── assemble ─────────────────────────────── */

/**
 * Build the full GSTR-1 return object for one tax period.
 *
 * @param company  supplier GSTIN + home state code
 * @param rows     all non-draft / non-cancelled invoices in the period
 * @param fp       filing period as 'MMYYYY' (e.g. '052026')
 */
export function buildGstr1(
  company: Gstr1Company,
  rows: Gstr1Invoice[],
  fp: string,
): Gstr1Return {
  const invoices = rows.filter((r) => INVOICE_DOC_TYPES.has(r.doc_type));
  const notes = rows.filter((r) => r.doc_type === 'credit_note');

  const b2bInv = invoices.filter((i) => isValidGstin(i.party_gstin));
  const unreg = invoices.filter((i) => !isValidGstin(i.party_gstin));
  const b2clInv = unreg.filter((i) => interstateOf(i) && num(i.total) > B2CL_THRESHOLD);
  const b2csInv = unreg.filter((i) => !(interstateOf(i) && num(i.total) > B2CL_THRESHOLD));

  const cdnrNotes = notes.filter((n) => isValidGstin(n.party_gstin));
  const cdnurNotes = notes.filter((n) => !isValidGstin(n.party_gstin));

  const out: Gstr1Return = {
    gstin: company.gstin.trim().toUpperCase(),
    fp,
    version: 'GST3.2.0',
    hash: 'hash',
  };

  const b2b = buildB2b(b2bInv);
  const b2cl = buildB2cl(b2clInv);
  const b2cs = buildB2cs(b2csInv);
  const cdnr = buildCdnr(cdnrNotes);
  const cdnur = buildCdnur(cdnurNotes);
  const hsn = buildHsn(invoices, notes);
  const docDet = buildDocIssue(invoices, notes);

  if (b2b.length) out.b2b = b2b;
  if (b2cl.length) out.b2cl = b2cl;
  if (b2cs.length) out.b2cs = b2cs;
  if (cdnr.length) out.cdnr = cdnr;
  if (cdnur.length) out.cdnur = cdnur;
  if (hsn.length) out.hsn = { data: hsn };
  if (docDet.length) out.doc_issue = { doc_det: docDet };

  return out;
}

/** Small per-section counts for the on-screen preview. */
export interface Gstr1Summary {
  b2b: number;
  b2cl: number;
  b2cs: number;
  cdnr: number;
  cdnur: number;
  hsn: number;
  totalTaxable: number;
  totalTax: number;
}

export function summarise(ret: Gstr1Return): Gstr1Summary {
  const sumItms = (itms: Itm[]): { tx: number; tax: number } =>
    itms.reduce(
      (a, it) => ({
        tx: a.tx + it.itm_det.txval,
        tax: a.tax + it.itm_det.iamt + it.itm_det.camt + it.itm_det.samt,
      }),
      { tx: 0, tax: 0 },
    );

  let totalTaxable = 0;
  let totalTax = 0;
  for (const g of ret.b2b ?? [])
    for (const inv of g.inv) {
      const s = sumItms(inv.itms);
      totalTaxable += s.tx;
      totalTax += s.tax;
    }
  for (const g of ret.b2cl ?? [])
    for (const inv of g.inv) {
      const s = sumItms(inv.itms);
      totalTaxable += s.tx;
      totalTax += s.tax;
    }
  for (const e of ret.b2cs ?? []) {
    totalTaxable += e.txval;
    totalTax += e.iamt + e.camt + e.samt;
  }

  return {
    b2b: ret.b2b?.length ?? 0,
    b2cl: ret.b2cl?.length ?? 0,
    b2cs: ret.b2cs?.length ?? 0,
    cdnr: ret.cdnr?.length ?? 0,
    cdnur: ret.cdnur?.length ?? 0,
    hsn: ret.hsn?.data.length ?? 0,
    totalTaxable: r2(totalTaxable),
    totalTax: r2(totalTax),
  };
}

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
