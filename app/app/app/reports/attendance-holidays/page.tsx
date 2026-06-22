/**
 * Holidays / Non-working Days (CORR-A5)
 *
 * Lists every day (or shift) that was marked as non-working in a date
 * range — power cut, national holiday, maintenance, other. Defaults to the
 * current calendar month.
 *
 * Source: v_non_working_days.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { CalendarOff } from 'lucide-react';

export const metadata = { title: 'Holidays / Non-working Days' };
export const dynamic = 'force-dynamic';

interface HolidayRow {
  attendance_date: string | null;
  shift: string | null;
  reason: string | null;
  remark: string | null;
  marked_at: string | null;
  marked_by_name: string | null;
}

const REASON_LABEL: Record<string, string> = {
  power_cut: 'Power cut',
  national_holiday: 'National holiday',
  maintenance: 'Maintenance',
  other: 'Other',
};

const REASON_TONE: Record<string, string> = {
  power_cut: 'text-amber-700 bg-amber-50',
  national_holiday: 'text-sky-700 bg-sky-50',
  maintenance: 'text-violet-700 bg-violet-50',
  other: 'text-ink-soft bg-cloud/60',
};

function startOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default async function AttendanceHolidaysReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : startOfMonth();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_non_working_days')
    .select('*')
    .gte('attendance_date', from)
    .lte('attendance_date', to)
    .order('attendance_date', { ascending: false })
    .order('shift');

  const rows = (data as unknown as HolidayRow[]) ?? [];

  // Count distinct dates (a date with both shifts off should only count once).
  const distinctDates = new Set(rows.map(r => r.attendance_date ?? '')).size;
  const byReason: Record<string, number> = {};
  for (const r of rows) {
    const k = r.reason ?? 'other';
    byReason[k] = (byReason[k] ?? 0) + 1;
  }

  const exportColumns: ExcelColumn[] = [
    { key: 'attendance_date', label: 'Date', type: 'text' },
    { key: 'shift', label: 'Shift', type: 'text' },
    { key: 'reason', label: 'Reason', type: 'text' },
    { key: 'remark', label: 'Remark', type: 'text' },
    { key: 'marked_by_name', label: 'Marked by', type: 'text' },
    { key: 'marked_at', label: 'Marked at', type: 'text' },
  ];

  return (
    <div>
      <PageHeader
        title="Holidays / Non-working Days"
        subtitle="Days (or shifts) when the shed did not run — power cut, national holiday, maintenance, other."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Attendance — Holidays' },
        ]}
        actions={
          rows.length > 0 ? (
            <ExcelExportButton
              filename={`holidays-${from}-to-${to}`}
              sheetName="Holidays"
              title={`Non-working Days — ${from} to ${to}`}
              columns={exportColumns}
              rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
            />
          ) : undefined
        }
      />

      <form method="GET" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            max={today()}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            max={today()}
            className="input"
          />
        </div>
        <button type="submit" className="btn-primary min-h-[44px]">
          Show
        </button>
        <span className="text-xs text-ink-mute ml-1">
          {fmtDate(from)} → {fmtDate(to)}
        </span>
      </form>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load report: {error.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiCard label="Days affected" value={distinctDates} />
        <KpiCard label="Shifts off" value={rows.length} />
        <KpiCard label="Power cut" value={byReason.power_cut ?? 0} tone="text-amber-700" />
        <KpiCard
          label="National holiday"
          value={byReason.national_holiday ?? 0}
          tone="text-sky-700"
        />
        <KpiCard
          label="Maintenance"
          value={byReason.maintenance ?? 0}
          tone="text-violet-700"
        />
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <CalendarOff className="w-4 h-4 text-ink-mute" />
        <h2 className="text-base font-semibold">Non-working entries</h2>
        <span className="text-xs text-ink-mute ml-1">{rows.length} total</span>
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No non-working days in this range. Every day in the range had at least one
          shift marked as working.
        </div>
      ) : (
        <>
        <CardFilter placeholder="Search non-working days…">
          {rows.map((r, i) => {
            const key = r.reason ?? 'other';
            return (
              <div key={`${r.attendance_date}-${r.shift}-${i}`} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink break-words">
                    {r.attendance_date ? fmtDate(r.attendance_date) : '—'}
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${REASON_TONE[key] ?? 'bg-cloud/60 text-ink-soft'}`}
                  >
                    {REASON_LABEL[key] ?? key}
                  </span>
                </div>
                <div className="text-xs text-ink-soft mt-2 space-y-1">
                  <div>Shift: <span className="capitalize text-ink">{r.shift ?? '—'}</span></div>
                  {r.remark && <div>Remark: <span className="text-ink">{r.remark}</span></div>}
                  <div>Marked by: <span className="text-ink">{r.marked_by_name ?? '—'}</span></div>
                </div>
              </div>
            );
          })}
        </CardFilter>
        <div className="card p-0 overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Shift</th>
                <th className="text-left px-3 py-2">Reason</th>
                <th className="text-left px-3 py-2">Remark</th>
                <th className="text-left px-3 py-2">Marked by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const key = r.reason ?? 'other';
                return (
                  <tr
                    key={`${r.attendance_date}-${r.shift}-${i}`}
                    className="border-t border-line/40 hover:bg-cloud/20"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {r.attendance_date ? fmtDate(r.attendance_date) : '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 capitalize text-xs">{r.shift ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${REASON_TONE[key] ?? 'bg-cloud/60 text-ink-soft'}`}
                      >
                        {REASON_LABEL[key] ?? key}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {r.remark ?? ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {r.marked_by_name ?? '—'}
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

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${tone ?? 'text-ink'}`}>{value}</div>
    </div>
  );
}
