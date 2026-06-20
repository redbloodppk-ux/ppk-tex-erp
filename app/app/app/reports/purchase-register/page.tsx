/**
 * Purchase Register
 *
 * Owner / accountant view of every supplier bill we received — unions
 * yarn lots, bobbin purchases, sizing jobs, fabric purchases, and
 * outsource-weaving / jobwork bills (invoice table). Source:
 * `public.v_purchase_register` from migration 175.
 *
 * Filters via querystring:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD       (defaults: 1st of this month → today)
 *   ?party_id=123                         (optional, single supplier)
 *   ?source=yarn|bobbin|sizing|fabric|outsource_weaving|jobwork|all
 *   ?gst=with|without|all                 (filter rows where GST > 0 vs = 0)
 *
 * KPI strip + CGST/SGST/IGST split + line table + totals footer. GST
 * split is computed in the view (intrastate splits 50/50 between CGST
 * and SGST, interstate becomes IGST).
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  FileText,
  ReceiptText,
  RotateCcw,
  Building2,
  AlertCircle,
} from 'lucide-react';

export const metadata = { title: 'Purchase Register' };
export const dynamic = 'force-dynamic';

type SourceFilter =
  | 'all'
  | 'yarn'
  | 'bobbin'
  | 'sizing'
  | 'fabric'
  | 'general'
  | 'outsource_weaving';

type GstFilter = 'all' | 'with' | 'without';

interface RegisterRow {
  source: string | null;
  source_id: number | null;
  bill_date: string | null;
  bill_no: string | null;
  party_id: number | null;
  party_code: string | null;
  party_name: string | null;
  party_gstin: string | null;
  party_state: string | null;
  quantity: number | string | null;
  qty_uom: string | null;
  gst_pct: number | string | null;
  taxable: number | string | null;
  gst_amount: number | string | null;
  total: number | string | null;
  amount_paid: number | string | null;
  balance: number | string | null;
  status: string | null;
  is_interstate: boolean | null;
  cgst_amount: number | string | null;
  sgst_amount: number | string | null;
  igst_amount: number | string | null;
  gst_flag: string | null;
}

interface PartyOpt {
  id: number;
  code: string | null;
  name: string;
}

/* ─────────────── helpers ─────────────── */

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtRupees(
  n: number | string | null | undefined,
  decimals = 0,
): string {
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

function fmtNum(
  n: number | string | null | undefined,
  decimals = 0,
): string {
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

function sourceLabel(s: string | null): string {
  switch (s) {
    case 'yarn':              return 'Yarn';
    case 'bobbin':            return 'Bobbin';
    case 'sizing':            return 'Sizing';
    case 'fabric':            return 'Fabric';
    case 'general':           return 'General';
    case 'outsource_weaving': return 'Outsource';
    default:                  return s ?? '—';
  }
}

function sourceTone(s: string | null): string {
  switch (s) {
    case 'yarn':              return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'bobbin':            return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'sizing':            return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'fabric':            return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'general':           return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'outsource_weaving': return 'bg-rose-50 text-rose-700 border-rose-200';
    default:                  return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

function statusTone(s: string | null): string {
  if (s === 'paid')          return 'text-emerald-700';
  if (s === 'overdue')       return 'text-rose-700';
  if (s === 'partial_paid')  return 'text-amber-700';
  if (s === 'cancelled')     return 'text-rose-500';
  return 'text-ink-soft';
}

/* ─────────────── page ─────────────── */

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    party_id?: string;
    source?: string;
    gst?: string;
  }>;
}

const SOURCE_OPTIONS: SourceFilter[] = [
  'all',
  'yarn',
  'bobbin',
  'sizing',
  'fabric',
  'general',
  'outsource_weaving',
];

export default async function PurchaseRegisterReport({
  searchParams,
}: PageProps) {
  const sp = await searchParams;
  const from = sp.from ?? startOfMonthISO();
  const to = sp.to ?? todayISO();
  const partyIdParam = sp.party_id ?? '';
  const partyIdNum = partyIdParam ? Number(partyIdParam) : null;
  const source: SourceFilter = SOURCE_OPTIONS.includes(
    (sp.source ?? 'all') as SourceFilter,
  )
    ? ((sp.source ?? 'all') as SourceFilter)
    : 'all';
  const gst: GstFilter =
    sp.gst === 'with' || sp.gst === 'without' ? sp.gst : 'all';

  const supabase = await createClient();

  // v_purchase_register isn't in the generated DB types yet (added by
  // migration 175). Cast through any so the build doesn't choke until
  // types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Main query
  let query = sb
    .from('v_purchase_register')
    .select('*')
    .gte('bill_date', from)
    .lte('bill_date', to)
    .order('bill_date', { ascending: false })
    .order('bill_no', { ascending: false });

  if (partyIdNum != null && !Number.isNaN(partyIdNum)) {
    query = query.eq('party_id', partyIdNum);
  }
  if (source !== 'all') {
    query = query.eq('source', source);
  }
  if (gst === 'with') {
    query = query.eq('gst_flag', 'with_gst');
  } else if (gst === 'without') {
    query = query.eq('gst_flag', 'without_gst');
  }

  const [rowsRes, partyRes] = await Promise.all([
    query,
    // Suppliers dropdown — broad enough to cover all 5 sources.
    sb
      .from('party')
      .select('id, code, name')
      .eq('status', 'active')
      .order('name', { ascending: true })
      .limit(800),
  ]);

  const rows = (rowsRes.data as unknown as RegisterRow[]) ?? [];
  const parties = (partyRes.data as unknown as PartyOpt[]) ?? [];

  /* Excel export (matches the filtered rows shown below) */
  const exportColumns: ExcelColumn[] = [
    { key: 'bill_date', label: 'Date', type: 'date', width: 13 },
    { key: 'source', label: 'Source', type: 'text', width: 11 },
    { key: 'bill_no', label: 'Bill #', type: 'text', width: 16 },
    { key: 'supplier', label: 'Supplier', type: 'text', width: 28 },
    { key: 'party_gstin', label: 'GSTIN', type: 'text', width: 18 },
    { key: 'party_state', label: 'State', type: 'text', width: 16 },
    { key: 'quantity', label: 'Qty', type: 'number', width: 10, total: true },
    { key: 'qty_uom', label: 'UoM', type: 'text', width: 7 },
    { key: 'gst_pct', label: 'GST %', type: 'number', width: 8 },
    { key: 'taxable', label: 'Taxable', type: 'rupee', width: 14, total: true },
    { key: 'cgst_amount', label: 'CGST', type: 'rupee', width: 12, total: true },
    { key: 'sgst_amount', label: 'SGST', type: 'rupee', width: 12, total: true },
    { key: 'igst_amount', label: 'IGST', type: 'rupee', width: 12, total: true },
    { key: 'total', label: 'Total', type: 'rupee', width: 14, total: true },
    { key: 'amount_paid', label: 'Paid', type: 'rupee', width: 13, total: true },
    { key: 'balance', label: 'Balance', type: 'rupee', width: 13, total: true },
    { key: 'status', label: 'Status', type: 'text', width: 12 },
  ];
  const exportRows = rows.map((r) => ({
    bill_date: r.bill_date ?? '',
    source: sourceLabel(r.source),
    bill_no: r.bill_no ?? '',
    supplier: r.party_code
      ? `${r.party_name ?? ''} (${r.party_code})`
      : r.party_name ?? '',
    party_gstin: r.party_gstin ?? '',
    party_state: r.party_state ?? '',
    quantity: Number(r.quantity ?? 0),
    qty_uom: r.qty_uom ?? '',
    gst_pct: Number(r.gst_pct ?? 0),
    taxable: Number(r.taxable ?? 0),
    cgst_amount: Number(r.cgst_amount ?? 0),
    sgst_amount: Number(r.sgst_amount ?? 0),
    igst_amount: Number(r.igst_amount ?? 0),
    total: Number(r.total ?? 0),
    amount_paid: Number(r.amount_paid ?? 0),
    balance: Number(r.balance ?? 0),
    status: r.status ?? '',
  }));

  // Aggregates
  const n = rows.length;
  const totalTaxable = rows.reduce(
    (s, r) => s + Number(r.taxable ?? 0),
    0,
  );
  const totalCgst = rows.reduce(
    (s, r) => s + Number(r.cgst_amount ?? 0),
    0,
  );
  const totalSgst = rows.reduce(
    (s, r) => s + Number(r.sgst_amount ?? 0),
    0,
  );
  const totalIgst = rows.reduce(
    (s, r) => s + Number(r.igst_amount ?? 0),
    0,
  );
  const totalGst = totalCgst + totalSgst + totalIgst;
  const totalTotal = rows.reduce(
    (s, r) => s + Number(r.total ?? 0),
    0,
  );
  const totalPaid = rows.reduce(
    (s, r) => s + Number(r.amount_paid ?? 0),
    0,
  );
  const totalBalance = rows.reduce(
    (s, r) => s + Number(r.balance ?? 0),
    0,
  );

  // Counts per gst flag
  const cntWithGst = rows.filter((r) => r.gst_flag === 'with_gst').length;
  const cntWithoutGst = rows.filter(
    (r) => r.gst_flag === 'without_gst',
  ).length;

  return (
    <div>
      <PageHeader
        title="Purchase Register"
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Purchase Register' },
        ]}
        subtitle={`Every supplier bill between ${from} and ${to}. Unions yarn, bobbin, sizing, fabric, and outsource-weaving bills. GST split is auto-derived from supplier state.`}
        actions={
          <ExcelExportButton
            filename="purchase-register"
            sheetName="Purchase Register"
            title={`Purchase Register · ${from} to ${to}`}
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
          <span className="text-xs text-ink-mute">Supplier</span>
          <select
            name="party_id"
            defaultValue={partyIdParam}
            className="input min-w-[200px]"
          >
            <option value="">All suppliers</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `${p.code} — ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Source</span>
          <select name="source" defaultValue={source} className="input">
            <option value="all">All</option>
            <option value="yarn">Yarn</option>
            <option value="bobbin">Bobbin</option>
            <option value="sizing">Sizing</option>
            <option value="fabric">Fabric</option>
            <option value="general">General</option>
            <option value="outsource_weaving">Outsource Weaving</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">GST</span>
          <select name="gst" defaultValue={gst} className="input">
            <option value="all">All</option>
            <option value="with">With GST</option>
            <option value="without">Without GST</option>
          </select>
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
        <a
          href="/app/reports/purchase-register"
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
          sub={`${cntWithGst} with GST · ${cntWithoutGst} without GST`}
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
          sub={`Paid ${fmtRupees(totalPaid)} · Balance ${fmtRupees(totalBalance)}`}
        />
      </div>

      {/* ─────────────── Error / empty / table ─────────────── */}
      {rowsRes.error && (
        <div className="card p-4 text-sm text-err mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load purchase data.</div>
            <div className="text-xs opacity-80 mt-1">
              {rowsRes.error.message}
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && !rowsRes.error ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No supplier bills in this window with the current filters.
        </div>
      ) : rows.length > 0 ? (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Bill #</th>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-left px-3 py-2">GSTIN</th>
                <th className="text-left px-3 py-2">State</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">GST %</th>
                <th className="text-right px-3 py-2">Taxable ₹</th>
                <th className="text-right px-3 py-2">CGST</th>
                <th className="text-right px-3 py-2">SGST</th>
                <th className="text-right px-3 py-2">IGST</th>
                <th className="text-right px-3 py-2">Total ₹</th>
                <th className="text-right px-3 py-2">Paid ₹</th>
                <th className="text-right px-3 py-2">Balance ₹</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const withoutGst = r.gst_flag === 'without_gst';
                return (
                  <tr
                    key={`${r.source}-${r.source_id ?? i}`}
                    className={`border-t border-line/40 ${withoutGst ? 'bg-slate-50/40' : ''}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDate(r.bill_date)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${sourceTone(r.source)}`}
                      >
                        {sourceLabel(r.source)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.bill_no ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">
                        {r.party_name ?? '—'}
                      </span>
                      {r.party_code ? (
                        <span className="ml-1 text-xs text-ink-mute">
                          ({r.party_code})
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
                      {fmtNum(r.quantity, 2)}
                      <span className="ml-1 text-[10px] text-ink-mute">
                        {r.qty_uom ?? ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {Number(r.gst_pct ?? 0) > 0
                        ? `${fmtNum(r.gst_pct, 0)}%`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(r.taxable, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.cgst_amount, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.sgst_amount, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.igst_amount, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {fmtRupees(r.total, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs text-emerald-700">
                      {fmtRupees(r.amount_paid, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      <span
                        className={
                          Number(r.balance ?? 0) > 0
                            ? 'text-rose-700'
                            : 'text-ink-soft'
                        }
                      >
                        {fmtRupees(r.balance, 2)}
                      </span>
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
                  Totals ({n} bill{n === 1 ? '' : 's'})
                </td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2"></td>
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
                <td className="px-3 py-2 text-right num">
                  {fmtRupees(totalPaid, 2)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtRupees(totalBalance, 2)}
                </td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-ink-mute mt-4">
        Source: <span className="font-mono">v_purchase_register</span>{' '}
        (migration 175). Draft and cancelled documents are excluded. (IS) =
        interstate bill — supplier outside your home state, so GST shows as
        IGST instead of CGST + SGST. Rows shaded grey are without-GST (cash
        purchases / unregistered suppliers).
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
