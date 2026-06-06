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
import { COMPANY } from '@/lib/company';
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
  tax_invoice:     { title: 'Tax Invoice',     accent: '#3730a3', accentSoft: '#eef2ff', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  jobwork_invoice: { title: 'Jobwork Bill',    accent: '#0f766e', accentSoft: '#ccfbf1', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  yarn_sale:       { title: 'Yarn Sale Invoice', accent: '#b45309', accentSoft: '#fef3c7', totalLabel: 'Total due',       partyLabel: 'Bill to'   },
  general_sale:    { title: 'Service Invoice', accent: '#475569', accentSoft: '#f1f5f9', totalLabel: 'Total due',         partyLabel: 'Bill to'   },
  credit_note:     { title: 'Credit Note',     accent: '#be123c', accentSoft: '#ffe4e6', totalLabel: 'Amount refundable', partyLabel: 'Refund to' },
  debit_note:      { title: 'Debit Note',      accent: '#6d28d9', accentSoft: '#ede9fe', totalLabel: 'Amount payable',    partyLabel: 'Bill from' },
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
  is_interstate: boolean;
  party_name: string | null;
  party_gstin: string | null;
  party_state: string | null;
  place_of_supply: string | null;
  original_invoice_id: number | null;
  customer: { id: number; name: string; gstin: string | null; state: string | null; billing_address: string | null } | null;
  vendor: { id: number; name: string } | null;
  jobwork_party: { id: number; name: string; gstin: string | null; state: string | null; billing_address: string | null } | null;
  original: { invoice_no: string; invoice_date: string } | null;
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

  const [hdrRes, lineRes, dcRes] = await Promise.all([
    sb.from('invoice')
      .select(`
        id, invoice_no, doc_type, invoice_date, due_date, status, notes,
        subtotal, gst_amount, total, taxable_value, cgst_amount, sgst_amount, igst_amount, round_off,
        is_interstate, party_name, party_gstin, party_state, place_of_supply,
        original_invoice_id,
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

  const inv = hdrRes.data as InvoiceRow | null;
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
        @page { size: A4; margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          .inv-sheet { box-shadow: none !important; border: none !important; }
          /* Force a fresh A4 page between ORIGINAL and DUPLICATE copies */
          .inv-sheet + .inv-sheet { page-break-before: always; }
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
          /* Bumped again: body 13px → 14px for easier reading from a
             distance. Weight stays 600. */
          font-size: 14px;
          font-weight: 600;
          line-height: 1.5;
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
        /* DC-style header: centered title band + meta strip + bill/ship grid */
        .inv-title { text-align: center; font-size: 21px; font-weight: 800; letter-spacing: 2px; color: #000; padding-top: 4px; }
        .inv-orig  { text-align: center; font-size: 13px; font-weight: 800; letter-spacing: 4px; color: #333; margin-top: 2px; margin-bottom: 8px; }
        .inv-meta  { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #000; }
        .inv-meta > div { padding: 7px 8px; border-right: 1px solid #000; font-size: 13px; font-weight: 600; }
        .inv-meta > div:last-child { border-right: none; }
        .inv-meta .lbl { font-size: 10px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
        .inv-meta .val { font-weight: 800; color: #000; font-size: 14px; }
        /* The old black "BILL TO :" header bar was redundant — each box
           already shows its own label inside (.tag). The bar is now an
           empty spacer: same height/border-rule but no fill, no text. */
        .inv-secbar { background: transparent; color: transparent; padding: 0; height: 6px; margin-top: 10px; }
        .inv-billship { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; }
        .inv-billship > div { padding: 8px 10px; border-right: 1px solid #000; }
        .inv-billship > div:last-child { border-right: none; }
        .inv-billship .tag { font-size: 12px; font-weight: 800; color: #000; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
        .inv-billship .gst { font-size: 13px; font-weight: 600; color: #111; }
        .inv-billship .party { font-size: 15px; font-weight: 800; color: #000; margin-top: 2px; }
        .inv-billship .addr { font-size: 13px; font-weight: 600; color: #222; white-space: pre-line; line-height: 1.5; margin-top: 2px; }
        .inv-billship .ps { font-size: 12px; font-weight: 600; color: #333; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #aaa; }
        .inv-tag { display: inline-block; font-size: 12px; padding: 2px 10px; border-radius: 999px; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 700; }
        .inv-lab { font-size: 10px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px; }
        .refstrip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; background: #f7f7f9; padding: 9px 10px; border-radius: 4px; margin-top: 12px; }
        .refstrip .lbl { font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 1px; }
        .refstrip .val { font-size: 13px; font-weight: 700; color: #000; }
        table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
        table.items th { font-size: 12px; font-weight: 800; color: #333; text-transform: uppercase; letter-spacing: 1px; text-align: left; padding: 8px 6px; border-bottom: 0.5px solid #888; }
        table.items td { font-size: 14px; font-weight: 600; padding: 8px 6px; border-bottom: 0.5px solid #ccc; vertical-align: top; color: #111; }
        table.items td.num, table.items th.num { text-align: right; }
        table.items tfoot td { font-weight: 800; color: #000; border-top: 1px solid #333; border-bottom: none; padding-top: 8px; }
        .totals-grid { display: grid; grid-template-columns: 1fr 240px; gap: 14px; margin-top: 14px; }
        .totals-left { font-size: 13px; font-weight: 600; color: #222; }
        .totals-left .h { font-size: 12px; color: #000; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
        .totals-right table { width: 100%; font-size: 14px; font-weight: 600; }
        .totals-right td { padding: 5px 0; }
        .totals-right td.v { text-align: right; font-weight: 700; color: #000; }
        .totals-right tr.grand td { font-size: 19px; font-weight: 900; color: #000; padding-top: 8px; border-top: 1px solid #333; }
        .words { margin-top: 10px; padding: 9px 10px; background: #fafafa; border-left: 3px solid; font-size: 13px; font-weight: 700; font-style: italic; color: #222; }
        .foot-strip { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; padding-top: 10px; border-top: 0.5px solid #e5e5e5; font-size: 13px; font-weight: 600; color: #222; }
        .sig-block { text-align: right; padding-top: 32px; font-weight: 800; color: #000; font-size: 14px; }
        .addr-foot { margin-top: 14px; padding-top: 8px; border-top: 0.5px solid #e5e5e5; text-align: center; font-size: 12px; font-weight: 600; color: #333; line-height: 1.5; }
        .ref-original { margin-top: 6px; font-size: 10px; color: #555; }
        .ref-original b { color: #111; }
        .inv-watermark { position: relative; }
        .inv-status-draft::before { content: 'DRAFT'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 110px; color: rgba(148, 163, 184, 0.16); font-weight: 900; letter-spacing: 14px; pointer-events: none; transform: rotate(-30deg); }
        .inv-status-cancelled::before { content: 'CANCELLED'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 90px; color: rgba(220, 38, 38, 0.18); font-weight: 900; letter-spacing: 10px; pointer-events: none; transform: rotate(-30deg); }
      `}</style>

      <InvoicePrintActions invoiceId={inv.id} invoiceNo={inv.invoice_no} />

      {/* Every invoice prints in two identical copies: one ORIGINAL for the
          buyer, one DUPLICATE for our records. We render the same sheet
          markup twice and the CSS rule `.inv-sheet + .inv-sheet` forces a
          page-break between them when printed. */}
      {(['ORIGINAL', 'DUPLICATE'] as const).map((copyLabel) => (
      <div
        key={copyLabel}
        className={'inv-sheet inv-watermark ' +
          (inv.status === 'draft' ? 'inv-status-draft' : inv.status === 'cancelled' ? 'inv-status-cancelled' : '')}
      >
        {/* ───── Header band: logo + company name + doc title (DC-style) ───── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <BrandLogo variant="mark" height={56} />
          <div style={{ flex: 1 }}>
            <div className="inv-title">{COMPANY.name} &nbsp; {style.title.toUpperCase()}</div>
            <div style={{ textAlign: 'center', fontSize: 10, color: '#555', marginTop: 2 }}>
              {COMPANY.address}
            </div>
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
            <div className="addr">{partyAddress || ''}</div>
            <div className="ps">
              PLACE OF SUPPLY : {inv.place_of_supply || partyState || '-'} &nbsp;&middot;&nbsp; {isInterstate ? 'INTERSTATE (IGST)' : 'INTRASTATE (CGST + SGST)'}
            </div>
          </div>
          <div>
            <div className="tag">SHIP TO</div>
            <div className="gst">GSTIN : {partyGstin || '-'}</div>
            <div className="party">{partyName || '-'}</div>
            <div className="addr">{partyAddress || ''}</div>
            <div className="ps">
              PLACE OF SUPPLY : {inv.place_of_supply || partyState || '-'}
            </div>
          </div>
        </div>

        {/* ───── Original invoice reference (credit / debit notes) ───── */}
        {(inv.doc_type === 'credit_note' || inv.doc_type === 'debit_note') && inv.original && (
          <div className="ref-original">
            Issued against <b>{inv.original.invoice_no}</b> dated <b>{fmtDate(inv.original.invoice_date)}</b>.
          </div>
        )}

        {/* ───── Reference strip ───── */}
        <div className="refstrip">
          <div><div className="lbl">Date</div><div className="val">{fmtDate(inv.invoice_date)}</div></div>
          <div><div className="lbl">Due</div><div className="val">{fmtDate(inv.due_date)}</div></div>
          <div><div className="lbl">Status</div><div className="val" style={{ textTransform: 'capitalize' }}>{inv.status.replace('_', ' ')}</div></div>
          <div><div className="lbl">Rev. chg</div><div className="val">No</div></div>
          <div><div className="lbl">Ship mode</div><div className="val">Road</div></div>
          <div><div className="lbl">DCs</div><div className="val">{linkedDcs.length > 0 ? linkedDcs.length : '-'}</div></div>
        </div>

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

        {/* ───── Linked DC numbers (just the codes, comma-separated) ───── */}
        {linkedDcs.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 10, color: '#555' }}>
            <span className="inv-lab" style={{ display: 'inline', marginRight: 6 }}>DC No:</span>
            <span style={{ fontFamily: 'monospace', color: '#111', fontSize: 11 }}>
              {linkedDcs.map((d) => d.code).join(',  ')}
            </span>
          </div>
        )}

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
