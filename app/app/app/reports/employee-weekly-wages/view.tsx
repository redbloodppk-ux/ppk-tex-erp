/**
 * Employee Weekly Wages
 *
 * Week-by-week wage history of each employee (Monday-start wage weeks),
 * built by fn_employee_weekly_wages:
 *
 *   Earned      = weavers: shift-log real metres x the frozen rate;
 *                 salaried staff: their weekly salary from the master
 *   Wage paid   = same-day + advance + settlement + adjustment (gross)
 *   Loan held   = part of the wage paid kept back for loan repayment
 *   Cash given  = wage paid - loan held
 *   Extra work  = shown separately, not part of the wage
 *   Balance     = earned - wage paid (weavers only)
 *
 * Totals per employee plus average per paid week and per month (x 4.33).
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import { MonthQuickPick } from '@/app/components/month-quick-pick';
import type { ExcelColumn } from '@/lib/xlsx';
import { todayIST } from '@/lib/utils';
import { PrintActions } from './print/print-actions';

export interface WeeklyWagesParams { from?: string; to?: string; emp?: string; role?: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROLES = ['weaver', 'winder', 'fitter', 'folder'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WEEKS_PER_MONTH = 4.33;

function pad(n: number): string { return String(n).padStart(2, '0'); }
function localISO(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1); }
function addDays(s: string, n: number): string { const d = parseISO(s); d.setDate(d.getDate() + n); return localISO(d); }
function monday(s: string): string { const d = parseISO(s); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return localISO(d); }
function pretty(s: string): string { const [y, m, d] = s.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''} ${y}`; }
function short(s: string): string { const [, m, d] = s.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`; }
function rupee(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function r0(n: number): string { return n === 0 ? '—' : rupee(n); }

interface Row {
  employee_id: number; full_name: string; emp_code: string | null; role: string | null;
  basis: string | null; status: string | null; week_start: string;
  earned: number | string | null; metres: number | string | null;
  same_day: number | string; advance: number | string; settlement: number | string;
  adjustment: number | string; loan_deducted: number | string; extra_work: number | string;
  entries: number | string;
}

interface Week {
  wk: string; earned: number | null; metres: number | null;
  sameDay: number; advance: number; settlement: number; adjustment: number;
  paid: number; loan: number; cash: number; extra: number;
}

interface Emp {
  id: number; name: string; code: string; role: string; status: string; isWeaver: boolean;
  salary: number; weeks: Week[];
}

export async function EmployeeWeeklyWagesView({ sp, print = false }: { sp: WeeklyWagesParams; print?: boolean }) {
  const today = todayIST();
  let from = ISO.test(sp.from ?? '') ? sp.from! : addDays(monday(today), -7 * 7);
  let to = ISO.test(sp.to ?? '') ? sp.to! : today;
  if (to < from) [from, to] = [to, from];
  const empFilter = sp.emp && /^\d+$/.test(sp.emp) ? Number(sp.emp) : null;
  const roleFilter = (ROLES as readonly string[]).includes(sp.role ?? '') ? sp.role! : null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [{ data, error }, { data: empData }] = await Promise.all([
    sb.rpc('fn_employee_weekly_wages', { p_from: from, p_to: to, p_employee: empFilter }),
    sb.from('employee').select('id, full_name, code, role, status, weekly_salary').order('full_name').limit(1000),
  ]);
  const masters = (empData ?? []) as Array<{ id: number; full_name: string; code: string | null; role: string | null; status: string | null; weekly_salary: number | string | null }>;
  const salaryById = new Map(masters.map((e) => [Number(e.id), Number(e.weekly_salary ?? 0)]));

  // ── Group rows into employees ──
  const empMap = new Map<number, Emp>();
  for (const r of (data ?? []) as Row[]) {
    const role = r.role ?? '';
    if (roleFilter && role !== roleFilter) continue;
    const id = Number(r.employee_id);
    let e = empMap.get(id);
    if (!e) {
      e = {
        id, name: r.full_name, code: r.emp_code ?? '', role, status: r.status ?? '',
        isWeaver: role === 'weaver', salary: salaryById.get(id) ?? 0, weeks: [],
      };
      empMap.set(id, e);
    }
    const sameDay = Number(r.same_day), advance = Number(r.advance), settlement = Number(r.settlement), adjustment = Number(r.adjustment);
    const paid = sameDay + advance + settlement + adjustment;
    const loan = Number(r.loan_deducted);
    e.weeks.push({
      wk: r.week_start,
      earned: r.earned == null ? null : Number(r.earned),
      metres: r.metres == null ? null : Number(r.metres),
      sameDay, advance, settlement, adjustment, paid, loan, cash: paid - loan, extra: Number(r.extra_work),
    });
  }
  const emps = Array.from(empMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of emps) e.weeks.sort((a, b) => a.wk.localeCompare(b.wk));

  // Earned for a week: weavers from the shift log, others the master weekly salary.
  const earnedOf = (e: Emp, w: Week): number | null => (e.isWeaver ? (w.earned ?? 0) : (e.salary > 0 ? e.salary : null));

  function totals(e: Emp) {
    const t = { earned: 0, paid: 0, loan: 0, cash: 0, extra: 0, sameDay: 0, advance: 0, settlement: 0, adjustment: 0, metres: 0, paidWeeks: 0 };
    for (const w of e.weeks) {
      t.earned += earnedOf(e, w) ?? 0; t.paid += w.paid; t.loan += w.loan; t.cash += w.cash; t.extra += w.extra;
      t.sameDay += w.sameDay; t.advance += w.advance; t.settlement += w.settlement; t.adjustment += w.adjustment;
      t.metres += w.metres ?? 0;
      if (w.paid > 0) t.paidWeeks += 1;
    }
    return t;
  }

  const grand = emps.reduce((g, e) => { const t = totals(e); g.paid += t.paid; g.loan += t.loan; g.cash += t.cash; g.extra += t.extra; return g; },
    { paid: 0, loan: 0, cash: 0, extra: 0 });

  // Employee options (masters, filtered by role).
  const empOpts = masters.filter((m) => !roleFilter || m.role === roleFilter);

  // ── Excel: one row per employee x week ──
  const exportColumns: ExcelColumn[] = [
    { key: 'employee', label: 'Employee', width: 22 },
    { key: 'code', label: 'Emp code', width: 10 },
    { key: 'role', label: 'Role', width: 10 },
    { key: 'week', label: 'Week (Mon–Sun)', width: 22 },
    { key: 'metres', label: 'Metres', type: 'number', total: true },
    { key: 'earned', label: 'Earned / salary', type: 'rupee', total: true },
    { key: 'same_day', label: 'Same-day', type: 'rupee', total: true },
    { key: 'advance', label: 'Advance', type: 'rupee', total: true },
    { key: 'settlement', label: 'Settlement', type: 'rupee', total: true },
    { key: 'adjustment', label: 'Adjustment', type: 'rupee', total: true },
    { key: 'paid', label: 'Wage paid', type: 'rupee', total: true },
    { key: 'loan', label: 'Loan held', type: 'rupee', total: true },
    { key: 'cash', label: 'Cash given', type: 'rupee', total: true },
    { key: 'extra', label: 'Extra work', type: 'rupee', total: true },
    { key: 'balance', label: 'Balance (weavers)', type: 'rupee', total: true },
  ];
  const exportRows = emps.flatMap((e) => e.weeks.map((w) => {
    const earned = earnedOf(e, w);
    return {
      employee: e.name, code: e.code, role: e.role, week: `${pretty(w.wk)} – ${pretty(addDays(w.wk, 6))}`,
      metres: w.metres ?? 0, earned: earned ?? 0,
      same_day: w.sameDay, advance: w.advance, settlement: w.settlement, adjustment: w.adjustment,
      paid: w.paid, loan: w.loan, cash: w.cash, extra: w.extra,
      balance: e.isWeaver ? (w.earned ?? 0) - w.paid : 0,
    };
  }));

  const label = `${pretty(from)} – ${pretty(to)}`;
  const qs = `from=${from}&to=${to}${empFilter !== null ? `&emp=${empFilter}` : ''}${roleFilter ? `&role=${roleFilter}` : ''}`;
  const oneName = empFilter !== null ? (masters.find((m) => Number(m.id) === empFilter)?.full_name ?? null) : null;
  const th = 'text-right px-3 py-2 whitespace-nowrap';
  const td = 'px-3 py-2 text-right num whitespace-nowrap';

  const body = (
    <>
      <PageHeader
        title="Employee Weekly Wages"
        subtitle={`${label}${roleFilter ? ` · ${roleFilter}s` : ''}`}
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Employee Weekly Wages' }]}
        actions={!print && emps.length > 0 ? (
          <div className="flex gap-2 print:hidden">
            <ExcelExportButton filename={`employee-weekly-wages-${from}-to-${to}`} sheetName="Weekly wages"
              title={`Employee Weekly Wages · ${label}`} columns={exportColumns} rows={exportRows} />
            <Link href={`/app/reports/employee-weekly-wages/print?${qs}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60">
              PDF / Print
            </Link>
          </div>
        ) : undefined}
      />

      {!print && <form action="/app/reports/employee-weekly-wages" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-2 print:hidden">
        <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Month
          <MonthQuickPick from={from} to={to} today={today} className="input py-1 text-xs min-w-[120px]" />
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">From
          <input name="from" type="date" defaultValue={from} className="input py-1 text-xs" />
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">To
          <input name="to" type="date" defaultValue={to} className="input py-1 text-xs" />
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Role
          <select name="role" defaultValue={roleFilter ?? ''} className="input py-1 text-xs">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Employee
          <select name="emp" defaultValue={empFilter !== null ? String(empFilter) : ''} className="input py-1 text-xs min-w-[170px]">
            <option value="">All employees</option>
            {empOpts.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.status && m.status !== 'active' ? ` (${m.status})` : ''}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-primary text-xs py-1.5">Apply</button>
        {(empFilter !== null || roleFilter) && (
          <Link href={`/app/reports/employee-weekly-wages?from=${from}&to=${to}`} className="text-xs text-indigo underline pb-1.5">Clear</Link>
        )}
      </form>}

      {error && <div className="card p-3 mb-4 text-err text-sm">Could not load: {error.message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3"><div className="text-xs text-ink-mute">Employees</div><div className="text-lg font-semibold mt-1">{emps.length}</div></div>
        <div className="card p-3"><div className="text-xs text-ink-mute">Wage paid</div><div className="text-lg font-semibold mt-1 num">{rupee(grand.paid)}</div></div>
        <div className="card p-3"><div className="text-xs text-ink-mute">Loan held back</div><div className="text-lg font-semibold mt-1 num">{rupee(grand.loan)}</div></div>
        <div className="card p-3"><div className="text-xs text-ink-mute">Extra work (separate)</div><div className="text-lg font-semibold mt-1 num">{rupee(grand.extra)}</div></div>
      </div>

      {emps.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">No wages or production in this period.</div>
      ) : (
        <div className="space-y-5">
          {emps.map((e) => {
            const t = totals(e);
            const avgWeek = t.paidWeeks > 0 ? t.paid / t.paidWeeks : 0;
            return (
              <div key={e.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 border-b border-line bg-cloud/40">
                  <div>
                    <span className="font-semibold">{e.name}</span>
                    <span className="text-xs text-ink-mute"> · {e.code} · {e.role}</span>
                    {e.status && e.status !== 'active' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{e.status}</span>}
                    {!e.isWeaver && <span className="text-xs text-ink-mute"> · weekly salary {e.salary > 0 ? rupee(e.salary) : 'not set'}</span>}
                  </div>
                  <div className="text-xs text-ink-soft">
                    Avg / paid week <span className="num font-semibold text-ink">{rupee(avgWeek)}</span>
                    <span className="mx-2 text-ink-mute">·</span>
                    Avg / month <span className="num font-semibold text-ink">{rupee(avgWeek * WEEKS_PER_MONTH)}</span>
                    <span className="text-ink-mute"> ({t.paidWeeks} paid wk{t.paidWeeks === 1 ? '' : 's'})</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-ink-soft bg-cloud/20">
                      <tr>
                        <th className="text-left px-3 py-2 whitespace-nowrap">Week</th>
                        {e.isWeaver && <th className={th}>Metres</th>}
                        <th className={th}>{e.isWeaver ? 'Earned' : 'Salary'}</th>
                        <th className={th}>Same-day</th>
                        <th className={th}>Advance</th>
                        <th className={th}>Settlement</th>
                        {t.adjustment !== 0 && <th className={th}>Adjust</th>}
                        <th className={`${th} font-bold`}>Wage paid</th>
                        <th className={th}>Loan held</th>
                        <th className={th}>Cash given</th>
                        <th className={th}>Extra work</th>
                        {e.isWeaver && <th className={th}>Balance</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {e.weeks.map((w) => {
                        const earned = earnedOf(e, w);
                        const bal = e.isWeaver ? (w.earned ?? 0) - w.paid : 0;
                        return (
                          <tr key={w.wk} className="hover:bg-haze/40">
                            <td className="px-3 py-2 whitespace-nowrap">{short(w.wk)} – {short(addDays(w.wk, 6))}</td>
                            {e.isWeaver && <td className={td}>{w.metres ? w.metres.toFixed(1) : '—'}</td>}
                            <td className={td}>{earned == null ? '—' : rupee(earned)}</td>
                            <td className={td}>{r0(w.sameDay)}</td>
                            <td className={td}>{r0(w.advance)}</td>
                            <td className={td}>{r0(w.settlement)}</td>
                            {t.adjustment !== 0 && <td className={td}>{r0(w.adjustment)}</td>}
                            <td className={`${td} font-semibold`}>{rupee(w.paid)}</td>
                            <td className={`${td} text-amber-700`}>{r0(w.loan)}</td>
                            <td className={td}>{rupee(w.cash)}</td>
                            <td className={`${td} text-ink-mute`}>{r0(w.extra)}</td>
                            {e.isWeaver && (
                              <td className={`${td} ${Math.abs(bal) < 5 ? 'text-ink-mute' : bal > 0 ? 'text-err' : 'text-ok'}`}>
                                {Math.abs(bal) < 0.005 ? '—' : rupee(bal)}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-line bg-cloud/30 text-xs font-semibold">
                      <tr>
                        <td className="px-3 py-2 uppercase tracking-wide text-ink-soft">Total ({e.weeks.length} wks)</td>
                        {e.isWeaver && <td className={td}>{t.metres.toFixed(1)}</td>}
                        <td className={td}>{rupee(t.earned)}</td>
                        <td className={td}>{rupee(t.sameDay)}</td>
                        <td className={td}>{rupee(t.advance)}</td>
                        <td className={td}>{rupee(t.settlement)}</td>
                        {t.adjustment !== 0 && <td className={td}>{rupee(t.adjustment)}</td>}
                        <td className={`${td} font-bold`}>{rupee(t.paid)}</td>
                        <td className={td}>{rupee(t.loan)}</td>
                        <td className={td}>{rupee(t.cash)}</td>
                        <td className={td}>{rupee(t.extra)}</td>
                        {e.isWeaver && <td className={td}>{rupee(t.earned - t.paid)}</td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-ink-mute mt-4">
        Weeks run Monday–Sunday (the wage week). Wage paid = same-day + advance + settlement (+ adjustment); loan held is the part of that kept back for
        loan repayment, so cash given = wage paid − loan held. Extra work is listed separately and not counted in the wage. Weavers&apos; earned = metres ×
        the rate saved on each shift; balance = earned − wage paid (red = still owed, green = paid ahead). Salaried staff show their master weekly salary.
        Average per month = average per paid week × 4.33.
      </p>
    </>
  );

  if (!print) return <div>{body}</div>;
  return (
    <>
      <PrintActions backHref={`/app/reports/employee-weekly-wages?${qs}`} filename={`Employee Weekly Wages - ${oneName ? `${oneName} - ` : ''}${from} to ${to}`} />
      <div className="weekly-wages-print p-6 mx-auto bg-paper text-ink" style={{ maxWidth: '297mm' }}>
        <style>{`@page { size: A4 landscape; margin: 10mm; }
          @media print { .weekly-wages-print { padding: 0 !important; } .weekly-wages-print .card { box-shadow: none; break-inside: avoid; } }`}</style>
        {body}
      </div>
    </>
  );
}
