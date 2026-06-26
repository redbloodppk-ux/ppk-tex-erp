'use client';
/**
 * LoanForm — issue (or edit) a single employee_loan disbursement.
 *
 * A loan is cash the owner lends a worker. The money physically leaves a
 * cash/bank account, so we record a "Paid from" ledger exactly like the
 * wage form — the Ledger View then shows it as a Credit (outflow) on that
 * account. Repayments are NOT entered here: they happen on the Wage Entry
 * form via the separate Loan field, which deducts from the wage paid and
 * reduces the worker's outstanding loan.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

export interface EmployeeOption {
  id: number;
  code: string;
  full_name: string;
  role: string;
}

// Optional starting values — when provided, the form edits an existing
// loan row instead of inserting a new one.
export interface InitialLoan {
  id: number;
  employee_id: number;
  loan_date: string;
  amount: number;
  notes: string | null;
  source_ledger_id?: number | null;
}

interface SourceLedgerOption {
  id: number;
  name: string;
  type_name: string;
}

interface LoanFormProps {
  employees: EmployeeOption[];
  initial?: InitialLoan;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function LoanForm({ employees, initial }: LoanFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial != null;

  const [employeeId, setEmployeeId] = useState<string>(
    initial ? String(initial.employee_id) : employees[0] ? String(employees[0].id) : '',
  );
  const [loanDate, setLoanDate] = useState<string>(initial?.loan_date ?? todayISO());
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : '');
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  const [sourceLedgers, setSourceLedgers] = useState<SourceLedgerOption[]>([]);
  const [sourceLedgerId, setSourceLedgerId] = useState<string>(
    initial?.source_ledger_id != null ? String(initial.source_ledger_id) : '',
  );

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load active cash + bank ledgers for the "Paid from" picker.
  useEffect(() => {
    let cancelled = false;
    async function loadLedgers(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('ledger')
        .select('id, name, active, ledger_type:type_id ( name )')
        .eq('active', true)
        .order('name');
      if (cancelled) return;
      const list = ((data ?? []) as Array<{ id: number; name: string; ledger_type: { name: string } | null }>)
        .filter((r) => r.ledger_type?.name === 'CASH' || r.ledger_type?.name === 'BANK')
        .map((r) => ({ id: r.id, name: r.name, type_name: r.ledger_type?.name ?? '' }))
        .sort((a, b) => (a.type_name === b.type_name ? a.name.localeCompare(b.name) : a.type_name === 'CASH' ? -1 : 1));
      setSourceLedgers(list);
      if (!sourceLedgerId) {
        const cash = list.find((l) => l.type_name === 'CASH') ?? list[0];
        if (cash) setSourceLedgerId(String(cash.id));
      }
    }
    void loadLedgers();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError('Pick an employee.');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Loan amount must be greater than zero.');
      return;
    }

    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      employee_id: Number(employeeId),
      loan_date: loanDate,
      amount: amt,
      notes: notes.trim() || null,
      source_ledger_id: sourceLedgerId ? Number(sourceLedgerId) : null,
      updated_by: user?.id ?? null,
    };

    let insErr: { message: string } | null = null;
    if (isEdit && initial) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('employee_loan')
        .update(payload as never)
        .eq('id', initial.id);
      insErr = error ?? null;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('employee_loan')
        .insert([{ ...payload, created_by: user?.id ?? null } as never]);
      insErr = error ?? null;
    }

    setBusy(false);

    if (insErr) {
      setError(insErr.message);
      return;
    }
    router.push('/app/loans');
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
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="loanDate">Loan date</label>
          <input
            id="loanDate"
            type="date"
            className="input"
            value={loanDate}
            onChange={(e) => setLoanDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="amount">Loan amount (₹)</label>
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

      <div>
        <label className="label" htmlFor="sourceLedger">Paid from</label>
        <select
          id="sourceLedger"
          className="input"
          value={sourceLedgerId}
          onChange={(e) => setSourceLedgerId(e.target.value)}
        >
          {sourceLedgers.length === 0 && <option value="">Loading…</option>}
          {sourceLedgers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}{l.type_name === 'CASH' ? '' : ' (Bank)'}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-ink-mute mt-1">
          Which account the loan cash came from. It records a matching Credit on
          that cash/bank ledger so its balance reflects money going out.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="notes">Notes (optional)</label>
        <textarea
          id="notes"
          className="input min-h-[64px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. festival advance, medical emergency"
        />
      </div>

      <p className="text-[11px] text-ink-mute">
        Repayments are not entered here. On the New Wage Entry form, use the
        <strong> Loan repayment</strong> field to deduct from a wage — that reduces
        this worker&apos;s outstanding loan.
      </p>

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={busy || employees.length === 0}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Issue loan'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push('/app/loans')}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
