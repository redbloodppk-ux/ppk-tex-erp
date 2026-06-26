/**
 * Invoice print preview (A4). Single template that adapts its title +
 * accent + extras based on the invoice's doc_type:
 *
 *   tax_invoice      -> TAX INVOICE         (indigo accent)
 *   jobwork_invoice  -> JOBWORK BILL        (teal accent, lists linked DCs)
 *   yarn_sale        -> YARN SALE INVOICE   (amber accent)
 *   general_sale     -> SERVICE INVOICE     (slate accent)
 *   credit_note      -> CREDIT NOTE         (rose accent, refs original)
 *   debit_note       -> DEBIT NOTE          (violet accent, refs original)
 *
 * Layout follows the "Modern minimal" mock the user picked - whitespace,
 * hairline rules, sans-serif. Logo top-left, doc tag top-right, party
 * blocks side-by-side, reference strip, items table with HSN + qty +
 * rate + amount, tax-summary on the right with grand total, bank +
 * amount-in-words at the bottom, declaration + signature row.
 *
 * App shell (sidebar/topbar) is bypassed by AppShell's /print check, so
 * what you see is what the printer gets.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BrandLogo } from '@/app/components/brand-logo';
import { InvoicePrintActions } from './print-actions';
import { loadCompany } from '@/lib/load-company';
import { rupeesInWords } from '@/lib/rupees-in-words';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `Invoice ${id} - Print` };
}

// ────────────────────────────────────────────────────────────────────────
// Doc-type registry: title, accent colour, optional extras.
// ────────────────────────────────────────────────────────────────────────

type DocType =
  | 'tax_invoice'
  | 'jobwork_invoice'
  | 'weaving_bill'
  | 'yarn_sale'
  | 'general_sale'
  | 'credit_note'
  | 'debit_note';

interface DocStyle {
  title: string;
  accent: string;       // hex used for the top-right tag, label colour
  accentSoft: string;   // background for the tag pill
  totalLabel: string;   // grand-total label
  partyLabel: string;   // "Bill to" vs "Bill from"
}

const DOC_STYLES: Record<DocType, DocStyle> = {
  tax_invoice:     { title: 'Tax Invoice',              accent: '#3730a3', accentSoft: '#eef2ff', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  jobwork_invoice: { title: 'Job Work / Weaver Bill',   accent: '#0f766e', accentSoft: '#ccfbf1', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  // weaving_bill (WB prefix) — outsource weaving flow. Same printed
  // title as jobwork_invoice so customer-facing copies of both bill
  // types read identically; the doc-type underneath stays distinct.
  weaving_bill:    { title: 'Job Work / Weaver Bill',   accent: '#0f766e', accentSoft: '#ccfbf1', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  yarn_sale:       { title: 'Yarn Sale Invoice',        accent: '#b45309', accentSoft: '#fef3c7', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  general_sale:    { title: 'Service Invoice',          accent: '#475569', accentSoft: '#f1f5f9', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  credit_note:     { title: 'Credit Note',              accent: '#be123c', accentSoft: '#ffe4e6', totalLabel: 'Amount refundable', partyLabel: 'Refund to' },
  debit_note:      { title: 'Debit Note',               accent: '#6d28d9', accentSoft: '#ede9fe', totalLabel: 'Amount payable',    partyLabel: 'Bill from' },
};

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: number;
  invoice_no: string;
  doc_type: DocType;
  invoice_date: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  subtotal: number | string;
  gst_amount: number | string;
  total: number | string;
  taxable_value: number | string;
  cgst_amount: number | string;
  sgst_amount: number | string;
  igst_amount: number | string;
  round_off: number | string;
  extra_charge: number | string;
  is_interstate: boolean;
  party_name: string | null;
  party_gstin: string | null;
  party_state: string | null;
  place_of_supply: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_gstin: string | null;
  ship_to_state: string | null;
  ewaybill_no: string | null;
  ewaybill_date: string | null;
  ewaybill_valid_till: string | null;
  vehicle_no: string | null;
  original_invoice_id: number | null;
  supplier_bill_no: string | null;
  supplier_bill_date: string | null;
  customer: { id: number; name: string; gstin: string | null; state: string | null; billing_address: string | null } | null;
  vendor: { id: number; name: string } | null;
  jobwork_party: { id: number; name: string; gstin: string | null; state: string | null; billing_address: string | null } | null;
  original: { invoice_no: string; invoice_date: string } | null;
}

/** A single bill referenced by the credit-note's synthetic payment
 *  allocations — could be an existing invoice or a pre-ERP opening
 *  receivable. Used to populate the "Issued against" line on the
 *  printed credit note. */
interface ReferencedBill {
  invoice_no: string;
  invoice_date: string | null;
}

interface InvoiceLine {
  id: number;
  description: string;
  quantity: number | string;
  rate: number | string;
  hsn_sac: string | null;
  uom: string;
  taxable_amount: number | string;
  cgst_amount: number | string;
  sgst_amount: number | string;
  igst_amount: number | string;
  total_amount: number | string;
  gst_rate_pct: number | string;
}

interface LinkedDc {
  code: string;
  dc_date: string;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1] ?? '???'} ${y}`;
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v: unknown): string {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Whole-rupee formatter for the grand total on the printed bill —
// matches the form's display and the rounded `total` saved on the
// invoice row.
function fmtRupees(v: unknown): string {
  return Math.round(num(v)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const companyP = loadCompany();
  const [hdrRes, lineRes, dcRes] = await Promise.all([
    sb.from('invoice')
      .select(`
        id, invoice_no, doc_type, invoice_date, due_date, status, notes,
        ship_to_name, ship_to_address, ship_to_gstin, ship_to_state,
        subtotal, gst_amount, total, taxable_value, cgst_amount, sgst_amount, igst_amount, round_off, extra_charge,
        is_interstate, party_name, party_gstin, party_state, place_of_supply,
        ewaybill_no, ewaybill_date, ewaybill_valid_till, vehicle_no,
        original_invoice_id, supplier_bill_no, supplier_bill_date,
        customer:customer_id ( id, name, gstin, state, billing_address ),
        vendor:ledger_id ( id, name ),
        jobwork_party:jobwork_party_id ( id, name, gstin, state, billing_address ),
        original:original_invoice_id ( invoice_no, invoice_date )
      `)
      .eq('id', numericId)
      .maybeSingle(),
    sb.from('invoice_line')
      .select('id, description, quantity, rate, hsn_sac, uom, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, gst_rate_pct')
      .eq('invoice_id', numericId)
      .order('id'),
    sb.from('delivery_challan')
      .select('code, dc_date, total_metres, total_pieces, total_bundles')
      .eq('invoice_id', numericId)
      .order('dc_date'),
  ]);

  const COMPANY = await companyP;
  const inv = hdrRes.data as InvoiceRow | null;

  // For a credit note: pull every bill its synthetic payment is
  // allocated against, so the printed "Issued against" line can
  // list ALL of them (not just original_invoice_id). The synthetic
  // payment has mode='credit_note' and invoice_id = this credit
  // note's id.
  let referencedBills: ReferencedBill[] = [];
  if (inv?.doc_type === 'credit_note') {
    const { data: pmt } = await sb
      .from('payment')
      .select('id')
      .eq('invoice_id', numericId)
      .eq('mode', 'credit_note')
      .maybeSingle();
    const pmtId = pmt?.id as number | undefined;
    if (pmtId !== undefined) {
      const [invAllocRes, openAllocRes] = await Promise.all([
        sb.from('payment_allocation')
          .select('invoice:invoice_id ( invoice_no, invoice_date )')
          .eq('payment_id', pmtId),
        sb.from('payment_opening_allocation')
          .select('opening:opening_ledger_id ( invoice_no, invoice_date )')
          .eq('payment_id', pmtId),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of ((invAllocRes.data ?? []) as any[])) {
        if (r.invoice?.invoice_no) {
          referencedBills.push({
            invoice_no:   r.invoice.invoice_no,
            invoice_date: r.invoice.invoice_date ?? null,
          });
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of ((openAllocRes.data ?? []) as any[])) {
        if (r.opening?.invoice_no) {
          referencedBills.push({
            invoice_no:   r.opening.invoice_no,
            invoice_date: r.opening.invoice_date ?? null,
          });
        }
      }
    }
    // De-duplicate by invoice_no in case the same bill appears twice.
    const seen = new Set<string>();
    referencedBills = referencedBills.filter((b) => {
      if (seen.has(b.invoice_no)) return false;
      seen.add(b.invoice_no);
      return true;
    });
    // Fallback to original_invoice_id if no allocations (legacy rows).
    if (referencedBills.length === 0 && inv.original?.invoice_no) {
      referencedBills.push({
        invoice_no:   inv.original.invoice_no,
        invoice_date: inv.original.invoice_date,
      });
    }
  }
  if (!inv) notFound();

  const lines = (lineRes.data ?? []) as InvoiceLine[];
  const linkedDcs = (dcRes.data ?? []) as LinkedDc[];

  const style = DOC_STYLES[inv.doc_type] ?? DOC_STYLES.tax_invoice;

  // Resolve the party block. The unified party table (jobwork_party_id)
  // is preferred for jobwork bills; customer for regular sales; ledger
  // for debit notes; snapshot fields as the final fallback.
  const partyName = inv.jobwork_party?.name
    ?? inv.customer?.name
    ?? inv.vendor?.name
    ?? inv.party_name
    ?? '';
  const partyGstin = inv.jobwork_party?.gstin ?? inv.customer?.gstin ?? inv.party_gstin ?? '';
  const partyState = inv.jobwork_party?.state ?? inv.customer?.state ?? inv.party_state ?? '';
  const partyAddress = inv.jobwork_party?.billing_address ?? inv.customer?.billing_address ?? '';

  const isInterstate = inv.is_interstate;
  const grand = num(inv.total);

  return (
    <>
      <style>{`
        /* Multi-page print: fixed slim header + fixed footer repeat on
           every printed page, even when a long invoice spills onto a
           second sheet. The @page bottom-center margin box injects the
           "Page N of M" counter. On-screen the fixed elements are
           hidden so the live preview stays clean. */
        @page {
          size: A4;
          margin: 28mm 14mm 26mm 14mm;
          @bottom-center {
            content: "Page " counter(page) " of " counter(pages);
            font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif;
            font-size: 12px;
            font-weight: 700;
            color: #222;
          }
        }
        /* Hide the print-only header/footer on screen. */
        .inv-print-header, .inv-print-footer { display: none; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          /* Critical: keep .inv-sheet full-printable-page tall so the
             flex column stretches and 'margin-top:auto' on .foot-strip
             pushes signatures + address footer to the page bottom.
             Without min-height:100vh the column collapses to content
             size and the printout looks "shrunken" vs preview. */
          /* Printable area = page (100vh) minus the @page top+bottom
             margins (28mm + 26mm). Using the full 100vh forced the sheet
             ~54mm taller than the printable area, spilling the footer to
             a 2nd page. Subtract the margins (+2mm slack) so a normal
             invoice fits one page; long invoices still grow and spill. */
          .inv-sheet { box-shadow: none !important; border: none !important; padding: 0 !important; min-height: calc(100vh - 56mm) !important; margin: 0 !important; width: auto !important; display: flex !important; flex-direction: column !important; }
          /* Fresh A4 page between ORIGINAL and DUPLICATE copies. */
          .inv-sheet + .inv-sheet { page-break-before: always; }
          .inv-print-header {
            display: flex !important;
            position: fixed;
            top: 0; left: 14mm; right: 14mm;
            height: 20mm;
            align-items: center;
            justify-content: space-between;
            padding: 4mm 0;
            border-bottom: 1px solid #000;
            font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif;
            font-size: 12px;
            font-weight: 700;
            color: #111;
            background: #fff;
          }
          .inv-print-header .ph-title { font-size: 16px; font-weight: 800; letter-spacing: 0.6px; }
          .inv-print-header .ph-meta  { text-align: right; font-size: 13px; font-weight: 700; line-height: 1.35; color: #222; }
          .inv-print-header .ph-meta b { color: #000; font-weight: 800; }
          .inv-print-footer {
            display: block !important;
            position: fixed;
            bottom: 0; left: 14mm; right: 14mm;
            padding: 3mm 0 2mm 0;
            border-top: 1px solid #000;
            text-align: center;
            font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.5;
            color: #111;
            background: #fff;
          }
          .inv-print-footer .pf-small { font-weight: 600; font-size: 12px; color: #222; }
          /* Avoid splitting the line-items table across pages if Chrome
             can fit it on one. Header repeats on each spilled page. */
          table.items thead { display: table-header-group; }
          table.items tfoot { display: table-footer-group; }
          /* The on-page address footer is redundant with the fixed
             footer — hide it during print so it doesn't double-print. */
          .addr-foot { display: none !important; }
        }
        body { background: #f3f4f6; }
        .inv-sheet {
          width: 210mm;
          min-height: 297mm;
          margin: 16px auto;
          background: #fff;
          color: #111;
          padding: 12mm 14mm;
          box-sizing: border-box;
          font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif;
          /* Bumped further for printed legibility: base 16px / weight
             600. Most child elements scaled proportionally below. */
          font-size: 14px;
          font-weight: 600;
          line-height: 1.55;
          border: 1px solid #d4d4d4;
          box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          /* Flex column so the declaration + signature + address footer
             can be pushed to the bottom of the A4 sheet with margin-top:
             auto. Without this, short invoices leave a big empty gap
             between totals and the footer instead of pushing it down. */
          display: flex;
          flex-direction: column;
        }
        /* Push declaration + signature + address footer to the bottom
           of the sheet. The auto-margin on .foot-strip consumes the
           leftover vertical space so everything above stays where it is. */
        .inv-sheet .foot-strip { margin-top: auto; }
        /* Page scale per document type. Regular invoices print at 92%
           (one step smaller); Job Work / Weaver bills keep their own
           90% compact scale (the override REPLACES the base zoom, it
           does not stack). */
        .inv-sheet { zoom: 0.92; }
        .inv-sheet.inv-compact { zoom: 0.9; }
        /* DC-style header: centered title band + meta strip + bill/ship grid */
        .inv-title { text-align: left; font-size: 34px; font-weight: 900; letter-spacing: 1px; color: #000; padding-top: 2px; line-height: 1.1; }
        .inv-doc-label { text-align: right; font-size: 20px; font-weight: 800; letter-spacing: 3px; color: #1f2937; border: 1.5px solid #1f2937; padding: 6px 14px; border-radius: 4px; white-space: nowrap; }
        /* Credit / debit note variants: tinted background so the
           operator can't miss that this isn't a regular tax invoice. */
        .inv-doc-label-cn { color: #9f1239; border-color: #9f1239; background: #fff1f2; }
        .inv-doc-label-dn { color: #92400e; border-color: #92400e; background: #fffbeb; }
        .inv-orig  { text-align: center; font-size: 14px; font-weight: 800; letter-spacing: 4px; color: #333; margin-top: 3px; margin-bottom: 9px; }
        .inv-meta  { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #000; }
        .inv-meta > div { padding: 8px 10px; border-right: 1px solid #000; font-size: 14px; font-weight: 600; }
        .inv-meta > div:last-child { border-right: none; }
        .inv-meta .lbl { font-size: 11px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px; }
        .inv-meta .val { font-weight: 800; color: #000; font-size: 15px; }
        /* The old black "BILL TO :" header bar was redundant — each box
           already shows its own label inside (.tag). The bar is now an
           empty spacer: same height/border-rule but no fill, no text. */
        .inv-secbar { background: transparent; color: transparent; padding: 0; height: 6px; margin-top: 10px; }
        .inv-billship { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; }
        .inv-billship > div { padding: 8px 10px; border-right: 1px solid #000; }
        .inv-billship > div:last-child { border-right: none; }
        .inv-billship .tag { font-size: 13px; font-weight: 800; color: #000; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px; }
        .inv-billship .gst { font-size: 14px; font-weight: 600; color: #111; }
        .inv-billship .party { font-size: 16px; font-weight: 800; color: #000; margin-top: 3px; }
        .inv-billship .addr { font-size: 14px; font-weight: 600; color: #222; white-space: pre-line; line-height: 1.55; margin-top: 3px; }
        .inv-billship .ps { font-size: 13px; font-weight: 600; color: #333; margin-top: 5px; padding-top: 4px; border-top: 1px dashed #aaa; }
        .inv-tag { display: inline-block; font-size: 13px; padding: 2px 10px; border-radius: 999px; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 700; }
        .inv-lab { font-size: 11px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px; }
        .refstrip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; background: #f7f7f9; padding: 10px 11px; border-radius: 4px; margin-top: 13px; }
        .refstrip .lbl { font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 1px; }
        .refstrip .val { font-size: 14px; font-weight: 700; color: #000; }
        table.items { width: 100%; border-collapse: collapse; margin-top: 15px; }
        table.items th { font-size: 13px; font-weight: 800; color: #333; text-transform: uppercase; letter-spacing: 1px; text-align: left; padding: 9px 7px; border-bottom: 0.5px solid #888; }
        table.items td { font-size: 14px; font-weight: 600; padding: 9px 7px; border-bottom: 0.5px solid #ccc; vertical-align: top; color: #111; }
        table.items td.num, table.items th.num { text-align: right; }
        table.items tfoot td { font-weight: 800; color: #000; border-top: 1px solid #333; border-bottom: none; padding-top: 9px; font-size: 15px; }
        .totals-grid { display: grid; grid-template-columns: 1fr 240px; gap: 15px; margin-top: 15px; }
        .totals-left { font-size: 14px; font-weight: 600; color: #222; }
        .totals-left .h { font-size: 13px; color: #000; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
        .totals-right table { width: 100%; font-size: 14px; font-weight: 600; }
        .totals-right td { padding: 6px 0; }
        .totals-right td.v { text-align: right; font-weight: 700; color: #000; }
        .totals-right tr.grand td { font-size: 20px; font-weight: 900; color: #000; padding-top: 9px; border-top: 1px solid #333; }
        .words { margin-top: 11px; padding: 10px 12px; background: #fafafa; border-left: 3px solid; font-size: 14px; font-weight: 700; font-style: italic; color: #222; }
        .foot-strip { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; padding-top: 10px; border-top: 0.5px solid #e5e5e5; font-size: 14px; font-weight: 600; color: #222; }
        .sig-block { text-align: right; padding-top: 32px; font-weight: 800; color: #000; font-size: 14px; }
        .addr-foot { margin-top: 14px; padding-top: 8px; border-top: 0.5px solid #e5e5e5; text-align: center; font-size: 13px; font-weight: 600; color: #333; line-height: 1.55; }
        /* "Issued against …" banner on credit/debit notes.
           Bigger, darker, with a soft amber background so the
           operator can spot which invoices the note covers at a
           glance from across the room. */
        .ref-original {
          margin-top: 10px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 600;
          color: #1f2937;
          background: #fffbeb;
          border-left: 3px solid #f59e0b;
          border-radius: 4px;
          line-height: 1.55;
        }
        .ref-original b { color: #b45309; }
        .inv-watermark { position: relative; }
        .inv-status-draft::before { content: 'DRAFT'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 101px; color: rgba(148, 163, 184, 0.16); font-weight: 900; letter-spacing: 14px; pointer-events: none; transform: rotate(-30deg); }
        .inv-status-cancelled::before { content: 'CANCELLED'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 83px; color: rgba(220, 38, 38, 0.18); font-weight: 900; letter-spacing: 10px; pointer-events: none; transform: rotate(-30deg); }
      `}</style>

      <InvoicePrintActions invoiceId={inv.id} invoiceNo={inv.invoice_no} partyName={partyName} invoiceDate={inv.invoice_date} />

      {/* Fixed print-only header — repeats on every printed page.
          Hidden on screen by CSS. */}
      <div className="inv-print-header">
        <div className="ph-title">
          {COMPANY.name} &nbsp;&middot;&nbsp; {
            inv.doc_type === 'credit_note' ? 'CREDIT NOTE'
              : inv.doc_type === 'debit_note' ? 'DEBIT NOTE'
              : 'TAX INVOICE'
          }
        </div>
        <div className="ph-meta">
          <div>Invoice # <b>{inv.invoice_no}</b></div>
          <div>Date: <b>{fmtDate(inv.invoice_date)}</b></div>
        </div>
      </div>

      {/* Fixed print-only footer — company address + contact line.
          The "Page X of Y" counter is injected by the @page rule's
          @bottom-center margin box, so it sits just below this band. */}
      <div className="inv-print-footer">
        <div>{COMPANY.address}</div>
        <div className="pf-small">
          GSTIN: {COMPANY.gstin} &nbsp;&middot;&nbsp; MOB: {COMPANY.phones.join(' \u00b7  MOB: ')} &nbsp;&middot;&nbsp; E-mail: {COMPANY.email}
        </div>
      </div>

      {/* Every invoice prints in two identical copies: one ORIGINAL for the
          buyer, one DUPLICATE for our records. We render the same sheet
          markup twice and the CSS rule `.inv-sheet + .inv-sheet` forces a
          page-break between them when printed. */}
      {(['ORIGINAL', 'DUPLICATE'] as const).map((copyLabel) => (
      <div
        key={copyLabel}
        className={'inv-sheet inv-watermark ' +
          (inv.doc_type === 'jobwork_invoice' || inv.doc_type === 'weaving_bill' ? 'inv-compact ' : '') +
          (inv.status === 'draft' ? 'inv-status-draft' : inv.status === 'cancelled' ? 'inv-status-cancelled' : '')}
      >
        {/* ───── Header band: logo + company name (left), TAX INVOICE
                label (right). Address line removed per operator's
                redesign brief — it lives in the printed footer band
                instead. Doc title is hard-coded to "TAX INVOICE" so
                every variant (sale, credit note, jobwork, weaving,
                etc.) shares the same recognisable header; the bill-to
                strip + reference banner downstream still convey the
                specific doc type. ───── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
          <BrandLogo variant="mark" height={64} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="inv-title">{COMPANY.name}</div>
          </div>
          {/* Doc label: TAX INVOICE for every sale-side document so
              the header looks consistent; CREDIT NOTE / DEBIT NOTE
              shown explicitly because they're legally distinct
              documents and the operator needs to see at a glance. */}
          <div className={'inv-doc-label' + (inv.doc_type === 'credit_note' ? ' inv-doc-label-cn' : inv.doc_type === 'debit_note' ? ' inv-doc-label-dn' : '')}>
            {inv.doc_type === 'credit_note' ? 'CREDIT NOTE'
              : inv.doc_type === 'debit_note' ? 'DEBIT NOTE'
              : 'TAX INVOICE'}
          </div>
        </div>

        <div className="inv-orig">{copyLabel} COPY</div>

        {/* ───── Meta strip ───── */}
        <div className="inv-meta">
          <div><div className="lbl">INVOICE DATE</div><div className="val">{fmtDate(inv.invoice_date)}</div></div>
          <div><div className="lbl">INVOICE #</div><div className="val">{inv.invoice_no}</div></div>
          <div><div className="lbl">GSTIN</div><div className="val">{COMPANY.gstin}</div></div>
          <div><div className="lbl">STATE / CODE</div><div className="val">{COMPANY.state} / {COMPANY.stateCode}</div></div>
        </div>

        {/* ───── E-way bill + Vehicle strip ─────
            Always rendered when either an e-way bill or a vehicle
            number is present. The vehicle column is always shown
            because migration 160 makes it mandatory on every new
            invoice (legacy invoices that pre-date the migration
            display "-"). */}
        {(inv.ewaybill_no || inv.vehicle_no) && (
          <div className="inv-meta">
            <div><div className="lbl">E-WAY BILL #</div><div className="val">{inv.ewaybill_no ?? '-'}</div></div>
            <div><div className="lbl">EWB DATE</div><div className="val">{inv.ewaybill_date ? fmtDate(inv.ewaybill_date) : '-'}</div></div>
            <div><div className="lbl">VEHICLE NO</div><div className="val">{inv.vehicle_no ?? '-'}</div></div>
            <div><div className="lbl">EWB VALID TILL</div><div className="val">{inv.ewaybill_valid_till ? fmtDate(inv.ewaybill_valid_till) : '-'}</div></div>
          </div>
        )}

        {/* ───── Bill To / Ship To (DC-style) ───── */}
        {/* The old solid-black "BILL TO :" header bar is now an empty
            spacer above the box. Each side of the box still shows its
            own .tag label ("BILL TO" / "SHIP TO") in plain black text. */}
        <div className="inv-secbar" aria-hidden="true"></div>
        <div className="inv-billship">
          <div>
            <div className="tag">{style.partyLabel.toUpperCase()}</div>
            <div className="gst">GSTIN : {partyGstin || '-'}</div>
            <div className="party">{partyName || '-'}</div>
            {/* whiteSpace: pre-line lets multi-line addresses (with \n
                or ', ') wrap properly instead of being truncated. */}
            <div className="addr" style={{ whiteSpace: 'pre-line' }}>{partyAddress || ''}</div>
            <div className="ps">
              PLACE OF SUPPLY : {inv.place_of_supply || partyState || '-'} &nbsp;&middot;&nbsp; {isInterstate ? 'INTERSTATE (IGST)' : 'INTRASTATE (CGST + SGST)'}
            </div>
          </div>
          {/* Ship-to: the consignee picked on the form, falling back to
              the bill-to party when no separate ship-to was set. */}
          <div>
            <div className="tag">SHIP TO</div>
            <div className="gst">GSTIN : {(inv.ship_to_name ? inv.ship_to_gstin : partyGstin) || '-'}</div>
            <div className="party">{inv.ship_to_name || partyName || '-'}</div>
            <div className="addr" style={{ whiteSpace: 'pre-line' }}>{inv.ship_to_name ? (inv.ship_to_address ?? '') : (partyAddress || '')}</div>
            <div className="ps">
              PLACE OF SUPPLY : {(inv.ship_to_name ? inv.ship_to_state : null) || inv.place_of_supply || partyState || '-'}
            </div>
          </div>
        </div>

        {/* ───── Reference strip / Issued-against banner ─────
            For sale invoices / jobwork / weaving / yarn / general:
            shows the standard Date/Due/Status/Rev-chg/Ship/DCs grid.
            For credit_note and debit_note: replaces that grid with
            a single highlighted line listing the original invoices
            (and party-bill-ref if captured), because Due/Ship/DCs
            don't apply to a balance-reducing document. */}
        {inv.doc_type === 'credit_note' || inv.doc_type === 'debit_note' ? (
          <div className="ref-original">
            {inv.doc_type === 'credit_note' && referencedBills.length > 0 && (
              <>
                Issued against{' '}
                {referencedBills.map((b, i) => (
                  <span key={`${b.invoice_no}-${i}`}>
                    {i > 0 ? ', ' : ''}
                    <b>{b.invoice_no}</b>
                    {b.invoice_date ? <> dated <b>{fmtDate(b.invoice_date)}</b></> : null}
                  </span>
                ))}
                .{inv.supplier_bill_no ? ' ' : ''}
              </>
            )}
            {inv.doc_type === 'debit_note' && inv.original && (
              <>Issued against <b>{inv.original.invoice_no}</b> dated <b>{fmtDate(inv.original.invoice_date)}</b>.{' '}</>
            )}
            {inv.supplier_bill_no && (
              <>
                {inv.doc_type === 'credit_note' ? 'Party debit note: ' : 'Supplier bill: '}
                <b>{inv.supplier_bill_no}</b>
                {inv.supplier_bill_date ? <> dated <b>{fmtDate(inv.supplier_bill_date)}</b></> : null}.
              </>
            )}
            {/* Edge case: no bills referenced and no party ref —
                still show the doc date so the strip isn't empty. */}
            {(inv.doc_type === 'credit_note' && referencedBills.length === 0 && !inv.supplier_bill_no) && (
              <>Credit note dated <b>{fmtDate(inv.invoice_date)}</b>.</>
            )}
            {(inv.doc_type === 'debit_note' && !inv.original && !inv.supplier_bill_no) && (
              <>Debit note dated <b>{fmtDate(inv.invoice_date)}</b>.</>
            )}
          </div>
        ) : (
          <div className="refstrip">
            <div><div className="lbl">Date</div><div className="val">{fmtDate(inv.invoice_date)}</div></div>
            <div><div className="lbl">Due</div><div className="val">{fmtDate(inv.due_date)}</div></div>
            <div><div className="lbl">Status</div><div className="val" style={{ textTransform: 'capitalize' }}>{inv.status.replace('_', ' ')}</div></div>
            <div><div className="lbl">Rev. chg</div><div className="val">No</div></div>
            <div><div className="lbl">Ship mode</div><div className="val">Road</div></div>
            <div><div className="lbl">DC No</div><div className="val">{linkedDcs.length > 0 ? linkedDcs.map((d) => d.code).join(', ') : '-'}</div></div>
          </div>
        )}

        {/* ───── Line items ───── */}
        <table className="items">
          <thead>
            <tr>
              <th style={{ width: '46%' }}>Description</th>
              <th>HSN</th>
              <th className="num">Quantity</th>
              <th className="num">Rate</th>
              <th className="num">Taxable</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888', padding: 18 }}>No line items.</td></tr>
            ) : lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{l.hsn_sac || '-'}</td>
                <td className="num">{fmtMoney(l.quantity)} {l.uom}</td>
                <td className="num">{fmtMoney(l.rate)}</td>
                <td className="num">{fmtMoney(l.taxable_amount)}</td>
                <td className="num">{fmtMoney(l.total_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Totals</td>
              <td className="num">{fmtMoney(inv.taxable_value)}</td>
              <td className="num">{fmtMoney(inv.total)}</td>
            </tr>
          </tfoot>
        </table>


        {/* ───── Totals grid: bank/notes on left, money on right ───── */}
        <div className="totals-grid">
          <div className="totals-left">
            <div className="h">Bank details</div>
            <div>{COMPANY.bank.name} &middot; A/C {COMPANY.bank.accountNo}</div>
            <div>IFSC {COMPANY.bank.ifsc} &middot; Branch {COMPANY.bank.branch}</div>
            <div style={{ marginTop: 8 }}>Make all cheques payable to {COMPANY.name}.</div>
            {inv.notes && (
              <div style={{ marginTop: 8 }}>
                <div className="h">Notes</div>
                <div style={{ whiteSpace: 'pre-line' }}>{inv.notes}</div>
              </div>
            )}
          </div>
          <div className="totals-right">
            <table>
              <tbody>
                <tr><td>Subtotal</td><td className="v">{fmtMoney(inv.taxable_value)}</td></tr>
                {isInterstate ? (
                  <tr><td>IGST</td><td className="v">{fmtMoney(inv.igst_amount)}</td></tr>
                ) : (
                  <>
                    <tr><td>CGST</td><td className="v">{fmtMoney(inv.cgst_amount)}</td></tr>
                    <tr><td>SGST</td><td className="v">{fmtMoney(inv.sgst_amount)}</td></tr>
                  </>
                )}
                <tr style={{ borderTop: '1px solid #ddd' }}>
                  <td>GST sub total</td>
                  <td className="v">{fmtMoney(num(inv.cgst_amount) + num(inv.sgst_amount) + num(inv.igst_amount))}</td>
                </tr>
                {num(inv.extra_charge) !== 0 && (
                  <tr><td>Other charges</td><td className="v">{fmtMoney(inv.extra_charge)}</td></tr>
                )}
                {num(inv.round_off) !== 0 && (
                  <tr><td>Round off</td><td className="v">{fmtMoney(inv.round_off)}</td></tr>
                )}
                <tr className="grand">
                  <td>{style.totalLabel}</td>
                  <td className="v" style={{ color: style.accent }}>&#8377; {fmtRupees(grand)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ───── Amount in words ───── */}
        <div className="words" style={{ borderLeftColor: style.accent }}>
          {rupeesInWords(grand)}
        </div>

        {/* ───── Declaration + signature ───── */}
        <div className="foot-strip">
          <div>
            <div className="inv-lab">Declaration</div>
            <div>{COMPANY.declaration}</div>
            <div style={{ marginTop: 6, fontStyle: 'italic', color: '#888' }}>This is a computer-generated invoice.</div>
          </div>
          <div className="sig-block">
            For {COMPANY.name}<br/>
            <span style={{ display: 'inline-block', marginTop: 28 }}>Authorised Signatory</span>
          </div>
        </div>

        {/* ───── Address footer ───── */}
        <div className="addr-foot">
          <div style={{ fontWeight: 600 }}>{COMPANY.address}</div>
          <div>
            MOB: {COMPANY.phones.join(' \u00b7 MOB: ')} &nbsp;&middot;&nbsp; E-mail: {COMPANY.email}
          </div>
        </div>
      </div>
      ))}
    </>
  );
}
