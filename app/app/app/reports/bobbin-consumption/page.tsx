/**
 * Bobbin Consumption (CORR-R10)
 *
 * One row per bobbin (warp beam), from the v_bobbin_consumption view.
 * Two halves:
 *
 *   1. Cost — rupee_per_m = bobbin_price / bobbin_metre. How much each
 *      bobbin adds to the cost of every metre of fabric it weaves.
 *
 *   2. Split-piece reconciliation — bobbins are bought as whole pieces but
 *      used up continuously in metres. produced_m_total / bobbin_metre is
 *      the pieces a bobbin has consumed; that splits into whole pieces
 *      fully used and a partial fraction of the current piece.
 *
 * When there is no production yet the usage half reads zero — the cost
 * and stock halves still work. There is no physical bobbin-issue log in
 * the system, so consumption is derived from produced metres.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { Disc, IndianRupee, AlertTriangle } from 'lucide-react';

export const metadata = { title: 'Bobbin Consumption' };
export const dynamic = 'force-dynamic';

interface BobbinRow {
  bobbin_id: number | null;
  code: string | null;
  description: string | null;
  is_lurex: boolean | null;
  vendor_id: number | null;
  vendor_name: string | null;
  bobbin_metre: number | null;
  bobbin_price: number | null;
  ends_per_bobbin: number | null;
  loading_per_metre: number | null;
  reorder_pieces: number | null;
  rupee_per_m: number | null;
  stock_pcs: number | null;
  below_reorder: boolean | null;
  batches_used: number | null;
  produced_m_total: number | null;
  pieces_consumed_equiv: number | null;
  whole_pieces_consumed: number | null;
  partial_piece_fraction: number | null;
  bobbin_spend: number | null;
}

type Tone = 'good' | 'warn' | 'bad' | 'mute';

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtRupees(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return '₹' + fmtNum(n, decimals);
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

export default async function BobbinConsumptionReport() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_bobbin_consumption')
    .select('*')
    .order('rupee_per_m', { ascending: false });

  const rows = (data as unknown as BobbinRow[]) ?? [];

  /* ───────── summary roll-up ───────── */
  const totalBobbins = rows.length;
  const belowReorder = rows.filter((r) => r.below_reorder === true).length;
  const totalStockPcs = rows.reduce(
    (s, r) => s + Number(r.stock_pcs ?? 0),
    0,
  );
  const totalProduced = rows.reduce(
    (s, r) => s + Number(r.produced_m_total ?? 0),
    0,
  );
  const rpmValues = rows
    .map((r) => Number(r.rupee_per_m ?? 0))
    .filter((v) => v > 0);
  const avgRpm =
    rpmValues.length > 0
      ? rpmValues.reduce((a, b) => a + b, 0) / rpmValues.length
      : null;

  const dearest = rows.find((r) => Number(r.rupee_per_m ?? 0) > 0);
  const noProduction = totalProduced === 0;

  const exportColumns: ExcelColumn[] = [
    { key: 'code', label: 'Bobbin', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'vendor_name', label: 'Vendor', type: 'text' },
    { key: 'bobbin_metre', label: 'Metres / pc', type: 'number' },
    { key: 'bobbin_price', label: 'Price / pc', type: 'rupee' },
    { key: 'rupee_per_m', label: 'Cost / m', type: 'rupee' },
    { key: 'stock_pcs', label: 'Stock pcs', type: 'number', total: true },
    { key: 'produced_m_total', label: 'Produced m', type: 'metre', total: true },
    { key: 'pieces_consumed_equiv', label: 'Pieces used', type: 'number' },
    { key: 'bobbin_spend', label: 'Bobbin spend', type: 'rupee', total: true },
  ];

  return (
    <div>
      <PageHeader
        title="Bobbin Consumption"
        subtitle="Cost per metre of each warp beam, plus a split-piece reconciliation of how many bobbins have been used up. Costliest per metre first."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Bobbin Consumption' },
        ]}
        actions={
          <ExcelExportButton
            filename="bobbin-consumption"
            sheetName="Bobbin Consumption"
            title="Bobbin Consumption"
            columns={exportColumns}
            rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
          />
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load bobbin data: {error.message}
        </div>
      )}

      {noProduction && (
        <div className="card p-3 mb-6 text-xs text-ink-soft border border-amber-200 bg-amber-50/40">
          <span className="font-semibold text-amber-700">Note:</span> No
          production batches have been recorded yet, so the consumption and
          split-piece columns all read zero. The cost-per-metre and stock
          figures are live. Once batches name their bobbins, pieces-consumed
          will fill in automatically.
        </div>
      )}

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Bobbins in registry" value={fmtNum(totalBobbins)} />
        <Kpi label="Pieces in stock" value={fmtNum(totalStockPcs)} />
        <Kpi
          label="Below reorder level"
          value={fmtNum(belowReorder)}
          tone={belowReorder > 0 ? 'warn' : 'good'}
        />
        <Kpi
          label="Avg cost per metre"
          value={avgRpm != null ? fmtRupees(avgRpm, 2) : '—'}
        />
      </div>

      {/* ─────────────── Highlight cards ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {dearest && (
          <HighlightCard
            icon={<IndianRupee className="w-4 h-4" />}
            tone="warn"
            label="Costliest per metre"
            headline={dearest.code ?? '—'}
            sub={`${dearest.description ?? '—'}`}
            value={fmtRupees(dearest.rupee_per_m, 2) + ' / m'}
          />
        )}
        <HighlightCard
          icon={<AlertTriangle className="w-4 h-4" />}
          tone={belowReorder > 0 ? 'warn' : 'good'}
          label="Below reorder level"
          headline={
            belowReorder > 0
              ? `${belowReorder} bobbin${belowReorder > 1 ? 's' : ''}`
              : 'None'
          }
          sub={
            belowReorder > 0
              ? 'Stock has dropped under the reorder pieces'
              : 'All bobbins above their reorder level'
          }
          value={belowReorder > 0 ? `${belowReorder}` : '0'}
        />
      </div>

      {/* ─────────────── Per-bobbin table ─────────────── */}
      <SectionHeader
        icon={<Disc className="w-4 h-4" />}
        title="Cost and consumption by bobbin"
        subtitle="Every bobbin in the registry, costliest per metre first."
      />

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No bobbins in the registry yet. Add bobbins under the Bobbins screen
          and they will appear here.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Bobbin</th>
                <th className="text-right px-3 py-2">Metres / pc</th>
                <th className="text-right px-3 py-2">Price / pc</th>
                <th className="text-right px-3 py-2">Cost / m</th>
                <th className="text-right px-3 py-2">Stock pcs</th>
                <th className="text-right px-3 py-2">Produced m</th>
                <th className="text-right px-3 py-2">Pieces used</th>
                <th className="text-right px-3 py-2">Bobbin spend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const whole = r.whole_pieces_consumed ?? 0;
                const frac = Number(r.partial_piece_fraction ?? 0);
                return (
                  <tr
                    key={r.bobbin_id ?? i}
                    className="border-t border-line/40 hover:bg-cloud/20"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium flex items-center gap-2">
                        {r.code ?? '—'}
                        {r.is_lurex && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            Lurex
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-mute">
                        {r.description ?? '—'}
                        {r.vendor_name ? ` · ${r.vendor_name}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtNum(r.bobbin_metre, 0)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtRupees(r.bobbin_price, 0)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {fmtRupees(r.rupee_per_m, 2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right num ${
                        r.below_reorder ? 'text-amber-700 font-semibold' : ''
                      }`}
                    >
                      {fmtNum(r.stock_pcs, 0)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {Number(r.produced_m_total ?? 0) > 0
                        ? fmtNum(r.produced_m_total, 0)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {Number(r.produced_m_total ?? 0) > 0 ? (
                        <span>
                          {fmtNum(whole, 0)}
                          {frac > 0 && (
                            <span className="text-ink-mute">
                              {' '}
                              + {(frac * 100).toFixed(0)}%
                            </span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {Number(r.bobbin_spend ?? 0) > 0
                        ? fmtRupees(r.bobbin_spend, 0)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-mute mt-4">
        &quot;Cost / m&quot; is price per piece ÷ metres per piece — the bobbin
        share of every metre woven. &quot;Pieces used&quot; is produced metres
        ÷ metres per piece: the whole number is bobbins fully used up, the
        percentage is how far into the current bobbin you are (the split
        piece). &quot;Bobbin spend&quot; values that consumption at the
        purchase price. With no production recorded, the last three columns
        stay blank.
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
