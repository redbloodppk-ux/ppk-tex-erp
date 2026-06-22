/**
 * Loom Utilisation (CORR-R8)
 *
 * Per-loom workload built from production batches. The original card asked
 * for pick-rate / RPM / downtime per shift, but the database has no shift
 * log, no downtime capture and no RPM readings — so none of that can be
 * shown yet. This report uses only what production_batch records: which
 * loom ran a batch, metres produced, metres rejected, and start/end dates.
 *
 * Columns:
 *   Batches       - total / finished / still running on the loom
 *   Produced m    - good metres woven
 *   Rejected m    - rejected metres, with rejection % alongside
 *   Active days   - sum of (end − start + 1) over finished batches; an
 *                   approximate count of loom-days actually worked
 *   m / day       - produced metres ÷ active days (a throughput proxy)
 *   Avg m / batch - produced metres ÷ finished batches
 *
 * Every loom appears, including idle ones with no batches, so you can see
 * which machines are sitting unused.
 *
 * To get true efficiency (pick rate, RPM utilisation, downtime reasons) the
 * business would first need a shift-production / downtime logging screen —
 * that is a separate, larger piece of work.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { Cog, Activity, Pause } from 'lucide-react';

export const metadata = { title: 'Loom Utilisation' };
export const dynamic = 'force-dynamic';

interface LoomRow {
  loom_id: number | null;
  loom_code: string | null;
  loom_type: string | null;
  width_in: number | null;
  status: string | null;
  batch_count: number | null;
  finished_batches: number | null;
  running_batches: number | null;
  total_produced_m: number | null;
  total_rejected_m: number | null;
  rejection_pct: number | null;
  active_days: number | null;
  m_per_active_day: number | null;
  avg_m_per_batch: number | null;
  first_batch_start: string | null;
  last_batch_end: string | null;
}

type Tone = 'good' | 'warn' | 'bad' | 'mute';

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toFixed(2) + '%';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/** Higher rejection is worse. */
function rejectionTone(pct: number | null): Tone {
  if (pct == null) return 'mute';
  const v = Number(pct);
  if (v >= 5) return 'bad';
  if (v >= 2) return 'warn';
  return 'good';
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

export default async function LoomUtilisationReport() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_loom_utilisation')
    .select('*')
    .order('total_produced_m', { ascending: false });

  const rows = (data as unknown as LoomRow[]) ?? [];

  /* ───────── summary roll-up ───────── */
  const totalLooms = rows.length;
  const idleLooms = rows.filter(
    (r) => Number(r.batch_count ?? 0) === 0,
  ).length;
  const activeLooms = totalLooms - idleLooms;
  const totalProduced = rows.reduce(
    (s, r) => s + Number(r.total_produced_m ?? 0),
    0,
  );
  const totalRejected = rows.reduce(
    (s, r) => s + Number(r.total_rejected_m ?? 0),
    0,
  );
  const overallRejectionPct =
    totalProduced + totalRejected > 0
      ? (totalRejected / (totalProduced + totalRejected)) * 100
      : null;

  const busiest = rows.find((r) => Number(r.total_produced_m ?? 0) > 0);

  const exportColumns: ExcelColumn[] = [
    { key: 'loom_code', label: 'Loom', type: 'text' },
    { key: 'loom_type', label: 'Type', type: 'text' },
    { key: 'batch_count', label: 'Batches', type: 'number', total: true },
    { key: 'total_produced_m', label: 'Produced m', type: 'metre', total: true },
    { key: 'total_rejected_m', label: 'Rejected m', type: 'metre', total: true },
    { key: 'rejection_pct', label: 'Reject %', type: 'percent' },
    { key: 'active_days', label: 'Active days', type: 'number', total: true },
    { key: 'm_per_active_day', label: 'm / day', type: 'number' },
    { key: 'avg_m_per_batch', label: 'Avg m / batch', type: 'number' },
    { key: 'last_batch_end', label: 'Last finished', type: 'date' },
  ];

  return (
    <div>
      <PageHeader
        title="Loom Utilisation"
        subtitle="How much work each loom has done, from production batch records. Sorted by metres woven — busiest looms first, idle looms at the bottom."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Loom Utilisation' },
        ]}
        actions={
          <ExcelExportButton
            filename="loom-utilisation"
            sheetName="Loom Utilisation"
            title="Loom Utilisation"
            columns={exportColumns}
            rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
          />
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load loom data: {error.message}
        </div>
      )}

      <div className="card p-3 mb-6 text-xs text-ink-soft border border-amber-200 bg-amber-50/40">
        <span className="font-semibold text-amber-700">Note:</span> This report
        shows workload only. Pick rate, RPM utilisation and downtime are not
        tracked anywhere in the system yet — capturing those needs a
        shift-production logging screen, which is separate future work.
      </div>

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Looms in registry" value={fmtNum(totalLooms)} />
        <Kpi
          label="Looms with activity"
          value={`${activeLooms} of ${totalLooms}`}
          tone={activeLooms > 0 ? 'good' : 'mute'}
        />
        <Kpi label="Total metres woven" value={fmtNum(totalProduced, 0)} />
        <Kpi
          label="Overall rejection %"
          value={fmtPct(overallRejectionPct)}
          tone={rejectionTone(overallRejectionPct)}
        />
      </div>

      {/* ─────────────── Highlight cards ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {busiest && (
          <HighlightCard
            icon={<Activity className="w-4 h-4" />}
            tone="good"
            label="Busiest loom"
            code={busiest.loom_code}
            sub={`${busiest.loom_type ?? '—'} · ${fmtNum(busiest.finished_batches)} batches`}
            value={`${fmtNum(busiest.total_produced_m, 0)} m`}
          />
        )}
        <HighlightCard
          icon={<Pause className="w-4 h-4" />}
          tone={idleLooms > 0 ? 'warn' : 'good'}
          label="Idle looms"
          code={idleLooms > 0 ? `${idleLooms} loom${idleLooms > 1 ? 's' : ''}` : 'None'}
          sub={
            idleLooms > 0
              ? 'No production batch recorded yet'
              : 'Every loom has run at least one batch'
          }
          value={idleLooms > 0 ? `${idleLooms}` : '0'}
        />
      </div>

      {/* ─────────────── Per-loom table ─────────────── */}
      <SectionHeader
        icon={<Cog className="w-4 h-4" />}
        title="Workload by loom"
        subtitle="Every loom in the registry, busiest first."
      />

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No looms in the registry yet. Add looms under the Looms screen and
          they will appear here once production batches are recorded against
          them.
        </div>
      ) : (
        <>
        <CardFilter placeholder="Search looms…">
          {rows.map((r, i) => {
            const idle = Number(r.batch_count ?? 0) === 0;
            const rejTone = rejectionTone(r.rejection_pct);
            return (
              <div key={r.loom_id ?? i} className={`card p-3 ${idle ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-words">{r.loom_code ?? '—'}</div>
                    <div className="text-xs text-ink-soft mt-0.5">
                      {r.loom_type ?? '—'}{r.width_in != null ? ` · ${fmtNum(r.width_in, 0)}" wide` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="num font-semibold text-base">{fmtNum(r.total_produced_m, 0)}</span>
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">produced m</div>
                  </div>
                </div>
                <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>
                    Batches: <span className="num font-semibold">{fmtNum(r.batch_count)}</span>
                    {Number(r.running_batches ?? 0) > 0 && (
                      <span className="text-emerald-700 ml-1">({fmtNum(r.running_batches)} running)</span>
                    )}
                  </div>
                  <div>Rejected m: <span className="num">{fmtNum(r.total_rejected_m, 0)}</span></div>
                  <div>Reject %: <span className={`num ${toneClass(rejTone)}`}>{fmtPct(r.rejection_pct)}</span></div>
                  <div>Active days: <span className="num">{fmtNum(r.active_days)}</span></div>
                  <div>m / day: <span className="num">{fmtNum(r.m_per_active_day, 0)}</span></div>
                  <div>Avg m / batch: <span className="num">{fmtNum(r.avg_m_per_batch, 0)}</span></div>
                  <div className="col-span-2">Last finished: {fmtDate(r.last_batch_end)}</div>
                </div>
              </div>
            );
          })}
        </CardFilter>
        <div className="card p-0 overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Loom</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-right px-3 py-2">Batches</th>
                <th className="text-right px-3 py-2">Produced m</th>
                <th className="text-right px-3 py-2">Rejected m</th>
                <th className="text-right px-3 py-2">Reject %</th>
                <th className="text-right px-3 py-2">Active days</th>
                <th className="text-right px-3 py-2">m / day</th>
                <th className="text-right px-3 py-2">Avg m / batch</th>
                <th className="text-left px-3 py-2">Last finished</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const idle = Number(r.batch_count ?? 0) === 0;
                const rejTone = rejectionTone(r.rejection_pct);
                return (
                  <tr
                    key={r.loom_id ?? i}
                    className={`border-t border-line/40 hover:bg-cloud/20 ${
                      idle ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {r.loom_code ?? '—'}
                      </div>
                      <div className="text-xs text-ink-mute">
                        {r.width_in != null
                          ? `${fmtNum(r.width_in, 0)}" wide`
                          : '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.loom_type ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <span className="font-semibold">
                        {fmtNum(r.batch_count)}
                      </span>
                      {Number(r.running_batches ?? 0) > 0 && (
                        <span className="text-emerald-700 ml-1">
                          ({fmtNum(r.running_batches)} running)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {fmtNum(r.total_produced_m, 0)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.total_rejected_m, 0)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <span className={toneClass(rejTone)}>
                        {fmtPct(r.rejection_pct)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.active_days)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtNum(r.m_per_active_day, 0)}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {fmtNum(r.avg_m_per_batch, 0)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {fmtDate(r.last_batch_end)}
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
        Active days is the sum of (end date − start date + 1) across finished
        batches — it approximates how many days the loom was actually weaving,
        not calendar days since it was installed. Metres per day uses that
        figure, so it is a rough throughput guide rather than a precise
        efficiency number. Idle looms (no batches) are shown faded.
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
  code: string | null;
  sub: string;
  value: string;
}

function HighlightCard({
  icon,
  tone,
  label,
  code,
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
          <div className="font-medium">{code ?? '—'}</div>
          <div className="text-xs text-ink-mute">{sub}</div>
        </div>
        <div className={`text-lg font-semibold ${text}`}>{value}</div>
      </div>
    </div>
  );
}
