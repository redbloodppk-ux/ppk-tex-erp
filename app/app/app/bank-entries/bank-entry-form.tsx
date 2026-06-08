'use client';
/**
 * Shared Bank Entry form — used by /new and /[id] (edit).
 *
 * Two-side double entry by ledger ids:
 *   bank_ledger_id  → the bank or cash account that moves
 *   other_ledger_id → the other side (EB expense ledger, Loan account,
 *                     Cash-in-Hand, GST Payable, etc.)
 *
 * The Category drives:
 *   • Which direction is allowed (`in_only` / `out_only` / `both`)
 *   • How the P&L treats this entry (expense / income / balance_sheet)
 *
 * On new: form submits insert; trigger fills entry_no.
 * On edit: form submits update against the existing id.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, Trash2 } from 'lucide-react';

export interface BankCategoryOpt {
  id: number;
  code: string;
  name: string;
  direction: 'out_only' | 'in_only' | 'both';
  pl_treatment: 'expense' | 'income' | 'balance_sheet';
}

export interface LedgerOpt {
  id: number;
  code: string | null;
  name: string;
  type_name: string | null;
}

export interface BankEntryInitial {
  id?: number;
  entry_no?: string;
  entry_date?: string;
  direction?: 'in' | 'out';
  amount?: number | string;
  bank_ledger_id?: number;
  other_ledger_id?: number | null;
  category_id?: number;
  mode?: string;
  reference?: string;
  notes?: string;
  status?: string;
}

interface Props {
  initial?: BankEntryInitial;
  categories: BankCategoryOpt[];
  bankLedgers: LedgerOpt[];   // ledgers tagged as Bank / Cash
  allLedgers: LedgerOpt[];    // every active ledger, for the "other side"
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'neft',       label: 'NEFT'       },
  { value: 'rtgs',       label: 'RTGS'       },
  { value: 'imps',       label: 'IMPS'       },
  { value: 'upi',        label: 'UPI'        },
  { value: 'cheque',     label: 'Cheque'     },
  { value: 'cash',       label: 'Cash'       },
  { value: 'auto_debit', label: 'Auto-debit' },
  { value: 'other',      label: 'Other'      },
];

export function BankEntryForm({ initial, categories, bankLedgers, allLedgers }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof initial?.id === 'number';

  const [form, setForm] = useState({
    entry_date: initial?.entry_date ?? todayISO(),
    direction: (initial?.direction ?? 'out') as 'in' | 'out',
    amount: initial?.amount != null ? String(initial.amount) : '',
    bank_ledger_id: initial?.bank_ledger_id != null ? String(initial.bank_ledger_id) : '',
    other_ledger_id: initial?.other_ledger_id != null ? String(initial.other_ledger_id) : '',
    category_id: initial?.category_id != null ? String(initial.category_id) : '',
    mode: initial?.mode ?? 'neft',
    reference: initial?.reference ?? '',
    notes: initial?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Categories filtered to the picked direction.
  const validCategories = useMemo<BankCategoryOpt[]>(() => {
    return categories.filter((c) =>
      c.direction === 'both'
      || (form.direction === 'in'  && c.direction === 'in_only')
      || (form.direction === 'out' && c.direction === 'out_only'),
    );
  }, [categories, form.direction]);

  // When direction flips, clear the category if it's no longer valid.
  useEffect(() => {
    if (form.category_id === '') return;
    const cur = categories.find((c) => c.id === Number(form.category_id));
    if (!cur) return;
    const stillValid = cur.direction === 'both'
      || (form.direction === 'in'  && cur.direction === 'in_only')
      || (form.direction === 'out' && cur.direction === 'out_only');
    if (!stillValid) setForm((f) => ({ ...f, category_id: '' }));
  }, [form.direction, form.category_id, categories]);

  const pickedCat = categories.find((c) => c.id === Number(form.category_id));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    // Validation
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Amount must be a positive number.'); return; }
    if (form.bank_ledger_id === '') { setError('Pick the bank / cash account.'); return; }
    if (form.category_id === '')    { setError('Pick a category.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const payload = {
      entry_date: form.entry_date,
      direction: form.direction,
      amount,
      bank_ledger_id: Number(form.bank_ledger_id),
      other_ledger_id: form.other_ledger_id === '' ? null : Number(form.other_ledger_id),
      category_id: Number(form.category_id),
      mode: form.mode,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (isEdit && initial?.id != null) {
      const { error: err } = await sb.from('bank_entry').update(payload).eq('id', initial.id);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setOkMsg('Saved.');
      router.refresh();
    } else {
      const { error: err } = await sb.from('bank_entry').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      router.push('/app/bank-entries');
      router.refresh();
    }
  }

  async function onCancelEntry(): Promise<void> {
    if (!isEdit || initial?.id == null) return;
    if (!window.confirm('Cancel this bank entry? Status flips to "cancelled" — the row stays in the audit log but is hidden from the list.')) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('bank_entry').update({ status: 'cancelled' }).eq('id', initial.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push('/app/bank-entries');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-5 space-y-4">
      {/* Header strip with category badge */}
      {pickedCat && (
        <div className={
          'p-3 rounded-lg text-xs font-semibold ' +
          (pickedCat.pl_treatment === 'expense'  ? 'bg-rose-50 text-rose-800 border border-rose-200'
           : pickedCat.pl_treatment === 'income' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                                  : 'bg-slate-50 text-slate-700 border border-slate-200')
        }>
          {pickedCat.name} · {pickedCat.pl_treatment === 'expense' ? 'Reduces profit on the P&L'
                              : pickedCat.pl_treatment === 'income' ? 'Adds to P&L income'
                              : 'Balance-sheet movement only (does NOT affect P&L)'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Date *</label>
          <input type="date" required value={form.entry_date}
            onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
            className="input" />
        </div>
        <div>
          <label className="label">Direction *</label>
          <select className="input" value={form.direction}
            onChange={(e) => setForm({ ...form, direction: e.target.value as 'in' | 'out' })}>
            <option value="out">OUT (money paid)</option>
            <option value="in">IN (money received)</option>
          </select>
        </div>
        <div>
          <label className="label">Amount (₹) *</label>
          <input type="number" required min={0.01} step={0.01}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="input num text-right" placeholder="0.00" />
        </div>
      </div>

      <div>
        <label className="label">Category *</label>
        <select className="input" required value={form.category_id}
          onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
          <option value="">--- pick a category ---</option>
          {validCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{' '}
              ({c.pl_treatment === 'expense' ? 'Expense' : c.pl_treatment === 'income' ? 'Income' : 'Balance sheet'})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Bank / Cash account *</label>
          <select className="input" required value={form.bank_ledger_id}
            onChange={(e) => setForm({ ...form, bank_ledger_id: e.target.value })}>
            <option value="">--- pick a bank or cash ledger ---</option>
            {bankLedgers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-ink-mute mt-1">
            Only ledgers tagged as Bank / Cash type show here.
          </p>
        </div>
        <div>
          <label className="label">Other ledger (the &ldquo;against&rdquo; side)</label>
          <select className="input" value={form.other_ledger_id}
            onChange={(e) => setForm({ ...form, other_ledger_id: e.target.value })}>
            <option value="">--- optional ---</option>
            {allLedgers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}{l.type_name ? ` · ${l.type_name}` : ''}</option>
            ))}
          </select>
          <p className="text-[10px] text-ink-mute mt-1">
            E.g. for EB bill → &ldquo;EB Expense&rdquo;; for Loan EMI → &ldquo;Loan A/c&rdquo;; for Cash Withdraw → &ldquo;Cash in Hand&rdquo;.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Mode *</label>
          <select className="input" value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Reference (Cheque #, UTR, TXN id)</label>
          <input type="text" value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            className="input" placeholder="optional" />
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea value={form.notes} rows={2}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="input" placeholder="optional" />
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-50 text-rose-800 text-sm">{error}</div>}
      {okMsg && <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm">{okMsg}</div>}

      <div className="flex justify-between gap-2 pt-2">
        <div>
          {isEdit && (
            <button type="button" onClick={onCancelEntry} disabled={busy}
              className="btn-ghost text-rose-700 text-xs"
              title="Soft-cancel: status='cancelled'. The row stays for audit.">
              <Trash2 className="w-3.5 h-3.5" /> Cancel entry
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.push('/app/bank-entries')} className="btn-secondary">Back</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save changes' : 'Record entry'}
          </button>
        </div>
      </div>
    </form>
  );
}
