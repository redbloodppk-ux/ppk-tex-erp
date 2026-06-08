/**
 * Per-quality fabric stock ledger.
 *
 * This is the drill-down view from the In-house Fabric Stock tab: pick a
 * quality and you see EVERY metre that ever entered or left the shed for
 * that exact fabric quality, in chronological order, with a running
 * balance column on the right.
 *
 * Inflows come from fabric_receipt_item (cloth arriving in the shed —
 * whether from our own loom, a jobwork weaver, an outsource weaver or a
 * resale purchase). Outflows come from delivery_challan_item across all
 * three DC modes:
 *   • inhouse   → sale to customer (invoiced)
 *   • outsource → fabric sent out to a vendor or sold
 *   • jobwork   → finished cloth returned to the yarn owner
 *
 * The balance column shows the running on-hand metres after each event,
 * so the operator can verify against physical stock at any point in
 * history.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Layers, TrendingDown, TrendingUp, Coins, Calendar } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatMetres } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ qualityId: string }>;
}): Promise<{ title: string }> {
  const { qualityId } = await params;
  return { title: `Fabric Stock Ledger — Quality #${qualityId}` };
}

type SourceKind = 'inhouse' | 'jobwork' | 'outsource' | 'resale' | 'unknown';

type LedgerStatus =
  | 'in_stock'
  | 'invoiced_paid'
  | 'invoiced_unpaid'
  | 'invoiced_partial'
  | 'draft_dc'
  | 'jobwork_return'
  | 'outsource_send';

interface LedgerRow {
  id: string;
  direction: 'in' | 'out';
  event_date: string;
  source_kind: SourceKind;
  dc_id: number | null;
  dc_code: string | null;
  receipt_id: number | null;
  receipt_code: string | null;
  invoice_id: number | null;
  invoice_no: string | null;
  party_name: string;
  metres: number;
  invoice_total: number;
  invoice_paid: number;
  invoice_balance: number;
  status: LedgerStatus;
}

const STATUS_PILL: Record<LedgerStatus, { label: string; cls: string }> = {
  in_stock:         { label: 'In Stock',         cls: 'bg-emerald-50 text-emerald-700' },
  invoiced_paid:    { label: 'Invoiced · Paid',  cls: 'bg-emerald-100 text-emerald-800' },
  invoiced_partial: { label: 'Invoiced · Part',  cls: 'bg-amber-50 text-amber-700' },
  invoiced_unpaid:  { label: 'Invoiced · Unpaid',cls: 'bg-rose-50 text-rose-700' },
  draft_dc:         { label: 'DC (no invoice)',  cls: 'bg-slate-100 text-slate-600' },
  jobwork_return:   { label: 'Jobwork Return',   cls: 'bg-amber-50 text-amber-700' },
  outsource_send:   { label: 'Outsource Send',   cls: 'bg-indigo-50 text-indigo-700' },
};

const SOURCE_LABEL: Record<SourceKind, string> = {
  inhouse:   'In-house',
  jobwork:   'Job Work',
  outsource: 'Outsource',
  resale:    'Resale',
  unknown:   '—',
};

const SOURCE_PILL: Record<SourceKind, string> = {
  inhouse:   'bg-emerald-50 text-emerald-700',
  jobwork:   'bg-amber-50 text-amber-700',
  outsource: 'bg-indigo-50 text-indigo-700',
  resale:    'bg-cyan-50 text-cyan-700',
  unknown:   'bg-slate-100 text-slate-500',
};

const FILTER_PILLS: Array<{ key: string; label: string }> = [
  { key: 'all',       label: 'All Events' },
  { key: 'in',        label: 'IN only' },
  { key: 'out',       label: 'OUT only' },
  { key: 'inhouse',   label: 'In-house' },
  { key: 'jobwork',   label: 'Jobwork' },
  { key: 'outsource', label: 'Outsource' },
];

function sourceKindFromMode(mode: string | null | undefined): SourceKind {
  if (mode === 'inhouse') return 'inhouse';
  if (mode === 'jobwork') return 'jobwork';
  if (mode === 'outsource') return 'outsource';
  return 'unknown';
}

function statusForOut(
  inv: { total?: number; amount_paid?: number; balance?: number } | null,
  sourceKind: SourceKind,
): LedgerStatus {
  if (!inv) {
    if (sourceKind === 'jobwork')   return 'jobwork_return';
    if (sourceKind === 'outsource') return 'outsource_send';
    return 'draft_dc';
  }
  const total = Number(inv.total ?? 0);
  const paid  = Number(inv.amount_paid ?? 0);
  const balance = Number(inv.balance ?? Math.max(0, total - paid));
  if (balance <= 0.01 && total > 0) return 'invoiced_paid';
  if (paid > 0 && balance > 0.01) return 'invoiced_partial';
  return 'invoiced_unpaid';
}

interface QualityHeader {
  id: number;
  code: string;
  name: string | null;
}

async function loadQuality(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  qualityId: number,
): Promise<QualityHeader | null> {
  const { data } = await supabase
    .from('fabric_quality')
    .select('id, code, name')
    .eq('id', qualityId)
    .maybeSingle();
  if (!data) return null;
  return { id: Number(data.id), code: String(data.code ?? '—'), name: data.name ?? null };
}

async function loadLedger(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  qualityId: number,
): Promise<LedgerRow[]> {
  // ── IN side ──
  const { data: inRowsRaw } = await supabase
    .from('fabric_receipt_item')
    .select(`
      id, fabric_quality_id, received_metres,
      receipt:receipt_id (
        id, code, receipt_date, party_id,
        dc:dc_id ( id, code, production_mode ),
        party:party_id ( id, name )
      )
    `)
    .eq('fabric_quality_id', qualityId);

  // ── OUT side: ALL DC types reduce in-house fabric stock ──
  const { data: outRowsRaw } = await supabase
    .from('delivery_challan_item')
    .select(`
      id, fabric_quality_id, metres,
      dc:dc_id!inner (
        id, code, dc_date, status, production_mode, invoice_id, bill_to_name,
        invoice:invoice_id ( id, invoice_no, total, amount_paid, balance, status )
      )
    `)
    .eq('fabric_quality_id', qualityId)
    .in('dc.production_mode', ['inhouse', 'outsource', 'jobwork']);

  type InRaw = {
    id: number; fabric_quality_id: number | null; received_metres: number | string | null;
    receipt: {
      id: number; code: string | null; receipt_date: string | null; party_id: number | null;
      dc: { id: number; code: string | null; production_mode: string | null } | null;
      party: { id: number; name: string | null } | null;
    } | null;
  };

  const inRows: LedgerRow[] = ((inRowsRaw ?? []) as InRaw[]).map((r): LedgerRow => ({
    id: `in:${r.id}`,
    direction: 'in',
    event_date: r.receipt?.receipt_date ?? '',
    source_kind: sourceKindFromMode(r.receipt?.dc?.production_mode),
    dc_id: r.receipt?.dc?.id ?? null,
    dc_code: r.receipt?.dc?.code ?? null,
    receipt_id: r.receipt?.id ?? null,
    receipt_code: r.receipt?.code ?? null,
    invoice_id: null,
    invoice_no: null,
    party_name: r.receipt?.party?.name ?? '—',
    metres: Number(r.received_metres ?? 0),
    invoice_total: 0,
    invoice_paid: 0,
    invoice_balance: 0,
    status: 'in_stock',
  }));

  type OutRaw = {
    id: number; fabric_quality_id: number | null; metres: number | string | null;
    dc: {
      id: number; code: string | null; dc_date: string | null; status: string | null;
      production_mode: string | null; invoice_id: number | null; bill_to_name: string | null;
      invoice: {
        id: number; invoice_no: string | null; total: number | string | null;
        amount_paid: number | string | null; balance: number | string | null; status: string | null;
      } | null;
    };
  };

  const outRows: LedgerRow[] = ((outRowsRaw ?? []) as OutRaw[]).map((r): LedgerRow => {
    const inv = r.dc?.invoice ?? null;
    const sourceKind = sourceKindFromMode(r.dc?.production_mode);
    const total = Number(inv?.total ?? 0);
    const paid  = Number(inv?.amount_paid ?? 0);
    const balance = Number(inv?.balance ?? Math.max(0, total - paid));
    return {
      id: `out:${r.id}`,
      direction: 'out',
      event_date: r.dc?.dc_date ?? '',
      source_kind: sourceKind,
      dc_id: r.dc?.id ?? null,
      dc_code: r.dc?.code ?? null,
      receipt_id: null,
      receipt_code: null,
      invoice_id: inv?.id ?? null,
      invoice_no: inv?.invoice_no ?? null,
      party_name: r.dc?.bill_to_name ?? '—',
      metres: Number(r.metres ?? 0),
      invoice_total: total,
      invoice_paid: paid,
      invoice_balance: balance,
      status: statusForOut(
        inv
          ? { total, amount_paid: paid, balance }
          : null,
        sourceKind,
      ),
    };
  });

  // Chronological order: OLDEST first so the running balance below
  // walks the timeline forward. We'll reverse for display so the
  // operator sees the most recent event at the top (with its closing
  // balance still correct).
  return [...inRows, ...outRows].sort((a, b) => {
    if (a.event_date === b.event_date) {
      // Apply IN before OUT on same day so the day's receipts are in
      // stock before the day's DCs are deducted.
      if (a.direction !== b.direction) return a.direction === 'in' ? -1 : 1;
      return a.id.localeCompare(b.id);
    }
    return a.event_date < b.event_date ? -1 : 1;
  });
}

interface KpiProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'ok' | 'warn' | 'mute';
}

function Kpi({ label, value, icon: Icon, tone = 'mute' }: KpiProps) {
  const toneCls =
    tone === 'ok'   ? 'bg-emerald-50 text-emerald-700' :
    tone === 'warn' ? 'bg-amber-50 text-amber-700' :
    'bg-cloud text-ink-soft';
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-md flex items-center justify-center ${toneCls}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-ink-mute">{label}</div>
        <div className="font-semibold text-lg truncate">{value}</div>
      </div>
    </div>
  );
}

interface PageProps {
  params: Promise<{ qualityId: string }>;
  searchParams: Promise<{ filter?: string }>;
}

export default async function FabricStockLedgerPage({
  params,
  searchParams,
}: PageProps) {
  const { qualityId: qidStr } = await params;
  const sp = await searchParams;
  const filter = sp.filter ?? 'all';

  const qualityId = Number.parseInt(qidStr, 10);
  if (!Number.isFinite(qualityId)) notFound();

  const supabase = await createClient();
  const quality = await loadQuality(supabase, qualityId);
  if (!quality) notFound();

  const rows = await loadLedger(supabase, qualityId);

  // Apply the filter.
  const filteredAsc = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'in')  return r.direction === 'in';
    if (filter === 'out') return r.direction === 'out';
    return r.source_kind === filter;
  });

  // Walk forward (oldest → newest) to compute running balance based on
  // the full unfiltered timeline, so the balance column reflects true
  // on-hand at each event, even when a filter is applied. Then we
  // attach the balance to filtered rows by id.
  const runningById = new Map<string, number>();
  let running = 0;
  for (const r of rows) {
    running += r.direction === 'in' ? r.metres : -r.metres;
    runningById.set(r.id, running);
  }
  const closingBalance = running;

  // Display newest first.
  const filteredForDisplay = [...filteredAsc].reverse();

  // KPI numbers always over the full (unfiltered) ledger so the user
  // gets the real bird's-eye totals.
  const totalIn   = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.metres, 0);
  const totalOut  = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.metres, 0);
  const lastMoveDate = rows.length > 0 ? rows[rows.length - 1]!.event_date : '';

  // Excel-friendly CSV link (data URL) — opens in Excel directly.
  const csvHeader = ['Date', 'Direction', 'Source', 'DC', 'Fabric Receipt', 'Invoice', 'Party', 'Metres', 'Status', 'Running Balance (m)'].join(',');
  const csvBody = filteredAsc.map((r) => {
    const cells = [
      r.event_date,
      r.direction.toUpperCase(),
      SOURCE_LABEL[r.source_kind],
      r.dc_code ?? '',
      r.receipt_code ?? '',
      r.invoice_no ?? '',
      r.party_name.replace(/,/g, ' '),
      r.metres.toFixed(2),
      STATUS_PILL[r.status].label,
      (runningById.get(r.id) ?? 0).toFixed(2),
    ];
    return cells.join(',');
  });
  const csv = [csvHeader, ...csvBody].join('\n');
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return (
    <main className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <Link
          href="/app/warehouse?mode=inhouse&tab=fabric&view=lineage"
          className="text-sm text-ink-soft hover:text-ink inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to In-house Fabric
        </Link>
        <a
          href={csvHref}
          download={`fabric-ledger-${quality.code}.csv`}
          className="btn btn-soft text-sm"
        >
          Export CSV
        </a>
      </div>

      <PageHeader
        title={`Fabric Ledger — ${quality.code}`}
        subtitle={quality.name ?? 'Per-event stock movement (IN + OUT) for this quality'}
      />

      <div className="grid sm:grid-cols-4 gap-3 mt-4 mb-3">
        <Kpi
          label="Total Received"
          value={formatMetres(totalIn, 1)}
          icon={TrendingUp}
          tone="ok"
        />
        <Kpi
          label="Total Sold / Out"
          value={formatMetres(totalOut, 1)}
          icon={TrendingDown}
          tone="warn"
        />
        <Kpi
          label="On-hand Balance"
          value={formatMetres(closingBalance, 1)}
          icon={Layers}
          tone={closingBalance > 0 ? 'ok' : 'mute'}
        />
        <Kpi
          label="Last Move"
          value={lastMoveDate || '—'}
          icon={Calendar}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {FILTER_PILLS.map((p) => (
          <Link
            key={p.key}
            href={`/app/warehouse/fabric/${qualityId}${p.key === 'all' ? '' : `?filter=${p.key}`}`}
            className={
              'px-3 py-1.5 rounded-full text-xs font-medium border transition ' +
              (filter === p.key
                ? 'bg-ink text-white border-ink'
                : 'bg-white text-ink-soft border-line/60 hover:bg-cloud/40')
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      {filteredForDisplay.length === 0 ? (
        <div className="card p-8 text-center text-ink-soft text-sm">
          No events match this filter.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Source</th>
                <th className="text-left  px-3 py-3">DC</th>
                <th className="text-left  px-3 py-3">Receipt</th>
                <th className="text-left  px-3 py-3">Invoice</th>
                <th className="text-left  px-3 py-3">Party</th>
                <th className="text-right px-3 py-3">Metres</th>
                <th className="text-left  px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Balance (m)</th>
              </tr>
            </thead>
            <tbody>
              {filteredForDisplay.map((r) => {
                const pill = STATUS_PILL[r.status];
                const bal = runningById.get(r.id) ?? 0;
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">
                      {r.event_date || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={
                            'inline-block w-1.5 h-1.5 rounded-full ' +
                            (r.direction === 'in' ? 'bg-emerald-500' : 'bg-rose-500')
                          }
                        />
                        <span className={`px-2 py-0.5 rounded text-[10px] ${SOURCE_PILL[r.source_kind]}`}>
                          {SOURCE_LABEL[r.source_kind]}
                        </span>
                        <span className="text-[10px] text-ink-mute">
                          {r.direction === 'in' ? 'IN' : 'OUT'}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.dc_id != null ? (
                        <Link href={`/app/delivery-challan/${r.dc_id}`} className="text-indigo-700 hover:underline">
                          {r.dc_code ?? '—'}
                        </Link>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.receipt_id != null ? (
                        <Link
                          href={`/app/jobwork/fabric-receipt/${r.receipt_id}`}
                          className="text-indigo-700 hover:underline"
                        >
                          {r.receipt_code ?? '—'}
                        </Link>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.invoice_id != null ? (
                        <Link href={`/app/invoices/${r.invoice_id}`} className="text-indigo-700 hover:underline">
                          {r.invoice_no ?? `#${r.invoice_id}`}
                        </Link>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.party_name}</td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      <span className={r.direction === 'in' ? 'text-emerald-700' : 'text-rose-600'}>
                        {r.direction === 'in' ? '+' : '−'}
                        {formatMetres(r.metres, 1)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`pill ${pill.cls} text-[11px] uppercase tracking-wide`}>{pill.label}</span>
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {formatMetres(bal, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-cloud/40 border-t border-line/40">
                <td className="px-3 py-3 text-xs font-semibold" colSpan={6}>
                  Closing balance (after all events above) — note: balance column reflects the FULL timeline, not just the filtered view
                </td>
                <td className="px-3 py-3 text-right num font-semibold" colSpan={2}>
                  IN {formatMetres(totalIn, 1)} · OUT {formatMetres(totalOut, 1)}
                </td>
                <td className="px-3 py-3 text-right num font-bold">
                  {formatMetres(closingBalance, 1)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[11px] text-ink-mute mt-3">
        IN rows are Fabric Receipts (cloth arriving in the shed). OUT rows are Delivery Challans across every
        production mode: in-house sales, outsource sends, and jobwork returns. The right-hand Balance column
        shows the running on-hand metres after each event in chronological order, so you can verify against
        physical stock at any historical point.
      </p>
    </main>
  );
}
