'use client';
/**
 * /app/bonus — Bonus calculator for the three pay groups:
 *
 *   1. Loom-shift employees (wage_alloc_basis = 'loom_shifts')
 *      Presents (auto from attendance, editable) × bonus → total.
 *   2. Weaver wages (wage_alloc_basis = 'metres')
 *      Presents + total wages over the From–To range (auto from
 *      wage_entry, editable) × bonus → total.
 *   3. Weekly employees (wage_alloc_basis = 'weekly')
 *      Presents + 4-week salary (auto from employee.weekly_salary × 4,
 *      editable) × bonus → total.
 *
 * Each section has ONE bonus setting with a %, / ₹ selector:
 *   - "% of amount"   → total = amount × bonus / 100
 *   - "₹ per present" → total = presents × bonus
 *
 * Pure calculator — nothing is written to the database.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, RefreshCw } from 'lucide-react';

type Basis = 'loom_shifts' | 'metres' | 'weekly';
type BonusMode = 'pct' | 'per_present';

interface EmployeeRow {
  id: number;
  code: string;
  full_name: string;
  role: string;
  wage_alloc_basis: Basis | string | null;
  weekly_salary: number | string | null;
}

/** Editable per-employee figures. Auto-filled from attendance / wages
 *  and overridable by the operator. */
interface RowState {
  presents: string;
  amount: string;
}

interface SectionConfig {
  basis: Basis;
  title: string;
  amountLabel: string;
  amountHint: string;
}

const SECTIONS: readonly SectionConfig[] = [
  {
    basis: 'loom_shifts',
    title: '1. Loom-Shift Employees',
    amountLabel: 'Wages in period (Rs)',
    amountHint: 'Auto = wages paid in the From–To range',
  },
  {
    basis: 'metres',
    title: '2. Weaver Wages (metre basis)',
    amountLabel: 'Total wages (Rs)',
    amountHint: 'Auto = wages paid in the From–To range',
  },
  {
    basis: 'weekly',
    title: '3. Weekly Employees',
    amountLabel: '4-week salary (Rs)',
    amountHint: 'Auto = weekly salary × 4 from the employee master',
  },
];

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

function yearAgoISO(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtRs(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function toNum(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Present-days contributed by one attendance entry. day_weight wins
 *  when set; otherwise present/late/early_leave = 1, half_day = 0.5. */
function presentWeight(status: string, dayWeight: number | string | null): number {
  if (status === 'absent' || status === 'none') return 0;
  const w = Number(dayWeight);
  if (Number.isFinite(w) && w > 0) return w;
  return status === 'half_day' ? 0.5 : 1;
}

export default function BonusPage(): React.ReactElement {
  const supabase = createClient();

  const [from, setFrom] = useState<string>(yearAgoISO());
  const [to,   setTo]   = useState<string>(todayISO());

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Per-section bonus settings: mode (% of amount / ₹ per present) + value.
  const [bonusMode,  setBonusMode]  = useState<Record<Basis, BonusMode>>({
    loom_shifts: 'per_present', metres: 'pct', weekly: 'pct',
  });
  const [bonusValue, setBonusValue] = useState<Record<Basis, string>>({
    loom_shifts: '', metres: '', weekly: '',
  });

  /** Load employees + auto-fill presents (attendance in range) and
   *  amounts (wages paid in range; weekly salary × 4 for weeklies). */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const [empRes, attRes, wageRes] = await Promise.all([
      sb.from('employee')
        .select('id, code, full_name, role, wage_alloc_basis, weekly_salary')
        .eq('status', 'active')
        .order('full_name'),
      sb.from('attendance_entry')
        .select('employee_id, status, day_weight, day:attendance_day_id!inner ( attendance_date )')
        .gte('day.attendance_date', from)
        .lte('day.attendance_date', to),
      sb.from('wage_entry')
        .select('employee_id, amount, pay_date')
        .gte('pay_date', from)
        .lte('pay_date', to),
    ]);
    if (empRes.error)  { setError(empRes.error.message);  setLoading(false); return; }
    if (attRes.error)  { setError(attRes.error.message);  setLoading(false); return; }
    if (wageRes.error) { setError(wageRes.error.message); setLoading(false); return; }

    const emps = (empRes.data ?? []) as EmployeeRow[];

    const presentsByEmp = new Map<number, number>();
    type AttRow = { employee_id: number; status: string; day_weight: number | string | null };
    for (const a of ((attRes.data ?? []) as AttRow[])) {
      presentsByEmp.set(
        a.employee_id,
        (presentsByEmp.get(a.employee_id) ?? 0) + presentWeight(a.status, a.day_weight),
      );
    }

    const wagesByEmp = new Map<number, number>();
    type WageRow = { employee_id: number; amount: number | string | null };
    for (const w of ((wageRes.data ?? []) as WageRow[])) {
      wagesByEmp.set(w.employee_id, (wagesByEmp.get(w.employee_id) ?? 0) + Number(w.amount ?? 0));
    }

    const next: Record<number, RowState> = {};
    for (const e of emps) {
      const presents = Math.round((presentsByEmp.get(e.id) ?? 0) * 100) / 100;
      const amount = e.wage_alloc_basis === 'weekly'
        ? Number(e.weekly_salary ?? 0) * 4
        : Math.round((wagesByEmp.get(e.id) ?? 0) * 100) / 100;
      next[e.id] = {
        presents: presents > 0 ? String(presents) : '0',
        amount:   amount   > 0 ? String(amount)   : '0',
      };
    }
    setEmployees(emps);
    setRows(next);
    setLoading(false);
  }, [supabase, from, to]);

  useEffect(() => { void load(); }, [load]);

  function patchRow(empId: number, patch: Partial<RowState>): void {
    setRows((r) => ({ ...r, [empId]: { ...(r[empId] ?? { presents: '0', amount: '0' }), ...patch } }));
  }

  /** Bonus for one employee under a section's mode + value. */
  function rowBonus(basis: Basis, empId: number): number {
    const row = rows[empId];
    if (row === undefined) return 0;
    const v = toNum(bonusValue[basis]);
    if (v <= 0) return 0;
    const raw = bonusMode[basis] === 'pct'
      ? toNum(row.amount) * v / 100
      : toNum(row.presents) * v;
    return Math.round(raw * 100) / 100;
  }

  const byBasis = useMemo<Map<Basis, EmployeeRow[]>>(() => {
    const m = new Map<Basis, EmployeeRow[]>();
    for (const s of SECTIONS) m.set(s.basis, []);
    for (const e of employees) {
      const b = e.wage_alloc_basis as Basis;
      if (m.has(b)) m.get(b)!.push(e);
    }
    return m;
  }, [employees]);

  const grandTotal = useMemo<number>(() => {
    let t = 0;
    for (const s of SECTIONS) {
      for (const e of byBasis.get(s.basis) ?? []) t += rowBonus(s.basis, e.id);
    }
    return Math.round(t * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byBasis, rows, bonusMode, bonusValue]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bonus"
        subtitle="Calculate bonus for loom-shift employees, metre-basis weavers and weekly employees. Presents and wages auto-fill from attendance and the wage register; every figure stays editable."
      />

      {/* Period picker — drives presents + wages for all sections. */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="bn-from">From *</label>
          <input id="bn-from" type="date" className="input"
            value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="bn-to">To *</label>
          <input id="bn-to" type="date" className="input"
            value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Grand total bonus</div>
          <div className="num text-2xl font-bold text-emerald-700">Rs {fmtRs(grandTotal)}</div>
        </div>
      </div>

      {error && <p className="text-sm text-err">{error}</p>}

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading attendance and wages…
        </div>
      ) : (
        SECTIONS.map((s) => {
          const emps = byBasis.get(s.basis) ?? [];
          const sectionTotal = emps.reduce((t, e) => t + rowBonus(s.basis, e.id), 0);
          return (
            <div key={s.basis} className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-line/40 bg-cloud/40 flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                  <div className="font-display font-bold">{s.title}</div>
                  <div className="text-[11px] text-ink-mute">{s.amountHint}</div>
                </div>
                <div>
                  <label className="label text-xs" htmlFor={`bn-mode-${s.basis}`}>Bonus type</label>
                  <select id={`bn-mode-${s.basis}`} className="input h-9 text-sm"
                    value={bonusMode[s.basis]}
                    onChange={(e) => setBonusMode((m) => ({ ...m, [s.basis]: e.target.value as BonusMode }))}>
                    <option value="pct">% of amount</option>
                    <option value="per_present">Rs per present</option>
                  </select>
                </div>
                <div>
                  <label className="label text-xs" htmlFor={`bn-val-${s.basis}`}>
                    Bonus {bonusMode[s.basis] === 'pct' ? '(%)' : '(Rs / present)'}
                  </label>
                  <input id={`bn-val-${s.basis}`} type="number" min={0} step="0.01"
                    className="input num h-9 text-sm w-32 text-right"
                    placeholder={bonusMode[s.basis] === 'pct' ? 'e.g. 8.33' : 'e.g. 50'}
                    value={bonusValue[s.basis]}
                    onChange={(e) => setBonusValue((v) => ({ ...v, [s.basis]: e.target.value }))} />
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-ink-mute">Section total</div>
                  <div className="num text-lg font-bold text-emerald-700">Rs {fmtRs(Math.round(sectionTotal * 100) / 100)}</div>
                </div>
              </div>

              {emps.length === 0 ? (
                <div className="p-5 text-sm text-ink-soft">No active employees in this group.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                      <tr>
                        <th className="text-left  px-3 py-3">Employee</th>
                        <th className="text-left  px-3 py-3 hidden md:table-cell">Role</th>
                        <th className="text-right px-3 py-3">No. of presents</th>
                        <th className="text-right px-3 py-3">{s.amountLabel}</th>
                        <th className="text-right px-3 py-3">Bonus total (Rs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emps.map((e) => {
                        const row = rows[e.id] ?? { presents: '0', amount: '0' };
                        return (
                          <tr key={e.id} className="border-t border-line/40 hover:bg-haze/60">
                            <td className="px-3 py-2">
                              <span className="font-semibold">{e.full_name}</span>
                              <span className="ml-2 font-mono text-[10px] text-ink-mute">{e.code}</span>
                            </td>
                            <td className="px-3 py-2 hidden md:table-cell text-xs text-ink-soft capitalize">{e.role}</td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" min={0} step="0.5"
                                className="input num h-8 text-xs w-24 text-right inline-block"
                                value={row.presents}
                                onChange={(ev) => patchRow(e.id, { presents: ev.target.value })} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" min={0} step="0.01"
                                className="input num h-8 text-xs w-32 text-right inline-block"
                                value={row.amount}
                                onChange={(ev) => patchRow(e.id, { amount: ev.target.value })} />
                            </td>
                            <td className="px-3 py-2 text-right num font-semibold text-emerald-700">
                              {fmtRs(rowBonus(s.basis, e.id))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}

      <p className="text-[11px] text-ink-mute">
        % of amount → bonus = amount × % ÷ 100. Rs per present → bonus = presents × rate.
        Changing the From–To dates re-fetches presents and wages (manual edits are replaced).
      </p>
    </div>
  );
}
