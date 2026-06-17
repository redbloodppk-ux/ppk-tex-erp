/**
 * Fabric Movements report
 *
 * Per-event audit log of every fabric movement: each row is either
 *   • IN  — a fabric_receipt_item or fabric_purchase delivery (resale),
 *           tagged with its source DC and party (the weaver / supplier).
 *   • OUT — a delivery_challan_item heading out to a customer (or a
 *           jobwork return / outsource send), joined to its sales
 *           invoice + payment rollup; plus Fabric Sale "Direct from
 *           Stock" invoice lines.
 *
 * The data + status-pill logic was previously the second half of the
 * warehouse In-house → Fabric (m) tab. It's a read-only owner view, so
 * lifting it into Reports & Alerts keeps the warehouse page focused on
 * live stock and gives the owner a permanent home for the audit trail.
 *
 * URL params:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (defaults: 1st of this month → today)
 *   ?party=<text>                     (case-insensitive substring on party_name)
 *   ?quality_id=<id>                  (optional fabric_quality.id filter)
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import { formatMetres, formatRupee } from '@/lib/utils';
import type { ExcelColumn } from '@/lib/xlsx';
import { Layers, Truck, Coins, AlertCircle } from 'lucide-react';

export const metadata = { title: 'Fabric Movements' };
export const dynamic = 'force-dynamic';

/* ─────────────── types ─────────────── */

type FabricLineageDirection = 'in' | 'out';
type FabricLineageStatus =
  | 'in_stock'
  | 'invoiced_paid'
  | 'invoiced_unpaid'
  | 'invoiced_partial'
  | 'draft_dc';

interface FabricLineageRow {
  id: string;
  direction: FabricLineageDirection;
  event_date: string;
  quality_id: number | null;
  quality_code: string;
  quality_name: string;
  source_kind: 'inhouse' | 'jobwork' | 'outsource' | 'resale' | 'unknown';
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
  status: FabricLineageStatus;
}

interface FabricQualityOpt {
  id: number;
  code: string;
  name: string;
}

const LINEAGE_STATUS_PILL: Record<FabricLineageStatus, { label: string; cls: string }> = {
  in_stock:         { label: 'In Stock',          cls: 'bg-emerald-50 text-emerald-700' },
  invoiced_paid:    { label: 'Invoiced · Paid',   cls: 'bg-emerald-100 text-emerald-800' },
  invoiced_partial: { label: 'Invoiced · Part',   cls: 'bg-amber-50 text-amber-700' },
  invoiced_unpaid:  { label: 'Invoiced · Unpaid', cls: 'bg-rose-50 text-rose-700' },
  draft_dc:         { label: 'DC (no invoice)',   cls: 'bg-slate-100 text-slate-600' },
};

const SOURCE_KIND_LABEL: Record<FabricLineageRow['source_kind'], string> = {
  inhouse:   'In-house',
  jobwork:   'Job Work',
  outsource: 'Outsource',
  resale:    'Resale',
  unknown:   '—',
};

/* ─────────────── small helpers ─────────────── */

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/* ─────────────── data loader ─────────────── */
/* Mirrors warehouse/page.tsx `loadFabricLineage`. Lifted here so the
 * report can live without depending on the warehouse module. The query
 * shape is unchanged so the per-event status pills remain consistent
 * with the warehouse fabric ledger.
 *
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFabricLineage(supabase: any, qualityFilter: number | null): Promise<FabricLineageRow[]> {
  // IN side: fabric_receipt_item × fabric_receipt × delivery_challan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inQ: any = supabase.from('fabric_receipt_item').select(`
    id, fabric_quality_id, received_metres,
    receipt:receipt_id (
      id, code, receipt_date, party_id,
      dc:dc_id ( id, code, production_mode ),
      party:party_id ( id, name )
    )
  `);
  if (qualityFilter !== null) inQ = inQ.eq('fabric_quality_id', qualityFilter);
  const { data: inRowsRaw } = await inQ;

  // OUT side: delivery_challan_item × delivery_challan × invoice — for
  // all three DC modes (inhouse / outsource / jobwork) because cloth
  // physically leaves the shed in every case.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let outQ: any = supabase.from('delivery_challan_item').select(`
    id, fabric_quality_id, metres,
    dc:dc_id!inner (
      id, code, dc_date, status, production_mode, invoice_id, bill_to_name,
      invoice:invoice_id ( id, invoice_no, total, amount_paid, balance, status )
    )
  `).in('dc.production_mode', ['inhouse', 'outsource', 'jobwork']);
  if (qualityFilter !== null) outQ = outQ.eq('fabric_quality_id', qualityFilter);
  const { data: outRowsRaw } = await outQ;

  // IN side 2: fabric purchases delivered to in-house (resale stock)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let purQ: any = supabase.from('fabric_purchase').select(`
    id, code, received_date, received_metres, fabric_quality_id,
    supplier:supplier_party_id ( name )
  `).eq('status', 'active').eq('delivery_destination', 'in_house');
  if (qualityFilter !== null) purQ = purQ.eq('fabric_quality_id', qualityFilter);
  const { data: purRowsRaw } = await purQ;

  // OUT side 2: Fabric Sale invoice lines that sold "Direct from Stock"
  // (each carries the fabric_purchase batch it sold from).
  const { data: saleRowsRaw } = await supabase.from('invoice_line').select(`
    id, quantity,
    purchase:fabric_purchase_id!inner ( id, code, fabric_quality_id ),
    invoice:invoice_id!inner ( id, invoice_no, invoice_date, total, amount_paid, balance, status, party_name )
  `).not('fabric_purchase_id', 'is', null);

  // Quality lookup — one round-trip for all distinct quality ids seen.
  const qIds = new Set<number>();
  for (const r of (inRowsRaw ?? []) as Array<{ fabric_quality_id: number | null }>) {
    if (r.fabric_quality_id) qIds.add(r.fabric_quality_id);
  }
  for (const r of (outRowsRaw ?? []) as Array<{ fabric_quality_id: number | null }>) {
    if (r.fabric_quality_id) qIds.add(r.fabric_quality_id);
  }
  for (const r of (purRowsRaw ?? []) as Array<{ fabric_quality_id: number | null }>) {
    if (r.fabric_quality_id) qIds.add(r.fabric_quality_id);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((saleRowsRaw ?? []) as any[])) {
    if (r.purchase?.fabric_quality_id) qIds.add(Number(r.purchase.fabric_quality_id));
  }

  let qualityById = new Map<number, { code: string; name: string }>();
  if (qIds.size > 0) {
    const { data: qRows } = await supabase
      .from('fabric_quality')
      .select('id, code, name')
      .in('id', Array.from(qIds));
    qualityById = new Map(
      ((qRows ?? []) as Array<{ id: number; code: string; name: string }>).map(
        (q) => [q.id, { code: q.code, name: q.name }],
      ),
    );
  }

  const sourceKindFromMode = (m: string | null | undefined): FabricLineageRow['source_kind'] => {
    if (m === 'inhouse') return 'inhouse';
    if (m === 'jobwork') return 'jobwork';
    if (m === 'outsource') return 'outsource';
    return 'unknown';
  };

  const inRows: FabricLineageRow[] = ((inRowsRaw ?? []) as Array<{
    id: number;
    fabric_quality_id: number | null;
    received_metres: number | string | null;
    receipt: {
      id: number; code: string | null; receipt_date: string | null; party_id: number | null;
      dc: { id: number; code: string | null; production_mode: string | null } | null;
      party: { id: number; name: string | null } | null;
    } | null;
  }>).map((r): FabricLineageRow => {
    const qid = r.fabric_quality_id;
    const q = qid != null ? qualityById.get(qid) : null;
    return {
      id: `in:${r.id}`,
      direction: 'in',
      event_date: r.receipt?.receipt_date ?? '',
      quality_id: qid,
      quality_code: q?.code ?? '—',
      quality_name: q?.name ?? '',
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
    };
  });

  const outRows: FabricLineageRow[] = ((outRowsRaw ?? []) as Array<{
    id: number;
    fabric_quality_id: number | null;
    metres: number | string | null;
    dc: {
      id: number; code: string | null; dc_date: string | null; status: string | null;
      production_mode: string | null; invoice_id: number | null; bill_to_name: string | null;
      invoice: {
        id: number; invoice_no: string | null; total: number | string | null;
        amount_paid: number | string | null; balance: number | string | null; status: string | null;
      } | null;
    };
  }>).map((r): FabricLineageRow => {
    const qid = r.fabric_quality_id;
    const q = qid != null ? qualityById.get(qid) : null;
    const inv = r.dc?.invoice ?? null;
    const total = Number(inv?.total ?? 0);
    const paid  = Number(inv?.amount_paid ?? 0);
    const balance = Number(inv?.balance ?? Math.max(0, total - paid));
    let status: FabricLineageStatus;
    if (!inv) status = 'draft_dc';
    else if (balance <= 0.01 && total > 0) status = 'invoiced_paid';
    else if (paid > 0 && balance > 0.01) status = 'invoiced_partial';
    else status = 'invoiced_unpaid';
    return {
      id: `out:${r.id}`,
      direction: 'out',
      event_date: r.dc?.dc_date ?? '',
      quality_id: qid,
      quality_code: q?.code ?? '—',
      quality_name: q?.name ?? '',
      source_kind: sourceKindFromMode(r.dc?.production_mode),
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
      status,
    };
  });

  // Fabric purchases → IN events (resale stock arriving)
  const purchaseRows: FabricLineageRow[] = ((purRowsRaw ?? []) as Array<{
    id: number; code: string | null; received_date: string | null;
    received_metres: number | string | null; fabric_quality_id: number | null;
    supplier: { name: string | null } | null;
  }>).map((r): FabricLineageRow => {
    const q = r.fabric_quality_id != null ? qualityById.get(r.fabric_quality_id) : null;
    return {
      id: `fp:${r.id}`,
      direction: 'in',
      event_date: r.received_date ?? '',
      quality_id: r.fabric_quality_id,
      quality_code: q?.code ?? '—',
      quality_name: q?.name ?? '',
      source_kind: 'resale',
      dc_id: null,
      dc_code: r.code,
      receipt_id: null,
      receipt_code: null,
      invoice_id: null,
      invoice_no: null,
      party_name: r.supplier?.name ?? '—',
      metres: Number(r.received_metres ?? 0),
      invoice_total: 0,
      invoice_paid: 0,
      invoice_balance: 0,
      status: 'in_stock',
    };
  });

  // Fabric Sale "Direct from Stock" lines → OUT events
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saleRows: FabricLineageRow[] = (((saleRowsRaw ?? []) as any[])
    .filter((r) => qualityFilter === null || Number(r.purchase?.fabric_quality_id) === qualityFilter)
    .map((r): FabricLineageRow => {
      const qid = r.purchase?.fabric_quality_id != null ? Number(r.purchase.fabric_quality_id) : null;
      const q = qid != null ? qualityById.get(qid) : null;
      const total = Number(r.invoice?.total ?? 0);
      const paid = Number(r.invoice?.amount_paid ?? 0);
      const balance = Number(r.invoice?.balance ?? Math.max(0, total - paid));
      let status: FabricLineageStatus;
      if (balance <= 0.01 && total > 0) status = 'invoiced_paid';
      else if (paid > 0 && balance > 0.01) status = 'invoiced_partial';
      else status = 'invoiced_unpaid';
      return {
        id: `sale:${r.id}`,
        direction: 'out',
        event_date: String(r.invoice?.invoice_date ?? ''),
        quality_id: qid,
        quality_code: q?.code ?? '—',
        quality_name: q?.name ?? '',
        source_kind: 'resale',
        dc_id: null,
        dc_code: r.purchase?.code ?? null,
        receipt_id: null,
        receipt_code: null,
        invoice_id: r.invoice?.id ?? null,
        invoice_no: r.invoice?.invoice_no ?? null,
        party_name: r.invoice?.party_name ?? '—',
        metres: Number(r.quantity ?? 0),
        invoice_total: total,
        invoice_paid: paid,
        invoice_balance: balance,
        status,
      };
    }));

  return [...inRows, ...outRows, ...purchaseRows, ...saleRows].sort((a, b) =>
    a.event_date === b.event_date ? a.id.localeCompare(b.id) : (a.event_date < b.event_date ? 1 : -1),
  );
}

/* ─────────────── page ─────────────── */

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    party?: string;
    quality_id?: string;
  }>;
}

export default async function FabricMovementsReport({ searchParams }: PageProps) {
  const sp = await searchParams;
  const from = sp.from ?? startOfMonthISO();
  const to = sp.to ?? todayISO();
  const partyFilter = (sp.party ?? '').trim();
  const qualityIdParam = sp.quality_id ?? '';
  const qualityIdNum =
    qualityIdParam && /^\d+$/.test(qualityIdParam) ? Number(qualityIdParam) : null;

  const supabase = await createClient();

  const [allRows, qRes] = await Promise.all([
    loadFabricLineage(supabase, qualityIdNum).catch((): FabricLineageRow[] => []),
    supabase
      .from('fabric_quality')
      .select('id, code, name')
      .order('code', { ascending: true })
      .limit(500),
  ]);

  const qualities = (qRes.data as unknown as FabricQualityOpt[]) ?? [];
  const loadError = qRes.error?.message ?? null;

  // Apply date + party filters in-memory. The loader fans out across
  // multiple source tables (receipts, DCs, purchases, sale lines) so a
  // single SQL date predicate would be awkward; doing it here keeps the
  // status-pill logic single-sourced.
  const rows = allRows.filter((r) => {
    // event_date may be '' (string) for orphan rows — treat those as
    // out-of-range so an unbounded sale line doesn't sneak in.
    const d = r.event_date || '';
    if (d && (d < from || d > to)) return false;
    if (!d) return false;
    if (partyFilter) {
      const needle = partyFilter.toLowerCase();
      const hay = (r.party_name ?? '').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // KPI strip: same numbers as the warehouse FabricLineageView.
  const received = rows
    .filter((r) => r.direction === 'in')
    .reduce((s, r) => s + r.metres, 0);
  const invoicedOut = rows
    .filter((r) => r.direction === 'out')
    .reduce((s, r) => s + r.metres, 0);
  const unpaidValue = rows
    .filter(
      (r) =>
        r.direction === 'out' &&
        (r.status === 'invoiced_unpaid' || r.status === 'invoiced_partial'),
    )
    .reduce((s, r) => s + r.invoice_balance, 0);

  // Excel export columns. Status uses the friendly label so the sheet
  // matches the on-screen pill.
  const exportColumns: ExcelColumn[] = [
    { key: 'event_date',     label: 'Date',          type: 'date',   width: 13 },
    { key: 'direction',      label: 'Direction',     type: 'text',   width: 10 },
    { key: 'quality_code',   label: 'Quality Code',  type: 'text',   width: 14 },
    { key: 'quality_name',   label: 'Quality Name',  type: 'text',   width: 24 },
    { key: 'source_kind',    label: 'Source',        type: 'text',   width: 12 },
    { key: 'dc_code',        label: 'DC',            type: 'text',   width: 14 },
    { key: 'receipt_code',   label: 'Fabric Receipt',type: 'text',   width: 16 },
    { key: 'invoice_no',     label: 'Invoice',       type: 'text',   width: 16 },
    { key: 'party_name',     label: 'Party',         type: 'text',   width: 28 },
    { key: 'metres',         label: 'Metres',        type: 'metre',  width: 12, total: true },
    { key: 'invoice_total',  label: 'Invoice ₹',     type: 'rupee',  width: 14, total: true },
    { key: 'invoice_paid',   label: 'Paid ₹',        type: 'rupee',  width: 14, total: true },
    { key: 'invoice_balance',label: 'Balance ₹',     type: 'rupee',  width: 14, total: true },
    { key: 'status',         label: 'Status',        type: 'text',   width: 18 },
  ];
  const exportRows = rows.map((r) => ({
    event_date:      r.event_date,
    direction:       r.direction === 'in' ? 'IN' : 'OUT',
    quality_code:    r.quality_code,
    quality_name:    r.quality_name,
    source_kind:     SOURCE_KIND_LABEL[r.source_kind],
    dc_code:         r.dc_code ?? '',
    receipt_code:    r.receipt_code ?? '',
    invoice_no:      r.invoice_no ?? '',
    party_name:      r.party_name,
    metres:          r.metres,
    invoice_total:   r.invoice_total,
    invoice_paid:    r.invoice_paid,
    invoice_balance: r.invoice_balance,
    status:          LINEAGE_STATUS_PILL[r.status].label,
  }));

  return (
    <div>
      <PageHeader
        title="Fabric Movements"
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Fabric Movements' },
        ]}
        subtitle={`Per-event audit of fabric in / out between ${from} and ${to}. Each row is one Fabric Receipt or one Delivery Challan / Sale line.`}
        actions={
          <ExcelExportButton
            filename="fabric-movements"
            sheetName="Fabric Movements"
            title={`Fabric Movements · ${from} to ${to}`}
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
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Fabric Quality</span>
          <select
            name="quality_id"
            defaultValue={qualityIdParam}
            className="input min-w-[200px]"
          >
            <option value="">All qualities</option>
            {qualities.map((q) => (
              <option key={q.id} value={q.id}>
                {q.code} — {q.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Party (contains)</span>
          <input
            type="text"
            name="party"
            defaultValue={partyFilter}
            placeholder="e.g. Saravana"
            className="input min-w-[200px]"
          />
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
        <a
          href="/app/reports/fabric-movements"
          className="text-xs text-ink-mute self-center hover:text-ink underline"
        >
          Reset
        </a>
      </form>

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Events shown" value={String(rows.length)} icon={Layers} />
        <Kpi label="Received (in)" value={formatMetres(received, 0)} icon={Truck} />
        <Kpi label="Sold (out)" value={formatMetres(invoicedOut, 0)} icon={Truck} />
        <Kpi
          label="Unpaid (₹)"
          value={formatRupee(unpaidValue, { compact: true })}
          icon={Coins}
        />
      </div>

      {/* ─────────────── Errors / empty / table ─────────────── */}
      {loadError && (
        <div className="card p-4 text-sm text-err mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load fabric quality master.</div>
            <div className="text-xs opacity-80 mt-1">{loadError}</div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No fabric movements in this window. Try widening the date range or clearing
          the party / quality filter.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Quality</th>
                <th className="text-left  px-3 py-3">Source</th>
                <th className="text-left  px-3 py-3">DC</th>
                <th className="text-left  px-3 py-3">Fabric Receipt</th>
                <th className="text-left  px-3 py-3">Invoice</th>
                <th className="text-left  px-3 py-3">Party</th>
                <th className="text-right px-3 py-3">Metres</th>
                <th className="text-left  px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // For non-inhouse OUT events the invoice-status pill is
                // meaningless (no sale invoice) — show the movement type
                // instead so the operator isn't confused by a stale "DC
                // (no invoice)" tag on a jobwork return / outsource send.
                let pill = LINEAGE_STATUS_PILL[r.status];
                if (r.direction === 'out' && r.source_kind === 'jobwork') {
                  pill = { label: 'Jobwork Return', cls: 'bg-amber-50 text-amber-700' };
                } else if (
                  r.direction === 'out' &&
                  r.source_kind === 'outsource' &&
                  r.status === 'draft_dc'
                ) {
                  pill = { label: 'Outsource Send', cls: 'bg-indigo-50 text-indigo-700' };
                }
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">
                      {fmtDate(r.event_date)}
                    </td>
                    <td className="px-3 py-2">
                      {r.quality_id != null ? (
                        <Link
                          href={`/app/warehouse/fabric/${r.quality_id}`}
                          className="group inline-block"
                          title="Open per-quality stock ledger"
                        >
                          <div className="font-semibold text-indigo-700 group-hover:underline">
                            {r.quality_code}
                          </div>
                          {r.quality_name && (
                            <div className="text-[10px] text-ink-mute">{r.quality_name}</div>
                          )}
                        </Link>
                      ) : (
                        <>
                          <div className="font-semibold">{r.quality_code}</div>
                          {r.quality_name && (
                            <div className="text-[10px] text-ink-mute">{r.quality_name}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={
                            'inline-block w-1.5 h-1.5 rounded-full ' +
                            (r.direction === 'in' ? 'bg-emerald-500' : 'bg-rose-500')
                          }
                        />
                        {SOURCE_KIND_LABEL[r.source_kind]} ·{' '}
                        {r.direction === 'in' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.dc_id != null ? (
                        <Link
                          href={`/app/delivery-challan/${r.dc_id}`}
                          className="text-indigo-700 hover:underline"
                        >
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
                        <Link
                          href={`/app/invoices/${r.invoice_id}`}
                          className="text-indigo-700 hover:underline"
                        >
                          {r.invoice_no ?? `#${r.invoice_id}`}
                        </Link>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.party_name}</td>
                    <td
                      className={
                        'px-3 py-2 text-right num font-semibold ' +
                        (r.direction === 'in' ? 'text-emerald-700' : 'text-rose-600')
                      }
                    >
                      {(r.direction === 'in' ? '+ ' : '\u2212 ') + formatMetres(r.metres, 1)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`pill ${pill.cls} text-[11px] uppercase tracking-wide`}
                      >
                        {pill.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-ink-mute mt-4">
        IN rows come from Fabric Receipts (and fabric-purchase deliveries marked
        in-house). OUT rows come from every DC type plus Fabric Sale invoice
        lines sold direct-from-stock. In-house Sales DCs show their invoice
        payment status; Jobwork DCs are tagged &ldquo;Jobwork Return&rdquo;
        (cloth returned to the yarn owner); Outsource DCs without an invoice are
        tagged &ldquo;Outsource Send&rdquo;.
      </p>
    </div>
  );
}

/* ─────────────── presentational helpers ─────────────── */

interface KpiProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  negative?: boolean;
}

function Kpi({ label, value, icon: Icon, negative = false }: KpiProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
        <Icon className="w-4 h-4 text-ink-mute" />
      </div>
      <div className={`num text-xl font-bold ${negative ? 'text-rose-700' : ''}`}>{value}</div>
    </div>
  );
}
