/**
 * Stock On Hand (CORR-R2)
 *
 * Yarn lots on hand aggregated per yarn_count with weighted-average cost.
 *
 *   weighted_avg_cost = Σ(current_kg × cost_per_kg) ÷ Σ current_kg
 *   stock_value       = Σ(current_kg × cost_per_kg)
 *
 * Reorder flag fires when available_kg < yarn_count.reorder_kg (and reorder_kg
 * is set). Counts with zero stock still appear so an owner can spot what just
 * ran out — toggle "hide empty" to focus on what's actually on the shelf.
 *
 * days_of_cover is pulled from the existing v_yarn_days_of_cover view (recent
 * 30-day usage / available_kg). Coloured red when <14 days, amber when <30.
 *
 * Source: v_stock_on_hand (migration 012).
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  Package,
  AlertTriangle,
  TrendingDown,
  Coins,
  Layers,
} from 'lucide-react';

export const metadata = { title: 'Stock on Hand' };
export const dynamic = 'force-dynamic';

type YarnType = 'cotton' | 'polyester' | 'blend';

interface StockRow {
  yarn_count_id: number | null;
  code: string | null;
  display_name: string | null;
  yarn_type: YarnType | null;
  ne: number | null;
  denier: number | null;
  is_doubled: boolean | null;
  is_slub: boolean | null;
  reorder_kg: number | null;
  status: string | null;
  available_kg: number | null;
  weighted_avg_cost: number | null;
  stock_value: number | null;
  lots_count: number | null;
  oldest_lot_date: string | null;
  newest_lot_date: string | null;
  below_reorder: boolean | null;
  kg_30d: number | null;
  days_of_cover: number | null;
}

interface PageProps {
  searchParams: Promise<{
    type?: string;
    only_low?: string;
    hide_empty?: string;
    quality?: string;
  }>;
}

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return (
    '₹' +
    Number(n).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtKg(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return (
    Number(n).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + ' kg'
  );
}

function fmtDays(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = Math.round(Number(n));
  return v + 'd';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function sizeLabel(row: StockRow): string {
  const parts: string[] = [];
  if (row.ne != null && Number(row.ne) > 0) parts.push(`${row.ne}s Ne`);
  if (row.denier != null && Number(row.denier) > 0) parts.push(`${row.denier}D`);
  if (row.is_doubled) parts.push('2-ply');
  if (row.is_slub) parts.push('slub');
  return parts.length ? parts.join(' · ') : '—';
}

function typeTone(t: YarnType | null): string {
  switch (t) {
    case 'cotton':
      return 'bg-blue-50 text-blue-700';
    case 'polyester':
      return 'bg-violet-50 text-violet-700';
    case 'blend':
      return 'bg-amber-50 text-amber-700';
    default:
      return 'bg-cloud/60 text-ink-mute';
  }
}

function daysTone(d: number | null | undefined): string {
  if (d == null) return 'text-ink-mute';
  if (d < 14) return 'text-rose-700 font-semibold';
  if (d < 30) return 'text-amber-700 font-semibold';
  return 'text-ink';
}

export default async function StockOnHandReport({ searchParams }: PageProps) {
  const params = await searchParams;
  const typeFilter = (params.type ?? 'all') as 'all' | YarnType;
  const onlyLow = params.only_low === '1';
  const hideEmpty = params.hide_empty === '1';
  // ?quality=<id> narrows the summary matrix to that fabric quality.
  // Only the rows that carry a natural fabric_quality link respond to
  // the filter (warp jobwork/outsource + all fabric rows). Other rows
  // get rendered as N/A. See migration 130.
  const qualityParam = typeof params.quality === 'string' ? params.quality : undefined;
  const qualityFilter = qualityParam && /^\d+$/.test(qualityParam) ? Number(qualityParam) : null;

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Mode-wise stock summary matrix via fn_stock_on_hand_summary (mig
  // 130). Passing NULL = global view; passing a quality id = filtered.
  const summaryRes = await sb.rpc('fn_stock_on_hand_summary', { p_quality_id: qualityFilter });

  // Fabric qualities list for the filter dropdown — every active
  // quality so the operator can pick one. Cheap query; cached by the
  // page's force-dynamic but it's small.
  const { data: qualityOptions } = await sb
    .from('fabric_quality')
    .select('id, code, name')
    .eq('active', true)
    .order('name');

  let query = supabase
    .from('v_stock_on_hand')
    .select('*')
    .order('stock_value', { ascending: false, nullsFirst: false });

  if (typeFilter !== 'all') {
    query = query.eq('yarn_type', typeFilter);
  }
  if (onlyLow) {
    query = query.eq('below_reorder', true);
  }
  if (hideEmpty) {
    query = query.gt('available_kg', 0);
  }

  const { data, error } = await query.returns<StockRow[]>();

  if (error) {
    return (
      <div>
        <PageHeader title="Stock on Hand" subtitle="Yarn lots with weighted-avg cost" />
        <div className="card p-4 text-rose-700 text-sm">
          Failed to load v_stock_on_hand: {error.message}
        </div>
      </div>
    );
  }

  const rows = data ?? [];

  /* Excel export (matches the filtered rows shown below) */
  const exportColumns: ExcelColumn[] = [
    { key: 'code', label: 'Code', type: 'text', width: 14 },
    { key: 'display_name', label: 'Display name', type: 'text', width: 26 },
    { key: 'yarn_type', label: 'Type', type: 'text', width: 12 },
    { key: 'size', label: 'Size', type: 'text', width: 18 },
    { key: 'available_kg', label: 'Available kg', type: 'number', width: 14, total: true },
    { key: 'weighted_avg_cost', label: 'Avg cost/kg', type: 'rupee', width: 14 },
    { key: 'stock_value', label: 'Stock value', type: 'rupee', width: 14, total: true },
    { key: 'lots_count', label: 'Lots', type: 'number', width: 8, total: true },
    { key: 'oldest_lot_date', label: 'Oldest lot', type: 'date', width: 13 },
    { key: 'days_of_cover', label: 'Cover (days)', type: 'number', width: 12 },
    { key: 'status', label: 'Status', type: 'text', width: 12 },
  ];
  const exportRows = rows.map((r) => ({
    code: r.code ?? '',
    display_name: r.display_name ?? '',
    yarn_type: r.yarn_type ?? '',
    size: sizeLabel(r),
    available_kg: Number(r.available_kg ?? 0),
    weighted_avg_cost: Number(r.weighted_avg_cost ?? 0),
    stock_value: Number(r.stock_value ?? 0),
    lots_count: Number(r.lots_count ?? 0),
    oldest_lot_date: r.oldest_lot_date ?? '',
    days_of_cover: Number(r.days_of_cover ?? 0),
    status: r.below_reorder
      ? 'Reorder'
      : Number(r.available_kg ?? 0) === 0
        ? 'Empty'
        : 'OK',
  }));


  const totalKg = rows.reduce((a, r) => a + Number(r.available_kg ?? 0), 0);
  const totalValue = rows.reduce((a, r) => a + Number(r.stock_value ?? 0), 0);
  const belowReorderCount = rows.filter(r => r.below_reorder).length;
  const lowCoverCount = rows.filter(
    r => r.days_of_cover != null && Number(r.days_of_cover) < 14,
  ).length;

  // ── Pivot the summary view into a 5-row × 3-col matrix ──
  // Rows = categories (warp_metre → fabric), cols = modes (in_house →
  // outsource). Missing cells default to 0 so the table always paints
  // a full grid even when the view returns nothing for a slot.
  interface SummaryCell { qty: number; unit: string }
  type SummaryCategory = 'warp_metre' | 'weft_yarn' | 'porvai_yarn' | 'bobbin_metre' | 'fabric';
  type SummaryMode = 'in_house' | 'jobwork' | 'outsource';
  // Categories that have a natural fabric_quality link. Used to decide
  // whether to render a real number or "N/A" when a quality filter is
  // active. Other categories (warp in-house, weft, porvai, bobbin) get
  // N/A because there's no clean way to attribute their stock to a
  // single fabric quality.
  const SUMMARY_CATEGORIES: ReadonlyArray<{ key: SummaryCategory; label: string; qualityFilterScope: ReadonlyArray<SummaryMode> }> = [
    { key: 'warp_metre',   label: 'Warp Metre',                           qualityFilterScope: ['jobwork', 'outsource'] },
    { key: 'weft_yarn',    label: 'Weft Yarn',                            qualityFilterScope: [] },
    { key: 'porvai_yarn',  label: 'Porvai Yarn',                          qualityFilterScope: [] },
    { key: 'bobbin_metre', label: 'Bobbin Metre',                         qualityFilterScope: [] },
    { key: 'fabric',       label: 'Fabric (received, not invoiced)',      qualityFilterScope: ['in_house', 'jobwork', 'outsource'] },
  ];
  const SUMMARY_MODES: ReadonlyArray<{ key: SummaryMode; label: string }> = [
    { key: 'in_house',  label: 'In-house'  },
    { key: 'jobwork',   label: 'Job Work'  },
    { key: 'outsource', label: 'Outsource' },
  ];
  const summaryRowsRaw = (summaryRes.data ?? []) as Array<{
    category: string; mode: string; unit: string; qty: number | string | null;
  }>;
  const summaryMatrix = new Map<string, SummaryCell>();
  for (const r of summaryRowsRaw) {
    summaryMatrix.set(`${r.category}|${r.mode}`, {
      qty: Number(r.qty ?? 0),
      unit: r.unit ?? '',
    });
  }
  function summaryCell(cat: SummaryCategory, mode: SummaryMode): SummaryCell {
    return summaryMatrix.get(`${cat}|${mode}`) ?? { qty: 0, unit: '' };
  }
  function fmtSummary(qty: number): string {
    return qty.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  return (
    <div>
      <PageHeader
        title="Stock on Hand"
        subtitle="Per-count yarn position with weighted-average cost. Source: v_stock_on_hand (migration 012)."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Stock on Hand' },
        ]}
        actions={
          <ExcelExportButton
            filename="stock-on-hand"
            sheetName="Stock on Hand"
            title="Stock on Hand"
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* ── Mode-wise stock summary (migration 129) ─────────────────
            5 categories × 3 production modes. Drives a quick scan of
            "what's where" before the operator drills into the yarn
            detail table below. Fabric row counts only stock that's
            been receipted but not yet invoiced. */}
      <div className="card overflow-x-auto mb-4">
        <div className="px-4 py-3 border-b border-line/60 bg-cloud/40 flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="font-display font-bold text-sm">
            Mode-wise stock summary
            {qualityFilter !== null && (() => {
              const picked = (qualityOptions ?? []).find((q: { id: number; code: string | null; name: string }) => q.id === qualityFilter);
              const label = picked ? (picked.code ?? picked.name) : `Quality #${qualityFilter}`;
              return (
                <span className="ml-2 text-xs font-normal text-ink-soft">
                  filtered to <strong className="text-ink">{label}</strong>
                </span>
              );
            })()}
          </h2>
          <span className="text-[11px] text-ink-mute">
            Fabric = received via Fabric Receipt and still not invoiced.
          </span>
        </div>
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-2">Category</th>
              {SUMMARY_MODES.map((m) => (
                <th key={m.key} className="text-right px-3 py-2">{m.label}</th>
              ))}
              <th className="text-right px-3 py-2 bg-cloud">Total</th>
            </tr>
          </thead>
          <tbody>
            {SUMMARY_CATEGORIES.map((cat) => {
              const cells = SUMMARY_MODES.map((m) => summaryCell(cat.key, m.key));
              const total = cells.reduce((s, c) => s + c.qty, 0);
              const unit = cells.find((c) => c.unit)?.unit ?? '';
              return (
                <tr key={cat.key} className="border-t border-line/40">
                  <td className="px-3 py-2 font-semibold">{cat.label}</td>
                  {cells.map((c, i) => {
                    const mode = SUMMARY_MODES[i]?.key;
                    // When a quality filter is set AND this (category,
                    // mode) cell has no natural quality link, the
                    // function returns 0 by construction — render N/A
                    // instead of a misleading zero. When no filter,
                    // zero is real and renders as a dash.
                    const inQualityScope = mode != null && cat.qualityFilterScope.includes(mode);
                    const filteredNA = qualityFilter !== null && !inQualityScope;
                    const isZero = c.qty <= 0;
                    return (
                      <td
                        key={i}
                        className={'px-3 py-2 text-right num ' + (isZero ? 'text-ink-mute' : '')}
                        title={filteredNA ? 'Stock breakdown by fabric quality is not tracked for this category' : undefined}
                      >
                        {filteredNA
                          ? <span className="italic">N/A</span>
                          : isZero
                            ? '\u2014'
                            : `${fmtSummary(c.qty)} ${c.unit || unit}`}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right num font-bold bg-cloud/40">
                    {total > 0 ? `${fmtSummary(total)} ${unit}` : '\u2014'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-line/40 text-[11px] text-ink-mute">
          {qualityFilter !== null ? (
            <>
              N/A cells: weft / porvai yarn and bobbin stock aren&apos;t tagged with a
              fabric quality in the data model. Only Warp Metre (jobwork &amp; outsource)
              and Fabric rows respond to the quality filter.
            </>
          ) : (
            <>
              Porvai-yarn at vendor is currently 0 because porvai-at-vendor isn&apos;t tracked
              separately yet. Add a porvai bag flow if you need that column to fill.
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <form
        method="get"
        className="card p-3 mb-3 flex flex-wrap items-end gap-3 text-sm"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Type</span>
          <select
            name="type"
            defaultValue={typeFilter}
            className="border border-cloud rounded px-2 py-1 bg-white"
          >
            <option value="all">All yarn types</option>
            <option value="cotton">Cotton</option>
            <option value="polyester">Polyester</option>
            <option value="blend">Blend</option>
          </select>
        </label>
        {/* Fabric quality filter — narrows the mode-wise summary
            matrix above. Doesn't affect the yarn-detail table below
            (yarn rows have no quality link). */}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Fabric Quality</span>
          <select
            name="quality"
            defaultValue={qualityFilter !== null ? String(qualityFilter) : ''}
            className="border border-cloud rounded px-2 py-1 bg-white min-w-[200px]"
          >
            <option value="">All qualities</option>
            {(qualityOptions ?? []).map((q: { id: number; code: string | null; name: string }) => (
              <option key={q.id} value={q.id}>
                {q.code ? `${q.code} — ${q.name}` : q.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="only_low"
            value="1"
            defaultChecked={onlyLow}
          />
          <span>Below reorder only</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="hide_empty"
            value="1"
            defaultChecked={hideEmpty}
          />
          <span>Hide empty (0 kg)</span>
        </label>
        <button
          type="submit"
          className="ml-auto px-3 py-1.5 rounded bg-ink text-white text-xs"
        >
          Apply
        </button>
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi
          icon={<Package className="w-4 h-4" />}
          label="Total on hand"
          value={fmtKg(totalKg, 0)}
          sub={`${rows.length} counts shown`}
        />
        <Kpi
          icon={<Coins className="w-4 h-4" />}
          label="Stock value"
          value={fmtRupees(totalValue)}
          sub="at weighted-avg cost"
        />
        <Kpi
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Below reorder"
          value={String(belowReorderCount)}
          tone={belowReorderCount > 0 ? 'warn' : 'ok'}
          sub="counts under reorder_kg"
        />
        <Kpi
          icon={<TrendingDown className="w-4 h-4" />}
          label="Cover &lt; 14 days"
          value={String(lowCoverCount)}
          tone={lowCoverCount > 0 ? 'danger' : 'ok'}
          sub="based on 30-day usage"
        />
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          <Layers className="w-6 h-6 mx-auto mb-2 opacity-50" />
          No yarn counts match the current filters.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/40 text-xs uppercase text-ink-mute">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Display name</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Size</th>
                <th className="text-right px-3 py-2">Available</th>
                <th className="text-right px-3 py-2">Avg cost ₹/kg</th>
                <th className="text-right px-3 py-2">Stock value</th>
                <th className="text-right px-3 py-2">Lots</th>
                <th className="text-left px-3 py-2">Oldest lot</th>
                <th className="text-right px-3 py-2">Cover</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.yarn_count_id ?? Math.random()}
                  className="border-t border-cloud/60"
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.code ?? '—'}</td>
                  <td className="px-3 py-2">{r.display_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${typeTone(r.yarn_type)}`}
                    >
                      {r.yarn_type ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-soft text-xs">
                    {sizeLabel(r)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtKg(r.available_kg, 1)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.weighted_avg_cost == null
                      ? '—'
                      : fmtRupees(r.weighted_avg_cost, 2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmtRupees(r.stock_value)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.lots_count ?? 0}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {fmtDate(r.oldest_lot_date)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${daysTone(r.days_of_cover)}`}
                  >
                    {fmtDays(r.days_of_cover)}
                  </td>
                  <td className="px-3 py-2">
                    {r.below_reorder ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700">
                        Reorder
                      </span>
                    ) : Number(r.available_kg ?? 0) === 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-cloud/60 text-ink-mute">
                        Empty
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-cloud/30 text-sm font-medium">
              <tr className="border-t-2 border-cloud">
                <td className="px-3 py-2" colSpan={4}>
                  Totals
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtKg(totalKg, 1)}
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtRupees(totalValue)}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  colSpan={4}
                />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-mute mt-3">
        Source: <code>public.v_stock_on_hand</code> (migration 012). Aggregates{' '}
        <code>yarn_lot.current_kg &gt; 0</code> per yarn_count. days_of_cover
        comes from <code>v_yarn_days_of_cover</code> (30-day rolling usage).
      </p>
    </div>
  );
}

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warn' | 'danger';
}

function Kpi({ icon, label, value, sub, tone = 'ok' }: KpiProps) {
  const toneClass =
    tone === 'danger'
      ? 'text-rose-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-ink';
  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 text-xs text-ink-mute mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-ink-mute mt-0.5">{sub}</div>}
    </div>
  );
}
