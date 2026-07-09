/**
 * Sales Register (CORR-R1)
 *
 * Owner / accountant view of every billed invoice (tax invoices, general
 * sales, yarn sales, credit + debit notes — excluding draft and cancelled
 * documents). Source: view `public.v_sales_register` from migration 011.
 *
 * Filters via querystring:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (defaults: 1st of this month → today)
 *   ?customer_id=123                  (optional, single customer)
 *   ?doc=invoice | credit_note | all  (defaults: all)
 *
 * KPI strip + GST split + line table + totals footer.  Credit-note rows
 * pre-signed by the view, so column totals are a straight SUM() — no
 * per-row branching here.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import { CardFilter } from '@/app/components/card-filter';
import { CustomerFilter } from './customer-filter';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  FileText,
  ReceiptText,
  RotateCcw,
  Building2,
  AlertCircle,
} from 'lucide-react';

export const metadata = { title: 'Sales Register' };
export const dynamic = 'force-dynamic';

type DocFilter = 'all' | 'invoice' | 'credit_note';

interface RegisterRow {
  invoice_id: number | null;
  invoice_no: string | null;
  invoice_date: string | null;
  doc_type: string | null;
  status: string | null;
  is_interstate: boolean | null;
  customer_id: number | null;
  customer_code: string | null;
  customer_name: string | null;
  party_gstin: string | null;
  party_state: string | null;
  taxable_value: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  gst_amount: number | null;
  total: number | null;
  signed_taxable: number | null;
  signed_cgst: number | null;
  signed_sgst: number | null;
  signed_igst: number | null;
  signed_gst: number | null;
  signed_total: number | null;
  total_quantity: number | null;
}

interface CustomerOpt {
  id: number;
  code: string;
  name: string;
}

/* ─────────────── small date / format helpers ─────────────── */

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  return (
    sign +
    '₹' +
    Math.abs(num).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function docLabel(d: string | null): string {
  switch (d) {
    case 'tax_invoice':
      return 'Tax Inv';
    case 'general_sale':
      return 'Gen Sale';
    case 'yarn_sale':
      return 'Yarn';
    case 'credit_note':
      return 'Cr Note';
    case 'debit_note':
      return 'Dr Note';
    default:
      return d ?? '—';
  }
}

function docTone(d: string | null): string {
  if (d === 'credit_note') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (d === 'yarn_sale') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-sky-50 text-sky-700 border-sky-200';
}

function statusTone(s: string | null): string {
  if (s === 'paid') return 'text-emerald-700';
  if (s === 'overdue') return 'text-rose-700';
  if (s === 'partial_paid') return 'text-amber-700';
  return 'text-ink-soft';
}

/* ─────────────── page ─────────────── */

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    customer_id?: string;
    doc?: string;
  }>;
}

export default async function SalesRegisterReport({ searchParams }: PageProps) {
  const sp = await searchParams;
  const from = sp.from ?? startOfMonthISO();
  const to = sp.to ?? todayISO();
  const customerIdParam = sp.customer_id ?? '';
  const customerIdNum = customerIdParam ? Number(customerIdParam) : null;
  const doc: DocFilter =
    sp.doc === 'invoice' || sp.doc === 'credit_note' ? sp.doc : 'all';

  const supabase = await createClient();

  // Main query
  let query = supabase
    .from('v_sales_register')
    .select('*')
    .gte('invoice_date', from)
    .lte('invoice_date', to)
    .order('invoice_date', { ascending: false })
    .order('invoice_no', { ascending: false });

  if (customerIdNum != null && !Number.isNaN(customerIdNum)) {
    query = query.eq('customer_id', customerIdNum);
  }
  if (doc === 'invoice') {
    query = query.neq('doc_type', 'credit_note');
  } else if (doc === 'credit_note') {
    query = query.eq('doc_type', 'credit_note');
  }

  const [rowsRes, custRes] = await Promise.all([
    query,
    supabase
      .from('customer')
      .select('id, code, name')
      .eq('status', 'active')
      .order('name', { ascending: true })
      .limit(500),
  ]);

  const rows = (rowsRes.data as unknown as RegisterRow[]) ?? [];
  const customers = (custRes.data as unknown as CustomerOpt[]) ?? [];

  /* Excel export (matches the filtered rows shown below) */
  const exportColumns: ExcelColumn[] = [
    { key: 'invoice_date', label: 'Date', type: 'date', width: 13 },
    { key: 'doc', label: 'Doc', type: 'text', width: 11 },
    { key: 'invoice_no', label: 'Invoice #', type: 'text', width: 16 },
    { key: 'customer', label: 'Customer', type: 'text', width: 28 },
    { key: 'party_gstin', label: 'GSTIN', type: 'text', width: 18 },
    { key: 'party_state', label: 'State', type: 'text', width: 16 },
    { key: 'total_quantity', label: 'Qty', type: 'number', width: 10, total: true },
    { key: 'signed_taxable', label: 'Taxable', type: 'rupee', width: 14, total: true },
    { key: 'signed_cgst', label: 'CGST', type: 'rupee', width: 12, total: true },
    { key: 'signed_sgst', label: 'SGST', type: 'rupee', width: 12, total: true },
    { key: 'signed_igst', label: 'IGST', type: 'rupee', width: 12, total: true },
    { key: 'signed_total', label: 'Total', type: 'rupee', width: 14, total: true },
    { key: 'status', label: 'Status', type: 'text', width: 12 },
  ];
  const exportRows = rows.map((r) => ({
    invoice_date: r.invoice_date ?? '',
    doc: docLabel(r.doc_type),
    invoice_no: r.invoice_no ?? '',
    customer: r.customer_code
      ? `${r.customer_name ?? ''} (${r.customer_code})`
      : r.customer_name ?? '',
    party_gstin: r.party_gstin ?? '',
    party_state: r.party_state ?? '',
    total_quantity: Number(r.total_quantity ?? 0),
    signed_taxable: Number(r.signed_taxable ?? 0),
    signed_cgst: Number(r.signed_cgst ?? 0),
    signed_sgst: Number(r.signed_sgst ?? 0),
    signed_igst: Number(r.signed_igst ?? 0),
    signed_total: Number(r.signed_total ?? 0),
    status: r.status ?? '',
  }));


  // Aggregates — sums on the pre-signed columns
  const n = rows.length;
  const totalTaxable = rows.reduce(
    (s, r) => s + Number(r.signed_taxable ?? 0),
    0,
  );
  const totalCgst = rows.reduce(
    (s, r) => s + Number(r.signed_cgst ?? 0),
    0,
  );
  const totalSgst = rows.reduce(
    (s, r) => s + Number(r.signed_sgst ?? 0),
    0,
  );
  const totalIgst = rows.reduce(
    (s, r) => s + Number(r.signed_igst ?? 0),
    0,
  );
  const totalGst = totalCgst + totalSgst + totalIgst;
  const totalTotal = rows.reduce(
    (s, r) => s + Number(r.signed_total ?? 0),
    0,
  );
  const totalQty = rows.reduce(
    (s, r) => s + Number(r.total_quantity ?? 0),
    0,
  );

  // Counts per doc type
  const cntInvoices = rows.filter((r) => r.doc_type !== 'credit_note').length;
  const cntCreditNotes = rows.filter((r) => r.doc_type === 'credit_note').length;

  return (
    <div>
      <PageHeader
        title="Sales Register"
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Sales Register' },
        ]}
        subtitle={`Every billed invoice between ${from} and ${to}. Credit notes net out automatically — totals here equal what goes on your GSTR-1 summary.`}
        actions={
          <ExcelExportButton
            filename="sales-register"
            sheetName="Sales Register"
            title={`Sales Register · ${from} to ${to}`}
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* ─────────────── Filter strip ─────────────── */}
      <form
        className="card p-3 mb-4 flex flex-wrap gap-3 items-end text-sm"
        action=""
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Customer</span>
          <CustomerFilter customers={customers} defaultValue={customerIdParam} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Doc type</span>
          <select name="doc" defaultValue={doc} className="input">
            <option value="all">All</option>
            <option value="invoice">Invoices only</option>
            <option value="credit_note">Credit notes only</option>
          </select>
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
        <a
          href="/app/reports/sales-register"
          className="text-xs text-ink-mute self-center hover:text-ink underline"
        >
          Reset
        </a>
      </form>

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi
          icon={<FileText className="w-4 h-4" />}
          label="Documents"
          value={fmtNum(n)}
          sub={`${cntInvoices} invoice${cntInvoices === 1 ? '' : 's'} · ${cntCreditNotes} credit note${cntCreditNotes === 1 ? '' : 's'}`}
        />
        <Kpi
          icon={<ReceiptText className="w-4 h-4" />}
          label="Net taxable"
          value={fmtRupees(totalTaxable)}
        />
        <Kpi
          icon={<RotateCcw className="w-4 h-4" />}
          label="Net GST"
          value={fmtRupees(totalGst)}
          sub={`CGST ${fmtRupees(totalCgst)} · SGST ${fmtRupees(totalSgst)} · IGST ${fmtRupees(totalIgst)}`}
        />
        <Kpi
          icon={<Building2 className="w-4 h-4" />}
          label="Net total"
          value={fmtRupees(totalTotal)}
          sub={`Qty (sum): ${fmtNum(totalQty, 2)}`}
        />
      </div>

      {/* ─────────────── Error / empty / table ─────────────── */}
      {rowsRes.error && (
        <div className="card p-4 text-sm text-err mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load sales data.</div>
            <div className="text-xs opacity-80 mt-1">
              {rowsRes.error.message}
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && !rowsRes.error ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No billed invoices in this window with the current filters.
        </div>
      ) : rows.length > 0 ? (
        <>
        {/* Mobile / PWA: card view. The register table is wide; below md we
            render each invoice as a tap-friendly card. */}
        <CardFilter placeholder="Search invoices…">
          {rows.map((r) => {
            const isCN = r.doc_type === 'credit_note';
            return (
              <div
                key={r.invoice_id ?? `${r.invoice_no}-${r.invoice_date}`}
                className={`card p-3 ${isCN ? 'bg-rose-50/30' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-words font-mono text-sm">
                      {r.invoice_no ?? '—'}
                    </div>
                    <div className="text-xs text-ink-soft mt-0.5">
                      {r.customer_name ?? '—'}
                      {r.customer_code ? (
                        <span className="ml-1 text-ink-mute">({r.customer_code})</span>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${docTone(r.doc_type)}`}
                  >
                    {docLabel(r.doc_type)}
                  </span>
                </div>

                <div className="text-xs text-ink-soft mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{fmtDate(r.invoice_date)}</span>
                  <span className={statusTone(r.status)}>{r.status ?? '—'}</span>
                  {r.party_state ? (
                    <span>
                      {r.party_state}
                      {r.is_interstate ? (
                        <span className="ml-1 text-amber-700">(IS)</span>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {r.party_gstin ? (
                  <div className="text-xs mt-1">
                    <span className="text-ink-mute">GSTIN: </span>
                    <span className="font-mono">{r.party_gstin}</span>
                  </div>
                ) : null}

                <div className="flex items-end justify-between mt-2 pt-2 border-t border-line/40">
                  <div className="text-xs text-ink-soft">
                    <div>Qty: <span className="num">{fmtNum(r.total_quantity, 2)}</span></div>
                    <div>Taxable: <span className="num">{fmtRupees(r.signed_taxable, 2)}</span></div>
                    <div>GST: <span className="num">{fmtRupees(Number(r.signed_cgst ?? 0) + Number(r.signed_sgst ?? 0) + Number(r.signed_igst ?? 0), 2)}</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total</div>
                    <div className="num font-semibold text-base">{fmtRupees(r.signed_total, 0)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardFilter>

        <div className="card p-0 overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Doc</th>
                <th className="text-left px-3 py-2">Invoice #</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-left px-3 py-2">GSTIN</th>
                <th className="text-left px-3 py-2">State</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Taxable ₹</th>
                <th className="text-right px-3 py-2">CGST</th>
                <th className="text-right px-3 py-2">SGST</th>
                <th className="text-right px-3 py-2">IGST</th>
                <th className="text-right px-3 py-2">Total ₹</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isCN = r.doc_type === 'credit_note';
                return (
                  <tr
                    key={r.invoice_id ?? `${r.invoice_no}-${r.invoice_date}`}
                    className={`border-t border-line/40 ${isCN ? 'bg-rose-50/30' : ''}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDate(r.invoice_date)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${docTone(r.doc_type)}`}
                      >
                        {docLabel(r.doc_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.invoice_no ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">
                        {r.customer_name ?? '—'}
                      </span>
                      {r.customer_code ? (
                        <span className="ml-1 text-xs text-ink-mute">
                          ({r.customer_code})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-soft">
                      {r.party_gstin ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {r.party_state ?? '—'}
                      {r.is_interstate ? (
                        <span className="ml-1 text-[10px] text-amber-700">
                          (IS)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.total_quantity, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(r.signed_taxable, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.signed_cgst, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.signed_sgst, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.signed_igst, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {fmtRupees(r.signed_total, 2)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className={statusTone(r.status)}>
                        {r.status ?? '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-cloud/40 font-semibold text-xs">
              <tr className="border-t-2 border-line">
                <td className="px-3 py-2" colSpan={6}>
                  Totals ({n} document{n === 1 ? '' : 's'})
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtNum(totalQty, 2)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtRupees(totalTaxable, 2)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtRupees(totalCgst, 2)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtRupees(totalSgst, 2)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtRupees(totalIgst, 2)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtRupees(totalTotal, 2)}
                </td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      ) : null}

      <p className="text-xs text-ink-mute mt-4">
        Source: <span className="font-mono">v_sales_register</span> (migration
        011). Draft and cancelled documents are excluded. (IS) = interstate
        invoice — uses IGST instead of CGST + SGST.
      </p>
    </div>
  );
}

/* ─────────────── presentational helpers ─────────────── */

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function Kpi({ icon, label, value, sub }: KpiProps) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-mute">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub ? <div className="text-[11px] text-ink-mute mt-0.5">{sub}</div> : null}
    </div>
  );
}
