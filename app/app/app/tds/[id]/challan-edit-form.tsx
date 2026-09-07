'use client';
/**
 * View and correct one TDS challan row.
 *
 * PPK, 2026-09-07: "we need view and edit option for challan". Until now a
 * challan could only be entered, never opened again — and on 7 Sep the same
 * August payment was saved twice, nineteen seconds apart, with no way to fix
 * it from the app. Removing the duplicate took a database migration.
 *
 * Deleting is offered here too, for exactly that case, and it asks first:
 * a challan row is the record of money sent to the government, so it should
 * be harder to lose than a typo.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, Trash2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export interface ChallanRow {
  id: number;
  period_month: string;
  amount: number;
  interest_amount: number;
  paid_date: string;
  challan_no: string | null;
  notes: string | null;
  source_ledger_id: number | null;
}

export interface LedgerOption { id: number; name: string }

interface Props {
  challan: ChallanRow;
  ledgers: LedgerOption[];
  /** Tax withheld in that month, for the "does this look right" line. */
  withheldThatMonth: number;
  monthLabel: string;
}

export function ChallanEditForm({
  challan, ledgers, withheldThatMonth, monthLabel,
}: Props): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();

  const [amount, setAmount] = useState(String(challan.amount ?? ''));
  const [interest, setInterest] = useState(String(challan.interest_amount ?? '0'));
  const [paidDate, setPaidDate] = useState(challan.paid_date ?? '');
  const [challanNo, setChallanNo] = useState(challan.challan_no ?? '');
  const [ledgerId, setLedgerId] = useState(
    challan.source_ledger_id != null ? String(challan.source_ledger_id) : '');
  const [notes, setNotes] = useState(challan.notes ?? '');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amt = Number(amount);
  // The portal takes whole rupees, so a month is settled within a rupee.
  // See TDS_SETTLED_TOLERANCE in lib/tds/liability.
  const shortfall = withheldThatMonth - amt;
  const looksShort = Number.isFinite(amt) && shortfall >= 1;
  const looksOver = Number.isFinite(amt) && shortfall <= -1;

  async function save(): Promise<void> {
    setError(null);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter the challan amount.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
      setError('Enter the date the challan was paid.');
      return;
    }
    setBusy('save');
    const { data: { user } } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('tds_payment')
      .update({
        amount: amt,
        interest_amount: Number(interest) || 0,
        paid_date: paidDate,
        challan_no: challanNo.trim() || null,
        source_ledger_id: ledgerId ? Number(ledgerId) : null,
        notes: notes.trim() || null,
        updated_by: user?.id ?? null,
      })
      .eq('id', challan.id);
    setBusy(null);
    if (upErr) { setError(upErr.message); return; }
    router.push('/app/tds');
    router.refresh();
  }

  async function remove(): Promise<void> {
    const ok = window.confirm(
      `Delete this challan?\n\n` +
      `${monthLabel} · ${challan.challan_no ?? 'no number'} · Rs ${challan.amount}\n\n` +
      `The month will go back to showing this tax as unpaid. Only do this ` +
      `for a duplicate or a row entered by mistake.`,
    );
    if (!ok) return;
    setBusy('delete');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delErr } = await (supabase as any)
      .from('tds_payment').delete().eq('id', challan.id);
    setBusy(null);
    if (delErr) { setError(delErr.message); return; }
    router.push('/app/tds');
    router.refresh();
  }

  return (
    <div className="card p-5 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{monthLabel}</div>
          <div className="text-[11px] text-ink-mute">
            Tax withheld that month:{' '}
            <span className="num">{withheldThatMonth.toFixed(2)}</span>
          </div>
        </div>
        <Link href="/app/tds" className="btn-ghost h-9">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="ch-amount">Challan amount (Rs) *</label>
          <input id="ch-amount" type="number" step="0.01" min="0" className="input num"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
          {/* The portal only takes whole rupees, so a difference under a
              rupee is not worth reporting — it cannot be paid either way. */}
          {looksShort && (
            <p className="mt-1 text-[11px] text-amber-700">
              Rs {shortfall.toFixed(2)} less than the tax withheld that month.
              The balance will keep showing as owed.
            </p>
          )}
          {looksOver && (
            <p className="mt-1 text-[11px] text-ink-mute">
              Rs {Math.abs(shortfall).toFixed(2)} more than the tax withheld
              that month.
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="ch-interest">Interest paid (Rs)</label>
          <input id="ch-interest" type="number" step="0.01" min="0" className="input num"
            value={interest} onChange={(e) => setInterest(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ch-date">Paid on *</label>
          <input id="ch-date" type="date" className="input"
            value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ch-no">Challan number</label>
          <input id="ch-no" className="input font-mono"
            value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ch-ledger">Paid from</label>
          <select id="ch-ledger" className="input"
            value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
            <option value="">— not recorded —</option>
            {ledgers.map((l) => (
              <option key={l.id} value={String(l.id)}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ch-notes">Notes</label>
          <input id="ch-notes" className="input" placeholder="CIN, or anything worth remembering"
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={save} disabled={busy !== null} className="btn-primary">
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save changes
        </button>
        <button type="button" onClick={remove} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
          {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Delete challan
        </button>
      </div>
    </div>
  );
}
