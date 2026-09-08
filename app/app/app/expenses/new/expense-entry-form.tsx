'use client';
/**
 * ExpenseEntryForm — single expense_entry row entry.
 *
 * Category list is now managed in Settings → Expense Categories. Each
 * entry is allocated pro-rata by metres across in-house batches whose
 * production window covers the pay_date.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchPaymentSources, defaultPaymentSource,
  type PaymentSource, type SupabaseLike,
} from '@/lib/ledgers/payment-sources';
import { Loader2 } from 'lucide-react';

export interface InitialExpense {
  id: number;
  category: string;
  amount: number;
  pay_date: string;
  notes: string | null;
  source_ledger_id?: number | null;
}

interface ExpenseEntryFormProps {
  initial?: InitialExpense;
}

interface CategoryOption {
  id: number;
  name: string;
}

// Cash / bank / owner account the expense was paid from. Shape and
// ordering both come from lib/ledgers/payment-sources.ts.
type SourceLedgerOption = PaymentSource;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseEntryForm({ initial }: ExpenseEntryFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial != null;

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [catLoading, setCatLoading] = useState<boolean>(true);
  const [category, setCategory] = useState<string>(initial?.category ?? '');
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : '');
  const [payDate, setPayDate] = useState<string>(initial?.pay_date ?? todayISO());
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  // "Paid from" cash/bank account. Defaults to CASH once the list loads.
  const [sourceLedgers, setSourceLedgers] = useState<SourceLedgerOption[]>([]);
  const [sourceLedgerId, setSourceLedgerId] = useState<string>(
    initial?.source_ledger_id != null ? String(initial.source_ledger_id) : '',
  );

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load the accounts money can come out of for the "Paid from" picker.
  // The rule lives in lib/ledgers/payment-sources.ts and nowhere else —
  // this screen used to carry its own copy, which is how owner funds ended
  // up reachable here and on no other screen.
  useEffect(() => {
    let cancelled = false;
    async function loadLedgers(): Promise<void> {
      const list = await fetchPaymentSources(supabase as unknown as SupabaseLike);
      if (cancelled) return;
      setSourceLedgers(list);
      if (!sourceLedgerId) {
        const first = defaultPaymentSource(list);
        if (first) setSourceLedgerId(String(first.id));
      }
    }
    void loadLedgers();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: dbErr } = await (supabase as any)
        .from('expense_category')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');
      if (cancelled) return;
      if (dbErr) {
        setError(dbErr.message);
      } else {
        const list = ((data ?? []) as Array<{ id: number; name: string }>).map(
          (r) => ({ id: r.id, name: r.name }),
        );
        // If editing an inactive category, make sure it still shows up.
        if (initial && !list.some((c) => c.name === initial.category)) {
          list.unshift({ id: -1, name: initial.category });
        }
        setCategories(list);
        const first = list[0];
        if (!initial && first && !category) {
          setCategory(first.name);
        }
      }
      setCatLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!category) {
      setError('Please choose a category. Add one in Settings → Expense Categories if the list is empty.');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Amount must be a non-negative number.');
      return;
    }

    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      category,
      amount: amt,
      pay_date: payDate,
      notes: notes.trim() || null,
      source_ledger_id: sourceLedgerId ? Number(sourceLedgerId) : null,
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
            onChange={(e) => setCategory(e.target.value)}
            required
            disabled={catLoading}
          >
            {catLoading ? (
              <option value="">Loading…</option>
            ) : categories.length === 0 ? (
              <option value="">No categories — add one in Settings</option>
            ) : (
              categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))
            )}
          </select>
          <p className="text-[11px] text-ink-mute mt-1">
            Manage this list in <a className="underline" href="/app/settings/expense-categories">Settings → Expense Categories</a>.
          </p>
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
        <label className="label" htmlFor="payDate">Pay date</label>
        <input
          id="payDate"
          type="date"
          className="input"
          value={payDate}
          onChange={(e) => setPayDate(e.target.value)}
          required
        />
        <p className="text-[11px] text-ink-mute mt-1">
          The amount is spread pro-rata by metres across in-house batches whose
          production window includes this pay date.
        </p>
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
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <p className="text-[11px] text-ink-mute mt-1">
          Which account this expense was paid from. It records a matching Credit
          on that ledger so its balance reflects money going out.
              {' '}Pick <strong>Owner funds</strong> when you paid for something
              business-related yourself &mdash; on your own card or out of pocket.
              The cost is recorded and the business owes you for it; paying your
              card bill from the business account later settles it.
        </p>
      </div>

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
