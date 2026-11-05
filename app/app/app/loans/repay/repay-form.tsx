'use client';
/**
 * RepayForm — record a loan the worker paid back DIRECTLY in cash / bank
 * (outside the wages). Inserts one employee_loan_repayment row (migration
 * 336). The money goes INTO the chosen cash/bank account, so the cash book
 * shows it as an inflow, and the worker's outstanding loan goes down.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchPaymentSources, defaultPaymentSource,
  type PaymentSource, type SupabaseLike,
} from '@/lib/ledgers/payment-sources';
import { Loader2 } from 'lucide-react';
import { SmartSelect } from '@/app/components/smart-select';
import { formatRupee, todayIST } from '@/lib/utils';

export interface RepayEmployee {
  id: number;
  code: string;
  full_name: string;
  outstanding: number;
}

export function RepayForm({ employees, defaultEmployeeId }: {
  employees: RepayEmployee[];
  defaultEmployeeId?: number | null;
}): React.ReactElement {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [employeeId, setEmployeeId] = useState<string>(
    defaultEmployeeId != null && employees.some((e) => e.id === defaultEmployeeId)
      ? String(defaultEmployeeId)
      : employees[0] ? String(employees[0].id) : '',
  );
  const [repayDate, setRepayDate] = useState<string>(todayIST());
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [ledgers, setLedgers] = useState<PaymentSource[]>([]);
  const [ledgerId, setLedgerId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emp = employees.find((e) => String(e.id) === employeeId) ?? null;
  const balance = emp?.outstanding ?? 0;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchPaymentSources(supabase as unknown as SupabaseLike);
      if (cancelled) return;
      setLedgers(list);
      const first = defaultPaymentSource(list);
      if (first) setLedgerId(String(first.id));
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!employeeId) { setError('Pick an employee.'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter the amount received.'); return; }
    if (amt > balance + 0.005) {
      setError(`That is more than ${emp?.full_name ?? 'the worker'}'s loan balance of ${formatRupee(balance)}.`);
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('employee_loan_repayment').insert({
      employee_id: Number(employeeId),
      repay_date: repayDate,
      amount: Math.round(amt * 100) / 100,
      dest_ledger_id: ledgerId ? Number(ledgerId) : null,
      notes: notes.trim() || null,
    });
    if (err) { setBusy(false); setError(err.message); return; }
    router.push('/app/loans');
    router.refresh();
  }

  if (employees.length === 0) {
    return (
      <div className="card p-5 max-w-xl text-sm text-ink-soft">
        No employee has a loan balance to repay.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4 max-w-xl">
      <div>
        <label className="label" htmlFor="employee">Employee</label>
        <SmartSelect id="employee" className="input" value={employeeId}
          onChange={(e) => { setEmployeeId(e.target.value); setAmount(''); }} required>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.code} — {e.full_name} (balance {formatRupee(e.outstanding)})
            </option>
          ))}
        </SmartSelect>
        {emp && (
          <div className="mt-1 text-xs">
            Loan balance: <span className="num font-semibold text-rose-700">{formatRupee(balance)}</span>
            <button type="button" className="ml-2 text-indigo font-semibold"
              onClick={() => setAmount(balance.toFixed(2))}>Pay full balance</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="repayDate">Date received</label>
          <input id="repayDate" type="date" className="input" value={repayDate}
            onChange={(e) => setRepayDate(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="amount">Amount received (₹)</label>
          <input id="amount" type="number" inputMode="decimal" step="0.01" min="0" className="input num"
            value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="ledger">Received into</label>
        <SmartSelect id="ledger" className="input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
          {ledgers.length === 0 && <option value="">Loading…</option>}
          {ledgers.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </SmartSelect>
        <p className="text-[11px] text-ink-mute mt-1">
          The cash box or bank account the money went into. Cash in hand goes up by this amount.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="notes">Notes (optional)</label>
        <input id="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. paid back in cash, closing the loan" />
      </div>

      <p className="text-[11px] text-ink-mute">
        Use this when the worker pays the loan back directly. Instalments kept back from wages are still entered
        on the Wage Entry form (Loan repayment field).
      </p>

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save repayment
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push('/app/loans')} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
