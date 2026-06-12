/**
 * Invoice detail + edit page.
 *
 * Header fields (date, due date, status, notes) are editable inline via
 * the EditInvoiceForm client component. Line items are listed read-only
 * - changing a billed invoice's lines means cancelling it and creating
 * a new one, which is the right paper-trail behaviour for an Indian GST
 * filing. From here the user can also delete the invoice.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { EditInvoiceForm } from './edit-invoice-form';
import { WhatsAppShareButton } from '@/app/components/whatsapp-share-button';
import { EwaybillCard } from './ewaybill-card';
import { DeleteInvoiceButton } from '../delete-invoice-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `Invoice ${id}` };
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

const DOC_LABEL: Record<string, string> = {
  tax_invoice:     'Fabric Sale',
  jobwork_invoice: 'Job Work / Weaver Bill',
  // weaving_bill (WB prefix) — outsource weaving flow. Same label as
  // jobwork_invoice so the operator sees one consistent name for both
  // bill types.
  weaving_bill:    'Job Work / Weaver Bill',
  yarn_sale:       'Yarn Sale',
  general_sale:    'General Sale',
  credit_note:     'Sales Return',
  debit_note:      'Purchase Return',
};

function fmtMoney(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Whole-rupee formatter for bill totals — matches the rounded
// `total` saved on the invoice row and the figure printed on the
// bill. Line-level numbers stay at 2 decimals for GST audit.
function fmtRupees(v: unknown): string {
  return Math.round(Number(v ?? 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

export default async function InvoiceDetailPage({
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
        id, invoice_no, doc_type, source_kind, invoice_date, due_date, notes, status,
        subtotal, gst_amount, total, amount_paid, balance,
        taxable_value, cgst_amount, sgst_amount, igst_amount, round_off, is_interstate,
        party_name, party_gstin, party_state, place_of_supply,
        ship_to_party_id, ship_to_name, ship_to_address, ship_to_gstin, ship_to_state,
        ewaybill_no, ewaybill_date, ewaybill_valid_till, ewaybill_notes,
        customer:customer_id ( id, name, gstin, state, billing_address, phone, whatsapp ),
        vendor:ledger_id     ( id, name, phone ),
        jobwork_party:jobwork_party_id ( id, name, gstin, state, billing_address, phone, whatsapp )
      `)
      .eq('id', numericId)
      .maybeSingle(),
    sb.from('invoice_line')
      .select('id, description, quantity, rate, hsn_sac, uom, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, gst_rate_pct')
      .eq('invoice_id', numericId)
      .order('id'),
    sb.from('delivery_challan')
      .select('id, code, dc_date, total_metres, total_pieces, total_bundles')
      .eq('invoice_id', numericId)
      .order('dc_date'),
  ]);

  const inv = hdrRes.data;
  if (!inv) notFound();

  const lines = (lineRes.data ?? []) as InvoiceLine[];
  const linkedDcs = (dcRes.data ?? []) as Array<{
    id: number; code: string; dc_date: string;
    total_metres: number | string | null; total_pieces: number | null; total_bundles: number | null;
  }>;

  const partyName = inv.customer?.name
    ?? inv.jobwork_party?.name
    ?? inv.vendor?.name
    ?? inv.party_name
    ?? '—';
  const partyGstin = inv.customer?.gstin
    ?? inv.jobwork_party?.gstin
    ?? inv.party_gstin
    ?? null;
  const partyState = inv.customer?.state
    ?? inv.jobwork_party?.state
    ?? inv.party_state
    ?? null;
  const partyAddress = inv.customer?.billing_address ?? inv.jobwork_party?.billing_address ?? null;

  // WhatsApp share: prefer the party's dedicated WhatsApp number, fall
  // back to their phone. The message is plain text — the operator can
  // also print the PDF and attach it in the opened chat.
  const partyWhatsApp: string | null =
    inv.customer?.whatsapp ?? inv.customer?.phone
    ?? inv.jobwork_party?.whatsapp ?? inv.jobwork_party?.phone
    ?? inv.vendor?.phone
    ?? null;
  const waMessage = [
    `*${DOC_LABEL[inv.doc_type] ?? 'Invoice'} ${inv.invoice_no}* — PPK Tex Industries`,
    `Party: ${partyName}`,
    `Date: ${fmtDate(inv.invoice_date)}`,
    `Total: Rs ${fmtRupees(inv.total)}`,
    Number(inv.balance ?? 0) > 0
      ? `Balance due: Rs ${fmtRupees(inv.balance)}${inv.due_date ? ` (due ${fmtDate(inv.due_date)})` : ''}`
      : 'Fully paid. Thank you!',
  ].join('\n');

  return (
    <div>
      <PageHeader
        title={`Invoice ${inv.invoice_no}`}
        subtitle={`${DOC_LABEL[inv.doc_type] ?? inv.doc_type} · ${partyName}`}
        crumbs={[
          { label: 'Invoices', href: '/app/invoices' },
          { label: inv.invoice_no },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/app/invoices"
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </Link>
            <Link
              href={`/app/invoices/${inv.id}/print`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
              title="View / Print / Download PDF"
            >
              <Printer className="w-3.5 h-3.5" /> View / Print / PDF
            </Link>
            <WhatsAppShareButton phone={partyWhatsApp} message={waMessage} />
            <DeleteInvoiceButton
              invoiceId={inv.id}
              invoiceNo={inv.invoice_no}
              variant="button"
            />
          </div>
        }
      />

      {/* ───── Editable header card ───── */}
      <EditInvoiceForm
        invoiceId={inv.id}
        invoiceNo={inv.invoice_no}
        initial={{
          invoice_no: inv.invoice_no,
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          status: inv.status,
          notes: inv.notes ?? '',
          taxable_value: Number(inv.taxable_value ?? 0),
          cgst_amount:   Number(inv.cgst_amount ?? 0),
          sgst_amount:   Number(inv.sgst_amount ?? 0),
          igst_amount:   Number(inv.igst_amount ?? 0),
          round_off:     Number(inv.round_off ?? 0),
          total:         Number(inv.total ?? 0),
          is_interstate: Boolean(inv.is_interstate),
          ship_to_party_id: inv.ship_to_party_id ?? null,
          ship_to_name:     inv.ship_to_name ?? null,
          ship_to_address:  inv.ship_to_address ?? null,
          ship_to_gstin:    inv.ship_to_gstin ?? null,
          ship_to_state:    inv.ship_to_state ?? null,
        }}
      />

      {/* ───── E-waybill capture ───── */}
      <EwaybillCard
        invoiceId={inv.id}
        invoiceNo={inv.invoice_no}
        invoiceTotal={Number(inv.total ?? 0)}
        ewaybillNo={inv.ewaybill_no ?? null}
        ewaybillDate={inv.ewaybill_date ?? null}
        ewaybillValidTill={inv.ewaybill_valid_till ?? null}
        ewaybillNotes={inv.ewaybill_notes ?? null}
      />

      {/* ───── Party block (read-only) ───── */}
      <div className="card p-4 mb-4">
        <h2 className="font-display font-bold text-sm mb-2">Billed to</h2>
        <div className="text-sm space-y-0.5">
          <div className="font-semibold">{partyName}</div>
          {partyGstin && <div className="text-ink-soft text-xs">GSTIN: {partyGstin}</div>}
          {partyState && <div className="text-ink-soft text-xs">State: {partyState}</div>}
          {partyAddress && <div className="text-ink-soft text-xs whitespace-pre-line">{partyAddress}</div>}
          <div className="text-xs text-ink-mute mt-1">
            {inv.is_interstate ? 'Interstate (IGST)' : 'Intrastate (CGST + SGST)'}
          </div>
        </div>
      </div>

      {/* ───── Line items (read-only) ───── */}
      <div className="card overflow-x-auto mb-4">
        <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
          <h2 className="font-display font-bold text-sm">Line items</h2>
        </div>
        {lines.length === 0 ? (
          <div className="p-6 text-center text-ink-mute text-sm">No line items.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-2">Description</th>
                <th className="text-left  px-3 py-2">HSN</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Rate</th>
                <th className="text-right px-3 py-2">Taxable</th>
                <th className="text-right px-3 py-2">CGST</th>
                <th className="text-right px-3 py-2">SGST</th>
                <th className="text-right px-3 py-2">IGST</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-line/40">
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2 text-xs">{l.hsn_sac || '-'}</td>
                  <td className="px-3 py-2 text-right num">{fmtMoney(l.quantity)} {l.uom}</td>
                  <td className="px-3 py-2 text-right num">{fmtMoney(l.rate)}</td>
                  <td className="px-3 py-2 text-right num">{fmtMoney(l.taxable_amount)}</td>
                  <td className="px-3 py-2 text-right num text-ink-soft">{fmtMoney(l.cgst_amount)}</td>
                  <td className="px-3 py-2 text-right num text-ink-soft">{fmtMoney(l.sgst_amount)}</td>
                  <td className="px-3 py-2 text-right num text-ink-soft">{fmtMoney(l.igst_amount)}</td>
                  <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(l.total_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-cloud/30 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={4}>Totals</td>
                <td className="px-3 py-2 text-right num">{fmtMoney(inv.taxable_value)}</td>
                <td className="px-3 py-2 text-right num">{fmtMoney(inv.cgst_amount)}</td>
                <td className="px-3 py-2 text-right num">{fmtMoney(inv.sgst_amount)}</td>
                <td className="px-3 py-2 text-right num">{fmtMoney(inv.igst_amount)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ───── Linked DCs (for jobwork bills) ───── */}
      {linkedDcs.length > 0 && (
        <div className="card overflow-x-auto mb-4">
          <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
            <h2 className="font-display font-bold text-sm">Linked Delivery Challans</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-2">DC No</th>
                <th className="text-left  px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Metres</th>
                <th className="text-right px-3 py-2">Pcs</th>
                <th className="text-right px-3 py-2">Bundles</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {linkedDcs.map((d) => (
                <tr key={d.id} className="border-t border-line/40">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/app/delivery-challan/${d.id}`} className="text-indigo hover:underline">{d.code}</Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{fmtDate(d.dc_date)}</td>
                  <td className="px-3 py-2 text-right num">{Number(d.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-right num">{d.total_pieces ?? 0}</td>
                  <td className="px-3 py-2 text-right num">{d.total_bundles ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/app/delivery-challan/${d.id}/print`}
                      target="_blank"
                      className="text-xs text-indigo hover:underline"
                    >
                      Print
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ───── Money summary ───── */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Subtotal</div>
            <div className="num font-bold">Rs {fmtMoney(inv.subtotal)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">GST</div>
            <div className="num font-bold">Rs {fmtMoney(inv.gst_amount)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total</div>
            <div className="num font-bold text-emerald-700 text-lg">Rs {fmtRupees(inv.total)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Paid</div>
            <div className="num font-bold">Rs {fmtMoney(inv.amount_paid)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Balance</div>
            <div className="num font-bold text-rose-700">Rs {fmtMoney(inv.balance ?? 0)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
