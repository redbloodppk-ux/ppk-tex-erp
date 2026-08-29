'use client';

/**
 * Record a TDS challan.
 *
 * The amount and interest are pre-filled from whichever month is picked,
 * because those are computed figures the operator should not have to
 * retype — but both stay editable, since the portal receipt is the source
 * of truth and a part payment is legitimate.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

export interface MonthOption {
  month: string;
  label: string;
  outstanding: number;
  interest: number;
  dueDate: string;
  interestMonths: number;
}

export interface LedgerOption { id: number; name: string }

export function TdsChallanForm({
  months, ledgers, preselectMonth, today,
}: {
  months: MonthOption[];
  ledgers: LedgerOption[];
  preselectMonth: string | null;
  today: string;
}): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();

  const initial = preselectMonth && months.some((m) => m.month === preselectMonth)
    ? preselectMonth
    : months[0]?.month ?? '';

  const [month, setMonth] = useState(initial);
  const picked = useMemo(() => months.find((m) => m.month === month) ?? null, [months, month]);

  const [amount, setAmount] = useState<string>(picked ? String(picked.outstanding) : '');
  const [interest, setInterest] = useState<string>(picked && picked.interest > 0 ? String(picked.interest) : '');
  const [paidDate, setPaidDate] = useState(today);
  const [challanNo, setChallanNo] = useState('');
  const [ledgerId, setLedgerId] = useState<string>(ledgers[0] ? String(ledgers[0].id) : '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Re-fill the money fields when the month changes. */
  function pickMonth(next: string): void {
    setMonth(next);
    const m = months.find((x) => x.month === next);
    setAmount(m ? String(m.outstanding) : '');
    setInterest(m && m.interest > 0 ? String(m.interest) : '');
    setError(null);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!month) { setError('Pick the month this challan covers.'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Amount must be more than zero.'); return; }
    const int = interest === '' ? 0 : Number(interest);
    if (!Number.isFinite(int) || int < 0) { setError('Interest must be zero or more.'); return; }
    if (picked && amt > picked.outstanding + 0.005) {
      setError(
        `That is more than the ${picked.label} liability of ₹${picked.outstanding.toFixed(2)}. ` +
        'Enter the tax only here — interest goes in its own field.',
      );
      return;
    }
    if (!paidDate) { setError('Enter the date it was paid.'); return; }

    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase as any).from('tds_payment').insert([{
      period_month: month,
      amount: amt,
      interest_amount: int,
      paid_date: paidDate,
      challan_no: challanNo.trim() || null,
      source_ledger_id: ledgerId ? Number(ledgerId) : null,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    }]);
    setBusy(false);
    if (insErr) { setError(insErr.message); return; }
    router.push('/app/tds');
    router.refresh();
  }

  if (months.length === 0) {
    return (
      <div className="card p-5 max-w-xl">
        <p className="text-sm text-ink-soft">
          Nothing is owed — every month of withheld tax has been remitted. Nothing
          to record.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4 max-w-xl">
      <div>
        <label className="label" htmlFor="month">For month</label>
        <select
          id="month" className="input" value={month}
          onChange={(e) => pickMonth(e.target.value)}
        >
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {m.label} — ₹{m.outstanding.toFixed(2)}
              {m.interest > 0 ? ` + ₹${m.interest.toFixed(2)} interest` : ''}
            </option>
          ))}
        </select>
        {picked && (
          <p className="text-[11px] text-ink-mute mt-1">
            Deducted in {picked.label}, due {picked.dueDate}.
            {picked.interestMonths > 0
              ? ` ${picked.interestMonths} month${picked.interestMonths === 1 ? '' : 's'} of interest at 1.5% have accrued.`
              : ' Not yet overdue.'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="amount">TDS amount (₹)</label>
          <input
            id="amount" type="number" inputMode="decimal" step="0.01" min="0"
            className="input num" value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="interest">Interest (₹)</label>
          <input
            id="interest" type="number" inputMode="decimal" step="0.01" min="0"
            className="input num" value={interest} placeholder="0"
            onChange={(e) => setInterest(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[11px] text-ink-mute -mt-2">
        Both are pre-filled from the month picked, and both stay editable — the
        portal receipt is what counts, and a part payment is allowed.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="paidDate">Paid on</label>
          <input
            id="paidDate" type="date" className="input"
            value={paidDate} onChange={(e) => setPaidDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="challanNo">Challan number</label>
          <input
            id="challanNo" type="text" className="input"
            value={challanNo} onChange={(e) => setChallanNo(e.target.value)}
            placeholder="BSR code / challan reference"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="ledger">Paid from</label>
        <select
          id="ledger" className="input" value={ledgerId}
          onChange={(e) => setLedgerId(e.target.value)}
        >
          {ledgers.length === 0 && <option value="">No cash or bank ledger found</option>}
          {ledgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <input
          id="notes" type="text" className="input"
          value={notes} onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Save challan
        </button>
        <button
          type="button" className="btn-ghost"
          onClick={() => { router.push('/app/tds'); }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
