/**
 * Loom Efficiency & Cost
 *
 * Tracks actual loom performance against the target set on
 * Settings -> Loom Rate Target, week by week, month by month, or year by
 * year (Indian financial year), with an optional shed filter.
 *
 * Two independent numbers per bucket:
 *
 *   Efficiency %  — actual metres woven vs. the metres one loom-shift
 *                   *could* weave running flat-out (100% of loom speed),
 *                   using each shift log's own fabric quality density
 *                   (picks/inch). This is the same "how fast did we
 *                   really run" number the owner's spreadsheet computes
 *                   by hand.
 *   Cost / metre  — real wages + real factory expenses for the period,
 *                   divided by real metres woven, vs. the flat
 *                   target_cost_per_m benchmark.
 *
 * Cost allocation to shed (wages have no shed column of their own):
 *   - Wages: split across each employee's attendance shed(s) for that
 *     bucket, weighted by day_weight. Employees with no attendance shed
 *     data in the bucket (salaried/indirect staff not required to mark
 *     attendance) fall back to employee.default_sheds, then
 *     employee.home_shed_no.
 *   - Factory expenses (expense_entry has no shed column at all): split
 *     across sheds by each shed's share of that bucket's actual metres
 *     woven — a volume proxy. If nothing was woven in a bucket, the
 *     expense is split evenly across all four sheds instead.
 *
 * Data source conventions mirror the rest of the ERP:
 *   - production_shift_log / production_shift_log_weaver for real output
 *     (same tables as Reports -> Total Production).
 *   - wage_entry / expense_entry filtered on `pay_date BETWEEN`, the same
 *     convention fn_period_pnl_split uses for the P&L report.
 *   - attendance_entry joined to attendance_day for dating, the same
 *     pattern Reports -> Shed Running uses.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { formatRupee } from '@/lib/utils';
import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { EfficiencyCharts, type TrendPoint, type ShedPoint } from './efficiency-charts';

export const metadata = { title: 'Loom Efficiency & Cost' };
export const dynamic = 'force-dynamic';

type PeriodKind = 'week' | 'month' | 'year';

interface PageProps {
  searchParams: Promise<{ period?: string; shed?: string }>;
}

// ──────────────────────────────────────────────────────────────────────────
// Date helpers — local, no UTC conversion. Same conventions as
// reports/production/page.tsx.
// ──────────────────────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, '0'); }

function localISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function todayISO(): string { return localISO(new Date()); }

function addDaysISO(iso: string, days: number): string {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + days);
  return localISO(dt);
}

function mondayISO(iso: string): string {
  const dt = parseISO(iso);
  const dow = dt.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + offset);
  return localISO(dt);
}

function monthStartISO(iso: string): string {
  const dt = parseISO(iso);
  return localISO(new Date(dt.getFullYear(), dt.getMonth(), 1));
}

/** Indian FY: 1 Apr YYYY -> 31 Mar YYYY+1. */
function fyStartISO(iso: string): string {
  const dt = parseISO(iso);
  const y = dt.getMonth() < 3 ? dt.getFullYear() - 1 : dt.getFullYear();
  return `${y}-04-01`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function prettyDate(iso: string): string {
  const [yStr, mStr, dStr] = iso.split('-');
  return `${Number(dStr)} ${MONTHS[Number(mStr) - 1] ?? ''} ${yStr}`;
}

function prettyRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-');
  const [ey, em, ed] = end.split('-');
  if (sy === ey && sm === em) return `${Number(sd)} - ${Number(ed)} ${MONTHS[Number(sm) - 1] ?? ''} ${sy}`;
  if (sy === ey) return `${Number(sd)} ${MONTHS[Number(sm) - 1] ?? ''} - ${Number(ed)} ${MONTHS[Number(em) - 1] ?? ''} ${sy}`;
  return `${prettyDate(start)} - ${prettyDate(end)}`;
}

function fmtNum(n: number, decimals = 1): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtInt(n: number): string { return n.toLocaleString('en-IN'); }

function fmtPct(n: number | null, decimals = 1): string {
  return n == null ? '—' : `${fmtNum(n, decimals)}%`;
}

function fmtCost(n: number | null): string {
  return n == null ? '—' : formatRupee(n, { decimals: 2 });
}

// ──────────────────────────────────────────────────────────────────────────
// Bucket construction — fixed lookback windows, most recent (partial) one
// included so today's numbers show up immediately.
// ──────────────────────────────────────────────────────────────────────────

const WEEK_BUCKETS = 12;
const MONTH_BUCKETS = 12;
const YEAR_BUCKETS = 5;

interface Bucket { key: string; label: string; start: string; end: string }

function buildBuckets(kind: PeriodKind, todayIso: string): Bucket[] {
  const buckets: Bucket[] = [];
  if (kind === 'week') {
    const thisMonday = mondayISO(todayIso);
    for (let i = WEEK_BUCKETS - 1; i >= 0; i--) {
      const start = addDaysISO(thisMonday, -7 * i);
      const rawEnd = addDaysISO(start, 6);
      const end = rawEnd > todayIso ? todayIso : rawEnd;
      buckets.push({ key: start, label: prettyRange(start, rawEnd), start, end });
    }
  } else if (kind === 'month') {
    const thisMonthStart = monthStartISO(todayIso);
    for (let i = MONTH_BUCKETS - 1; i >= 0; i--) {
      const dt = parseISO(thisMonthStart);
      dt.setMonth(dt.getMonth() - i);
      const start = localISO(dt);
      const rawEndDt = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
      const rawEnd = localISO(rawEndDt);
      const end = rawEnd > todayIso ? todayIso : rawEnd;
      const [y, m] = start.split('-');
      buckets.push({ key: start, label: `${MONTHS[Number(m) - 1] ?? ''} ${y}`, start, end });
    }
  } else {
    const thisFyStart = fyStartISO(todayIso);
    const thisFyStartYear = Number(thisFyStart.split('-')[0]);
    for (let i = YEAR_BUCKETS - 1; i >= 0; i--) {
      const startYear = thisFyStartYear - i;
      const start = `${startYear}-04-01`;
      const rawEnd = `${startYear + 1}-03-31`;
      const end = rawEnd > todayIso ? todayIso : rawEnd;
      buckets.push({ key: start, label: `FY ${startYear}-${String(startYear + 1).slice(-2)}`, start, end });
    }
  }
  return buckets;
}

function bucketKeyForDate(kind: PeriodKind, dateIso: string): string {
  if (kind === 'week') return mondayISO(dateIso);
  if (kind === 'month') return monthStartISO(dateIso);
  return fyStartISO(dateIso);
}

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

const SHEDS = [1, 2, 3, 4] as const;

interface LoomMeta { id: number; shed_no: number | null; fabric_quality_id: number | null }
interface QualityMeta { id: number; pick_per_inch: number | string | null }
interface ShiftLogRow { id: number; loom_id: number; log_date: string }
interface WeaverRow { shift_log_id: number; metres_woven: number | string | null }
interface EmployeeMeta { id: number; home_shed_no: string | null; default_sheds: string[] | null }
interface WageRow { employee_id: number; pay_date: string; amount: number | string | null }
interface ExpenseRow { pay_date: string; amount: number | string | null }
interface AttendanceRow {
  employee_id: number;
  shed_no: string | null;
  shed_nos: string[] | null;
  day_weight: number | string | null;
  attendance_day: { attendance_date: string } | { attendance_date: string }[] | null;
}

interface RateTarget {
  picks_per_min: number;
  shift_hours: number;
  efficiency_pct: number; // 0-1
  target_cost_per_m: number;
  inches_per_metre: number;
}

interface ShedBucketStat {
  metres: number;
  theoreticalMetres: number; // at target efficiency
  maxMetres100: number;      // at 100% loom speed
  shiftLogs: number;
  wageCost: number;
  expenseCost: number;
}

function emptyStat(): ShedBucketStat {
  return { metres: 0, theoreticalMetres: 0, maxMetres100: 0, shiftLogs: 0, wageCost: 0, expenseCost: 0 };
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default async function LoomEfficiencyReportPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kind: PeriodKind = (['week', 'month', 'year'] as const).includes(sp.period as PeriodKind)
    ? (sp.period as PeriodKind)
    : 'week';
  const shedFilter = sp.shed && /^[1-4]$/.test(sp.shed) ? Number(sp.shed) : null;
  const activeSheds: number[] = shedFilter !== null ? [shedFilter] : [...SHEDS];

  const today = todayISO();
  const buckets = buildBuckets(kind, today);
  const firstBucket = buckets[0]!;
  const lastBucket = buckets[buckets.length - 1]!;
  const rangeStart = firstBucket.start;
  const rangeEnd = today;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [loomRes, qualityRes, configRes, employeeRes] = await Promise.all([
    sb.from('loom').select('id, shed_no, fabric_quality_id'),
    sb.from('fabric_quality').select('id, pick_per_inch'),
    sb.from('system_config').select('value').eq('key', 'loom_rate_target').maybeSingle(),
    sb.from('employee').select('id, home_shed_no, default_sheds'),
  ]);

  const looms = (loomRes.data ?? []) as LoomMeta[];
  const qualities = (qualityRes.data ?? []) as QualityMeta[];
  const employees = (employeeRes.data ?? []) as EmployeeMeta[];

  const loomById = new Map<number, LoomMeta>();
  for (const l of looms) loomById.set(l.id, l);
  const qualityById = new Map<number, QualityMeta>();
  for (const q of qualities) qualityById.set(q.id, q);
  const employeeById = new Map<number, EmployeeMeta>();
  for (const e of employees) employeeById.set(e.id, e);

  const configValue = (configRes.data as { value: Record<string, unknown> } | null)?.value ?? null;
  const target: RateTarget | null = configValue && Number(configValue.picks_per_min) > 0 ? {
    picks_per_min: Number(configValue.picks_per_min ?? 0),
    shift_hours: Number(configValue.shift_hours ?? 0),
    efficiency_pct: Number(configValue.efficiency_pct ?? 0),
    target_cost_per_m: Number(configValue.target_cost_per_m ?? 0),
    inches_per_metre: Number(configValue.inches_per_metre ?? 39.37),
  } : null;
  const hasTarget = target != null && target.picks_per_min > 0 && target.shift_hours > 0 && target.efficiency_pct > 0;

  const allLoomIds = looms.map((l) => l.id);

  // ───── Production: all sheds always fetched (needed for expense-share
  // allocation even when a shed filter narrows the display) ─────
  let shiftLogs: ShiftLogRow[] = [];
  if (allLoomIds.length > 0) {
    const logsRes = await sb
      .from('production_shift_log')
      .select('id, loom_id, log_date')
      .gte('log_date', rangeStart)
      .lte('log_date', rangeEnd)
      .in('loom_id', allLoomIds);
    shiftLogs = (logsRes.data ?? []) as ShiftLogRow[];
  }

  let weaverRows: WeaverRow[] = [];
  if (shiftLogs.length > 0) {
    const shiftLogIds = shiftLogs.map((s) => s.id);
    const wRes = await sb
      .from('production_shift_log_weaver')
      .select('shift_log_id, metres_woven')
      .in('shift_log_id', shiftLogIds);
    weaverRows = (wRes.data ?? []) as WeaverRow[];
  }

  // ───── Wages, factory expenses, attendance (for shed allocation) ─────
  const [wageRes, expenseRes, attendanceRes] = await Promise.all([
    sb.from('wage_entry').select('employee_id, pay_date, amount').gte('pay_date', rangeStart).lte('pay_date', rangeEnd),
    sb.from('expense_entry').select('pay_date, amount').gte('pay_date', rangeStart).lte('pay_date', rangeEnd),
    sb.from('attendance_entry')
      .select('employee_id, shed_no, shed_nos, day_weight, attendance_day:attendance_day_id!inner ( attendance_date )')
      .gte('attendance_day.attendance_date', rangeStart)
      .lte('attendance_day.attendance_date', rangeEnd),
  ]);
  const wageRows = (wageRes.data ?? []) as WageRow[];
  const expenseRows = (expenseRes.data ?? []) as ExpenseRow[];
  const attendanceRows = ((attendanceRes.data ?? []) as AttendanceRow[])
    .filter((r) => r.attendance_day != null);

  // ───── Aggregate actual + theoretical production per bucket+shed ─────
  const metresByShiftLog = new Map<number, number>();
  for (const w of weaverRows) {
    const m = Number(w.metres_woven ?? 0);
    if (!Number.isFinite(m) || m <= 0) continue;
    metresByShiftLog.set(w.shift_log_id, (metresByShiftLog.get(w.shift_log_id) ?? 0) + m);
  }

  const stats = new Map<string, ShedBucketStat>(); // `${bucketKey}|${shed}`
  function statFor(bKey: string, shed: number): ShedBucketStat {
    const k = `${bKey}|${shed}`;
    let s = stats.get(k);
    if (!s) { s = emptyStat(); stats.set(k, s); }
    return s;
  }

  for (const log of shiftLogs) {
    const loom = loomById.get(log.loom_id);
    if (!loom || loom.shed_no == null) continue;
    if (log.log_date < rangeStart || log.log_date > rangeEnd) continue;
    const bKey = bucketKeyForDate(kind, log.log_date);
    const stat = statFor(bKey, loom.shed_no);
    stat.metres += metresByShiftLog.get(log.id) ?? 0;
    stat.shiftLogs += 1;

    if (hasTarget && target && loom.fabric_quality_id != null) {
      const quality = qualityById.get(loom.fabric_quality_id);
      const pickPerInch = quality?.pick_per_inch != null ? Number(quality.pick_per_inch) : null;
      if (pickPerInch && pickPerInch > 0) {
        const max100 = (target.picks_per_min * 60 * target.shift_hours) / target.inches_per_metre / pickPerInch;
        stat.maxMetres100 += max100;
        stat.theoreticalMetres += max100 * target.efficiency_pct;
      }
    }
  }

  // ───── Attendance -> employee shed weight per bucket ─────
  // key = `${employee_id}|${bucketKey}` -> Map<shedNo, weight>
  const attnWeight = new Map<string, Map<number, number>>();
  for (const a of attendanceRows) {
    const dayField = Array.isArray(a.attendance_day) ? a.attendance_day[0] : a.attendance_day;
    const date = dayField?.attendance_date;
    if (!date) continue;
    const bKey = bucketKeyForDate(kind, date);
    const dw = Number(a.day_weight ?? 1);
    if (!Number.isFinite(dw) || dw <= 0) continue;

    let sheds: number[] = [];
    if (a.shed_nos && a.shed_nos.length > 0) {
      sheds = a.shed_nos.map(Number).filter((n) => Number.isFinite(n));
    } else if (a.shed_no) {
      const n = Number(a.shed_no);
      if (Number.isFinite(n)) sheds = [n];
    }
    if (sheds.length === 0) continue;

    const perShed = dw / sheds.length;
    const mapKey = `${a.employee_id}|${bKey}`;
    let m = attnWeight.get(mapKey);
    if (!m) { m = new Map(); attnWeight.set(mapKey, m); }
    for (const s of sheds) m.set(s, (m.get(s) ?? 0) + perShed);
  }

  // ───── Wage allocation: attendance shed share, falling back to
  // default_sheds / home_shed_no when an employee has no attendance shed
  // data in the bucket (salaried/indirect staff). ─────
  for (const w of wageRows) {
    const amount = Number(w.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const bKey = bucketKeyForDate(kind, w.pay_date);
    const shedMap = attnWeight.get(`${w.employee_id}|${bKey}`);

    let shares: Array<[number, number]> = [];
    if (shedMap && shedMap.size > 0) {
      const total = Array.from(shedMap.values()).reduce((s, v) => s + v, 0);
      if (total > 0) shares = Array.from(shedMap.entries()).map(([s, v]) => [s, v / total]);
    }
    if (shares.length === 0) {
      const emp = employeeById.get(w.employee_id);
      const fallback: number[] = [];
      if (emp?.default_sheds && emp.default_sheds.length > 0) {
        for (const s of emp.default_sheds) { const n = Number(s); if (Number.isFinite(n)) fallback.push(n); }
      } else if (emp?.home_shed_no) {
        const n = Number(emp.home_shed_no);
        if (Number.isFinite(n)) fallback.push(n);
      }
      if (fallback.length > 0) shares = fallback.map((s) => [s, 1 / fallback.length]);
    }
    for (const [shed, frac] of shares) {
      statFor(bKey, shed).wageCost += amount * frac;
    }
  }

  // ───── Factory expense allocation: each shed's share of that bucket's
  // actual metres; even split across all 4 sheds if nothing was woven. ─────
  const bucketTotalMetres = new Map<string, number>();
  for (const [k, stat] of stats) {
    const bKey = k.split('|')[0] ?? '';
    bucketTotalMetres.set(bKey, (bucketTotalMetres.get(bKey) ?? 0) + stat.metres);
  }
  for (const e of expenseRows) {
    const amount = Number(e.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const bKey = bucketKeyForDate(kind, e.pay_date);
    const total = bucketTotalMetres.get(bKey) ?? 0;
    if (total > 0) {
      for (const s of SHEDS) {
        const shedMetres = stats.get(`${bKey}|${s}`)?.metres ?? 0;
        if (shedMetres <= 0) continue;
        statFor(bKey, s).expenseCost += amount * (shedMetres / total);
      }
    } else {
      for (const s of SHEDS) statFor(bKey, s).expenseCost += amount / SHEDS.length;
    }
  }

  // ───── Roll up per bucket across the active shed(s) ─────
  function rollup(bKey: string, sheds: number[]): ShedBucketStat {
    const out = emptyStat();
    for (const s of sheds) {
      const stat = stats.get(`${bKey}|${s}`);
      if (!stat) continue;
      out.metres += stat.metres;
      out.theoreticalMetres += stat.theoreticalMetres;
      out.maxMetres100 += stat.maxMetres100;
      out.shiftLogs += stat.shiftLogs;
      out.wageCost += stat.wageCost;
      out.expenseCost += stat.expenseCost;
    }
    return out;
  }

  const trend: TrendPoint[] = buckets.map((b) => {
    const r = rollup(b.key, activeSheds);
    const actualEfficiencyPct = r.maxMetres100 > 0 ? (r.metres / r.maxMetres100) * 100 : null;
    const actualCostPerM = r.metres > 0 ? (r.wageCost + r.expenseCost) / r.metres : null;
    return {
      key: b.key,
      label: b.label,
      metres: r.metres,
      actualCostPerM,
      targetCostPerM: hasTarget && target ? target.target_cost_per_m : null,
      actualEfficiencyPct,
      targetEfficiencyPct: hasTarget && target ? target.efficiency_pct * 100 : null,
    };
  });

  const overall = buckets.reduce((acc, b) => {
    const r = rollup(b.key, activeSheds);
    acc.metres += r.metres;
    acc.theoreticalMetres += r.theoreticalMetres;
    acc.maxMetres100 += r.maxMetres100;
    acc.shiftLogs += r.shiftLogs;
    acc.wageCost += r.wageCost;
    acc.expenseCost += r.expenseCost;
    return acc;
  }, emptyStat());

  const overallEfficiencyPct = overall.maxMetres100 > 0 ? (overall.metres / overall.maxMetres100) * 100 : null;
  const overallVsTargetPct = overall.theoreticalMetres > 0 ? (overall.metres / overall.theoreticalMetres) * 100 : null;
  const overallCostPerM = overall.metres > 0 ? (overall.wageCost + overall.expenseCost) / overall.metres : null;
  const targetCostPerM = hasTarget && target ? target.target_cost_per_m : null;

  const shedTotalsAll: ShedPoint[] = SHEDS.map((s) => {
    const r = buckets.reduce((acc, b) => {
      const stat = stats.get(`${b.key}|${s}`);
      if (stat) { acc.metres += stat.metres; acc.maxMetres100 += stat.maxMetres100; }
      return acc;
    }, { metres: 0, maxMetres100: 0 });
    return {
      name: `Shed ${s}`,
      metres: r.metres,
      actualEfficiencyPct: r.maxMetres100 > 0 ? (r.metres / r.maxMetres100) * 100 : null,
    };
  });

  const byShedRows = activeSheds.map((s) => {
    const r = buckets.reduce((acc, b) => {
      const stat = stats.get(`${b.key}|${s}`);
      if (stat) {
        acc.metres += stat.metres;
        acc.maxMetres100 += stat.maxMetres100;
        acc.theoreticalMetres += stat.theoreticalMetres;
        acc.wageCost += stat.wageCost;
        acc.expenseCost += stat.expenseCost;
        acc.shiftLogs += stat.shiftLogs;
      }
      return acc;
    }, emptyStat());
    return {
      shed: s,
      metres: r.metres,
      shiftLogs: r.shiftLogs,
      efficiencyPct: r.maxMetres100 > 0 ? (r.metres / r.maxMetres100) * 100 : null,
      vsTargetPct: r.theoreticalMetres > 0 ? (r.metres / r.theoreticalMetres) * 100 : null,
      costPerM: r.metres > 0 ? (r.wageCost + r.expenseCost) / r.metres : null,
    };
  });

  const hasData = overall.metres > 0 || overall.wageCost > 0 || overall.expenseCost > 0;

  function buildHref(overrides: Partial<{ period: PeriodKind; shed: string }>): string {
    const params = new URLSearchParams();
    params.set('period', overrides.period ?? kind);
    const sh = overrides.shed !== undefined ? overrides.shed : (shedFilter !== null ? String(shedFilter) : '');
    if (sh) params.set('shed', sh);
    return `/app/reports/loom-efficiency?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Loom Efficiency & Cost"
        subtitle={`${firstBucket.label} \u2192 ${lastBucket.label}`}
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Loom Efficiency & Cost' }]}
        actions={
          <Link
            href="/app/settings/loom-rate-target"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
          >
            <Settings2 className="w-3.5 h-3.5" /> Edit target
          </Link>
        }
      />

      {!hasTarget && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 mb-4">
          No loom rate target is set yet, so this report can only show actuals — no target lines or
          efficiency %. <Link href="/app/settings/loom-rate-target" className="underline font-semibold">Set the target</Link> to unlock the comparison.
        </div>
      )}

      {/* ───── Filter bar ───── */}
      <div className="card p-3 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-mute mr-1">Period:</span>
          {(['week', 'month', 'year'] as const).map((k) => (
            <Link
              key={k}
              href={buildHref({ period: k })}
              className={
                'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ' +
                (kind === k ? 'border-indigo bg-indigo/10 text-indigo' : 'border-line bg-white text-ink-soft hover:bg-haze/60')
              }
            >
              {k === 'week' ? `Last ${WEEK_BUCKETS} weeks` : k === 'month' ? `Last ${MONTH_BUCKETS} months` : `Last ${YEAR_BUCKETS} years`}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-mute mr-1">Shed:</span>
          <Link
            href={buildHref({ shed: '' })}
            className={
              'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ' +
              (shedFilter === null ? 'border-indigo bg-indigo/10 text-indigo' : 'border-line bg-white text-ink-soft hover:bg-haze/60')
            }
          >
            All sheds
          </Link>
          {SHEDS.map((s) => (
            <Link
              key={s}
              href={buildHref({ shed: String(s) })}
              className={
                'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ' +
                (shedFilter === s ? 'border-indigo bg-indigo/10 text-indigo' : 'border-line bg-white text-ink-soft hover:bg-haze/60')
              }
            >
              Shed {s}
            </Link>
          ))}
        </div>
      </div>

      {/* ───── KPI cards ───── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Total metres" value={fmtNum(overall.metres)} suffix="m" highlight />
        <KpiCard label="Efficiency %" value={fmtPct(overallEfficiencyPct)} sub={hasTarget && target ? `target ${fmtPct(target.efficiency_pct * 100, 0)}` : undefined} />
        <KpiCard label="Cost / metre" value={fmtCost(overallCostPerM)} sub={targetCostPerM != null ? `target ${fmtCost(targetCostPerM)}` : undefined} />
        <KpiCard label="vs target output" value={fmtPct(overallVsTargetPct, 0)} sub="actual ÷ theoretical" />
      </div>

      {!hasData ? (
        <div className="card p-10 text-center text-ink-mute text-sm">
          No production, wages or expenses logged for this range yet.
        </div>
      ) : (
        <>
          <EfficiencyCharts trend={trend} shedTotals={shedFilter === null ? shedTotalsAll : []} hasTarget={hasTarget} />

          {/* ───── Trend breakdown table ───── */}
          <CardFilter placeholder="Search periods…">
            {trend.map((t) => (
              <div key={t.key} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink break-words">{t.label}</div>
                  <div className="text-right shrink-0">
                    <span className="num font-semibold text-base">{fmtNum(t.metres)}</span>
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">metres</div>
                  </div>
                </div>
                <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>Efficiency: <span className="num">{fmtPct(t.actualEfficiencyPct)}</span></div>
                  <div>Cost/m: <span className="num">{fmtCost(t.actualCostPerM)}</span></div>
                </div>
              </div>
            ))}
          </CardFilter>
          <div className="card overflow-x-auto mb-4 hidden md:block">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line/60 bg-cloud/40">
              <h2 className="font-display font-bold text-sm">
                {kind === 'week' ? 'Weekly' : kind === 'month' ? 'Monthly' : 'Yearly'} breakdown
              </h2>
              <span className="text-xs text-ink-mute">{trend.length} row{trend.length === 1 ? '' : 's'}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-4 py-2.5">{kind === 'week' ? 'Week' : kind === 'month' ? 'Month' : 'Year'}</th>
                  <th className="text-right px-4 py-2.5">Metres</th>
                  <th className="text-right px-4 py-2.5">Efficiency %</th>
                  <th className="text-right px-4 py-2.5">Target %</th>
                  <th className="text-right px-4 py-2.5">Cost / m</th>
                  <th className="text-right px-4 py-2.5">Target / m</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {trend.map((t) => (
                  <tr key={t.key} className="hover:bg-haze/40">
                    <td className="px-4 py-2 font-medium">{t.label}</td>
                    <td className="px-4 py-2 text-right num font-semibold">{fmtNum(t.metres)}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">{fmtPct(t.actualEfficiencyPct)}</td>
                    <td className="px-4 py-2 text-right num text-ink-mute">{fmtPct(t.targetEfficiencyPct, 0)}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">{fmtCost(t.actualCostPerM)}</td>
                    <td className="px-4 py-2 text-right num text-ink-mute">{fmtCost(t.targetCostPerM)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ───── By-shed summary (whole period) ───── */}
          <div className="md:hidden mb-4">
            <h2 className="font-display font-bold text-sm mb-2">By shed (whole period)</h2>
            <div className="space-y-2">
              {byShedRows.map((r) => (
                <div key={r.shed} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-ink">Shed {r.shed}</div>
                    <div className="num font-semibold text-base shrink-0">{fmtNum(r.metres)}</div>
                  </div>
                  <div className="text-xs text-ink-soft mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                    <div>Efficiency: <span className="num">{fmtPct(r.efficiencyPct)}</span></div>
                    <div>Cost/m: <span className="num">{fmtCost(r.costPerM)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card overflow-x-auto hidden md:block">
            <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
              <h2 className="font-display font-bold text-sm">By shed (whole period)</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-4 py-2.5">Shed</th>
                  <th className="text-right px-4 py-2.5">Shift logs</th>
                  <th className="text-right px-4 py-2.5">Metres</th>
                  <th className="text-right px-4 py-2.5">Efficiency %</th>
                  <th className="text-right px-4 py-2.5">vs Target output</th>
                  <th className="text-right px-4 py-2.5">Cost / m</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byShedRows.map((r) => (
                  <tr key={r.shed} className="hover:bg-haze/40">
                    <td className="px-4 py-2 font-medium">Shed {r.shed}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">{fmtInt(r.shiftLogs)}</td>
                    <td className="px-4 py-2 text-right num font-semibold">{fmtNum(r.metres)}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">{fmtPct(r.efficiencyPct)}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">{fmtPct(r.vsTargetPct, 0)}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">{fmtCost(r.costPerM)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Small UI bits
// ──────────────────────────────────────────────────────────────────────────

function KpiCard({ label, value, suffix, sub, highlight = false }: { label: string; value: string; suffix?: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={'card p-3 ' + (highlight ? 'bg-indigo/5 border-indigo/30' : '')}>
      <div className="text-[11px] uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={'num font-bold ' + (highlight ? 'text-xl text-indigo' : 'text-xl')}>
        {value}{suffix ? <span className="text-sm ml-1 text-ink-mute">{suffix}</span> : null}
      </div>
      {sub && <div className="text-[11px] text-ink-mute mt-0.5">{sub}</div>}
    </div>
  );
}
