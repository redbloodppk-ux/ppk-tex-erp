/**
 * Sizing Spend Report (CORR-R3)
 *
 * Three sections, all server-rendered, in order of "how much, who, why":
 *
 *   1. Monthly spend       â€” v_sizing_spend_by_month
 *      Where the money went, period by period. Shows total â‚¹, total kg
 *      consumed, weighted â‚¹/kg, and trend arrow vs previous month.
 *
 *   2. Per-vendor spend    â€” v_sizing_spend_by_vendor
 *      Ranked biggest-spend first. Lets the owner see which vendor is
 *      cheapest on â‚¹/kg so the next set_no goes to the right party.
 *
 *   3. Planned vs actual   â€” v_batch_sizing_variance
 *      Per-batch variance: did the actual sizing cost â‚¹/m drift from the
 *      costing we promised the SO? Overruns flagged amber, savings green.
 *
 * Date range filter via ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults: last
 * 12 months â†’ today). Empty data shows a friendly placeholder per section
 * â€” sizing data is new in the system so this will be sparse for a while.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Minus,
  Calendar,
  Users,
  GitCompare,
} from 'lucide-react';
import { recordDateBounds, clampDate, SOURCES as DATE_SOURCES } from '@/lib/reports/record-bounds';

export const metadata = { title: 'Sizing Spend' };
export const dynamic = 'force-dynamic';

interface MonthRow {
  period_start: string | null;
  jobs_count: number | null;
  total_yarn_kg: number | null;
  total_spend: number | null;
  effective_rate_per_kg: number | null;
}

interface VendorRow {
  vendor_id: number | null;
  vendor_code: string | null;
  vendor_name: string | null;
  jobs_count: number | null;
  total_yarn_kg: number | null;
  total_spend: number | null;
  effective_rate_per_kg: number | null;
  first_job_date: string | null;
  last_job_date: string | null;
}

interface VarianceRow {
  batch_id: number | null;
  batch_code: string | null;
  sizing_job_code: string | null;
  planned_sizing_cost_per_m: number | null;
  actual_sizing_cost_per_m: number | null;
  variance_per_m: number | null;
  variance_total: number | null;
  produced_m: number | null;
}

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return 'â€”';
  return 'â‚¹' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return 'â€”';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtMonth(iso: string | null): string {
  if (!iso) return 'â€”';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function SizingSpendReport({ searchParams }: PageProps) {
  const sp = await searchParams;
  const fromRaw = sp.from ?? isoMonthsAgo(12);
  const toRaw = sp.to ?? todayISO();

  const supabase = await createClient();

  // Keep the pickers inside the dates the books actually reach.
  // See lib/reports/record-bounds.
  const bounds = await recordDateBounds(supabase, DATE_SOURCES.sizing);
  const from = clampDate(fromRaw, bounds);
  const to = clampDate(toRaw, bounds);

  const [monthRes, vendorRes, varianceRes] = await Promise.all([
    supabase
      .from('v_sizing_spend_by_month')
      .select('*')
      .gte('period_start', from)
      .lte('period_start', to)
      .order('period_start', { ascending: false }),
    supabase
      .from('v_sizing_spend_by_vendor')
      .select('*')
      .order('total_spend', { ascending: false }),
    supabase
      .from('v_batch_sizing_variance')
      .select(
        'batch_id, batch_code, sizing_job_code, planned_sizing_cost_per_m, actual_sizing_cost_per_m, variance_per_m, variance_total, produced_m'
      )
      .not('variance_per_m', 'is', null)
      .order('variance_per_m', { ascending: false })
      .limit(50),
  ]);

  const months = (monthRes.data as unknown as MonthRow[]) ?? [];
  const vendors = (vendorRes.data as unknown as VendorRow[]) ?? [];
  const variances = (varianceRes.data as unknown as VarianceRow[]) ?? [];

  // Summary totals across the filtered window.
  const totalSpend = months.reduce((s, m) => s + Number(m.total_spend ?? 0), 0);
  const totalKg = months.reduce((s, m) => s + Number(m.total_yarn_kg ?? 0), 0);
  const totalJobs = months.reduce((s, m) => s + Number(m.jobs_count ?? 0), 0);
  const blendedRate = totalKg > 0 ? totalSpend / totalKg : null;

  /* Excel export â€” the monthly spend table for the filtered window */
  const exportColumns: ExcelColumn[] = [
    { key: 'period_start', label: 'Month', type: 'date', width: 14 },
    { key: 'jobs_count', label: 'Jobs', type: 'number', width: 10, total: true },
    { key: 'total_yarn_kg', label: 'Yarn kg', type: 'number', width: 13, total: true },
    { key: 'total_spend', label: 'Total spend', type: 'rupee', width: 15, total: true },
    { key: 'effective_rate_per_kg', label: 'Effective/kg', type: 'rupee', width: 14 },
  ];
  const exportRows = months.map((m) => ({
    period_start: m.period_start ?? '',
    jobs_count: Number(m.jobs_count ?? 0),
    total_yarn_kg: Number(m.total_yarn_kg ?? 0),
    total_spend: Number(m.total_spend ?? 0),
    effective_rate_per_kg: Number(m.effective_rate_per_kg ?? 0),
  }));

  return (
    <div>
      <PageHeader
        title="Sizing Spend"
        subtitle={`Where your sizing rupees went between ${from} and ${to}. Drill down to find the cheapest vendor and spot batches that drifted from plan.`}
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Sizing Spend' },
        ]}
        actions={
          <ExcelExportButton
            filename="sizing-spend-by-month"
            sheetName="Sizing Spend"
            title={`Sizing Spend by Month Â· ${from} to ${to}`}
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Filter strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <form className="card p-3 mb-4 flex flex-wrap gap-3 items-end text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from} min={bounds?.min} max={bounds?.max}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={to} min={from || bounds?.min} max={bounds?.max} className="input" />
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
      </form>

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ KPI summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Total spend" value={fmtRupees(totalSpend)} />
        <Kpi label="Yarn sized" value={`${fmtNum(totalKg, 1)} kg`} />
        <Kpi label="Jobs" value={fmtNum(totalJobs)} />
        <Kpi
          label="Blended â‚¹/kg"
          value={blendedRate != null ? fmtRupees(blendedRate, 2) : 'â€”'}
        />
      </div>

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Monthly table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <SectionHeader icon={<Calendar className="w-4 h-4" />} title="Spend by month" />
      {monthRes.error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load monthly data: {monthRes.error.message}
        </div>
      )}
      {months.length === 0 ? (
        <EmptyCard text="No sizing jobs billed in this window yet." />
      ) : (
        <>
        <CardFilter placeholder="Search monthsâ€¦">
          {months.map((m, i) => {
            const prev = months[i + 1];
            const trend = trendBetween(m.effective_rate_per_kg, prev?.effective_rate_per_kg ?? null);
            return (
              <div key={m.period_start ?? i} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink break-words">{fmtMonth(m.period_start)}</div>
                  <div className="text-right shrink-0">
                    <span className="num font-semibold text-base">{fmtRupees(m.total_spend)}</span>
                    <div className="mt-0.5"><TrendBadge trend={trend} /></div>
                  </div>
                </div>
                <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>Jobs: <span className="num">{fmtNum(m.jobs_count)}</span></div>
                  <div>Yarn kg: <span className="num">{fmtNum(m.total_yarn_kg, 1)}</span></div>
                  <div>Effective â‚¹/kg: <span className="num">{m.effective_rate_per_kg != null ? fmtRupees(m.effective_rate_per_kg, 2) : 'â€”'}</span></div>
                </div>
              </div>
            );
          })}
        </CardFilter>
        <div className="card p-0 overflow-x-auto mb-8 hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Month</th>
                <th className="text-right px-3 py-2">Jobs</th>
                <th className="text-right px-3 py-2">Yarn kg</th>
                <th className="text-right px-3 py-2">Total â‚¹</th>
                <th className="text-right px-3 py-2">Effective â‚¹/kg</th>
                <th className="text-right px-3 py-2">Trend</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const prev = months[i + 1];
                const trend = trendBetween(
                  m.effective_rate_per_kg,
                  prev?.effective_rate_per_kg ?? null
                );
                return (
                  <tr
                    key={m.period_start ?? i}
                    className="border-t border-line/40"
                  >
                    <td className="px-3 py-2 font-medium">
                      {fmtMonth(m.period_start)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(m.jobs_count)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(m.total_yarn_kg, 1)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {fmtRupees(m.total_spend)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {m.effective_rate_per_kg != null
                        ? fmtRupees(m.effective_rate_per_kg, 2)
                        : 'â€”'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TrendBadge trend={trend} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Vendor table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <SectionHeader
        icon={<Users className="w-4 h-4" />}
        title="Spend by vendor (all time)"
        subtitle="Ranked by total spend. The cheapest â‚¹/kg vendor is highlighted."
      />
      {vendorRes.error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load vendor data: {vendorRes.error.message}
        </div>
      )}
      {vendors.length === 0 ? (
        <EmptyCard text="No vendor spend yet." />
      ) : (
        <>
        <CardFilter placeholder="Search vendorsâ€¦">
          {vendors.map((v, i) => {
            const isCheapest = v.effective_rate_per_kg != null && v.effective_rate_per_kg === cheapestRate(vendors);
            return (
              <div key={v.vendor_id ?? i} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-words">{v.vendor_name}</div>
                    <div className="font-mono text-xs text-ink-soft mt-0.5">{v.vendor_code}</div>
                  </div>
                  <div className="num font-semibold text-base shrink-0">{fmtRupees(v.total_spend)}</div>
                </div>
                <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>Jobs: <span className="num">{fmtNum(v.jobs_count)}</span></div>
                  <div>Yarn kg: <span className="num">{fmtNum(v.total_yarn_kg, 1)}</span></div>
                  <div className="col-span-2">
                    Effective â‚¹/kg:{' '}
                    <span className={isCheapest ? 'inline-flex items-center gap-1 text-emerald-700 font-semibold num' : 'num'}>
                      {isCheapest && <CheckCircle2 className="w-3 h-3" />}
                      {v.effective_rate_per_kg != null ? fmtRupees(v.effective_rate_per_kg, 2) : 'â€”'}
                    </span>
                  </div>
                  <div className="col-span-2">Window: {v.first_job_date ?? 'â€”'} â†’ {v.last_job_date ?? 'â€”'}</div>
                </div>
              </div>
            );
          })}
        </CardFilter>
        <div className="card p-0 overflow-x-auto mb-8 hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Vendor</th>
                <th className="text-right px-3 py-2">Jobs</th>
                <th className="text-right px-3 py-2">Yarn kg</th>
                <th className="text-right px-3 py-2">Total â‚¹</th>
                <th className="text-right px-3 py-2">Effective â‚¹/kg</th>
                <th className="text-left px-3 py-2">Window</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v, i) => {
                const isCheapest =
                  v.effective_rate_per_kg != null &&
                  v.effective_rate_per_kg === cheapestRate(vendors);
                return (
                  <tr
                    key={v.vendor_id ?? i}
                    className="border-t border-line/40"
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-ink-mute">
                        {v.vendor_code}
                      </span>
                      <span className="ml-2 font-medium">{v.vendor_name}</span>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(v.jobs_count)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(v.total_yarn_kg, 1)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {fmtRupees(v.total_spend)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      <span
                        className={
                          isCheapest
                            ? 'inline-flex items-center gap-1 text-emerald-700 font-semibold'
                            : ''
                        }
                      >
                        {isCheapest && <CheckCircle2 className="w-3 h-3" />}
                        {v.effective_rate_per_kg != null
                          ? fmtRupees(v.effective_rate_per_kg, 2)
                          : 'â€”'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {v.first_job_date ?? 'â€”'} â†’ {v.last_job_date ?? 'â€”'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Variance table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <SectionHeader
        icon={<GitCompare className="w-4 h-4" />}
        title="Planned vs actual â€” batch variance"
        subtitle="Top 50 batches with the largest sizing-cost drift from the costing snapshot."
      />
      {varianceRes.error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load variance data: {varianceRes.error.message}
        </div>
      )}
      {variances.length === 0 ? (
        <EmptyCard text="No batches with a measurable sizing variance yet. (Variance appears once a batch is linked to a pavu_assign and the sizing job has billing.)" />
      ) : (
        <>
        <CardFilter placeholder="Search batchesâ€¦">
          {variances.map((v) => {
            const per = v.variance_per_m;
            const overrun = per != null && Number(per) > 0.01;
            const saving = per != null && Number(per) < -0.01;
            return (
              <div key={v.batch_id ?? v.batch_code} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-ink break-words">{v.batch_code}</div>
                    <div className="font-mono text-xs text-ink-soft mt-0.5">{v.sizing_job_code ?? 'â€”'}</div>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    {overrun ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><AlertTriangle className="w-3 h-3" />+{fmtRupees(per, 2)}</span>
                    ) : saving ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3 h-3" />{fmtRupees(per, 2)}</span>
                    ) : (
                      <span className="text-ink-soft">on plan</span>
                    )}
                    <div className="num mt-0.5">{v.variance_total != null ? fmtRupees(v.variance_total, 0) : 'â€”'}</div>
                  </div>
                </div>
                <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>Produced m: <span className="num">{fmtNum(v.produced_m)}</span></div>
                  <div>Planned â‚¹/m: <span className="num">{v.planned_sizing_cost_per_m != null ? fmtRupees(v.planned_sizing_cost_per_m, 2) : 'â€”'}</span></div>
                  <div>Actual â‚¹/m: <span className="num">{v.actual_sizing_cost_per_m != null ? fmtRupees(v.actual_sizing_cost_per_m, 2) : 'â€”'}</span></div>
                </div>
              </div>
            );
          })}
        </CardFilter>
        <div className="card p-0 overflow-x-auto mb-8 hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Batch</th>
                <th className="text-left px-3 py-2">Sizing job</th>
                <th className="text-right px-3 py-2">Produced m</th>
                <th className="text-right px-3 py-2">Planned â‚¹/m</th>
                <th className="text-right px-3 py-2">Actual â‚¹/m</th>
                <th className="text-right px-3 py-2">Variance /m</th>
                <th className="text-right px-3 py-2">Variance total â‚¹</th>
              </tr>
            </thead>
            <tbody>
              {variances.map((v) => {
                const per = v.variance_per_m;
                const overrun = per != null && Number(per) > 0.01;
                const saving = per != null && Number(per) < -0.01;
                return (
                  <tr
                    key={v.batch_id ?? v.batch_code}
                    className="border-t border-line/40"
                  >
                    <td className="px-3 py-2 font-mono font-semibold">
                      {v.batch_code}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-soft">
                      {v.sizing_job_code ?? 'â€”'}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(v.produced_m)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {v.planned_sizing_cost_per_m != null
                        ? fmtRupees(v.planned_sizing_cost_per_m, 2)
                        : 'â€”'}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {v.actual_sizing_cost_per_m != null
                        ? fmtRupees(v.actual_sizing_cost_per_m, 2)
                        : 'â€”'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {overrun ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                          <AlertTriangle className="w-3 h-3" />+
                          {fmtRupees(per, 2)}
                        </span>
                      ) : saving ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          {fmtRupees(per, 2)}
                        </span>
                      ) : (
                        <span className="text-ink-soft">on plan</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num text-xs">
                      {v.variance_total != null
                        ? fmtRupees(v.variance_total, 0)
                        : 'â€”'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ small presentational helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface KpiProps {
  label: string;
  value: string;
}

function Kpi({ label, value }: KpiProps) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
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

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="card p-6 text-center text-sm text-ink-mute mb-8">
      {text}
    </div>
  );
}

type Trend = 'up' | 'down' | 'flat' | 'unknown';

function trendBetween(
  current: number | null | undefined,
  prev: number | null | undefined
): Trend {
  if (current == null || prev == null) return 'unknown';
  const delta = Number(current) - Number(prev);
  if (Math.abs(delta) < 0.005) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

function TrendBadge({ trend }: { trend: Trend }) {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 text-xs">
        <TrendingUp className="w-3 h-3" /> costlier
      </span>
    );
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
        <TrendingDown className="w-3 h-3" /> cheaper
      </span>
    );
  }
  if (trend === 'flat') {
    return (
      <span className="inline-flex items-center gap-1 text-ink-soft text-xs">
        <Minus className="w-3 h-3" /> steady
      </span>
    );
  }
  return <span className="text-ink-mute text-xs">â€”</span>;
}

function cheapestRate(rows: VendorRow[]): number | null {
  let min: number | null = null;
  for (const r of rows) {
    if (r.effective_rate_per_kg == null) continue;
    const v = Number(r.effective_rate_per_kg);
    if (min === null || v < min) min = v;
  }
  return min;
}
