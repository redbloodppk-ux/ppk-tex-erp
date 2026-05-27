'use client';
/**
 * ExpenseEntryForm — single expense_entry row entry.
 *
 * Categories: spares / carpenter / electrical / knotting / auto / office /
 * others. Each entry is allocated pro-rata by metres across in-house batches
 * whose production window overlaps period_start..period_end.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

export type ExpenseCategory =
  | 'spares'
  | 'carpenter'
  | 'electrical'
  | 'knotting'
  | 'auto'
  | 'office'
  | 'others';

export const EXPENSE_CATEGORIES: ReadonlyArray<{
  value: ExpenseCategory;
  label: string;
}> = [
  { value: 'spares',     label: 'Spares' },
  { value: 'carpenter',  label: 'Carpenter' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'knotting',   label: 'Knotting' },
  { value: 'auto',       label: 'Auto' },
  { value: 'office',     label: 'Office' },
  { value: 'others',     label: 'Others' },
];

export interface InitialExpense {
  id: number;
  category: ExpenseCategory;
  title: string;
  amount: number;
  pay_date: string;
  period_start: string;
  period_end: string;
  notes: string | null;
}

interface ExpenseEntryFormProps {
  initial?: InitialExpense;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function lastWeekISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

export function ExpenseEntryForm({ initial }: ExpenseEntryFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial != null;

  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'spares');
  const [title, setTitle] = useState<string>(initial?.title ?? '');
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : '');
  const [payDate, setPayDate] = useState<string>(initial?.pay_date ?? todayISO());
  const [periodStart, setPeriodStart] = useState<string>(initial?.period_start ?? lastWeekISO());
  const [periodEnd, setPeriodEnd] = useState<string>(initial?.period_end ?? todayISO());
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required — e.g. "Beam bearing replacement" or "Loom-3 belt".');
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      category,
      title: trimmedTitle,
      amount: amt,
      pay_date: payDate,
      period_start: periodStart,
      period_end: periodEnd,
      notes: notes.trim() || null,
      updated_by: user?.id ?? null,
    };

    let dbErr: { message: string } | null = null;
    if (isEdit && initial) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('expense_entry')
        .update(payload as never)
        .eq('id', initial.id);
      dbErr = error ?? null;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('expense_entry')
        .insert([{ ...payload, created_by: user?.id ?? null } as never]);
      dbErr = error ?? null;
    }

    setBusy(false);

    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    router.push('/app/expenses');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4 max-w-xl">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select
            id="category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            required
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
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

      <div>
        <label className="label" htmlFor="title">Title</label>
        <input
          id="title"
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Beam bearing replacement, electrician visit, office stationery"
          required
        />
        <p className="text-[11px] text-ink-mute mt-1">
          A short description of what was paid for. There&apos;s no payee /
          vendor field — this title is the only label on reports.
        </p>
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
        The amount is spread pro-rata by metres across in-house batches whose
        production window overlaps Period start → Period end.
      </p>

      <div>
        <label className="label" htmlFor="notes">Notes (optional)</label>
        <textarea
          id="notes"
          className="input min-h-[64px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Bill number, who attended, anything you want to recall later"
        />
      </div>

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Save expense'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push('/app/expenses')}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
