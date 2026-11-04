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
 * Tick boxes choose who is eligible; unticked employees get no bonus and
 * are left out of the totals and the printed statement.
 *
 * Wages before the app (employee_opening_wages, migration 331) are added
 * when their period overlaps From–To — the books only begin on 25-05-2026.
 *
 * "Save bonus" stores the whole calculation in bonus_run so it can be
 * reopened and reprinted; nothing else is written to the database.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { BrandLogo } from '@/app/components/brand-logo';
import { Loader2, RefreshCw, FileDown, Save, Trash2, FolderOpen, Plus } from 'lucide-react';
import { recordDateBounds, clampDate, SOURCES, type RecordBounds } from '@/lib/reports/record-bounds';
import { todayIST } from '@/lib/utils';

type Basis = 'loom_shifts' | 'metres' | 'weekly';
type BonusMode = 'pct' | 'per_present';

interface EmployeeRow {
  id: number;
  code: string;
  full_name: string;
  role: string;
  wage_alloc_basis: Basis | string | null;
  weekly_salary: number | string | null;
  status?: string | null;
}

/** Editable per-employee figures. Auto-filled from attendance / wages
 *  and overridable by the operator. */
interface RowState {
  presents: string;
  amount: string;
}

/** Wages earned before the ERP started (old note books). */
interface OpeningWage {
  id: number;
  employee_id: number;
  period_from: string;
  period_to: string;
  amount: number | string;
  presents: number | string | null;
  notes: string | null;
}

/** One employee line of a saved bonus calculation. */
interface SavedRow {
  employee_id: number; name: string; code: string; role: string; basis: string;
  included: boolean; presents: string; amount: string; bonus: number;
}

interface BonusRun {
  id: number; title: string; period_from: string; period_to: string;
  settings: { bonusMode?: Record<Basis, BonusMode>; bonusValue?: Record<Basis, string> };
  rows: SavedRow[]; grand_total: number | string; created_at: string;
}

interface SectionConfig {
  basis: Basis;
  title: string;
  amountLabel: string;
  amountHint: string;
}

/** Company letterhead fields for the printed statement. */
interface CompanyProfile {
  display_name?: string;
  legal_name?: string;
  gstin?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
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

function todayISO(): string { return todayIST(); }

function yearAgoISO(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtRs(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(s: string): string {
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
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

  /**
   * The window where records actually exist — earliest and latest of any
   * attendance day or wage entry. null until it has been read.
   *
   * PPK, 2026-09-02: "in bonus page, don't show date range that beyond the
   * record date". The page opened on 02-04-2025 to 02-09-2026, a span of
   * seventeen months, while the books begin on 25-05-2026. The eleven
   * months in front of that are not zero-bonus months, they are months
   * that never happened, and a total computed across them invites the
   * question "why is ANAND's bonus low" when the honest answer is that the
   * range is fiction.
   */
  const [bounds, setBounds] = useState<RecordBounds | null>(null);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyProfile>({});
  /** Eligible for bonus (tick box). Missing key = ticked. */
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  /** Wages-before-the-app rows, all of them (for the manager card). */
  const [openings, setOpenings] = useState<OpeningWage[]>([]);
  /** Opening wages/presents that fall in the current From–To, per employee. */
  const [openingInRange, setOpeningInRange] = useState<Record<number, { amount: number; presents: number }>>({});
  const [savedRuns, setSavedRuns] = useState<BonusRun[]>([]);
  const [saveTitle, setSaveTitle] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** A saved run waiting to be applied once its period has loaded. */
  const pendingRunRef = useRef<BonusRun | null>(null);
  const [openRunId, setOpenRunId] = useState<number | null>(null);
  // New opening-wage form
  const [owEmp, setOwEmp] = useState<string>('');
  const [owFrom, setOwFrom] = useState<string>('');
  const [owTo, setOwTo] = useState<string>('');
  const [owAmount, setOwAmount] = useState<string>('');
  const [owPresents, setOwPresents] = useState<string>('');
  const [owNotes, setOwNotes] = useState<string>('');
  const [owBusy, setOwBusy] = useState<boolean>(false);

  // Per-section bonus settings: mode (% of amount / ₹ per present) + value.
  const [bonusMode,  setBonusMode]  = useState<Record<Basis, BonusMode>>({
    loom_shifts: 'per_present', metres: 'pct', weekly: 'pct',
  });
  const [bonusValue, setBonusValue] = useState<Record<Basis, string>>({
    loom_shifts: '', metres: '', weekly: '',
  });

  /**
   * Read every matching row, not just the first page.
   *
   * PostgREST caps an un-ranged select at 1000 rows and says nothing about
   * it - no error, no flag, just a short array. This page asked for every
   * attendance row in a 16-month window (about 2,000) and silently got the
   * oldest 1000, so:
   *   - every present count came out roughly half right. ASHOK read 3
   *     against 38 actual, ANAND 33 against 72;
   *   - widening the date range changed nothing, because the extra rows
   *     fell off the same cap. That is the "same value whatever dates I
   *     pick" symptom.
   *
   * Paging until a short page arrives is the fix.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchAllRows = useCallback(async function <T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build: (lo: number, hi: number) => any,
  ): Promise<{ rows: T[]; error: string | null }> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let lo = 0; ; lo += PAGE) {
      const { data, error } = await build(lo, lo + PAGE - 1);
      if (error) return { rows: [], error: error.message };
      const chunk = (data ?? []) as T[];
      out.push(...chunk);
      if (chunk.length < PAGE) break;
    }
    return { rows: out, error: null };
  }, []);

  /** Load employees + auto-fill presents (attendance in range) and
   *  amounts (wages paid in range; weekly salary × 4 for weeklies). */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    type AttRow = { employee_id: number; status: string; day_weight: number | string | null };
    type WageRow = { employee_id: number; amount: number | string | null; kind: string | null };

    const [empRes, attAll, wageAll, cpRes, owRes, runRes] = await Promise.all([
      sb.from('employee')
        // All employees, not only active ones: someone who worked in the
        // period and has since left (ANAND, ACTING 1) is still owed a
        // bonus for it. Filtered below to active OR worked/paid in range.
        .select('id, code, full_name, role, wage_alloc_basis, weekly_salary, status')
        .order('full_name'),
      // Ordered by id so the pages line up and no row is read twice or
      // skipped between them.
      fetchAllRows<AttRow>((lo, hi) => sb.from('attendance_entry')
        .select('id, employee_id, status, day_weight, day:attendance_day_id!inner ( attendance_date )')
        .gte('day.attendance_date', from)
        .lte('day.attendance_date', to)
        .order('id', { ascending: true })
        .range(lo, hi)),
      fetchAllRows<WageRow>((lo, hi) => sb.from('wage_entry')
        .select('id, employee_id, amount, kind, pay_date')
        .gte('pay_date', from)
        .lte('pay_date', to)
        .order('id', { ascending: true })
        .range(lo, hi)),
      sb.from('company_profile')
        .select('display_name, legal_name, gstin, address_line1, address_line2, city, state, pincode, phone')
        .limit(1)
        .maybeSingle(),
      sb.from('employee_opening_wages')
        .select('id, employee_id, period_from, period_to, amount, presents, notes')
        .order('period_from', { ascending: true })
        .limit(1000),
      sb.from('bonus_run')
        .select('id, title, period_from, period_to, settings, rows, grand_total, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);
    if (empRes.error) { setError(empRes.error.message); setLoading(false); return; }
    if (attAll.error) { setError(attAll.error);         setLoading(false); return; }
    if (wageAll.error){ setError(wageAll.error);        setLoading(false); return; }

    const allEmps = (empRes.data ?? []) as EmployeeRow[];

    const presentsByEmp = new Map<number, number>();
    for (const a of attAll.rows) {
      presentsByEmp.set(
        a.employee_id,
        (presentsByEmp.get(a.employee_id) ?? 0) + presentWeight(a.status, a.day_weight),
      );
    }

    const wagesByEmp = new Map<number, number>();
    for (const w of wageAll.rows) {
      // wage_entry.amount is the GROSS wage: a loan instalment is part of it
      // (the worker returns it), so it is NOT added again — that counted
      // VIJI's Rs 5,500 of loan repayments twice. Extra work is not wages.
      if (w.kind === 'extra_work') continue;
      wagesByEmp.set(w.employee_id, (wagesByEmp.get(w.employee_id) ?? 0) + Number(w.amount ?? 0));
    }

    // Wages before the app, when their period overlaps From–To.
    const allOpenings = ((owRes?.data ?? []) as OpeningWage[]);
    const openMap: Record<number, { amount: number; presents: number }> = {};
    for (const o of allOpenings) {
      if (o.period_from > to || o.period_to < from) continue;
      const cur = openMap[o.employee_id] ?? { amount: 0, presents: 0 };
      cur.amount += Number(o.amount ?? 0);
      cur.presents += Number(o.presents ?? 0);
      openMap[o.employee_id] = cur;
    }
    for (const [idStr, v] of Object.entries(openMap)) {
      const id = Number(idStr);
      wagesByEmp.set(id, (wagesByEmp.get(id) ?? 0) + v.amount);
      presentsByEmp.set(id, (presentsByEmp.get(id) ?? 0) + v.presents);
    }

    const emps = allEmps.filter((e) => e.status === 'active'
      || (presentsByEmp.get(e.id) ?? 0) > 0 || (wagesByEmp.get(e.id) ?? 0) > 0);
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
    // A saved bonus being reopened: its figures and ticks win over auto-fill.
    const pending = pendingRunRef.current;
    const nextIncluded: Record<number, boolean> = {};
    if (pending) {
      pendingRunRef.current = null;
      for (const e of emps) nextIncluded[e.id] = false;
      for (const r of pending.rows ?? []) {
        next[r.employee_id] = { presents: r.presents, amount: r.amount };
        nextIncluded[r.employee_id] = r.included;
      }
      if (pending.settings?.bonusMode) setBonusMode(pending.settings.bonusMode);
      if (pending.settings?.bonusValue) setBonusValue(pending.settings.bonusValue);
      setSaveTitle(pending.title);
      setOpenRunId(pending.id);
    } else {
      for (const e of emps) nextIncluded[e.id] = true;
    }
    setEmployees(emps);
    setRows(next);
    setIncluded(nextIncluded);
    setOpenings(allOpenings);
    setOpeningInRange(openMap);
    setSavedRuns((runRes?.data ?? []) as BonusRun[]);
    setCompany((cpRes?.data ?? {}) as CompanyProfile);
    setLoading(false);
  }, [supabase, from, to, fetchAllRows]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Find the real extent of the books, once, and pull the pickers inside it.
   *
   * Both tables are asked for their own first and last date rather than
   * assuming attendance always starts first — a wage entry could predate
   * the first marked shift, and the bonus reads both.
   *
   * The clamp only ever NARROWS: if the saved range already sits inside the
   * data it is left alone. That matters because this runs after the first
   * load, and yanking the dates out from under someone who has just picked
   * them would be worse than the wrong default it is fixing.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Bonus reads attendance for presents and wage entries for amounts,
      // so the window is the union of both — a wage entry could predate
      // the first marked shift.
      const b0 = await recordDateBounds(supabase, SOURCES.wages);
      if (cancelled || !b0) return; // empty books: leave the pickers open
      // Wages before the app reach back before the books: let From go there.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ow } = await (supabase as any).from('employee_opening_wages')
        .select('period_from').order('period_from', { ascending: true }).limit(1);
      const owMin = (ow?.[0]?.period_from as string | undefined) ?? null;
      const b: RecordBounds = owMin && owMin < b0.min ? { ...b0, min: owMin } : b0;
      if (cancelled) return;
      setBounds(b);
      setFrom((f) => clampDate(f, b));
      setTo((t) => clampDate(t, b));
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  function patchRow(empId: number, patch: Partial<RowState>): void {
    setRows((r) => ({ ...r, [empId]: { ...(r[empId] ?? { presents: '0', amount: '0' }), ...patch } }));
  }

  const isIn = (empId: number): boolean => included[empId] !== false;

  /** Bonus for one employee under a section's mode + value (0 if unticked). */
  function rowBonus(basis: Basis, empId: number): number {
    const row = rows[empId];
    if (row === undefined || !isIn(empId)) return 0;
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
  }, [byBasis, rows, bonusMode, bonusValue, included]);

  const defaultTitle = `Bonus ${fmtDate(from)} to ${fmtDate(to)}`;

  async function saveRun(): Promise<void> {
    setMsg(null);
    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const savedRows: SavedRow[] = [];
    for (const s of SECTIONS) {
      for (const e of byBasis.get(s.basis) ?? []) {
        const r = rows[e.id] ?? { presents: '0', amount: '0' };
        savedRows.push({
          employee_id: e.id, name: e.full_name, code: e.code, role: e.role, basis: s.basis,
          included: isIn(e.id), presents: r.presents, amount: r.amount, bonus: rowBonus(s.basis, e.id),
        });
      }
    }
    const payload = {
      title: (saveTitle || defaultTitle).trim(), period_from: from, period_to: to,
      settings: { bonusMode, bonusValue }, rows: savedRows, grand_total: grandTotal,
      updated_at: new Date().toISOString(),
    };
    const res = openRunId
      ? await sb.from('bonus_run').update(payload).eq('id', openRunId).select('id').single()
      : await sb.from('bonus_run').insert(payload).select('id').single();
    setSaving(false);
    if (res.error) { setMsg(`Could not save: ${res.error.message}`); return; }
    setOpenRunId(Number(res.data?.id ?? openRunId));
    setSaveTitle(payload.title);
    setMsg(openRunId ? 'Saved bonus updated.' : 'Bonus saved.');
    const { data } = await sb.from('bonus_run')
      .select('id, title, period_from, period_to, settings, rows, grand_total, created_at')
      .order('created_at', { ascending: false }).limit(200);
    setSavedRuns((data ?? []) as BonusRun[]);
  }

  function openRun(r: BonusRun): void {
    setMsg(null);
    pendingRunRef.current = r;
    if (r.period_from === from && r.period_to === to) void load();
    else { setFrom(r.period_from); setTo(r.period_to); }
  }

  function newRun(): void {
    setOpenRunId(null);
    setSaveTitle('');
    setMsg(null);
    void load();
  }

  async function deleteRun(r: BonusRun): Promise<void> {
    if (!window.confirm(`Delete saved bonus "${r.title}"?`)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase as any).from('bonus_run').delete().eq('id', r.id);
    if (e) { setMsg(`Could not delete: ${e.message}`); return; }
    if (openRunId === r.id) { setOpenRunId(null); setSaveTitle(''); }
    setSavedRuns((list) => list.filter((x) => x.id !== r.id));
  }

  async function addOpening(): Promise<void> {
    setMsg(null);
    const amt = Number(owAmount);
    if (!owEmp || !owFrom || !owTo || !Number.isFinite(amt) || amt <= 0) {
      setMsg('Wages before the app: choose the employee, both dates and the amount.');
      return;
    }
    if (owTo < owFrom) { setMsg('Wages before the app: To date is before From date.'); return; }
    setOwBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase as any).from('employee_opening_wages').insert({
      employee_id: Number(owEmp), period_from: owFrom, period_to: owTo, amount: amt,
      presents: owPresents === '' ? null : Number(owPresents), notes: owNotes || null,
    });
    setOwBusy(false);
    if (e) { setMsg(`Could not save: ${e.message}`); return; }
    setOwEmp(''); setOwAmount(''); setOwPresents(''); setOwNotes('');
    void load();
  }

  async function deleteOpening(o: OpeningWage): Promise<void> {
    if (!window.confirm('Delete this wages-before-the-app entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase as any).from('employee_opening_wages').delete().eq('id', o.id);
    if (e) { setMsg(`Could not delete: ${e.message}`); return; }
    void load();
  }

  const empName = (id: number): string => employees.find((e) => e.id === id)?.full_name ?? `#${id}`;

  const companyAddress = [
    company.address_line1,
    company.address_line2,
    [company.city, company.state, company.pincode].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n');

  /** Browser print dialog → user picks "Save as PDF". Only the hidden
   *  #bonus-print document stays visible while printing. */
  function exportPdf(): void {
    const originalTitle = document.title;
    document.title = `Bonus ${from} to ${to}`;
    setTimeout(() => {
      window.print();
      document.title = originalTitle;
    }, 50);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bonus"
        subtitle="Calculate bonus for loom-shift employees, metre-basis weavers and weekly employees. Presents and wages auto-fill from attendance and the wage register; every figure stays editable."
      />

      {/* Period picker — drives presents + wages for all sections. */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        {/* min/max keep the calendar inside the dates that actually have
            records. The browser greys out everything beyond, so a range
            covering months the mill has no books for cannot be picked by
            accident. */}
        <div>
          <label className="label" htmlFor="bn-from">From *</label>
          <input id="bn-from" type="date" className="input"
            min={bounds?.min} max={bounds?.max}
            value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="bn-to">To *</label>
          <input id="bn-to" type="date" className="input"
            min={bounds?.min} max={bounds?.max}
            value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {bounds && (
          <div className="text-[11px] leading-tight text-ink-mute">
            Records available<br />
            <span className="num">{fmtDate(bounds.min)}</span> to{' '}
            <span className="num">{fmtDate(bounds.max)}</span>
          </div>
        )}
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
        <button type="button" className="btn-secondary" onClick={exportPdf} disabled={loading}>
          <FileDown className="w-4 h-4" /> Export PDF
        </button>
        <div className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="bn-title">Save as</label>
            <input id="bn-title" className="input w-56" placeholder={defaultTitle}
              value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" onClick={() => void saveRun()} disabled={loading || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {openRunId ? 'Update saved' : 'Save bonus'}
          </button>
          {openRunId && (
            <button type="button" className="btn-ghost" onClick={newRun} disabled={loading}>
              <Plus className="w-4 h-4" /> New
            </button>
          )}
        </div>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Grand total bonus</div>
          <div className="num text-2xl font-bold text-emerald-700">Rs {fmtRs(grandTotal)}</div>
        </div>
      </div>

      {error && <p className="text-sm text-err">{error}</p>}
      {msg && <p className="text-sm text-indigo">{msg}</p>}

      {/* Saved bonuses */}
      {savedRuns.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/40 bg-cloud/40 font-display font-bold">Saved bonuses</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-3 py-2">Title</th>
                  <th className="text-left px-3 py-2">Period</th>
                  <th className="text-right px-3 py-2">Employees</th>
                  <th className="text-right px-3 py-2">Total bonus (Rs)</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Saved on</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {savedRuns.map((r) => (
                  <tr key={r.id} className={`border-t border-line/40 ${openRunId === r.id ? 'bg-indigo/5' : 'hover:bg-haze/60'}`}>
                    <td className="px-3 py-2 font-semibold">{r.title}{openRunId === r.id && <span className="ml-2 text-[10px] text-indigo">open</span>}</td>
                    <td className="px-3 py-2 text-xs num">{fmtDate(r.period_from)} – {fmtDate(r.period_to)}</td>
                    <td className="px-3 py-2 text-right num">{(r.rows ?? []).filter((x) => x.included).length}</td>
                    <td className="px-3 py-2 text-right num font-semibold text-emerald-700">{fmtRs(Number(r.grand_total ?? 0))}</td>
                    <td className="px-3 py-2 text-xs text-ink-mute hidden md:table-cell">{fmtDate(r.created_at.slice(0, 10))}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button type="button" className="btn-ghost h-8 text-xs" onClick={() => openRun(r)} disabled={loading}>
                        <FolderOpen className="w-3.5 h-3.5" /> Open
                      </button>
                      <button type="button" className="btn-ghost h-8 text-xs text-err" onClick={() => void deleteRun(r)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                  <input inputMode="decimal" id={`bn-val-${s.basis}`} type="number" min={0} step="0.01"
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
                  <div className="px-4 py-1.5 text-[11px] text-ink-mute border-b border-line/30">
                    {emps.filter((e) => isIn(e.id)).length} of {emps.length} selected for bonus
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                      <tr>
                        <th className="px-3 py-3 w-8">
                          <input type="checkbox" aria-label="Select all in this section"
                            checked={emps.every((e) => isIn(e.id))}
                            onChange={(ev) => {
                              const on = ev.target.checked;
                              setIncluded((m) => { const n = { ...m }; for (const e of emps) n[e.id] = on; return n; });
                            }} />
                        </th>
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
                          <tr key={e.id} className={`border-t border-line/40 hover:bg-haze/60 ${isIn(e.id) ? '' : 'opacity-50'}`}>
                            <td className="px-3 py-2">
                              <input type="checkbox" aria-label={`Bonus for ${e.full_name}`}
                                checked={isIn(e.id)}
                                onChange={(ev) => setIncluded((m) => ({ ...m, [e.id]: ev.target.checked }))} />
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-semibold">{e.full_name}</span>
                              <span className="ml-2 font-mono text-[10px] text-ink-mute">{e.code}</span>
                              {e.status && e.status !== 'active' && (
                                <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{e.status}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 hidden md:table-cell text-xs text-ink-soft capitalize">{e.role}</td>
                            <td className="px-3 py-2 text-right">
                              <input inputMode="decimal" type="number" min={0} step="0.5"
                                className="input num h-8 text-xs w-24 text-right inline-block"
                                value={row.presents}
                                onChange={(ev) => patchRow(e.id, { presents: ev.target.value })} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input inputMode="decimal" type="number" min={0} step="0.01"
                                className="input num h-8 text-xs w-32 text-right inline-block"
                                value={row.amount}
                                onChange={(ev) => patchRow(e.id, { amount: ev.target.value })} />
                              {openingInRange[e.id] && openingInRange[e.id]!.amount > 0 && s.basis !== 'weekly' && (
                                <div className="text-[10px] text-amber-700 mt-0.5">incl. Rs {fmtRs(openingInRange[e.id]!.amount)} before app</div>
                              )}
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

      {/* Wages before the app */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line/40 bg-cloud/40">
          <div className="font-display font-bold">Wages before the app</div>
          <div className="text-[11px] text-ink-mute">Wages from the old books (before 25-05-2026). Added to the bonus when their dates fall inside From–To.</div>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-2 border-b border-line/30">
          <div>
            <label className="label text-xs" htmlFor="ow-emp">Employee</label>
            <select id="ow-emp" className="input h-9 text-sm min-w-[170px]" value={owEmp} onChange={(e) => setOwEmp(e.target.value)}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs" htmlFor="ow-from">From</label>
            <input id="ow-from" type="date" className="input h-9 text-sm" value={owFrom} onChange={(e) => setOwFrom(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs" htmlFor="ow-to">To</label>
            <input id="ow-to" type="date" className="input h-9 text-sm" value={owTo} onChange={(e) => setOwTo(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs" htmlFor="ow-amt">Wages (Rs)</label>
            <input id="ow-amt" type="number" min={0} step="0.01" inputMode="decimal" className="input num h-9 text-sm w-32 text-right"
              value={owAmount} onChange={(e) => setOwAmount(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs" htmlFor="ow-pr">Presents (optional)</label>
            <input id="ow-pr" type="number" min={0} step="0.5" inputMode="decimal" className="input num h-9 text-sm w-28 text-right"
              value={owPresents} onChange={(e) => setOwPresents(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs" htmlFor="ow-notes">Note</label>
            <input id="ow-notes" className="input h-9 text-sm w-40" placeholder="old note book"
              value={owNotes} onChange={(e) => setOwNotes(e.target.value)} />
          </div>
          <button type="button" className="btn-secondary h-9" onClick={() => void addOpening()} disabled={owBusy}>
            {owBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
          </button>
        </div>
        {openings.length === 0 ? (
          <div className="p-4 text-sm text-ink-soft">None entered.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-right px-3 py-2">Wages (Rs)</th>
                <th className="text-right px-3 py-2">Presents</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {openings.map((o) => {
                const inRange = !(o.period_from > to || o.period_to < from);
                return (
                  <tr key={o.id} className="border-t border-line/40">
                    <td className="px-3 py-2 font-semibold">{empName(o.employee_id)}</td>
                    <td className="px-3 py-2 text-xs num">
                      {fmtDate(o.period_from)} – {fmtDate(o.period_to)}
                      {!inRange && <span className="ml-2 text-[10px] text-ink-mute">(outside From–To, not added)</span>}
                    </td>
                    <td className="px-3 py-2 text-right num">{fmtRs(Number(o.amount ?? 0))}</td>
                    <td className="px-3 py-2 text-right num">{o.presents == null ? '—' : String(o.presents)}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft hidden md:table-cell">{o.notes ?? ''}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="btn-ghost h-8 text-xs text-err" onClick={() => void deleteOpening(o)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-ink-mute">
        Untick an employee to leave them out of the bonus. Wages = wage entries in the period (extra work not counted) plus wages before the app.
        % of amount → bonus = amount × % ÷ 100. Rs per present → bonus = presents × rate.
        Changing the From–To dates re-fetches presents and wages (manual edits are replaced).
      </p>

      {/* Hidden A4 document — only this shows while printing (Save as PDF). */}
      <div id="bonus-print" className="hidden bg-white text-ink" style={{ maxWidth: '210mm' }}>
        <div className="flex items-start justify-between border-b-2 border-ink pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BrandLogo variant="mark" height={48} />
              <span className="text-3xl font-display font-extrabold tracking-tight leading-none">
                {company.display_name ?? 'PPK TEX'}
              </span>
            </div>
            {companyAddress && (
              <pre className="text-xs text-ink-soft mt-0.5 whitespace-pre-line font-sans">{companyAddress}</pre>
            )}
            {company.gstin && (
              <div className="text-xs text-ink-soft mt-0.5">GSTIN: <span className="font-mono">{company.gstin}</span></div>
            )}
            {company.phone && <div className="text-xs text-ink-soft">Phone: {company.phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-ink-mute">Bonus Statement</div>
            <div className="text-sm font-semibold">{fmtDate(from)} to {fmtDate(to)}</div>
            <div className="mt-2 text-[10px] uppercase tracking-wide text-ink-mute">Grand total bonus</div>
            <div className="num text-xl font-extrabold">Rs {fmtRs(grandTotal)}</div>
          </div>
        </div>

        {SECTIONS.map((s) => {
          const emps = (byBasis.get(s.basis) ?? []).filter((e) => isIn(e.id));
          const sectionTotal = emps.reduce((t, e) => t + rowBonus(s.basis, e.id), 0);
          const bonusLabel = bonusMode[s.basis] === 'pct'
            ? `${bonusValue[s.basis] || '0'}% of amount`
            : `Rs ${bonusValue[s.basis] || '0'} / present`;
          return (
            <div key={s.basis} className="mb-5 break-inside-avoid">
              <div className="flex items-end justify-between border-b border-line/60 pb-1 mb-1">
                <div className="font-bold text-sm">{s.title}</div>
                <div className="text-[11px] text-ink-soft">
                  Bonus: <span className="font-semibold">{bonusLabel}</span>
                  <span className="mx-2">·</span>
                  Total: <span className="num font-bold">Rs {fmtRs(Math.round(sectionTotal * 100) / 100)}</span>
                </div>
              </div>
              {emps.length === 0 ? (
                <div className="text-xs text-ink-soft py-2">No active employees in this group.</div>
              ) : (
                <table className="w-full text-xs border border-line/60">
                  <thead className="bg-cloud/50 text-[10px] uppercase tracking-wide text-ink-soft">
                    <tr>
                      <th className="text-left px-2 py-1.5 border-b border-line/60">Employee</th>
                      <th className="text-left px-2 py-1.5 border-b border-line/60">Role</th>
                      <th className="text-right px-2 py-1.5 border-b border-line/60">Presents</th>
                      <th className="text-right px-2 py-1.5 border-b border-line/60">{s.amountLabel}</th>
                      <th className="text-right px-2 py-1.5 border-b border-line/60">Bonus (Rs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emps.map((e) => {
                      const row = rows[e.id] ?? { presents: '0', amount: '0' };
                      return (
                        <tr key={e.id} className="border-b border-line/40">
                          <td className="px-2 py-1.5">
                            {e.full_name}
                            <span className="ml-1.5 font-mono text-[10px] text-ink-mute">{e.code}</span>
                          </td>
                          <td className="px-2 py-1.5 text-ink-soft capitalize">{e.role}</td>
                          <td className="px-2 py-1.5 text-right num">{row.presents}</td>
                          <td className="px-2 py-1.5 text-right num">{fmtRs(toNum(row.amount))}</td>
                          <td className="px-2 py-1.5 text-right num font-semibold">{fmtRs(rowBonus(s.basis, e.id))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-cloud/40 font-bold">
                    <tr>
                      <td className="px-2 py-1.5" colSpan={4}>Section total ({emps.length})</td>
                      <td className="px-2 py-1.5 text-right num">Rs {fmtRs(Math.round(sectionTotal * 100) / 100)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          );
        })}

        <div className="mt-4 flex items-center justify-between border-t-2 border-ink pt-2">
          <div className="text-sm font-bold">Grand Total Bonus</div>
          <div className="num text-lg font-extrabold">Rs {fmtRs(grandTotal)}</div>
        </div>
        <p className="mt-4 text-[10px] text-ink-soft italic">
          System-generated bonus statement. Period {fmtDate(from)} to {fmtDate(to)}.
        </p>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #bonus-print, #bonus-print * { visibility: visible !important; }
          #bonus-print {
            display: block !important;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  );
}
