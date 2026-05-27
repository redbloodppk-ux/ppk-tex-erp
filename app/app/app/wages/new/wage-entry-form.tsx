'use client';
/**
 * WageEntryForm — single wage_entry row entry (CORR-T4)
 *
 * Per-employee allocation basis (metres vs loom_shifts) is set on the
 * Employee form, not here. We surface the current value in the helper text
 * so the operator knows which way this entry will spread.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

export type Kind = 'advance' | 'settlement' | 'adjustment';

export interface EmployeeOption {
  id: number;
  code: string;
  full_name: string;
  role: string;
  wage_alloc_basis: 'metres' | 'loom_shifts';
}

interface WageEntryFormProps {
  employees: EmployeeOption[];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function lastWeekISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

export function WageEntryForm({ employees }: WageEntryFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [employeeId, setEmployeeId] = useState<string>(
    employees[0] ? String(employees[0].id) : '',
  );
  const [payDate, setPayDate] = useState<string>(todayISO());
  const [periodStart, setPeriodStart] = useState<string>(lastWeekISO());
  const [periodEnd, setPeriodEnd] = useState<string>(todayISO());
  const [kind, setKind] = useState<Kind>('settlement');
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => employees.find((e) => String(e.id) === employeeId) ?? null,
    [employees, employeeId],
  );

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError('Pick an employee.');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Amount must be a non-negative number.');
      return;
    }
    if (periodEnd < periodStart) {
      setError('Period end cannot be before period start.');
      return;
    }

    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    // wage_entry was added in migration 031 — types not yet regenerated.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase as any)
      .from('wage_entry')
      .insert([{
        employee_id: Number(employeeId),
        pay_date: payDate,
        period_start: periodStart,
        period_end: periodEnd,
        kind,
        amount: amt,
        notes: notes.trim() || null,
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
      } as never]);

    setBusy(false);

    if (insErr) {
      setError(insErr.message);
      return;
    }
    router.push('/app/wages');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4 max-w-xl">
      <div>
        <label className="label" htmlFor="employee">Employee</label>
        <select
          id="employee"
          className="input"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          required
        >
          {employees.length === 0 && <option value="">No active employees</option>}
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.code} — {emp.full_name} ({emp.role})
            </option>
          ))}
        </select>
        {selected && (
          <p className="text-[11px] text-ink-mute mt-1">
            Allocation basis for this employee:{' '}
            <span className="font-semibold capitalize">
              {selected.wage_alloc_basis.replace('_', '-')}
            </span>
            . Change on the Employee page if needed.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="kind">Kind</label>
          <select
            id="kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="settlement">Settlement (weekly)</option>
            <option value="advance">Advance</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="amount">Amount (₹)</label>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            className="input num"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="payDate">Pay date</label>
          <input
            id="payDate"
            type="date"
            className="input"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="periodStart">Period start</label>
          <input
            id="periodStart"
            type="date"
            className="input"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="periodEnd">Period end</label>
          <input
            id="periodEnd"
            type="date"
            className="input"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
          />
        </div>
      </div>
      <p className="text-[11px] text-ink-mute -mt-2">
        The amount is spread across in-house batches whose production window
        overlaps Period start → Period end. For advances, set both dates to
        the day the advance is paid.
      </p>

      <div>
        <label className="label" htmlFor="notes">Notes (optional)</label>
        <textarea
          id="notes"
          className="input min-h-[64px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. weekly settlement, festival bonus, deduction reversal"
        />
      </div>

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={busy || employees.length === 0}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Save wage entry
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push('/app/wages')}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
