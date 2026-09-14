/**
 * Yarn Days-of-Cover (CORR-R9)
 *
 * "How long will the yarn last?" — one row per yarn count, built from the
 * v_yarn_cover_dashboard view.
 *
 *   available_kg   - kg in stock across all open lots
 *   kg_30d         - estimated warp yarn consumed in the last 30 days
 *   days_of_cover  - available_kg / (kg_30d / 30); how many days the
 *                    current stock would last at the recent run-rate
 *   below_reorder  - available_kg has dropped under the reorder level
 *   cover_status   - risk bucket: out / critical / low / ok / idle
 *
 * IMPORTANT: days_of_cover can only be computed when there has been warp
 * consumption in the last 30 days. With no recent production the run-rate
 * is zero, cover is undefined, and the yarn is shown as "Idle" — the page
 * falls back to the reorder check so low stock still surfaces.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { Layers, AlertTriangle, PackageX } from 'lucide-react';

export const metadata = { title: 'Yarn Days-of-Cover' };
export const dynamic = 'force-dynamic';

interface CoverRow {
  yarn_count_id: number | null;
  code: string | null;
  display_name: string | null;
  yarn_type: string | null;
  reorder_kg: number | null;
  status: string | null;
  available_kg: number | null;
  kg_30d: number | null;
  days_of_cover: number | null;
  below_reorder: boolean | null;
  cover_status: string | null;
}

/**
 * Whose shelf the page is reporting on.
 *
 * PPK, 2026-09-14, asked for the in-house / jobwork / outsource filter here
 * as well as on Stock on Hand.
 *
 * There is deliberately no "all". Cover is stock divided by the rate the
 * MILL draws it down; adding yarn that is sitting at a jobwork party to the
 * numerator would make the mill look better covered than it is. The two
 * sides are reported separately or not at all.
 */
type StockMode = 'in_house' | 'jobwork' | 'outsource';

const MODE_LABEL: Record<StockMode, string> = {
  in_house: 'In-house',
  jobwork: 'Job work',
  outsource: 'Outsource',
};

type Tone = 'good' | 'warn' | 'bad' | 'mute';

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Lower days_of_cover is worse. */
function coverTone(status: string | null): Tone {
  switch (status) {
    case 'out':
      return 'bad';
    case 'critical':
      return 'bad';
    case 'low':
      return 'warn';
    case 'ok':
      return 'good';
    default:
      return 'mute';
  }
}

function statusLabel(status: string | null): string {
  switch (status) {
    // Vendor modes: the yarn is at a party, so there is no cover to rate.
    case 'held':
      return 'With the party';
    case 'none':
      return 'None held';
    case 'out':
      return 'Out of stock';
    case 'critical':
      return 'Critical';
    case 'low':
      return 'Low';
    case 'ok':
      return 'OK';
    case 'idle':
      return 'Idle — no recent use';
    default:
      return '—';
  }
}

/** Sort order: most urgent first. */
function riskRank(status: string | null): number {
  switch (status) {
    case 'held':
      return 2;
    case 'none':
      return 5;
    case 'out':
      return 0;
    case 'critical':
      return 1;
    case 'low':
      return 2;
    case 'idle':
      return 3;
    case 'ok':
      return 4;
    default:
      return 5;
  }
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

function badgeClass(tone: Tone): string {
  return tone === 'good'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : tone === 'warn'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : tone === 'bad'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-cloud/50 text-ink-soft border-line/60';
}

export default async function DaysOfCoverReport({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const sp = await searchParams;
  const mode: StockMode =
    sp.mode === 'jobwork' || sp.mode === 'outsource' ? sp.mode : 'in_house';
  const isVendorMode = mode !== 'in_house';

  const supabase = await createClient();

  let data: unknown = null;
  let error: { message: string } | null = null;

  if (isVendorMode) {
    // Yarn held by a jobwork / outsource party, from fn_stock_by_mode
    // (migration 300). Cover, reorder and 30-day usage do not apply: the
    // mill is not drawing this yarn down, the party is, and nothing here
    // records at what rate.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (supabase as any).rpc('fn_stock_by_mode', { p_mode: mode });
    error = res.error ?? null;
    data = ((res.data ?? []) as CoverRow[]).map((r) => ({
      ...r,
      kg_30d: null,
      days_of_cover: null,
      below_reorder: false,
      cover_status: Number(r.available_kg ?? 0) > 0 ? 'held' : 'none',
    }));
  } else {
    const res = await supabase.from('v_yarn_cover_dashboard').select('*');
    data = res.data;
    error = res.error;
  }

  const rows = (data as unknown as CoverRow[]) ?? [];
  rows.sort((a, b) => {
    const r = riskRank(a.cover_status) - riskRank(b.cover_status);
    if (r !== 0) return r;
    return Number(a.available_kg ?? 0) - Number(b.available_kg ?? 0);
  });

  /* ───────── summary roll-up ───────── */
  const totalCounts = rows.length;
  const outOfStock = rows.filter((r) => r.cover_status === 'out').length;
  const inStock = rows.filter(
    (r) => Number(r.available_kg ?? 0) > 0,
  ).length;
  const belowReorder = rows.filter((r) => r.below_reorder === true).length;
  const totalAvailable = rows.reduce(
    (s, r) => s + Number(r.available_kg ?? 0),
    0,
  );

  const exportColumns: ExcelColumn[] = [
    { key: 'code', label: 'Yarn', type: 'text' },
    { key: 'display_name', label: 'Name', type: 'text' },
    { key: 'yarn_type', label: 'Type', type: 'text' },
    { key: 'reorder_kg', label: 'Reorder kg', type: 'number' },
    { key: 'available_kg', label: 'Available kg', type: 'number', total: true },
    { key: 'kg_30d', label: 'Used 30d kg', type: 'number', total: true },
    { key: 'days_of_cover', label: 'Days of cover', type: 'number' },
    { key: 'cover_status', label: 'Status', type: 'text' },
  ];

  return (
    <div>
      <PageHeader
        title="Yarn Days-of-Cover"
        subtitle={
          isVendorMode
            ? `Yarn sitting with your ${MODE_LABEL[mode].toLowerCase()} parties, count by count. Cover cannot be worked out for it — see the note below.`
            : 'How long current yarn stock will last at the recent run-rate. Highest-risk yarns first, healthy stock at the bottom.'
        }
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Days of Cover' },
        ]}
        actions={
          <ExcelExportButton
            filename={`yarn-days-of-cover-${mode}`}
            sheetName="Days of Cover"
            title={`Yarn Days-of-Cover — ${MODE_LABEL[mode]}`}
            columns={exportColumns}
            rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
          />
        }
      />

      {/* Mode tabs. Same vocabulary as Stock on Hand and Warehouse, so the
          three stock screens are switched the same way. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(['in_house', 'jobwork', 'outsource'] as StockMode[]).map((m) => (
          <Link
            key={m}
            href={m === 'in_house' ? '/app/reports/days-of-cover' : `/app/reports/days-of-cover?mode=${m}`}
            className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${
              mode === m
                ? 'bg-indigo text-white border-indigo shadow-sm'
                : 'bg-paper text-ink-soft border-line hover:bg-haze hover:text-ink'
            }`}
          >
            {MODE_LABEL[m]}
          </Link>
        ))}
      </div>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load cover data: {error.message}
        </div>
      )}

      <div className="card p-3 mb-6 text-xs text-ink-soft border border-amber-200 bg-amber-50/40">
        <span className="font-semibold text-amber-700">How to read this:</span>{' '}
        {isVendorMode ? (
          <>
            This is yarn you have given out and not yet had back as cloth, so
            it is not on your shelf and the mill is not drawing it down.
            Cover, reorder level and 30-day usage are all blank for that
            reason — showing a number would suggest something is being
            measured that is not. Use it to see how much is out with whom.
          </>
        ) : (
          <>
            Days of cover = stock in kg ÷ average daily warp use over the last
            30 days. When there has been no production in the last 30 days the
            run-rate is zero and cover cannot be computed — those yarns show as{' '}
            <span className="font-medium">Idle</span>, and the reorder-level
            check still flags anything running low.
          </>
        )}
      </div>

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Yarn counts tracked" value={fmtNum(totalCounts)} />
        <Kpi
          label={isVendorMode ? 'Counts held' : 'In stock'}
          value={`${inStock} of ${totalCounts}`}
          tone={inStock > 0 ? 'good' : 'mute'}
        />
        <Kpi
          label={isVendorMode ? 'Total kg out' : 'Out of stock'}
          value={isVendorMode ? `${fmtNum(totalAvailable, 0)} kg` : fmtNum(outOfStock)}
          tone={isVendorMode ? 'mute' : outOfStock > 0 ? 'bad' : 'good'}
        />
        <Kpi
          label="Below reorder level"
          value={isVendorMode ? '—' : fmtNum(belowReorder)}
          tone={isVendorMode ? 'mute' : belowReorder > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* ─────────────── Highlight cards ───────────────
          Both are about the mill's own shelf running low, which says
          nothing about yarn already given to a party. Hidden there rather
          than shown reading zero. */}
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 ${isVendorMode ? 'hidden' : ''}`}>
        <HighlightCard
          icon={<PackageX className="w-4 h-4" />}
          tone={outOfStock > 0 ? 'bad' : 'good'}
          label="Out of stock"
          headline={
            outOfStock > 0
              ? `${outOfStock} yarn count${outOfStock > 1 ? 's' : ''}`
              : 'None'
          }
          sub={
            outOfStock > 0
              ? 'No open lots — order before the next warp'
              : 'Every yarn count has stock on hand'
          }
        />
        <HighlightCard
          icon={<AlertTriangle className="w-4 h-4" />}
          tone={belowReorder > 0 ? 'warn' : 'good'}
          label="Below reorder level"
          headline={
            belowReorder > 0
              ? `${belowReorder} yarn count${belowReorder > 1 ? 's' : ''}`
              : 'None'
          }
          sub={
            belowReorder > 0
              ? 'Stock has dropped under the set reorder kg'
              : 'All yarns above their reorder level'
          }
        />
      </div>

      {/* ─────────────── Per-yarn table ─────────────── */}
      <SectionHeader
        icon={<Layers className="w-4 h-4" />}
        title={isVendorMode ? `Yarn with ${MODE_LABEL[mode].toLowerCase()} parties` : 'Cover by yarn count'}
        subtitle={
          isVendorMode
            ? `${fmtNum(totalAvailable, 0)} kg out with parties in total`
            : `${fmtNum(totalAvailable, 0)} kg of yarn on hand in total`
        }
      />

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No yarn counts in the registry yet. Add yarn counts and receive lots,
          and they will appear here.
        </div>
      ) : (
        <>
        <CardFilter placeholder="Search yarn counts…">
          {rows.map((r, i) => {
            const tone = coverTone(r.cover_status);
            const out = r.cover_status === 'out';
            return (
              <div key={r.yarn_count_id ?? i} className={`card p-3 ${out ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-words">{r.code ?? '—'}</div>
                    <div className="text-xs text-ink-soft mt-0.5">{r.display_name ?? '—'}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${badgeClass(tone)}`}>
                    {statusLabel(r.cover_status)}
                  </span>
                </div>
                <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>Type: <span className="capitalize">{r.yarn_type ?? '—'}</span></div>
                  <div>Reorder kg: <span className="num">{fmtNum(r.reorder_kg, 0)}</span></div>
                  <div>Available kg: <span className={`num font-semibold ${r.below_reorder ? 'text-amber-700' : ''}`}>{fmtNum(r.available_kg, 0)}</span></div>
                  <div>Used 30d kg: <span className="num">{Number(r.kg_30d ?? 0) > 0 ? fmtNum(r.kg_30d, 0) : '—'}</span></div>
                  <div>Days of cover: {r.days_of_cover != null ? <span className={`num ${toneClass(tone)}`}>{fmtNum(r.days_of_cover, 0)}</span> : <span className="text-ink-mute">—</span>}</div>
                </div>
              </div>
            );
          })}
        </CardFilter>
        <div className="card p-0 overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Yarn</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-right px-3 py-2">Reorder kg</th>
                <th className="text-right px-3 py-2">Available kg</th>
                <th className="text-right px-3 py-2">Used 30d kg</th>
                <th className="text-right px-3 py-2">Days of cover</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const tone = coverTone(r.cover_status);
                const out = r.cover_status === 'out';
                return (
                  <tr
                    key={r.yarn_count_id ?? i}
                    className={`border-t border-line/40 hover:bg-cloud/20 ${
                      out ? 'opacity-70' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.code ?? '—'}</div>
                      <div className="text-xs text-ink-mute">
                        {r.display_name ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs capitalize">
                      {r.yarn_type ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtNum(r.reorder_kg, 0)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right num font-semibold ${
                        r.below_reorder ? 'text-amber-700' : ''
                      }`}
                    >
                      {fmtNum(r.available_kg, 0)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {Number(r.kg_30d ?? 0) > 0
                        ? fmtNum(r.kg_30d, 0)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {r.days_of_cover != null ? (
                        <span className={toneClass(tone)}>
                          {fmtNum(r.days_of_cover, 0)}
                        </span>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${badgeClass(
                          tone,
                        )}`}
                      >
                        {statusLabel(r.cover_status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <p className="text-xs text-ink-mute mt-4">
        {isVendorMode ? (
          <>
            Source: <code>fn_stock_by_mode</code> (migration 300) — open weft
            bags given to {MODE_LABEL[mode].toLowerCase()} parties, summed per
            yarn count. The totals here match the {MODE_LABEL[mode]} column on{' '}
            <Link href={`/app/reports/stock-on-hand?mode=${mode}`} className="underline">
              Stock on Hand
            </Link>.
          </>
        ) : (
          <>
            &quot;Used 30d&quot; is the estimated warp yarn drawn down by
            production batches started in the last 30 days. Days of cover
            divides current stock by the daily average of that figure, so it is
            a planning guide, not an exact forecast. Yarns with no recent
            production show &quot;Idle&quot; — judge those by the reorder level
            instead.
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
}

function HighlightCard({
  icon,
  tone,
  label,
  headline,
  sub,
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
      <div className="mt-2">
        <div className={`text-lg font-semibold ${text}`}>{headline}</div>
        <div className="text-xs text-ink-mute mt-0.5">{sub}</div>
      </div>
    </div>
  );
}
