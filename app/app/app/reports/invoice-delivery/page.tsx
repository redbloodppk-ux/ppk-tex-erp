/**
 * Invoice -> DC Delivery Report (CORR-R11)
 *
 * One row per sales invoice, from the v_invoice_delivery_status view.
 * It answers a single owner question: "which invoices have goods that
 * still need a Delivery Challan raised?"
 *
 * For each invoice it compares:
 *   - invoiced_m   : metres billed on the invoice lines
 *   - delivered_m  : metres covered by its issued delivery challans
 * and classifies the invoice as:
 *   - missing  : no DC raised yet            (red)
 *   - partial  : some metres dispatched      (amber)
 *   - full     : dispatch covers the bill    (green)
 *   - over     : dispatched more than billed (amber - review)
 *
 * Until DCs start being entered the whole list reads "missing" — which is
 * exactly right: it is a to-do list of invoices awaiting dispatch paperwork.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Truck, PackageCheck, AlertTriangle, Clock } from 'lucide-react';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';

export const metadata = { title: 'Invoice Delivery Status' };
export const dynamic = 'force-dynamic';

type DeliveryStatus = 'missing' | 'partial' | 'full' | 'over';
type Tone = 'good' | 'warn' | 'bad' | 'mute';

interface DeliveryRow {
  invoice_id: number | null;
  invoice_no: string | null;
  invoice_date: string | null;
  doc_type: string | null;
  invoice_status: string | null;
  customer_id: number | null;
  customer_code: string | null;
  customer_name: string | null;
  invoice_total: number | null;
  invoiced_m: number | null;
  delivered_m: number | null;
  undelivered_m: number | null;
  dc_count: number | null;
  last_dc_date: string | null;
  delivery_status: DeliveryStatus | null;
}

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return '₹' + fmtNum(n, decimals);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function toneClass(tone: Tone): string {
  return tone === 'good'
    ? 'text-emerald-700'
    : tone === 'warn'
      ? 'text-amber-700'
      : tone === 'bad'
        ? 'text-rose-700'
        : '';
}

const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice: 'Fabric',
  yarn_sale: 'Yarn',
  general_sale: 'General',
};

/* sort order: missing first, then partial, then over, then full */
const STATUS_RANK: Record<DeliveryStatus, number> = {
  missing: 0,
  partial: 1,
  over: 2,
  full: 3,
};

export default async function InvoiceDeliveryReport() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_invoice_delivery_status')
    .select('*');

  const rows = (data as unknown as DeliveryRow[]) ?? [];

  rows.sort((a, b) => {
    const ra = STATUS_RANK[a.delivery_status ?? 'missing'];
    const rb = STATUS_RANK[b.delivery_status ?? 'missing'];
    if (ra !== rb) return ra - rb;
    /* within a status, oldest invoice first — chase the stalest one */
    return (a.invoice_date ?? '').localeCompare(b.invoice_date ?? '');
  });

  /* ───────── summary roll-up ───────── */
  const total = rows.length;
  const missing = rows.filter((r) => r.delivery_status === 'missing').length;
  const partial = rows.filter((r) => r.delivery_status === 'partial').length;
  const full = rows.filter((r) => r.delivery_status === 'full').length;
  const over = rows.filter((r) => r.delivery_status === 'over').length;
  const undeliveredM = rows.reduce(
    (s, r) => s + Number(r.undelivered_m ?? 0),
    0,
  );
  const awaiting = missing + partial;

  /* oldest invoice still awaiting a DC */
  const oldestPending = rows
    .filter(
      (r) =>
        r.delivery_status === 'missing' || r.delivery_status === 'partial',
    )
    .sort((a, b) =>
      (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''),
    )[0];

  const noData = total === 0;
  const noDcsYet = rows.every((r) => Number(r.dc_count ?? 0) === 0);

  /* Excel export (matches the rows shown below) */
  const exportColumns: ExcelColumn[] = [
    { key: 'invoice_no', label: 'Invoice', type: 'text', width: 16 },
    { key: 'invoice_date', label: 'Date', type: 'date', width: 14 },
    { key: 'customer_name', label: 'Customer', type: 'text', width: 28 },
    { key: 'customer_code', label: 'Code', type: 'text', width: 12 },
    { key: 'type', label: 'Type', type: 'text', width: 12 },
    { key: 'invoiced_m', label: 'Invoiced m', type: 'metre', width: 14, total: true },
    { key: 'delivered_m', label: 'Delivered m', type: 'metre', width: 14, total: true },
    { key: 'undelivered_m', label: 'Pending m', type: 'metre', width: 14, total: true },
    { key: 'dc_count', label: 'DCs', type: 'number', width: 8, total: true },
    { key: 'status', label: 'Status', type: 'text', width: 12 },
  ];
  const exportRows = rows.map((r) => ({
    invoice_no: r.invoice_no ?? '',
    invoice_date: r.invoice_date ?? '',
    customer_name: r.customer_name ?? '',
    customer_code: r.customer_code ?? '',
    type: DOC_TYPE_LABEL[r.doc_type ?? ''] ?? r.doc_type ?? '',
    invoiced_m: Number(r.invoiced_m ?? 0),
    delivered_m: Number(r.delivered_m ?? 0),
    undelivered_m: Number(r.undelivered_m ?? 0),
    dc_count: Number(r.dc_count ?? 0),
    status: r.delivery_status ?? 'missing',
  }));

  return (
    <div>
      <PageHeader
        title="Invoice Delivery Status"
        subtitle="Which sales invoices still need a Delivery Challan. Invoices awaiting dispatch are listed first, oldest at the top."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Invoice Delivery' },
        ]}
        actions={
          <ExcelExportButton
            filename="invoice-delivery-status"
            sheetName="Invoice Delivery"
            title="Invoice Delivery Status"
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load delivery data: {error.message}
        </div>
      )}

      {!noData && noDcsYet && (
        <div className="card p-3 mb-6 text-xs text-ink-soft border border-amber-200 bg-amber-50/40">
          <span className="font-semibold text-amber-700">Note:</span> No
          Delivery Challans have been entered yet, so every invoice shows{' '}
          <span className="font-semibold">missing</span>. Treat this as a
          to-do list — once the DC entry screen is built and challans are
          raised, invoices will move to <span className="font-semibold">
            partial
          </span>{' '}
          and <span className="font-semibold">full</span> on their own.
        </div>
      )}

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Sales invoices" value={fmtNum(total)} />
        <Kpi
          label="Awaiting delivery"
          value={fmtNum(awaiting)}
          tone={awaiting > 0 ? 'warn' : 'good'}
        />
        <Kpi
          label="Fully delivered"
          value={fmtNum(full)}
          tone={full > 0 ? 'good' : 'mute'}
        />
        <Kpi
          label="Undelivered metres"
          value={fmtNum(undeliveredM, 1)}
          tone={undeliveredM > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* ─────────────── Highlight cards ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <HighlightCard
          icon={<AlertTriangle className="w-4 h-4" />}
          tone={missing > 0 ? 'bad' : 'good'}
          label="No challan raised"
          headline={
            missing > 0
              ? `${missing} invoice${missing > 1 ? 's' : ''}`
              : 'None'
          }
          sub={
            missing > 0
              ? 'These invoices have no Delivery Challan at all'
              : 'Every invoice has at least one challan'
          }
          value={`${missing}`}
        />
        {oldestPending ? (
          <HighlightCard
            icon={<Clock className="w-4 h-4" />}
            tone="warn"
            label="Oldest awaiting dispatch"
            headline={oldestPending.invoice_no ?? '—'}
            sub={`${oldestPending.customer_name ?? '—'} · ${fmtDate(
              oldestPending.invoice_date,
            )}`}
            value={`${fmtNum(oldestPending.undelivered_m, 1)} m`}
          />
        ) : (
          <HighlightCard
            icon={<PackageCheck className="w-4 h-4" />}
            tone="good"
            label="Dispatch backlog"
            headline="All clear"
            sub="No invoices are waiting on a Delivery Challan"
            value="0"
          />
        )}
      </div>

      {/* ─────────────── Per-invoice table ─────────────── */}
      <SectionHeader
        icon={<Truck className="w-4 h-4" />}
        title="Delivery status by invoice"
        subtitle="Missing and partial first, oldest at the top."
      />

      {noData ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No sales invoices yet. Once invoices are raised they will appear
          here with their delivery status.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Invoice</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-right px-3 py-2">Invoiced m</th>
                <th className="text-right px-3 py-2">Delivered m</th>
                <th className="text-right px-3 py-2">Pending m</th>
                <th className="text-right px-3 py-2">DCs</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.invoice_id ?? i}
                  className="border-t border-line/40 hover:bg-cloud/20"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.invoice_no ?? '—'}</div>
                    <div className="text-xs text-ink-mute">
                      {fmtDate(r.invoice_date)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {r.customer_name ?? '—'}
                    </div>
                    <div className="text-xs text-ink-mute">
                      {r.customer_code ?? ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {DOC_TYPE_LABEL[r.doc_type ?? ''] ?? r.doc_type ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right num text-xs">
                    {Number(r.invoiced_m ?? 0) > 0
                      ? fmtNum(r.invoiced_m, 1)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right num text-xs">
                    {Number(r.delivered_m ?? 0) > 0
                      ? fmtNum(r.delivered_m, 1)
                      : '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right num ${
                      Number(r.undelivered_m ?? 0) > 0
                        ? 'text-amber-700 font-semibold'
                        : ''
                    }`}
                  >
                    {Number(r.undelivered_m ?? 0) > 0
                      ? fmtNum(r.undelivered_m, 1)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right num text-xs">
                    {fmtNum(r.dc_count, 0)}
                  </td>
                  <td className="px-3 py-2">
                    <DeliveryBadge status={r.delivery_status ?? 'missing'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-mute mt-4">
        &quot;Invoiced m&quot; is the metres billed on the invoice lines.
        &quot;Delivered m&quot; is the metres covered by issued Delivery
        Challans linked to that invoice. An invoice is <b>full</b> once
        delivered metres cover the bill (within a 0.5 m rounding tolerance),{' '}
        <b>partial</b> while some metres are still pending, and <b>missing</b>{' '}
        when no challan has been raised at all. <b>Over</b> means more metres
        were dispatched than billed — worth a quick check.
        {over > 0 && (
          <>
            {' '}
            <span className="text-amber-700 font-medium">
              {over} invoice{over > 1 ? 's' : ''} currently show over.
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/* ─────────────────── presentational helpers ─────────────────── */

interface KpiProps {
  label: string;
  value: string;
  tone?: Tone;
}

function Kpi({ label, value, tone = 'mute' }: KpiProps) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${toneClass(tone)}`}>
        {value}
      </div>
    </div>
  );
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}

function SectionHeader({ icon, title, subtitle }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline gap-2 mb-2 mt-4">
      <span className="text-ink-mute">{icon}</span>
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && (
        <span className="text-xs text-ink-mute ml-2">{subtitle}</span>
      )}
    </div>
  );
}

interface HighlightCardProps {
  icon: React.ReactNode;
  tone: Tone;
  label: string;
  headline: string;
  sub: string;
  value?: string;
}

function HighlightCard({
  icon,
  tone,
  label,
  headline,
  sub,
  value,
}: HighlightCardProps) {
  const ring =
    tone === 'good'
      ? 'border-emerald-300 bg-emerald-50/40'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50/40'
        : tone === 'bad'
          ? 'border-rose-300 bg-rose-50/40'
          : 'border-line/60';
  const text = toneClass(tone);
  return (
    <div className={`card p-4 border ${ring}`}>
      <div className="flex items-center gap-2 text-xs text-ink-mute uppercase tracking-wide">
        <span className={text}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{headline}</div>
          <div className="text-xs text-ink-mute">{sub}</div>
        </div>
        {value && (
          <div className={`text-lg font-semibold ${text}`}>{value}</div>
        )}
      </div>
    </div>
  );
}

function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const map: Record<
    DeliveryStatus,
    { label: string; cls: string }
  > = {
    full: {
      label: 'Full',
      cls: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    partial: {
      label: 'Partial',
      cls: 'text-amber-700 bg-amber-50 border-amber-200',
    },
    missing: {
      label: 'Missing',
      cls: 'text-rose-700 bg-rose-50 border-rose-200',
    },
    over: {
      label: 'Over',
      cls: 'text-amber-700 bg-amber-50 border-amber-200',
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${cls}`}
    >
      {label}
    </span>
  );
}
