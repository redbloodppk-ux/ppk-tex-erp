'use client';
/**
 * Sizing Payment tab. Mirrors the JobworkPaymentTab concept but
 * against sizing bills (which live on sizing_job rows, not invoices).
 *
 * Each row is one sizing bill. We show:
 *   - bill no + date
 *   - sizing mill (the ledger linked to the job)
 *   - total amount (rounded to whole rupees by the bill flow)
 *   - paid total (sum of payment rows linked via sizing_job_id)
 *   - balance + payment status pill
 *
 * Inline "Record payment" form per row inserts into the public.payment
 * table with sizing_job_id = the bill's job id (migration 118). The
 * existing /app/payments page also picks these up because they share
 * the same payment table.
 *
 * Bank-mode payments must choose a Bank ledger; cash-mode payments
 * leave ledger_id null.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, X, Save, Wallet } from 'lucide-react';

interface BillRow {
  id: number;                 // sizing_job.id
  job_code: string;
  bill_no: string;
  bill_date: string | null;
  total_amount: number | string;
  charges_amount: number | string;
  gst_pct: number | string;
  sizing_vendor_name: string | null;
}

interface PaymentRow {
  id: number;
  payment_no: string;
  sizing_job_id: number | null;
  amount: number | string;
  payment_date: string;
  mode: string;
  reference: string | null;
  ledger_id: number | null;
}

interface LedgerOpt { id: number; name: string }

type Status = 'unpaid' | 'partial' | 'paid';

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}
function fmtRs(v: unknown): string {
  return 'Rs ' + Math.round(Number(v ?? 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_STYLE: Record<Status, string> = {
  unpaid:  'bg-rose-50 text-rose-700',
  partial: 'bg-amber-50 text-amber-700',
  paid:    'bg-emerald-50 text-emerald-700',
};

export function SizingPaymentTab(): React.ReactElement {
  const supabase = createClient();
  const [loading, setLoading]   = useState<boolean>(true);
  const [error,   setError]     = useState<string | null>(null);
  const [bills,   setBills]     = useState<BillRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [bankLedgers, setBankLedgers] = useState<LedgerOpt[]>([]);

  // Inline payment-entry state.
  const [openFor,  setOpenFor]  = useState<number | null>(null);
  const [pDate,    setPDate]    = useState<string>(todayISO());
  const [pMode,    setPMode]    = useState<'cash' | 'bank'>('cash');
  const [pAmount,  setPAmount]  = useState<string>('');
  const [pRef,     setPRef]     = useState<string>('');
  const [pLedger,  setPLedger]  = useState<string>('');
  const [busy,     setBusy]     = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const [billRes, payRes, ledgerRes] = await Promise.all([
      sb.from('sizing_job')
        .select(`
          id, job_code, bill_no, bill_date,
          total_amount, charges_amount, gst_pct,
          sizing_vendor:sizing_ledger_id ( name )
        `)
        .not('bill_no', 'is', null)
        .order('bill_date', { ascending: false, nullsFirst: false })
        .order('id',        { ascending: false }),
      sb.from('payment')
        .select('id, payment_no, sizing_job_id, amount, payment_date, mode, reference, ledger_id')
        .not('sizing_job_id', 'is', null)
        .order('payment_date', { ascending: false })
        .order('id',           { ascending: false }),
      sb.from('ledger')
        .select('id, name, ledger_type:ledger_type_id ( name )'),
    ]);

    if (billRes.error) { setError(billRes.error.message); setLoading(false); return; }

    setBills(((billRes.data ?? []) as Array<{
      id: number; job_code: string; bill_no: string; bill_date: string | null;
      total_amount: number | string; charges_amount: number | string; gst_pct: number | string;
      sizing_vendor: { name: string } | null;
    }>).map((r) => ({
      id:                 r.id,
      job_code:           r.job_code,
      bill_no:            r.bill_no,
      bill_date:          r.bill_date,
      total_amount:       r.total_amount,
      charges_amount:     r.charges_amount,
      gst_pct:            r.gst_pct,
      sizing_vendor_name: r.sizing_vendor?.name ?? null,
    })));
    setPayments(((payRes.data ?? []) as PaymentRow[]) ?? []);

    const banks: LedgerOpt[] = ((ledgerRes.data ?? []) as Array<{ id: number; name: string; ledger_type: { name: string } | null }>)
      .filter((l) => (l.ledger_type?.name ?? '').toLowerCase().startsWith('bank'))
      .map((l) => ({ id: l.id, name: l.name }));
    setBankLedgers(banks);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const paymentsByBill = useMemo<Map<number, PaymentRow[]>>(() => {
    const m = new Map<number, PaymentRow[]>();
    for (const p of payments) {
      if (p.sizing_job_id == null) continue;
      const arr = m.get(p.sizing_job_id) ?? [];
      arr.push(p);
      m.set(p.sizing_job_id, arr);
    }
    return m;
  }, [payments]);

  function paidTotal(billId: number): number {
    const ps = paymentsByBill.get(billId) ?? [];
    return ps.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  }

  function statusFor(billId: number, total: number): Status {
    const paid = paidTotal(billId);
    if (paid <= 0) return 'unpaid';
    // 10-rupee tolerance — covers the "bill 610, received 600 → full"
    // case the existing jobwork flow uses.
    if (total - paid <= 10) return 'paid';
    return 'partial';
  }

  const totals = useMemo(() => {
    let billed = 0, paid = 0;
    for (const b of bills) {
      billed += Number(b.total_amount ?? 0);
      paid   += paidTotal(b.id);
    }
    return { billed, paid, due: billed - paid };
  }, [bills, paymentsByBill]); // eslint-disable-line react-hooks/exhaustive-deps

  function openRecord(billId: number, defaultAmount: number): void {
    setOpenFor(billId);
    setPDate(todayISO());
    setPMode('cash');
    setPAmount(defaultAmount > 0 ? String(Math.round(defaultAmount)) : '');
    setPRef('');
    setPLedger('');
    setError(null);
  }

  async function handleSave(billId: number): Promise<void> {
    setError(null);
    const amt = num(pAmount);
    if (amt <= 0) { setError('Enter a positive amount.'); return; }
    if (pMode === 'bank' && pLedger === '') { setError('Pick a bank account.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // payment_no is NOT NULL. We mirror the jobwork pattern until a
    // doc_sequence row is set up for sizing payments.
    const stamp = Date.now().toString().slice(-6);
    const paymentNo = 'SPAY-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + stamp;
    const payload = {
      payment_no:    paymentNo,
      direction:     'out',                // we're paying the sizing mill
      invoice_id:    null,
      sizing_job_id: billId,
      amount:        Math.round(amt * 100) / 100,
      payment_date:  pDate,
      mode:          pMode,
      reference:     pRef || null,
      ledger_id:     pMode === 'bank' && pLedger !== '' ? Number(pLedger) : null,
    };
    const { error: err } = await sb.from('payment').insert(payload);
    if (err) { setBusy(false); setError(err.message); return; }

    setBusy(false);
    setOpenFor(null);
    void load();
  }

  async function handleDelete(paymentId: number): Promise<void> {
    if (!window.confirm('Delete this payment? This will restore the balance on the bill.')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('payment').delete().eq('id', paymentId);
    if (err) { setError(err.message); return; }
    void load();
  }

  // ── Render ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading sizing payments…
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total billed</div>
          <div className="num text-xl font-bold">{fmtRs(totals.billed)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total paid</div>
          <div className="num text-xl font-bold text-emerald-700">{fmtRs(totals.paid)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Balance due</div>
          <div className={'num text-xl font-bold ' + (totals.due > 0 ? 'text-rose-700' : 'text-emerald-700')}>
            {fmtRs(totals.due)}
          </div>
        </div>
      </div>

      {error && <div className="card p-3 mb-3 text-err text-sm">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-3">Bill No</th>
              <th className="text-left  px-3 py-3">Bill Date</th>
              <th className="text-left  px-3 py-3">Sizing Mill</th>
              <th className="text-left  px-3 py-3 hidden md:table-cell">Job</th>
              <th className="text-right px-3 py-3">Total</th>
              <th className="text-right px-3 py-3">Paid</th>
              <th className="text-right px-3 py-3">Balance</th>
              <th className="text-left  px-3 py-3">Status</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {bills.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-ink-soft">
                  No sizing bills to pay yet. Bills appear here once a sizing job is saved with a bill no.
                </td>
              </tr>
            ) : bills.map((b) => {
              const total = Number(b.total_amount ?? 0);
              const paid  = paidTotal(b.id);
              const bal   = total - paid;
              const st    = statusFor(b.id, total);
              const isOpen = openFor === b.id;
              const history = paymentsByBill.get(b.id) ?? [];
              return (
                <React.Fragment key={b.id}>
                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{b.bill_no}</td>
                    <td className="px-3 py-2 text-ink-soft text-xs">{fmtDate(b.bill_date)}</td>
                    <td className="px-3 py-2">{b.sizing_vendor_name ?? '—'}</td>
                    <td className="px-3 py-2 hidden md:table-cell font-mono text-xs text-ink-soft">{b.job_code}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtRs(total)}</td>
                    <td className="px-3 py-2 text-right num text-emerald-700">{fmtRs(paid)}</td>
                    <td className={'px-3 py-2 text-right num font-semibold ' + (bal > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                      {fmtRs(bal)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={'pill ' + STATUS_STYLE[st]}>{st}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {st === 'paid' ? (
                        <span className="text-emerald-700 text-xs inline-flex items-center gap-1">
                          <Wallet className="w-3 h-3" /> Settled
                        </span>
                      ) : isOpen ? (
                        <button
                          type="button"
                          onClick={() => setOpenFor(null)}
                          className="btn-ghost text-xs inline-flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openRecord(b.id, bal)}
                          className="btn-primary text-xs py-1 px-3 inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Record payment
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Inline payment-entry form */}
                  {isOpen && (
                    <tr className="bg-indigo-50/30">
                      <td colSpan={9} className="px-3 py-3">
                        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                          <div>
                            <label className="label text-[10px]">Date</label>
                            <input type="date" className="input h-8 text-xs" value={pDate} onChange={(e) => setPDate(e.target.value)} />
                          </div>
                          <div>
                            <label className="label text-[10px]">Amount (Rs)</label>
                            <input type="number" step={1} min={0} className="input num h-8 text-xs" value={pAmount} onChange={(e) => setPAmount(e.target.value)} />
                          </div>
                          <div>
                            <label className="label text-[10px]">Mode</label>
                            <select
                              value={pMode}
                              onChange={(e) => setPMode(e.target.value as 'cash' | 'bank')}
                              className="input h-8 text-xs"
                            >
                              <option value="cash">Cash</option>
                              <option value="bank">Bank</option>
                            </select>
                          </div>
                          {pMode === 'bank' && (
                            <div className="sm:col-span-2">
                              <label className="label text-[10px]">Bank ledger</label>
                              <select
                                value={pLedger}
                                onChange={(e) => setPLedger(e.target.value)}
                                className="input h-8 text-xs"
                              >
                                <option value="">Select bank…</option>
                                {bankLedgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </select>
                            </div>
                          )}
                          <div className={pMode === 'bank' ? '' : 'sm:col-span-2'}>
                            <label className="label text-[10px]">Reference</label>
                            <input className="input h-8 text-xs" value={pRef} onChange={(e) => setPRef(e.target.value)} placeholder="UTR / cheque no" />
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => void handleSave(b.id)}
                              disabled={busy}
                              className="btn-primary text-xs py-1 px-3 inline-flex items-center gap-1 w-full justify-center"
                            >
                              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* History of prior payments — read-only */}
                  {history.length > 0 && (
                    <tr className="bg-cloud/30">
                      <td colSpan={9} className="px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-ink-mute mb-1">
                          Payment history ({history.length})
                        </div>
                        <ul className="space-y-0.5 text-xs">
                          {history.map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center gap-3">
                              <span className="font-mono text-ink-soft">{p.payment_no}</span>
                              <span>{fmtDate(p.payment_date)}</span>
                              <span className="capitalize">{p.mode}</span>
                              {p.reference && <span className="text-ink-mute">· {p.reference}</span>}
                              <span className="font-semibold num">{fmtRs(p.amount)}</span>
                              <button
                                type="button"
                                onClick={() => void handleDelete(p.id)}
                                className="text-rose-700 hover:text-rose-900 ml-auto text-[10px] underline"
                              >
                                Delete
                              </button>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
