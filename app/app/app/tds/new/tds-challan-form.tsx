'use client';

/**
 * Record a TDS challan, covering one month or several.
 *
 * WHY TICK BOXES RATHER THAN A DROPDOWN
 * One portal payment often clears more than one month — three overdue
 * months get paid together. A single-select forced three separate entries
 * and three chances to mistype the challan number.
 *
 * WHY IT STILL WRITES ONE ROW PER MONTH
 * The liability is per month: April's tax has its own deadline, its own
 * interest clock and its own line in the return. A single row spanning
 * "April to June" could never say how much of it settled April, so no
 * month could ever be marked paid on its own. The challan number is what
 * ties the rows together — same reference on each, which is also how the
 * portal receipt reads.
 *
 * Amounts stay editable per month. The portal receipt is the source of
 * truth, and a part payment against one month while another is settled in
 * full is perfectly ordinary.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, ExternalLink } from 'lucide-react';

export interface MonthOption {
  month: string;
  label: string;
  outstanding: number;
  interest: number;
  dueDate: string;
  interestMonths: number;
  financialYear: string;
  assessmentYear: string;
}

/** Pre-login e-Pay Tax on the Income Tax portal. */
const EPAY_URL =
  'https://eportal.incometax.gov.in/iec/foservices/#/e-pay-tax-prelogin/user-details';

export interface LedgerOption { id: number; name: string }

interface Line { checked: boolean; amount: string; interest: string }

const money = (n: number): string =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TdsChallanForm({
  months, ledgers, preselectMonth, today, tan,
}: {
  months: MonthOption[];
  ledgers: LedgerOption[];
  preselectMonth: string | null;
  today: string;
  tan: string | null;
}): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();

  const [lines, setLines] = useState<Record<string, Line>>(() => {
    const out: Record<string, Line> = {};
    for (const m of months) {
      // Arriving from a "Pay →" link ticks that month; otherwise nothing is
      // ticked, so a stray Save cannot record a payment never made.
      const on = preselectMonth === m.month;
      out[m.month] = {
        checked: on,
        amount: String(m.outstanding),
        interest: m.interest > 0 ? String(m.interest) : '',
      };
    }
    return out;
  });

  const [paidDate, setPaidDate] = useState(today);
  const [challanNo, setChallanNo] = useState('');
  const [ledgerId, setLedgerId] = useState<string>(ledgers[0] ? String(ledgers[0].id) : '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = useMemo(
    () => months.filter((m) => lines[m.month]?.checked),
    [months, lines],
  );

  const totals = useMemo(() => {
    let tax = 0, int = 0;
    for (const m of picked) {
      const l = lines[m.month];
      tax += Number(l?.amount ?? 0) || 0;
      int += Number(l?.interest ?? 0) || 0;
    }
    return { tax, int, all: tax + int };
  }, [picked, lines]);

  function setLine(month: string, patch: Partial<Line>): void {
    setLines((prev) => ({ ...prev, [month]: { ...(prev[month] as Line), ...patch } }));
    setError(null);
  }

  function toggleAll(on: boolean): void {
    setLines((prev) => {
      const next = { ...prev };
      for (const m of months) next[m.month] = { ...(next[m.month] as Line), checked: on };
      return next;
    });
    setError(null);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (picked.length === 0) { setError('Tick at least one month.'); return; }
    if (!paidDate) { setError('Enter the date it was paid.'); return; }

    // Validate every line before writing any of them — a challan that
    // settles two months and fails on the third would leave the liability
    // half-corrected with no sign of it.
    const rows: Array<{ month: string; amount: number; interest: number }> = [];
    for (const m of picked) {
      const l = lines[m.month] as Line;
      const amt = Number(l.amount);
      const int = l.interest === '' ? 0 : Number(l.interest);
      if (!Number.isFinite(amt) || amt <= 0) {
        setError(`${m.label}: amount must be more than zero.`); return;
      }
      if (!Number.isFinite(int) || int < 0) {
        setError(`${m.label}: interest must be zero or more.`); return;
      }
      if (amt > m.outstanding + 0.005) {
        setError(
          `${m.label}: ₹${money(amt)} is more than the ₹${money(m.outstanding)} owed. ` +
          'Put the tax here and the interest in its own box.',
        );
        return;
      }
      rows.push({ month: m.month, amount: amt, interest: int });
    }

    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase as any).from('tds_payment').insert(
      rows.map((r) => ({
        period_month: r.month,
        amount: r.amount,
        interest_amount: r.interest,
        paid_date: paidDate,
        challan_no: challanNo.trim() || null,
        source_ledger_id: ledgerId ? Number(ledgerId) : null,
        notes: notes.trim() || null,
        created_by: user?.id ?? null,
      })),
    );
    setBusy(false);
    if (insErr) { setError(insErr.message); return; }
    router.push('/app/tds');
    router.refresh();
  }

  if (months.length === 0) {
    return (
      <div className="card p-5 max-w-2xl">
        <p className="text-sm text-ink-soft">
          Nothing is owed — every month of withheld tax has been remitted.
        </p>
      </div>
    );
  }

  const allOn = months.every((m) => lines[m.month]?.checked);

  // The portal asks for one assessment year per challan. Months from two
  // different financial years cannot share one, so say so rather than let
  // the payment be parked against the wrong year.
  const years = Array.from(new Set(picked.map((m) => m.assessmentYear)));
  const mixedYears = years.length > 1;

  return (
    <form onSubmit={submit} className="card p-5 space-y-4 max-w-2xl">
      {/* Pay first, record second. The details below are what the portal
          asks for, taken from the months ticked — so they can be read off
          rather than remembered. */}
      <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-indigo-900">
            Not paid yet? Pay on the Income Tax portal first
          </span>
          <a
            href={EPAY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
          >
            e-Pay Tax <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ink-mute">TAN</dt>
            <dd className="num font-semibold">{tan ?? 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-ink-mute">Assessment year</dt>
            <dd className="num font-semibold">
              {picked.length === 0 ? '—' : years.join(' + ')}
            </dd>
          </div>
          <div>
            <dt className="text-ink-mute">Amount</dt>
            <dd className="num font-semibold">
              {picked.length === 0 ? '—' : `₹${money(totals.all)}`}
            </dd>
          </div>
          <div>
            <dt className="text-ink-mute">Major head</dt>
            <dd>0021 &mdash; other than companies</dd>
          </div>
          <div>
            <dt className="text-ink-mute">Minor head</dt>
            <dd>200 &mdash; TDS payable by taxpayer</dd>
          </div>
          <div>
            <dt className="text-ink-mute">Nature of payment</dt>
            <dd>94C &mdash; contractors</dd>
          </div>
        </dl>
        {mixedYears && (
          <p className="mt-2 text-xs font-semibold text-amber-800">
            These months fall in different assessment years. The portal takes one
            year per challan, so pay them as separate challans.
          </p>
        )}
        <p className="mt-2 text-[11px] text-indigo-900/70">
          Enter tax and interest in their own boxes on the portal too &mdash; the
          receipt itemises them, and so does this form.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="label mb-0">Months covered by this challan</span>
          <button
            type="button"
            className="text-xs text-indigo font-semibold"
            onClick={() => toggleAll(!allOn)}
          >
            {allOn ? 'Clear all' : 'Select all'}
          </button>
        </div>

        <div className="rounded-md border border-line divide-y divide-line/60">
          {months.map((m) => {
            const l = lines[m.month] as Line;
            return (
              <div key={m.month} className="p-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-indigo-600"
                    checked={l.checked}
                    onChange={(e) => setLine(m.month, { checked: e.target.checked })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{m.label}</span>
                      <span className="num text-sm">₹{money(m.outstanding)}</span>
                      {m.interest > 0 && (
                        <span className="num text-xs text-rose-700">
                          + ₹{money(m.interest)} interest
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-ink-mute">
                      Due {m.dueDate}
                      {m.interestMonths > 0
                        ? ` · ${m.interestMonths} month${m.interestMonths === 1 ? '' : 's'} of interest at 1.5%`
                        : ' · not yet overdue'}
                    </span>
                  </span>
                </label>

                {l.checked && (
                  <div className="mt-2 ml-7 grid grid-cols-2 gap-3">
                    <div>
                      <label className="label text-[11px]" htmlFor={`amt-${m.month}`}>
                        TDS paid (₹)
                      </label>
                      <input
                        id={`amt-${m.month}`} type="number" inputMode="decimal"
                        step="0.01" min="0" className="input num h-9"
                        value={l.amount}
                        onChange={(e) => setLine(m.month, { amount: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label text-[11px]" htmlFor={`int-${m.month}`}>
                        Interest paid (₹)
                      </label>
                      <input
                        id={`int-${m.month}`} type="number" inputMode="decimal"
                        step="0.01" min="0" className="input num h-9"
                        value={l.interest} placeholder="0"
                        onChange={(e) => setLine(m.month, { interest: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {picked.length > 0 && (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-cloud/60 px-3 py-2">
            <span className="text-xs text-ink-soft">
              {picked.length} month{picked.length === 1 ? '' : 's'} &middot; tax{' '}
              <span className="num">₹{money(totals.tax)}</span> + interest{' '}
              <span className="num">₹{money(totals.int)}</span>
            </span>
            <span className="num font-semibold">Total ₹{money(totals.all)}</span>
          </div>
        )}
        <p className="text-[11px] text-ink-mute mt-1">
          Amounts are pre-filled and stay editable — the portal receipt is what
          counts. Each month is saved as its own row sharing this challan number,
          so every month settles on its own.
        </p>
      </div>

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
          {picked.length > 1 ? `Save challan for ${picked.length} months` : 'Save challan'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => { router.push('/app/tds'); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
