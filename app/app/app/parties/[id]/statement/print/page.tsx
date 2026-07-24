/**
 * Party Outstanding Statement — A4 print view.
 *
 * Lists every unpaid / partially-paid bill for one party (customer
 * or supplier) with a running total at the bottom. Designed to be
 * printed and handed to the party as a polite reminder, or saved as
 * a PDF and WhatsApp'd.
 *
 * Pulls from seven sources:
 *   - invoice (sales / jobwork / weaving bills)
 *   - party_opening_ledger (opening balances)
 *   - sizing_job
 *   - bobbin_purchase
 *   - yarn_lot
 *   - fabric_purchase (supplier-source rows only)
 *   - bank_entry (direct bank transactions where the party's linked
 *     ledger is the offset side — these adjust the net outstanding
 *     when something is settled or accrued outside the payment flow).
 *
 * No app shell so the page prints cleanly. PrintActions toolbar at
 * the top is hidden under @media print.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BrandLogo } from '@/app/components/brand-logo';
import { PrintActions } from './print-actions';

export const dynamic = 'force-dynamic';

interface Bill {
  doc_no: string;
  doc_date: string;
  doc_type: string;
  total: number;
  paid: number;
  balance: number;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice:        'Fabric Sale',
  yarn_sale:          'Yarn Sale',
  general_sale:       'General Sale',
  credit_note:        'Credit Note',
  debit_note:         'Debit Note',
  jobwork_invoice:    'Jobwork Bill',
  weaving_bill:       'Weaving Bill',
  sizing_bill:        'Sizing Bill',
  bobbin_purchase:    'Bobbin Purchase',
  yarn_purchase:      'Yarn Purchase',
  fabric_purchase:    'Fabric Purchase',
  opening_receivable: 'Opening (Receivable)',
  opening_payable:    'Opening (Payable)',
  bank_in:            'Bank Receipt',
  bank_out:           'Bank Payment',
};

function fmtINR(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function todayDisplay(): string { return fmtDate(todayISO()); }

function daysBetween(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export default async function PartyStatementPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const partyId = Number(id);
  if (!Number.isInteger(partyId) || partyId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [partyRes, cpRes] = await Promise.all([
    sb.from('party')
      .select('id, code, name, gstin, state, billing_address, phone, whatsapp, ledger_id')
      .eq('id', partyId)
      .maybeSingle(),
    sb.from('company_profile')
      .select('legal_name, display_name, gstin, address_line1, address_line2, city, state, pincode, phone')
      .limit(1)
      .maybeSingle(),
  ]);

  const party = partyRes?.data as {
    id: number; code: string; name: string; gstin: string | null;
    state: string | null; billing_address: string | null;
    phone: string | null; whatsapp: string | null;
    ledger_id: number | null;
  } | null;
  if (!party) notFound();

  const cp = (cpRes?.data ?? {}) as {
    legal_name?: string; display_name?: string;
    gstin?: string; address_line1?: string; address_line2?: string;
    city?: string; state?: string; pincode?: string; phone?: string;
  };

  // Fetch the six bill sources in parallel + bank entries that touch
  // the party's linked ledger. Bank entries are only meaningful when
  // party.ledger_id is set — otherwise we hand back an empty array so
  // the downstream code can stay uniform.
  const partyLedgerId = party.ledger_id;
  const bankPromise = partyLedgerId != null
    ? sb.from('bank_entry')
        .select(`
          id, entry_no, entry_date, direction, amount, mode, reference, notes,
          status, bank_ledger_id, other_ledger_id, category_id,
          bank:bank_ledger_id ( id, name ),
          category:category_id ( id, code, name )
        `)
        .eq('status', 'active')
        .eq('other_ledger_id', partyLedgerId)
    : Promise.resolve({ data: [] as unknown[], error: null });

  const [invRes, openRes, sizRes, bobRes, yarnRes, fabRes, bankRes] = await Promise.all([
    sb.from('invoice')
      .select('id, invoice_no, invoice_date, doc_type, total, amount_paid, balance')
      .ilike('party_name', party.name)
      .in('status', ['issued', 'partial_paid', 'overdue'])
      .gt('balance', 0)
      .order('invoice_date', { ascending: true }),
    sb.from('party_opening_ledger')
      .select('id, invoice_no, invoice_date, direction, amount, amount_paid, balance')
      .eq('party_id', partyId)
      .eq('status', 'active')
      .gt('balance', 0),
    sb.from('sizing_job')
      .select('id, bill_no, bill_date, total_amount, amount_paid')
      .eq('party_id', partyId)
      .not('bill_no', 'is', null),
    sb.from('bobbin_purchase')
      .select('id, invoice_no, purchase_date, total_amount, amount_paid')
      .eq('vendor_id', partyId),
    sb.from('yarn_lot')
      .select('id, lot_code, invoice_no, received_date, total_amount, amount_paid')
      .eq('supplier_party_id', partyId),
    sb.from('fabric_purchase')
      .select('id, code, invoice_no, received_date, total_amount, amount_paid')
      .eq('supplier_party_id', partyId)
      .eq('source', 'supplier')
      .eq('status', 'active'),
    bankPromise,
  ]);

  const bills: Bill[] = [];

  for (const r of ((invRes.data ?? []) as Array<{
    invoice_no: string; invoice_date: string; doc_type: string;
    total: number | string; amount_paid: number | string; balance: number | string;
  }>)) {
    const bal = Number(r.balance ?? 0);
    if (bal <= 0.005) continue;
    // Credit notes exist to REDUCE what the party owes (quality claims,
    // discounts, adjustments against an earlier sale) — they are not a
    // separate debt. `invoice.balance` stores them as a plain positive
    // number like any other doc, so we negate here for display, mirroring
    // the bank_entry convention below ("negative balance = reduces
    // outstanding"). This matches how the ledger view and Sales Register
    // already treat credit notes (outflow / netted, not an addend).
    const isCreditNote = r.doc_type === 'credit_note';
    bills.push({
      doc_no: r.invoice_no,
      doc_date: r.invoice_date,
      doc_type: r.doc_type,
      total: Number(r.total ?? 0),
      paid: Number(r.amount_paid ?? 0),
      balance: isCreditNote ? -bal : bal,
    });
  }
  for (const r of ((openRes?.data ?? []) as Array<{
    invoice_no: string; invoice_date: string; direction: string;
    amount: number | string; amount_paid: number | string; balance: number | string;
  }>)) {
    const bal = Number(r.balance ?? 0);
    if (bal <= 0.005) continue;
    bills.push({
      doc_no: r.invoice_no,
      doc_date: r.invoice_date,
      doc_type: `opening_${r.direction}`,
      total: Number(r.amount ?? 0),
      paid: Number(r.amount_paid ?? 0),
      balance: bal,
    });
  }
  for (const r of ((sizRes?.data ?? []) as Array<{
    bill_no: string | null; bill_date: string | null;
    total_amount: number | string; amount_paid: number | string;
  }>)) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    bills.push({
      doc_no: r.bill_no ?? '',
      doc_date: r.bill_date ?? '',
      doc_type: 'sizing_bill',
      total: Number(r.total_amount ?? 0),
      paid: Number(r.amount_paid ?? 0),
      balance: bal,
    });
  }
  for (const r of ((bobRes?.data ?? []) as Array<{
    invoice_no: string | null; purchase_date: string | null;
    total_amount: number | string; amount_paid: number | string;
  }>)) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    bills.push({
      doc_no: r.invoice_no ?? '',
      doc_date: r.purchase_date ?? '',
      doc_type: 'bobbin_purchase',
      total: Number(r.total_amount ?? 0),
      paid: Number(r.amount_paid ?? 0),
      balance: bal,
    });
  }
  for (const r of ((yarnRes?.data ?? []) as Array<{
    lot_code: string | null; invoice_no: string | null;
    received_date: string | null; total_amount: number | string; amount_paid: number | string;
  }>)) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    bills.push({
      doc_no: r.invoice_no ?? r.lot_code ?? '',
      doc_date: r.received_date ?? '',
      doc_type: 'yarn_purchase',
      total: Number(r.total_amount ?? 0),
      paid: Number(r.amount_paid ?? 0),
      balance: bal,
    });
  }
  for (const r of ((fabRes?.data ?? []) as Array<{
    code: string; invoice_no: string | null; received_date: string | null;
    total_amount: number | string; amount_paid: number | string;
  }>)) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    bills.push({
      doc_no: r.invoice_no ?? r.code,
      doc_date: r.received_date ?? '',
      doc_type: 'fabric_purchase',
      total: Number(r.total_amount ?? 0),
      paid: Number(r.amount_paid ?? 0),
      balance: bal,
    });
  }

  // Bank entries — only fetched when the party has a linked ledger,
  // and only the rows where the party's ledger is the OFFSET side
  // (the company's bank is the bank side). Sign convention mirrors
  // ledger-view-tab: from the offset ledger's POV, a bank dir='out'
  // is a debit ("grew" the offset, i.e. +balance), and a bank dir='in'
  // is a credit (reduces it, i.e. -balance). For the outstanding
  // statement this naturally nets: paying a supplier from bank
  // (dir='out' on the supplier ledger context) DEBITS the supplier
  // (reduces what we owe) → +balance on a payable account in standard
  // accounting actually means the credit balance shrinks toward zero,
  // which matches "outstanding goes DOWN". We model that as a paid
  // adjustment with negative balance contribution. See README and
  // ledger-view-tab.tsx for the full reasoning.
  //
  // Concretely:
  //   - dir='out' (bank paid out, e.g. we paid this supplier):
  //       paid = amount, balance = -amount  (reduces outstanding)
  //   - dir='in'  (bank received, e.g. customer paid us):
  //       paid = amount, balance = -amount  (also reduces outstanding)
  // Both directions of a direct bank↔party movement settle balance,
  // so they reduce the outstanding sum at the bottom of the page.
  // If a bank entry needs to INCREASE outstanding (rare adjustments),
  // the operator should use a payment / debit note / opening row
  // instead — that's outside the scope of this surface.
  for (const r of ((bankRes?.data ?? []) as Array<{
    id: number; entry_no: string | null; entry_date: string;
    direction: 'in' | 'out'; amount: number | string;
    reference: string | null; notes: string | null;
    bank?: { id: number; name: string } | null;
    category?: { id: number; name: string } | null;
  }>)) {
    const amt = Number(r.amount ?? 0);
    if (!Number.isFinite(amt) || amt <= 0.005) continue;
    bills.push({
      doc_no:   r.entry_no ?? `BE-${r.id}`,
      doc_date: r.entry_date,
      doc_type: r.direction === 'in' ? 'bank_in' : 'bank_out',
      total:    0,
      paid:     amt,
      balance:  -amt,
    });
  }

  bills.sort((a, b) => (a.doc_date ?? '').localeCompare(b.doc_date ?? ''));

  const totalOutstanding = bills.reduce((s, b) => s + b.balance, 0);
  const billedTotal      = bills.reduce((s, b) => s + b.total,   0);
  const paidTotal        = bills.reduce((s, b) => s + b.paid,    0);

  const companyAddress = [cp.address_line1, cp.address_line2, [cp.city, cp.state, cp.pincode].filter(Boolean).join(' ')]
    .filter(Boolean).join('\n');

  return (
    <>
      <PrintActions partyId={partyId} partyName={party.name} asOfDate={todayISO()} />

      <div className="statement-page p-8 mx-auto bg-paper text-ink" style={{ maxWidth: '210mm', minHeight: '297mm' }}>
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-ink pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BrandLogo variant="mark" height={56} />
              <span className="text-4xl font-display font-extrabold tracking-tight text-ink leading-none">
                {cp.display_name ?? 'PPK TEX'}
              </span>
            </div>
            {companyAddress && <pre className="text-xs text-ink-soft mt-0.5 whitespace-pre-line font-sans">{companyAddress}</pre>}
            {cp.gstin && <div className="text-xs text-ink-soft mt-0.5">GSTIN: <span className="font-mono">{cp.gstin}</span></div>}
            {cp.phone && <div className="text-xs text-ink-soft">Phone: {cp.phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-ink-mute">Statement of Outstanding</div>
            <div className="text-sm font-semibold">as on {todayDisplay()}</div>
          </div>
        </div>

        {/* Bill-to block */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-mute mb-1">Statement for</div>
            <div className="font-bold text-lg">{party.name}</div>
            <div className="text-xs text-ink-soft font-mono">{party.code}</div>
            {party.billing_address && <div className="text-xs text-ink-soft mt-1 whitespace-pre-line">{party.billing_address}</div>}
            {party.gstin && <div className="text-xs text-ink-soft mt-0.5">GSTIN: <span className="font-mono">{party.gstin}</span></div>}
            {party.phone && <div className="text-xs text-ink-soft">Phone: {party.phone}</div>}
          </div>
          <div className="rounded-md border border-line/60 p-3 text-right bg-cloud/20">
            <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total outstanding</div>
            <div className={'text-3xl font-extrabold tabular-nums num ' + (totalOutstanding < 0 ? 'text-emerald-700' : 'text-rose-700')}>
              Rs {fmtINR(totalOutstanding)}
            </div>
            <div className="text-[10px] text-ink-mute mt-0.5">
              Across {bills.length} bill{bills.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        {/* Bills table */}
        {bills.length === 0 ? (
          <div className="p-8 text-center text-ink-soft border border-line/60 rounded-md">
            No outstanding bills against this party — fully settled.
          </div>
        ) : (
          <table className="w-full text-sm border border-line/60">
            <thead className="bg-cloud/50 text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-2 py-1.5 border-b border-line/60">#</th>
                <th className="text-left  px-2 py-1.5 border-b border-line/60">Doc no</th>
                <th className="text-left  px-2 py-1.5 border-b border-line/60">Date</th>
                <th className="text-left  px-2 py-1.5 border-b border-line/60">Type</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Days</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Billed (₹)</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Paid (₹)</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b, i) => {
                const days = daysBetween(b.doc_date);
                // Negative balance = the row REDUCES the outstanding
                // sum (a bank-side settlement). Show it in emerald so
                // it visually reads as a credit, not as a debt.
                const isCredit = b.balance < 0;
                return (
                  <tr key={`${b.doc_type}-${b.doc_no}-${i}`} className="border-b border-line/40">
                    <td className="px-2 py-1.5 text-ink-soft">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{b.doc_no}</td>
                    <td className="px-2 py-1.5">{fmtDate(b.doc_date)}</td>
                    <td className="px-2 py-1.5 text-xs">{DOC_TYPE_LABEL[b.doc_type] ?? b.doc_type}</td>
                    <td className="px-2 py-1.5 text-right num">{days}</td>
                    <td className="px-2 py-1.5 text-right num">{fmtINR(b.total)}</td>
                    <td className="px-2 py-1.5 text-right num text-emerald-700">{fmtINR(b.paid)}</td>
                    <td className={'px-2 py-1.5 text-right num font-semibold ' + (isCredit ? 'text-emerald-700' : 'text-rose-700')}>
                      {fmtINR(b.balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-cloud/40 font-bold">
              <tr>
                <td className="px-2 py-2" colSpan={5}>Totals</td>
                <td className="px-2 py-2 text-right num">{fmtINR(billedTotal)}</td>
                <td className="px-2 py-2 text-right num text-emerald-700">{fmtINR(paidTotal)}</td>
                <td className={'px-2 py-2 text-right num ' + (totalOutstanding < 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmtINR(totalOutstanding)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Footer note */}
        <div className="mt-6 text-[11px] text-ink-soft leading-relaxed border-t border-line/40 pt-3">
          <p>
            This statement lists all bills with an outstanding balance against this account as on{' '}
            <span className="font-semibold">{todayDisplay()}</span>. If you find any discrepancy please bring it to our notice within 7 days.
          </p>
          <p className="mt-2 italic">
            This is a system-generated statement and does not require a signature.
          </p>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .statement-page { padding: 12mm !important; }
          @page { size: A4; margin: 8mm; }
        }
      `}</style>
    </>
  );
}
