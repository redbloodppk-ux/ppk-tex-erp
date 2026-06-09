/**
 * /app/reports/production-vs-delivery — Production vs Delivery.
 *
 * Per-quality variance between metres produced and metres delivered
 * in a chosen window, split by production mode (in-house, jobwork,
 * outsource). Source: fn_production_vs_delivery(p_from, p_to).
 */
import Link from 'next/link';
import { Layers, TrendingUp, TrendingDown, Equal } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';

export const metadata = { title: 'Production vs Delivery' };
export const dynamic = 'force-dynamic';

interface PvDRow {
  fabric_quality_id: number | null;
  quality_code: string | null;
  quality_name: string | null;
  /** True when this row was produced by collapsing several fabric_quality
   *  rows that share a merged_name. The quality_code/_name field is then
   *  the merged_name, not an individual FQ code. */
  is_merged: boolean | null;
  /** Metres per finished piece (towel length, dhoti length, etc.).
   *  NULL when the quality is sold as running metres. When non-null,
   *  produced_pcs / delivered_pcs / variance_pcs are populated and the
   *  page renders the pcs comparison alongside the metres figure. */
  meter_per_pc: number | string | null;
  production_mode: 'inhouse' | 'jobwork' | 'outsource' | 'unattributed';
  produced_m: number | string;
  delivered_m: number | string;
  variance_m: number | string;
  variance_pct: number | string | null;
  produced_pcs: number | string | null;
  delivered_pcs: number | string | null;
  variance_pcs: number | string | null;
  last_activity: string | null;
}

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    preset?: string;
    mode?: string;
  }>;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to:   isoDate(now),
  };
}

function presetRange(preset: string | undefined): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === 'this_month') return thisMonthRange();
  if (preset === 'last_month') {
    const start = new Date(y, m - 1, 1);
    const end   = new Date(y, m, 0);
    return { from: isoDate(start), to: isoDate(end) };
  }
  if (preset === 'this_quarter') {
    const q = Math.floor(m / 3);
    const start = new Date(y, q * 3, 1);
    return { from: isoDate(start), to: isoDate(now) };
  }
  if (preset === 'fy_to_date') {
    // Indian FY starts 1 April.
    const fyStart = m >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);
    return { from: isoDate(fyStart), to: isoDate(now) };
  }
  if (preset === 'last_30d') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { from: isoDate(start), to: isoDate(now) };
  }
  return null;
}

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtMetres(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtPcs(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '';
  // Pieces are usually whole-ish but the conversion produces fractions;
  // show 1 decimal to surface partials without being noisy.
  return n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' pcs';
}

export default async function ProductionVsDeliveryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const preset = sp.preset ? presetRange(sp.preset) : null;
  const fromInput = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null;
  const toInput   = sp.to   && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)   ? sp.to   : null;
  const def = thisMonthRange();
  const from = fromInput ?? preset?.from ?? def.from;
  const to   = toInput   ?? preset?.to   ?? def.to;

  // Outsource is no longer surfaced — this report compares loom
  // utilisation (shift_log) vs delivery, so only In-house and Job Work
  // appear as real production streams.
  const modeFilter: 'all' | 'inhouse' | 'jobwork' =
    sp.mode === 'inhouse' ? 'inhouse' :
    sp.mode === 'jobwork' ? 'jobwork' : 'all';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb.rpc('fn_production_vs_delivery', { p_from: from, p_to: to });
  const allRows: PvDRow[] = Array.isArray(data) ? (data as PvDRow[]) : [];

  // Apply the URL mode filter. Outsource rows are excluded from this
  // report entirely (the report is a loom-utilisation vs delivery
  // comparison; outsource fabric never touches the mill's looms).
  // 'unattributed' rows are dropped when the user picks a specific
  // mode — they're a data-quality flag, not a real production stream
  // — and shown only on 'all'.
  const filteredRows: PvDRow[] = allRows.filter((r) => {
    if (r.production_mode === 'outsource') return false;
    if (modeFilter === 'all') return true;
    if (r.production_mode === 'unattributed') return false;
    return r.production_mode === modeFilter;
  });

  // Default sort: |variance_m| desc so the biggest swings surface first.
  const sortedRows: PvDRow[] = [...filteredRows].sort((a, b) => {
    const av = Math.abs(num(a.variance_m));
    const bv = Math.abs(num(b.variance_m));
    if (av !== bv) return bv - av;
    return (a.quality_code ?? '').localeCompare(b.quality_code ?? '');
  });

  // KPIs run over the already-mode-filtered rows so the strip matches
  // what's on screen.
  const totalProduced  = sortedRows.reduce((s, r) => s + num(r.produced_m),  0);
  const totalDelivered = sortedRows.reduce((s, r) => s + num(r.delivered_m), 0);
  const netVariance    = totalProduced - totalDelivered;
  const lineCount      = sortedRows.length;

  // ── Excel export: quality-grouped sections ────────────────────────
  const exportColumns: ExcelColumn[] = [
    { key: 'quality',        label: 'Quality',        type: 'text',   width: 28 },
    { key: 'mode',           label: 'Mode',           type: 'text',   width: 14 },
    { key: 'produced_m',     label: 'Produced (m)',   type: 'number', total: true },
    { key: 'produced_pcs',   label: 'Produced (pcs)', type: 'number', total: true },
    { key: 'delivered_m',    label: 'Delivered (m)',  type: 'number', total: true },
    { key: 'delivered_pcs',  label: 'Delivered (pcs)',type: 'number', total: true },
    { key: 'variance_m',     label: 'Variance (m)',   type: 'number', total: true },
    { key: 'variance_pcs',   label: 'Variance (pcs)', type: 'number', total: true },
    { key: 'variance_pct',   label: 'Var %',          type: 'number' },
    { key: 'last_activity',  label: 'Last activity',  type: 'text',   width: 14 },
  ];

  const byQuality = new Map<string, PvDRow[]>();
  for (const r of sortedRows) {
    const key = r.fabric_quality_id == null ? '__unattributed__' : String(r.fabric_quality_id);
    const bucket = byQuality.get(key) ?? [];
    bucket.push(r);
    byQuality.set(key, bucket);
  }
  // ExcelExportButton requires ReadonlyArray<Record<string, unknown>>
  // so we type the rows as Record<string, unknown>[] directly rather
  // than a named interface (which would need an index signature to
  // satisfy the prop type under strict mode).
  const exportRows: Record<string, unknown>[] = [];
  const qualityOrder = [...byQuality.keys()].sort((a, b) => {
    if (a === '__unattributed__') return 1;
    if (b === '__unattributed__') return -1;
    const ca = byQuality.get(a)?.[0]?.quality_code ?? '';
    const cb = byQuality.get(b)?.[0]?.quality_code ?? '';
    return ca.localeCompare(cb);
  });
  // Track grand-total pieces too so the bottom-row pcs cells reconcile.
  let grandProducedPcs  = 0;
  let grandDeliveredPcs = 0;
  let grandVariancePcs  = 0;

  for (const key of qualityOrder) {
    const bucket = byQuality.get(key) ?? [];
    if (bucket.length === 0) continue;
    const first = bucket[0]!;
    const header = first.quality_code
      ? `${first.quality_code} — ${first.quality_name ?? ''}`
      : (first.quality_name ?? 'Unattributed');
    exportRows.push({
      quality: header, mode: '',
      produced_m: '', produced_pcs: '',
      delivered_m: '', delivered_pcs: '',
      variance_m: '', variance_pcs: '',
      variance_pct: '', last_activity: '',
    });
    let prodSum = 0, delivSum = 0, varSum = 0;
    let prodPcsSum = 0, delivPcsSum = 0, varPcsSum = 0;
    let anyPcs = false;
    for (const r of bucket) {
      const p = num(r.produced_m);
      const d = num(r.delivered_m);
      const v = num(r.variance_m);
      prodSum += p; delivSum += d; varSum += v;
      const pPcs = r.produced_pcs  == null ? null : Number(r.produced_pcs);
      const dPcs = r.delivered_pcs == null ? null : Number(r.delivered_pcs);
      const vPcs = r.variance_pcs  == null ? null : Number(r.variance_pcs);
      if (pPcs != null) { prodPcsSum  += pPcs; anyPcs = true; }
      if (dPcs != null) { delivPcsSum += dPcs; anyPcs = true; }
      if (vPcs != null) { varPcsSum   += vPcs; anyPcs = true; }
      exportRows.push({
        quality: '',
        mode: r.production_mode === 'inhouse'   ? 'In-house'
            : r.production_mode === 'jobwork'   ? 'Job Work'
            : r.production_mode === 'outsource' ? 'Outsource'
            :                                     'Unattributed',
        produced_m:    p,
        produced_pcs:  pPcs == null ? '' : pPcs,
        delivered_m:   d,
        delivered_pcs: dPcs == null ? '' : dPcs,
        variance_m:    v,
        variance_pcs:  vPcs == null ? '' : vPcs,
        variance_pct:  r.variance_pct == null ? '' : Number(r.variance_pct),
        last_activity: r.last_activity ?? '',
      });
    }
    grandProducedPcs  += prodPcsSum;
    grandDeliveredPcs += delivPcsSum;
    grandVariancePcs  += varPcsSum;
    exportRows.push({
      quality: 'Quality total', mode: '',
      produced_m:    prodSum,
      produced_pcs:  anyPcs ? prodPcsSum  : '',
      delivered_m:   delivSum,
      delivered_pcs: anyPcs ? delivPcsSum : '',
      variance_m:    varSum,
      variance_pcs:  anyPcs ? varPcsSum   : '',
      variance_pct:  prodSum > 0 ? Number(((varSum / prodSum) * 100).toFixed(2)) : '',
      last_activity: '',
    });
    exportRows.push({
      quality: '', mode: '',
      produced_m: '', produced_pcs: '',
      delivered_m: '', delivered_pcs: '',
      variance_m: '', variance_pcs: '',
      variance_pct: '', last_activity: '',
    });
  }
  exportRows.push({
    quality: 'GRAND TOTAL', mode: '',
    produced_m:    totalProduced,
    produced_pcs:  grandProducedPcs  > 0 ? grandProducedPcs  : '',
    delivered_m:   totalDelivered,
    delivered_pcs: grandDeliveredPcs > 0 ? grandDeliveredPcs : '',
    variance_m:    netVariance,
    variance_pcs:  grandVariancePcs !== 0 ? grandVariancePcs : '',
    variance_pct:  totalProduced > 0
      ? Number(((netVariance / totalProduced) * 100).toFixed(2))
      : '',
    last_activity: '',
  });

  return (
    <div>
      <PageHeader
        title="Production vs Delivery"
        subtitle="Per-quality comparison of metres produced (shift logs / fabric receipts) vs metres delivered on DCs. Variance flags where production is drifting from dispatch."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Production vs Delivery' },
        ]}
        actions={
          <ExcelExportButton
            filename={`production-vs-delivery-${from}-to-${to}`}
            sheetName="Production vs Delivery"
            title={`Production vs Delivery — ${from} to ${to}`}
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* Mode filter pills. URL state via ?mode=. */}
      <div className="mb-3 flex items-center gap-1">
        {(['all', 'inhouse', 'jobwork'] as const).map((m) => {
          const qs = new URLSearchParams();
          if (sp.from)   qs.set('from',   sp.from);
          if (sp.to)     qs.set('to',     sp.to);
          if (sp.preset) qs.set('preset', sp.preset);
          if (m !== 'all') qs.set('mode', m);
          const href = `/app/reports/production-vs-delivery${qs.toString() ? `?${qs.toString()}` : ''}`;
          const label = m === 'all' ? 'All' :
                        m === 'inhouse' ? 'In-house' : 'Job Work';
          const active = modeFilter === m;
          return (
            <Link
              key={m}
              href={href}
              className={
                'px-3 py-1.5 rounded-md text-xs font-semibold border border-line ' +
                (active ? 'bg-ink text-white border-ink' : 'bg-paper text-ink-soft hover:bg-haze')
              }
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Period picker */}
      <form action="/app/reports/production-vs-delivery" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="mode" value={modeFilter === 'all' ? '' : modeFilter} />
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">From</span>
          <input name="from" type="date" defaultValue={from} className="input py-1 text-xs" />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">To</span>
          <input name="to" type="date" defaultValue={to} className="input py-1 text-xs" />
        </label>
        <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
        <div className="flex items-center gap-1 ml-auto text-[11px]">
          <span className="text-ink-mute">Quick:</span>
          <Link href={`/app/reports/production-vs-delivery?preset=this_month${modeFilter !== 'all' ? `&mode=${modeFilter}` : ''}`}   className="text-indigo-700 underline">This month</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=last_month${modeFilter !== 'all' ? `&mode=${modeFilter}` : ''}`}   className="text-indigo-700 underline">Last month</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=this_quarter${modeFilter !== 'all' ? `&mode=${modeFilter}` : ''}`} className="text-indigo-700 underline">Quarter</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=fy_to_date${modeFilter !== 'all' ? `&mode=${modeFilter}` : ''}`}   className="text-indigo-700 underline">FY-to-date</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=last_30d${modeFilter !== 'all' ? `&mode=${modeFilter}` : ''}`}     className="text-indigo-700 underline">Last 30d</Link>
        </div>
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-mute">
            <Layers className="w-3.5 h-3.5" /> Produced
          </div>
          <div className="num text-xl font-bold text-emerald-700">{fmtMetres(totalProduced)} m</div>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-mute">
            <TrendingDown className="w-3.5 h-3.5" /> Delivered
          </div>
          <div className="num text-xl font-bold text-indigo-700">{fmtMetres(totalDelivered)} m</div>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-mute">
            {netVariance > 0
              ? <TrendingUp   className="w-3.5 h-3.5 text-emerald-700" />
              : netVariance < 0
                ? <TrendingDown className="w-3.5 h-3.5 text-rose-700" />
                : <Equal        className="w-3.5 h-3.5 text-ink-mute" />}
            Net Variance
          </div>
          <div className={'num text-xl font-bold ' + (netVariance > 0 ? 'text-emerald-700' : netVariance < 0 ? 'text-rose-700' : 'text-ink-mute')}>
            {netVariance >= 0 ? '+' : ''}{fmtMetres(netVariance)} m
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Lines</div>
          <div className="num text-xl font-bold">{lineCount}</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load report: {error.message}</div>
      )}

      {sortedRows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No production or delivery in this period. Try a wider window or a different mode.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Quality</th>
                <th className="text-left  px-3 py-3">Mode</th>
                <th className="text-right px-3 py-3">Produced (m)</th>
                <th className="text-right px-3 py-3">Produced (pcs)</th>
                <th className="text-right px-3 py-3">Delivered (m)</th>
                <th className="text-right px-3 py-3">Delivered (pcs)</th>
                <th className="text-right px-3 py-3">Variance (m)</th>
                <th className="text-right px-3 py-3">Variance (pcs)</th>
                <th className="text-right px-3 py-3">Var %</th>
                <th className="text-left  px-3 py-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const v = num(r.variance_m);
                const variancePct = r.variance_pct == null ? null : Number(r.variance_pct);
                const modeLabel =
                  r.production_mode === 'inhouse'      ? 'In-house' :
                  r.production_mode === 'jobwork'      ? 'Job Work' :
                  r.production_mode === 'outsource'    ? 'Outsource' :
                  'Unattributed';
                const modeClass =
                  r.production_mode === 'inhouse'      ? 'bg-emerald-50 text-emerald-700' :
                  r.production_mode === 'jobwork'      ? 'bg-amber-50 text-amber-700' :
                  r.production_mode === 'outsource'    ? 'bg-indigo-50 text-indigo-700' :
                                                          'bg-rose-50 text-rose-700';
                const varClass = v > 0 ? 'text-emerald-700' : v < 0 ? 'text-rose-700' : 'text-ink-soft';
                // Pieces conversion — only when meter_per_pc is set.
                // Renders a faded sub-line below each metres cell.
                const mpp = r.meter_per_pc == null ? null : Number(r.meter_per_pc);
                const showPcs = mpp != null && mpp > 0;
                const producedPcs  = showPcs && r.produced_pcs  != null ? Number(r.produced_pcs)  : null;
                const deliveredPcs = showPcs && r.delivered_pcs != null ? Number(r.delivered_pcs) : null;
                const variancePcs  = showPcs && r.variance_pcs  != null ? Number(r.variance_pcs)  : null;
                const qualityCell = r.fabric_quality_id != null && r.quality_code
                  ? (
                    <Link
                      href={`/app/warehouse/fabric/${r.fabric_quality_id}`}
                      className="text-indigo-700 hover:underline font-semibold"
                      title="Open per-quality stock ledger"
                    >
                      {r.quality_code}
                    </Link>
                  )
                  : <span className="font-semibold text-ink-mute">{r.quality_name ?? '—'}</span>;
                return (
                  <tr key={`${r.fabric_quality_id ?? 'na'}-${r.production_mode}`} className="border-t border-line/40 hover:bg-haze/60 align-top">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {qualityCell}
                        {r.is_merged && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 uppercase tracking-wide">merged</span>
                        )}
                      </div>
                      {r.quality_name && r.quality_code && r.quality_name !== r.quality_code && (
                        <div className="text-[10px] text-ink-mute">{r.quality_name}</div>
                      )}
                      {showPcs && (
                        <div className="text-[10px] text-ink-mute">@ {mpp} m/pc</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={'inline-block px-2 py-0.5 rounded text-[11px] ' + modeClass}>
                        {modeLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtMetres(num(r.produced_m))}
                    </td>
                    <td className="px-3 py-2 text-right num text-ink-soft">
                      {producedPcs != null ? fmtPcs(producedPcs) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtMetres(num(r.delivered_m))}
                    </td>
                    <td className="px-3 py-2 text-right num text-ink-soft">
                      {deliveredPcs != null ? fmtPcs(deliveredPcs) : '—'}
                    </td>
                    <td className={'px-3 py-2 text-right num font-semibold ' + varClass}>
                      {v >= 0 ? '+' : ''}{fmtMetres(v)}
                    </td>
                    <td className={'px-3 py-2 text-right num ' + varClass}>
                      {variancePcs != null
                        ? `${variancePcs >= 0 ? '+' : ''}${fmtPcs(variancePcs)}`
                        : '—'}
                    </td>
                    <td className={'px-3 py-2 text-right num ' + varClass}>
                      {variancePct == null ? '—' : `${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">
                      {r.last_activity ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-ink-mute mt-4">
        Period: <strong>{from}</strong> to <strong>{to}</strong>. {lineCount} row{lineCount === 1 ? '' : 's'}.
        Variance &gt; 0 = stock building (produced more than delivered); variance &lt; 0 = stock depleting
        (delivered more than produced this period). <strong>Produced</strong> is sourced exclusively from
        the production shift logs on the mill&apos;s own looms — fabric received back from external weavers
        is <em>not</em> counted here. Row mode = the fabric quality&apos;s production_mode (In-house or
        Job Work). <strong>Delivered</strong> is the sum of DC items (status confirmed / invoiced) for the
        same quality and mode. &ldquo;Unattributed&rdquo; metres are shift-log production on looms with no
        fabric quality assigned.
      </p>
    </div>
  );
}
