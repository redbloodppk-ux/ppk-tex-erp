/**
 * Profit by Quality (CORR-R5)
 *
 * Per-quality margin = revenue (invoice_line.taxable_amount, ex-GST)
 *                    − cost   (production_batch.produced_m × actual_true_cost_per_m,
 *                              snapshotted at batch insert).
 *
 * Margin %       = margin ÷ revenue × 100
 * avg_sell_per_m = revenue ÷ invoiced metres   (your blended selling price)
 * avg_cost_per_m = cost    ÷ produced metres   (your blended true cost)
 *
 * Why the asymmetry columns matter: if you've invoiced a quality but not
 * yet produced it (or vice-versa) the margin number is half-real — produced
 * metres without invoiced metres just sits as inventory, invoiced metres
 * without produced metres means you billed against old stock or a future
 * batch. Both are visible side-by-side so nothing hides.
 *
 * The view aggregates over ALL history. v1 has no period filter; once the
 * data volume justifies it, we'll add a window slider that hits the
 * underlying tables instead of the view.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  AlertTriangle,
  Layers,
} from 'lucide-react';

export const metadata = { title: 'Profit by Quality' };
export const dynamic = 'force-dynamic';

interface MarginRow {
  costing_id: number | null;
  quality_code: string | null;
  quality_name: string | null;
  invoiced_m: number | null;
  total_revenue: number | null;
  produced_m: number | null;
  total_cost: number | null;
  margin: number | null;
  avg_sell_per_m: number | null;
  avg_cost_per_m: number | null;
  margin_pct: number | null;
  last_invoice_date: string | null;
  last_batch_date: string | null;
}

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

export default async function ProfitByQualityReport() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_quality_margin')
    .select('*')
    .order('margin', { ascending: false });

  const rows = (data as unknown as MarginRow[]) ?? [];

  /* ───────── summary roll-up across all shown qualities ───────── */
  const totalRevenue = rows.reduce((s, r) => s + Number(r.total_revenue ?? 0), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.total_cost ?? 0), 0);
  const totalMargin = totalRevenue - totalCost;
  const blendedPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;

  // Best & worst margin lines
  const best = rows.find(
    (r) => r.margin != null && Number(r.margin) > 0 && r.margin_pct != null
  );
  const worst = [...rows]
    .filter((r) => r.margin != null)
    .sort((a, b) => Number(a.margin) - Number(b.margin))[0];

  /* Excel export (matches the rows shown below) */
  const exportColumns: ExcelColumn[] = [
    { key: 'quality_code', label: 'Quality code', type: 'text', width: 16 },
    { key: 'quality_name', label: 'Quality', type: 'text', width: 26 },
    { key: 'invoiced_m', label: 'Invoiced m', type: 'metre', width: 13, total: true },
    { key: 'produced_m', label: 'Produced m', type: 'metre', width: 13, total: true },
    { key: 'total_revenue', label: 'Revenue', type: 'rupee', width: 14, total: true },
    { key: 'total_cost', label: 'Cost', type: 'rupee', width: 14, total: true },
    { key: 'margin', label: 'Margin', type: 'rupee', width: 14, total: true },
    { key: 'margin_pct', label: 'Margin %', type: 'percent', width: 11 },
    { key: 'avg_sell_per_m', label: 'Sell/m', type: 'rupee', width: 12 },
    { key: 'avg_cost_per_m', label: 'Cost/m', type: 'rupee', width: 12 },
    { key: 'last_activity', label: 'Last activity', type: 'date', width: 13 },
  ];
  const exportRows = rows.map((r) => ({
    quality_code: r.quality_code ?? '',
    quality_name: r.quality_name ?? '',
    invoiced_m: Number(r.invoiced_m ?? 0),
    produced_m: Number(r.produced_m ?? 0),
    total_revenue: Number(r.total_revenue ?? 0),
    total_cost: Number(r.total_cost ?? 0),
    margin: Number(r.margin ?? 0),
    margin_pct: Number(r.margin_pct ?? 0),
    avg_sell_per_m: Number(r.avg_sell_per_m ?? 0),
    avg_cost_per_m: Number(r.avg_cost_per_m ?? 0),
    last_activity: mostRecent(r.last_invoice_date, r.last_batch_date) ?? '',
  }));

  return (
    <div>
      <PageHeader
        title="Profit by Quality"
        subtitle="What every quality really earns once you subtract the frozen production cost. Sorted by margin in rupees — biggest contributors at the top."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Profit by Quality' },
        ]}
        actions={
          <ExcelExportButton
            filename="profit-by-quality"
            sheetName="Profit by Quality"
            title="Profit by Quality"
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load margin data: {error.message}
        </div>
      )}

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Total revenue" value={fmtRupees(totalRevenue)} />
        <Kpi label="Total cost" value={fmtRupees(totalCost)} />
        <Kpi
          label="Total margin"
          value={fmtRupees(totalMargin)}
          tone={totalMargin >= 0 ? 'good' : 'bad'}
        />
        <Kpi
          label="Blended margin %"
          value={blendedPct != null ? blendedPct.toFixed(2) + '%' : '—'}
          tone={
            blendedPct == null
              ? 'mute'
              : blendedPct >= 20
                ? 'good'
                : blendedPct >= 0
                  ? 'warn'
                  : 'bad'
          }
        />
      </div>

      {/* ─────────────── Highlight cards ─────────────── */}
      {(best || worst) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {best && (
            <HighlightCard
              icon={<Trophy className="w-4 h-4" />}
              tone="good"
              label="Best margin"
              code={best.quality_code}
              name={best.quality_name}
              amount={fmtRupees(best.margin)}
              pct={best.margin_pct != null ? `${best.margin_pct}%` : '—'}
            />
          )}
          {worst && worst !== best && (
            <HighlightCard
              icon={<AlertTriangle className="w-4 h-4" />}
              tone={Number(worst.margin) < 0 ? 'bad' : 'warn'}
              label={Number(worst.margin) < 0 ? 'Loss-making' : 'Thinnest margin'}
              code={worst.quality_code}
              name={worst.quality_name}
              amount={fmtRupees(worst.margin)}
              pct={worst.margin_pct != null ? `${worst.margin_pct}%` : '—'}
            />
          )}
        </div>
      )}

      {/* ─────────────── Per-quality table ─────────────── */}
      <SectionHeader
        icon={<Layers className="w-4 h-4" />}
        title="Margin by quality"
        subtitle="Compare invoiced vs produced metres to spot half-realised margins."
      />

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No quality has both an invoiced metre and a produced metre yet. Once
          you book a sale tied to a costing AND finish a production batch
          for it, this list will populate.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Quality</th>
                <th className="text-right px-3 py-2">Invoiced m</th>
                <th className="text-right px-3 py-2">Produced m</th>
                <th className="text-right px-3 py-2">Revenue ₹</th>
                <th className="text-right px-3 py-2">Cost ₹</th>
                <th className="text-right px-3 py-2">Margin ₹</th>
                <th className="text-right px-3 py-2">Margin %</th>
                <th className="text-right px-3 py-2">Sell ₹/m</th>
                <th className="text-right px-3 py-2">Cost ₹/m</th>
                <th className="text-left px-3 py-2">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const margin = Number(r.margin ?? 0);
                const pct = r.margin_pct != null ? Number(r.margin_pct) : null;
                const tone =
                  margin < 0
                    ? 'bad'
                    : pct != null && pct < 10
                      ? 'warn'
                      : 'good';

                const invoiced = Number(r.invoiced_m ?? 0);
                const produced = Number(r.produced_m ?? 0);
                const asymmetric =
                  (invoiced > 0 && produced === 0) ||
                  (produced > 0 && invoiced === 0);

                const lastDate = mostRecent(r.last_invoice_date, r.last_batch_date);

                return (
                  <tr
                    key={r.costing_id ?? i}
                    className="border-t border-line/40 hover:bg-cloud/20"
                  >
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-ink-mute">
                        {r.quality_code ?? '—'}
                      </div>
                      <div className="font-medium">{r.quality_name ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.invoiced_m, 1)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.produced_m, 1)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(r.total_revenue)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(r.total_cost)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      <MarginCell amount={r.margin} tone={tone} />
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <PctBadge pct={pct} asymmetric={asymmetric} />
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {r.avg_sell_per_m != null
                        ? fmtRupees(r.avg_sell_per_m, 2)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {r.avg_cost_per_m != null
                        ? fmtRupees(r.avg_cost_per_m, 2)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {fmtDate(lastDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-mute mt-4">
        Revenue is taken net of GST (taxable amount). Cost uses the snapshotted
        per-batch true cost frozen at the time of production, so historical
        batches keep their original numbers even if your costing master changes
        later. Credit-notes that reference a quality reduce its revenue.
      </p>
    </div>
  );
}

/* ─────────────────── presentational helpers ─────────────────── */

type Tone = 'good' | 'warn' | 'bad' | 'mute';

interface KpiProps {
  label: string;
  value: string;
  tone?: Tone;
}

function Kpi({ label, value, tone = 'mute' }: KpiProps) {
  const colour =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'bad'
          ? 'text-rose-700'
          : '';
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${colour}`}>{value}</div>
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
  const text =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-rose-700';
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

interface MarginCellProps {
  amount: number | null;
  tone: Tone;
}

function MarginCell({ amount, tone }: MarginCellProps) {
  if (amount == null) return <span className="text-ink-mute">—</span>;
  const colour =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-rose-700';
  return <span className={colour}>{fmtRupees(amount)}</span>;
}

interface PctBadgeProps {
  pct: number | null;
  asymmetric: boolean;
}

function PctBadge({ pct, asymmetric }: PctBadgeProps) {
  if (pct == null) {
    return <span className="text-ink-mute">—</span>;
  }
  const colour =
    pct < 0
      ? 'text-rose-700'
      : pct < 10
        ? 'text-amber-700'
        : pct < 20
          ? 'text-amber-600'
          : 'text-emerald-700';
  const Icon = pct < 0 ? TrendingDown : pct < 5 ? Minus : TrendingUp;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${colour}`}>
      <Icon className="w-3 h-3" />
      {pct.toFixed(2)}%
      {asymmetric && (
        <span
          className="text-amber-600"
          title="Asymmetric: only one of (invoiced, produced) has activity"
        >
          *
        </span>
      )}
    </span>
  );
}

function mostRecent(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}
