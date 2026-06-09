/**
 * Variance Dashboard (CORR-R6)
 *
 * Planned vs actual cost-per-metre. "Planned" is the cost you saved in the
 * costing master before the job ran. "Actual" is the cost frozen onto each
 * production batch the moment it was created (the CORR-T1 trigger snapshots
 * the live yarn rates and wage rates at that instant).
 *
 * Sign convention (set in migration 015):
 *   variance > 0  -> actual cost EXCEEDED the plan  (over budget, shown red)
 *   variance < 0  -> actual cost came in UNDER plan (a saving, shown green)
 *
 *   variance_per_m     = actual ₹/m − planned ₹/m
 *   variance_pct       = variance_per_m ÷ planned ₹/m × 100
 *   total_variance_inr = variance_per_m × produced_m
 *
 * Two tables:
 *   - By quality: produced-metre-weighted roll-up. Sorted worst-first so the
 *     qualities bleeding the most money sit at the top.
 *   - By batch:   every finished batch individually, so you can trace a bad
 *     quality number down to the exact run that caused it.
 *
 * Only batches with produced_m > 0 appear (drafts are skipped by the view).
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  PiggyBank,
  Layers,
  Boxes,
} from 'lucide-react';

export const metadata = { title: 'Variance Dashboard' };
export const dynamic = 'force-dynamic';

interface QualityVarianceRow {
  quality_code: string | null;
  quality_name: string | null;
  produced_m: number | null;
  batch_count: number | null;
  planned_true_per_m: number | null;
  actual_true_per_m: number | null;
  variance_per_m: number | null;
  variance_pct: number | null;
  total_variance_inr: number | null;
}

interface BatchVarianceRow {
  batch_id: number | null;
  batch_code: string | null;
  costing_id: number | null;
  quality_code: string | null;
  quality_name: string | null;
  produced_m: number | null;
  start_date: string | null;
  end_date: string | null;
  planned_true_per_m: number | null;
  actual_true_per_m: number | null;
  variance_per_m: number | null;
  variance_pct: number | null;
  total_variance_inr: number | null;
}

type Tone = 'good' | 'warn' | 'bad' | 'mute';

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtSignedRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return sign + fmtRupees(v, decimals);
}

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/** Over budget is bad, under budget is good, near-zero is neutral. */
function varianceTone(variancePerM: number | null): Tone {
  if (variancePerM == null) return 'mute';
  if (variancePerM > 0.0001) return 'bad';
  if (variancePerM < -0.0001) return 'good';
  return 'mute';
}

export default async function VarianceDashboard() {
  const supabase = await createClient();

  const [qualityRes, batchRes] = await Promise.all([
    supabase.from('v_variance_by_quality').select('*'),
    supabase.from('v_variance_by_batch').select('*'),
  ]);

  const qualityRows = ((qualityRes.data as unknown as QualityVarianceRow[]) ?? [])
    .slice()
    .sort((a, b) => Number(b.total_variance_inr ?? 0) - Number(a.total_variance_inr ?? 0));

  const batchRows = ((batchRes.data as unknown as BatchVarianceRow[]) ?? [])
    .slice()
    .sort((a, b) => Number(b.total_variance_inr ?? 0) - Number(a.total_variance_inr ?? 0));

  const loadError = qualityRes.error ?? batchRes.error;

  /* ───────── summary roll-up ───────── */
  const totalProduced = qualityRows.reduce(
    (s, r) => s + Number(r.produced_m ?? 0),
    0,
  );
  const totalVariance = qualityRows.reduce(
    (s, r) => s + Number(r.total_variance_inr ?? 0),
    0,
  );
  const blendedVariancePerM =
    totalProduced > 0 ? totalVariance / totalProduced : null;

  const overBudgetCount = qualityRows.filter(
    (r) => Number(r.total_variance_inr ?? 0) > 0,
  ).length;
  const underBudgetCount = qualityRows.filter(
    (r) => Number(r.total_variance_inr ?? 0) < 0,
  ).length;

  const worst = qualityRows[0];
  const best = qualityRows[qualityRows.length - 1];

  /* Excel export — the by-batch variance table, worst-first as shown */
  const exportColumns: ExcelColumn[] = [
    { key: 'batch_code', label: 'Batch', type: 'text', width: 14 },
    { key: 'quality_code', label: 'Quality code', type: 'text', width: 14 },
    { key: 'quality_name', label: 'Quality', type: 'text', width: 24 },
    { key: 'produced_m', label: 'Produced m', type: 'metre', width: 13, total: true },
    { key: 'planned_true_per_m', label: 'Planned/m', type: 'rupee', width: 13 },
    { key: 'actual_true_per_m', label: 'Actual/m', type: 'rupee', width: 13 },
    { key: 'variance_per_m', label: 'Variance/m', type: 'rupee', width: 13 },
    { key: 'variance_pct', label: 'Variance %', type: 'percent', width: 12 },
    { key: 'total_variance_inr', label: 'Total variance', type: 'rupee', width: 15, total: true },
    { key: 'end_date', label: 'Finished', type: 'date', width: 13 },
  ];
  const exportRows = batchRows.map((r) => ({
    batch_code: r.batch_code ?? `#${r.batch_id ?? ''}`,
    quality_code: r.quality_code ?? '',
    quality_name: r.quality_name ?? '',
    produced_m: Number(r.produced_m ?? 0),
    planned_true_per_m: Number(r.planned_true_per_m ?? 0),
    actual_true_per_m: Number(r.actual_true_per_m ?? 0),
    variance_per_m: Number(r.variance_per_m ?? 0),
    variance_pct: Number(r.variance_pct ?? 0),
    total_variance_inr: Number(r.total_variance_inr ?? 0),
    end_date: r.end_date ?? '',
  }));

  return (
    <div>
      <PageHeader
        title="Variance Dashboard"
        subtitle="Planned cost vs the cost actually frozen onto each batch. Red means you spent more than you quoted; green means you came in under. Sorted worst-first so the biggest leaks sit at the top."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Variance' },
        ]}
        actions={
          <ExcelExportButton
            filename="variance-by-batch"
            sheetName="Variance by Batch"
            title="Variance Dashboard — by Batch"
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {loadError && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load variance data: {loadError.message}
        </div>
      )}

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Metres produced" value={fmtNum(totalProduced, 0)} />
        <Kpi
          label="Total variance"
          value={fmtSignedRupees(totalVariance)}
          tone={varianceTone(totalVariance)}
        />
        <Kpi
          label="Blended variance ₹/m"
          value={
            blendedVariancePerM != null
              ? fmtSignedRupees(blendedVariancePerM, 2)
              : '—'
          }
          tone={varianceTone(blendedVariancePerM)}
        />
        <Kpi
          label="Qualities over budget"
          value={`${overBudgetCount} of ${qualityRows.length}`}
          tone={overBudgetCount > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* ─────────────── Highlight cards ─────────────── */}
      {(worst || best) && worst !== best && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {worst && Number(worst.total_variance_inr ?? 0) > 0 && (
            <HighlightCard
              icon={<AlertTriangle className="w-4 h-4" />}
              tone="bad"
              label="Biggest overspend"
              code={worst.quality_code}
              name={worst.quality_name}
              amount={fmtSignedRupees(worst.total_variance_inr)}
              pct={fmtPct(worst.variance_pct)}
            />
          )}
          {best && Number(best.total_variance_inr ?? 0) < 0 && (
            <HighlightCard
              icon={<PiggyBank className="w-4 h-4" />}
              tone="good"
              label="Biggest saving"
              code={best.quality_code}
              name={best.quality_name}
              amount={fmtSignedRupees(best.total_variance_inr)}
              pct={fmtPct(best.variance_pct)}
            />
          )}
        </div>
      )}

      {/* ─────────────── By quality ─────────────── */}
      <SectionHeader
        icon={<Layers className="w-4 h-4" />}
        title="Variance by quality"
        subtitle="Produced-metre-weighted roll-up across every batch of that quality."
      />

      {qualityRows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No finished production batch is linked to a saved costing yet. Once
          you complete a batch tied to a costing master, this list will
          populate.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Quality</th>
                <th className="text-right px-3 py-2">Batches</th>
                <th className="text-right px-3 py-2">Produced m</th>
                <th className="text-right px-3 py-2">Planned ₹/m</th>
                <th className="text-right px-3 py-2">Actual ₹/m</th>
                <th className="text-right px-3 py-2">Variance ₹/m</th>
                <th className="text-right px-3 py-2">Variance %</th>
                <th className="text-right px-3 py-2">Total variance ₹</th>
              </tr>
            </thead>
            <tbody>
              {qualityRows.map((r, i) => {
                const tone = varianceTone(r.variance_per_m);
                return (
                  <tr
                    key={r.quality_code ?? i}
                    className="border-t border-line/40 hover:bg-cloud/20"
                  >
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-ink-mute">
                        {r.quality_code ?? '—'}
                      </div>
                      <div className="font-medium">
                        {r.quality_name ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.batch_count)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.produced_m, 1)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.planned_true_per_m, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.actual_true_per_m, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      <Toned tone={tone}>
                        {fmtSignedRupees(r.variance_per_m, 2)}
                      </Toned>
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <PctBadge pct={r.variance_pct} />
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      <Toned tone={tone}>
                        {fmtSignedRupees(r.total_variance_inr)}
                      </Toned>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─────────────── By batch ─────────────── */}
      <SectionHeader
        icon={<Boxes className="w-4 h-4" />}
        title="Variance by batch"
        subtitle="Every finished batch individually — trace a bad quality number to the exact run."
      />

      {batchRows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No finished batches to show yet.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Batch</th>
                <th className="text-left px-3 py-2">Quality</th>
                <th className="text-right px-3 py-2">Produced m</th>
                <th className="text-right px-3 py-2">Planned ₹/m</th>
                <th className="text-right px-3 py-2">Actual ₹/m</th>
                <th className="text-right px-3 py-2">Variance ₹/m</th>
                <th className="text-right px-3 py-2">Variance %</th>
                <th className="text-right px-3 py-2">Total variance ₹</th>
                <th className="text-left px-3 py-2">Finished</th>
              </tr>
            </thead>
            <tbody>
              {batchRows.map((r, i) => {
                const tone = varianceTone(r.variance_per_m);
                return (
                  <tr
                    key={r.batch_id ?? i}
                    className="border-t border-line/40 hover:bg-cloud/20"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.batch_code ?? `#${r.batch_id ?? '—'}`}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-ink-mute">
                        {r.quality_code ?? '—'}
                      </div>
                      <div className="text-xs">{r.quality_name ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.produced_m, 1)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.planned_true_per_m, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.actual_true_per_m, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      <Toned tone={tone}>
                        {fmtSignedRupees(r.variance_per_m, 2)}
                      </Toned>
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <PctBadge pct={r.variance_pct} />
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      <Toned tone={tone}>
                        {fmtSignedRupees(r.total_variance_inr)}
                      </Toned>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {fmtDate(r.end_date)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-mute mt-4">
        Planned cost is the true cost-per-metre saved in the costing master.
        Actual cost is frozen onto each batch when it is created, using the
        yarn and wage rates live at that moment — so an old batch keeps its
        original numbers even if rates move later. A positive variance means
        the job cost more than you quoted; a negative variance is a saving.
        Quality-level figures are weighted by produced metres, so a large
        batch counts more than a small one.
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

function toneClass(tone: Tone): string {
  return tone === 'good'
    ? 'text-emerald-700'
    : tone === 'warn'
      ? 'text-amber-700'
      : tone === 'bad'
        ? 'text-rose-700'
        : '';
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

interface TonedProps {
  tone: Tone;
  children: React.ReactNode;
}

function Toned({ tone, children }: TonedProps) {
  return <span className={toneClass(tone)}>{children}</span>;
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
  code: string | null;
  name: string | null;
  amount: string;
  pct: string;
}

function HighlightCard({
  icon,
  tone,
  label,
  code,
  name,
  amount,
  pct,
}: HighlightCardProps) {
  const ring =
    tone === 'good'
      ? 'border-emerald-300 bg-emerald-50/40'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50/40'
        : 'border-rose-300 bg-rose-50/40';
  const text = toneClass(tone);
  return (
    <div className={`card p-4 border ${ring}`}>
      <div className="flex items-center gap-2 text-xs text-ink-mute uppercase tracking-wide">
        <span className={text}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-ink-mute">{code ?? '—'}</div>
          <div className="font-medium">{name ?? '—'}</div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold ${text}`}>{amount}</div>
          <div className={`text-xs ${text}`}>{pct}</div>
        </div>
      </div>
    </div>
  );
}

interface PctBadgeProps {
  pct: number | null;
}

function PctBadge({ pct }: PctBadgeProps) {
  if (pct == null) {
    return <span className="text-ink-mute">—</span>;
  }
  const v = Number(pct);
  const colour =
    v > 0.0001
      ? 'text-rose-700'
      : v < -0.0001
        ? 'text-emerald-700'
        : 'text-ink-mute';
  const Icon = v > 0.0001 ? TrendingUp : v < -0.0001 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${colour}`}>
      <Icon className="w-3 h-3" />
      {(v > 0 ? '+' : '') + v.toFixed(2)}%
    </span>
  );
}
