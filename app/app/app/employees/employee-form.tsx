'use client';
/**
 * Shared form for creating + editing employees.
 *
 * Used by /app/employees/new and /app/employees/[id]. Server actions would
 * be slightly cleaner but the rest of the app uses client-side supabase-js
 * writes (see customers/new) so we stay consistent.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface EmployeeFormValues {
  code: string;
  full_name: string;
  role: string;
  default_shift: string;
  date_of_joining: string;     // YYYY-MM-DD or ''
  phone: string;
  id_last4: string;
  status: string;
  notes: string;
  // CORR-A8: when false, this employee is hidden from /attendance/mark.
  // They still appear on wage reports — useful for salaried staff.
  attendance_required: boolean;
  // CORR-T4: per-employee wage allocation basis. Spreads each wage_entry
  // across in-house batches either by metres produced or by loom-shifts.
  wage_alloc_basis: 'metres' | 'loom_shifts' | 'weekly';
  // Migration 037: book weekly salary in INR. Used to auto-fill the
  // wage_entry amount on a "settlement" entry for weekly-basis staff.
  // Stored as a string in form state for clean controlled-input behaviour;
  // converted to number (or null) on save.
  weekly_salary: string;
  // Migration 039: a weaver's home shed. Falls back into the winder
  // weaver-absent count when an absent attendance row has no shed_no.
  home_shed_no: string;
  // Migration 077: default sheds the employee covers. The Attendance
  // Marking page pre-fills the shed picker from this on a fresh shift.
  // Useful mainly for fitters and winders who consistently cover the
  // same sheds. Stored on the row as a Postgres text[] column.
  default_sheds: string[];
}

interface Props {
  initial: EmployeeFormValues;
  /** undefined = create mode; numeric id = edit mode. */
  employeeId?: number;
}

const ROLE_OPTIONS = [
  'weaver', 'fitter', 'folder', 'winder', 'knotter', 'auto', 'office', 'other',
] as const;
const SHIFT_OPTIONS = ['morning', 'night', 'either'] as const;
const STATUS_OPTIONS = ['active', 'inactive', 'resigned'] as const;
// All four sheds available for shed-picker pills. Keep in sync with the
// Attendance Marking page's SHEDS constant.
const SHED_OPTIONS = ['1', '2', '3', '4'] as const;

export function EmployeeForm({ initial, employeeId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = employeeId !== undefined;

  const [values, setValues] = useState<EmployeeFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof EmployeeFormValues>(key: K, v: EmployeeFormValues[K]) {
    setValues(prev => ({ ...prev, [key]: v }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const code = values.code.trim();
    const full_name = values.full_name.trim();
    if (!code) { setBusy(false); setError('Employee code is required.'); return; }
    if (!full_name) { setBusy(false); setError('Full name is required.'); return; }

    const id4 = values.id_last4.trim();
    if (id4 && !/^\d{4}$/.test(id4)) {
      setBusy(false); setError('ID last-4 must be exactly 4 digits.'); return;
    }

    const ws = values.weekly_salary.trim();
    let weeklySalary: number | null = null;
    if (ws !== '') {
      const parsed = Number(ws);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setBusy(false); setError('Weekly salary must be a non-negative number.'); return;
      }
      weeklySalary = parsed;
    }

    const payload = {
      code,
      full_name,
      role:                values.role,
      default_shift:       values.default_shift,
      date_of_joining:     values.date_of_joining || null,
      phone:               values.phone.trim() || null,
      id_last4:            id4 || null,
      status:              values.status,
      notes:               values.notes.trim() || null,
      attendance_required: values.attendance_required,
      wage_alloc_basis:    values.wage_alloc_basis,
      weekly_salary:       weeklySalary,
      home_shed_no:        values.home_shed_no.trim() || null,
      default_sheds:       values.default_sheds,
    };

    // weekly_salary added in migration 037 — supabase-js types lag, cast through any.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: dbError } = isEdit
      ? await sb.from('employee').update(payload as never).eq('id', employeeId as never)
      : await sb.from('employee').insert(payload as never);

    setBusy(false);
    if (dbError) { setError(dbError.message); return; }
    router.push('/app/employees');
    router.refresh();
  }

  async function onDelete() {
    if (!isEdit) return;
    const ok = window.confirm(
      `Permanently delete ${values.full_name} (${values.code})?\n\n` +
      `This cannot be undone. If the employee has attendance or wage history, ` +
      `the delete will fail — set status to "resigned" instead.`,
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    const { error: dbError } = await supabase
      .from('employee')
      .delete()
      .eq('id', employeeId as never);
    setBusy(false);

    if (dbError) {
      // FK violation from attendance_entry / wage_entry rows.
      setError(
        dbError.message.includes('foreign key')
          ? 'This employee has linked attendance or wage records and cannot be deleted. Set status to "resigned" instead.'
          : dbError.message,
      );
      return;
    }
    router.push('/app/employees');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Employee Code *</label>
          <input
            value={values.code}
            onChange={e => set('code', e.target.value)}
            required
            disabled={isEdit}
            className="input font-mono"
            placeholder="EMP-0042"
          />
          {isEdit && (
            <p className="text-[11px] text-ink-mute mt-1">
              Code cannot be changed once created.
            </p>
          )}
        </div>
        <div>
          <label className="label">Status</label>
          <select
            value={values.status}
            onChange={e => set('status', e.target.value)}
            className="input capitalize"
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Full Name *</label>
        <input
          value={values.full_name}
          onChange={e => set('full_name', e.target.value)}
          required
          className="input"
          placeholder="As per ID proof"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Role</label>
          <select
            value={values.role}
            onChange={e => set('role', e.target.value)}
            className="input capitalize"
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r} value={r} className="capitalize">{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Default Shift</label>
          <select
            value={values.default_shift}
            onChange={e => set('default_shift', e.target.value)}
            className="input capitalize"
          >
            {SHIFT_OPTIONS.map(s => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="home_shed_no">Home shed (weavers)</label>
        <input
          id="home_shed_no"
          value={values.home_shed_no}
          onChange={(e) => set('home_shed_no', e.target.value)}
          className="input num max-w-xs"
          placeholder="e.g. 1"
        />
        <p className="text-[11px] text-ink-mute mt-1">
          Used to attribute a weaver&apos;s absence to a shed when the daily mark
          skipped the shed pick. Optional for non-weaver roles.
        </p>
      </div>

      <div>
        <label className="label">Default sheds covered (fitters / winders)</label>
        <div className="flex flex-wrap items-center gap-2">
          {SHED_OPTIONS.map((s) => {
            const active = values.default_sheds.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const next = active
                    ? values.default_sheds.filter((x) => x !== s)
                    : [...values.default_sheds, s].sort();
                  set('default_sheds', next);
                }}
                className={
                  'min-h-[36px] rounded-full border px-3 text-xs font-semibold transition ' +
                  (active
                    ? 'border-transparent bg-indigo-600 text-white'
                    : 'border-line bg-white text-ink-soft hover:bg-haze/60')
                }
              >
                Shed {s}
              </button>
            );
          })}
          {values.default_sheds.length > 0 && (
            <button
              type="button"
              onClick={() => set('default_sheds', [])}
              className="text-[11px] text-ink-mute underline hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-[11px] text-ink-mute mt-1">
          Pre-fills the shed picker on Attendance Marking. Mainly used for
          fitters and winders who cover the same sheds every shift. Leave
          empty if the employee doesn&apos;t have a fixed coverage.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-slate-50 p-3 space-y-2">
        <div className="text-sm font-medium">Wage allocation basis</div>
        <p className="text-xs text-ink-mute -mt-1">
          How this employee&apos;s wages spread across in-house batches.
          Weekly is the default for salaried/weekly-paid staff.
          Weavers / fitters paid by output use loom-shifts;
          finishing staff (folder, winder, knotter) paid by output use metres.
          Vendor batches never receive mill wages.
        </p>
        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="wage_alloc_basis"
              value="weekly"
              checked={values.wage_alloc_basis === 'weekly'}
              onChange={() => set('wage_alloc_basis', 'weekly')}
              className="h-4 w-4"
            />
            <span className="text-sm">Weekly</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="wage_alloc_basis"
              value="metres"
              checked={values.wage_alloc_basis === 'metres'}
              onChange={() => set('wage_alloc_basis', 'metres')}
              className="h-4 w-4"
            />
            <span className="text-sm">Metres produced</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="wage_alloc_basis"
              value="loom_shifts"
              checked={values.wage_alloc_basis === 'loom_shifts'}
              onChange={() => set('wage_alloc_basis', 'loom_shifts')}
              className="h-4 w-4"
            />
            <span className="text-sm">Loom-shifts worked</span>
          </label>
        </div>

        <div className="pt-2">
          <label className="label" htmlFor="weekly_salary">Weekly salary (₹)</label>
          <input
            id="weekly_salary"
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            value={values.weekly_salary}
            onChange={(e) => set('weekly_salary', e.target.value)}
            className="input num max-w-xs"
            placeholder="e.g. 3500"
          />
          <p className="text-[11px] text-ink-mute mt-1">
            {values.wage_alloc_basis === 'weekly'
              ? 'Auto-fills the amount on a Weekly settlement wage entry. Leave blank if not yet decided.'
              : 'Optional — only used for weekly-basis staff. Safe to leave blank for metres / loom-shift employees.'}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-slate-50 p-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={values.attendance_required}
            onChange={(e) => set('attendance_required', e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-sm">
            <span className="font-medium">Mark attendance for this employee</span>
            <span className="block text-xs text-ink-mute mt-0.5">
              Uncheck for salaried staff who don&apos;t need a daily mark.
              They&apos;ll still appear on wages and reports, just not on the Mark Attendance screen.
            </span>
          </span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Phone</label>
          <input
            type="tel"
            value={values.phone}
            onChange={e => set('phone', e.target.value)}
            className="input num"
            placeholder="+91 98765 43210"
          />
        </div>
        <div>
          <label className="label">Date of Joining</label>
          <input
            type="date"
            value={values.date_of_joining}
            onChange={e => set('date_of_joining', e.target.value)}
            className="input"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">ID Last 4 Digits</label>
          <input
            value={values.id_last4}
            onChange={e => set('id_last4', e.target.value)}
            className="input num"
            maxLength={4}
            inputMode="numeric"
            placeholder="1234"
          />
          <p className="text-[11px] text-ink-mute mt-1">
            Last 4 of Aadhaar / ID. Never store the full number.
          </p>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea
          value={values.notes}
          onChange={e => set('notes', e.target.value)}
          rows={2}
          className="input"
          placeholder="Optional — shift swaps allowed, two-wheeler license, etc."
        />
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>
      )}

      <div className="flex justify-between items-center gap-2 pt-2">
        <div>
          {isEdit && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="text-sm text-rose-600 hover:text-rose-700 hover:underline font-medium"
            >
              Delete employee
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Employee'}
          </button>
        </div>
      </div>
    </form>
  );
}
