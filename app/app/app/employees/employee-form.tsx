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

    const payload = {
      code,
      full_name,
      role:            values.role,
      default_shift:   values.default_shift,
      date_of_joining: values.date_of_joining || null,
      phone:           values.phone.trim() || null,
      id_last4:        id4 || null,
      status:          values.status,
      notes:           values.notes.trim() || null,
    };

    const { error: dbError } = isEdit
      ? await supabase.from('employee').update(payload as never).eq('id', employeeId as never)
      : await supabase.from('employee').insert(payload as never);

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
