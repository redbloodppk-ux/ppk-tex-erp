'use client';
/**
 * Jobwork Payment tab. Lists every jobwork bill (invoice.doc_type =
 * 'jobwork_invoice') with the sum of payments already recorded against
 * it, the running balance, and an inline "Record payment" form per row.
 *
 * Payments hit the existing public.payment table:
 *   direction='in', invoice_id=<bill>, mode='cash' | 'bank',
 *   amount, payment_date, reference, ledger_id (bank ledger, optional).
 *
 * Bank ledgers come from the ledger master where ledger_type.name
 * starts with 'Bank' (close enough for an SME chart of accounts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, X, Save, Wallet } from 'lucide-react';

interface BillRow {
  id: number;
  invoice_no: string;
  invoice_date: string;
  total: number | string;
  status: string;
  jobwork_party_id: number | null;
}

interface PaymentRow {
  id: number;
  payment_no: string;
  invoice_id: number | null;
  amount: number | string;
  payment_date: string;
  mode: string;
  reference: string | null;
  ledger_id: number | null;
}

interface PartyOpt { id: number; code: string; name: string }
interface LedgerOpt { id: number; name: string }

interface JobworkPaymentTabProps {
  parties?: ReadonlyArray<PartyOpt>;
  /** Route variant. `outsource` swaps the visible bill noun so the
   *  table says "weaving bills" instead of "jobwork bills". The
   *  underlying invoice doc_type stays `jobwork_invoice` because we
   *  haven't split the bill type at the DB level. */
  kind?: 'jobwork' | 'outsource';
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}
function fmtRs(v: unknown): string {
  return 'Rs ' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function JobworkPaymentTab(props: JobworkPaymentTabProps): React.ReactElement {
  const billLabel: string = props.kind === 'outsource' ? 'weaving bill' : 'jobwork bill';
  const supabase = createClient();
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError]     = useState<string | null>(null);
  const [bills, setBills]     = useState<BillRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [partiesMap, setPartiesMap] = useState<Map<number, string>>(new Map());
  const [bankLedgers, setBankLedgers] = useState<LedgerOpt[]>([]);

  const [openFor, setOpenFor] = useState<number | null>(null);
  const [pDate, setPDate]     = useState<string>(todayISO());
  const [pMode, setPMode]     = useState<'cash' | 'bank'>('cash');
  const [pAmount, setPAmount] = useState<string>('');
  const [pRef, setPRef]       = useState<string>('');
  const [pLedger, setPLedger] = useState<string>('');
  const [busy, setBusy]       = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const [billRes, payRes, partyRes, ledgerRes] = await Promise.all([
      sb.from('invoice')
        .select('id, invoice_no, invoice_date, total, status, jobwork_party_id')
        .eq('doc_type', 'jobwork_invoice')
        .order('invoice_date', { ascending: false })
        .order('id', { ascending: false }),
      sb.from('payment')
        .select('id, payment_no, invoice_id, amount, payment_date, mode, reference, ledger_id')
        .order('payment_date', { ascending: false })
        .order('id', { ascending: false }),
      sb.from('party').select('id, code, name').eq('status', 'active'),
      sb.from('ledger')
        .select('id, name, ledger_type:ledger_type_id ( name )'),
    ]);

    if (billRes.error) { setError(billRes.error.message); setLoading(false); return; }

    setBills((billRes.data ?? []) as BillRow[]);
    setPayments((payRes.data ?? []) as PaymentRow[]);
    const pMap = new Map<number, string>();
    for (const p of ((partyRes.data ?? []) as PartyOpt[])) pMap.set(p.id, p.name);
    setPartiesMap(pMap);
    const banks: LedgerOpt[] = ((ledgerRes.data ?? []) as Array<{ id: number; name: string; ledger_type: { name: string } | null }>)
      .filter((l) => (l.ledger_type?.name ?? '').toLowerCase().startsWith('bank'))
      .map((l) => ({ id: l.id, name: l.name }));
    setBankLedgers(banks);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // Group payments per invoice id for quick balance + history lookup.
  const paymentsByBill = useMemo<Map<number, PaymentRow[]>>(() => {
    const m = new Map<number, PaymentRow[]>();
    for (const p of payments) {
      if (p.invoice_id == null) continue;
      const arr = m.get(p.invoice_id) ?? [];
      arr.push(p);
      m.set(p.invoice_id, arr);
    }
    return m;
  }, [payments]);

  function paidTotal(billId: number): number {
    const ps = paymentsByBill.get(billId) ?? [];
    return ps.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  }

  const totals = useMemo(() => {
    let billed = 0, paid = 0;
    for (const b of bills) {
      billed += Number(b.total ?? 0);
      paid   += paidTotal(b.id);
    }
    return { billed, paid, due: billed - paid };
  }, [bills, paymentsByBill]); // eslint-disable-line react-hooks/exhaustive-deps

  function openRecord(billId: number, defaultAmount: number): void {
    setOpenFor(billId);
    setPDate(todayISO());
    setPMode('cash');
    setPAmount(defaultAmount > 0 ? String(defaultAmount.toFixed(2)) : '');
    setPRef('');
    setPLedger('');
  }

  async function handleSave(billId: number): Promise<void> {
    setError(null);
    const amt = num(pAmount);
    if (amt <= 0) { setError('Enter a positive amount.'); return; }
    if (pMode === 'bank' && pLedger === '') { setError('Pick a bank account.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // payment_no is required NOT NULL on the table. Use a soft-pattern
    // until a doc_sequence row is set up for payments.
    const stamp = Date.now().toString().slice(-6);
    const paymentNo = 'PAY-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + stamp;
    const payload = {
      payment_no: paymentNo,
      direction: 'in',
      invoice_id: billId,
      amount: Math.round(amt * 100) / 100,
      payment_date: pDate,
      mode: pMode,
      reference: pRef || null,
      ledger_id: pMode === 'bank' && pLedger !== '' ? Number(pLedger) : null,
    };
    const { error: err } = await sb.from('payment').insert(payload);
    if (err) { setBusy(false); setError(err.message); return; }

    // ── Auto-update invoice status based on the new paid total ──
    // Threshold rule: if the outstanding balance is LESS THAN Rs 10 we
    // treat the bill as fully paid (covers rounding / cash short-pay
    // tolerances). Anything Rs 10 or above remains 'partial'. Zero
    // payments fall back to whatever status the bill already had.
    try {
      const bill = bills.find((b) => b.id === billId);
      if (bill) {
        const previouslyPaid = paidTotal(billId);
        const newPaid = previouslyPaid + amt;
        const billTotal = Number(bill.total ?? 0);
        const outstanding = billTotal - newPaid;
        // Tolerance: a 10-rupee shortage still counts as fully paid
        // (covers your "bill 610, received 600 -> full" rule).
        let nextStatus: string | null = null;
        if (outstanding <= 10) nextStatus = 'paid';
        else if (newPaid > 0)   nextStatus = 'partial';
        if (nextStatus && nextStatus !== bill.status) {
          await sb.from('invoice')
            .update({
              status: nextStatus,
              amount_paid: Math.round(newPaid * 100) / 100,
            })
            .eq('id', billId);
        } else {
          // Even if status didn't change, keep amount_paid in sync so
          // reports + invoice detail show the right outstanding.
          await sb.from('invoice')
            .update({ amount_paid: Math.round(newPaid * 100) / 100 })
            .eq('id', billId);
        }
      }
    } catch {
      // Status update is best-effort - the payment itself is saved.
    }

    setBusy(false);
    setOpenFor(null);
    await load();
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Bills</div>
          <div className="num text-xl font-bold">{bills.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total billed</div>
          <div className="num text-xl font-bold">{fmtRs(totals.billed)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total received</div>
          <div className="num text-xl font-bold text-emerald-700">{fmtRs(totals.paid)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Balance due</div>
          <div className="num text-xl font-bold text-rose-700">{fmtRs(totals.due)}</div>
        </div>
      </div>

      {error && <div className="card p-3 text-err text-sm">{error}</div>}
      {loading ? (
        <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading payments...
        </div>
      ) : bills.length === 0 ? (
        <div className="card p-6 text-center text-ink-mute text-sm">
          No {billLabel}s yet. Create one from <span className="font-mono">/app/invoices/new/jobwork-bill</span>.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Bill No</th>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Party</th>
                <th className="text-right px-3 py-3">Bill total</th>
                <th className="text-right px-3 py-3">Paid</th>
                <th className="text-right px-3 py-3">Balance</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const paid = paidTotal(b.id);
                const due = Number(b.total ?? 0) - paid;
                const ps = paymentsByBill.get(b.id) ?? [];
                return (
                  <React.Fragment key={b.id}>
                    <tr className="border-t border-line/40">
                      <td className="px-3 py-2 font-mono text-xs">{b.invoice_no}</td>
                      <td className="px-3 py-2 text-ink-soft">{fmtDate(b.invoice_date)}</td>
                      <td className="px-3 py-2 font-medium">
                        {b.jobwork_party_id != null ? (partiesMap.get(b.jobwork_party_id) ?? '-') : '-'}
                      </td>
                      <td className="px-3 py-2 text-right num font-semibold">{fmtRs(b.total)}</td>
                      <td className="px-3 py-2 text-right num text-emerald-700">{fmtRs(paid)}</td>
                      <td className={'px-3 py-2 text-right num font-semibold ' + (due > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                        {fmtRs(due)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {due > 0 && openFor !== b.id && (
                          <button type="button" onClick={() => openRecord(b.id, due)} className="btn-primary text-xs">
                            <Wallet className="w-3.5 h-3.5" /> Record payment
                          </button>
                        )}
                        {openFor === b.id && (
                          <button type="button" onClick={() => setOpenFor(null)} className="btn-secondary text-xs">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Inline Record-payment form */}
                    {openFor === b.id && (
                      <tr className="bg-indigo/5 border-t border-line/40">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="text-[10px] uppercase tracking-wide text-ink-mute">Date</label>
                              <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} className="input py-1 text-xs max-w-[150px]" />
                            </div>
                            <div>
                              <label className="text-[10px] uppercase tracking-wide text-ink-mute">Mode</label>
                              <select value={pMode} onChange={(e) => setPMode(e.target.value as 'cash' | 'bank')} className="input py-1 text-xs max-w-[110px]">
                                <option value="cash">Cash</option>
                                <option value="bank">Bank</option>
                              </select>
                            </div>
                            {pMode === 'bank' && (
                              <div>
                                <label className="text-[10px] uppercase tracking-wide text-ink-mute">Bank account</label>
                                <select value={pLedger} onChange={(e) => setPLedger(e.target.value)} className="input py-1 text-xs min-w-[180px]">
                                  <option value="">Pick bank...</option>
                                  {bankLedgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                                </select>
                                {bankLedgers.length === 0 && (
                                  <div className="text-[10px] text-amber-700 mt-1">
                                    No bank ledgers configured (Admin → Ledgers).
                                  </div>
                                )}
                              </div>
                            )}
                            <div>
                              <label className="text-[10px] uppercase tracking-wide text-ink-mute">Amount</label>
                              <input type="number" step="0.01" value={pAmount} onChange={(e) => setPAmount(e.target.value)} className="input py-1 text-xs num text-right max-w-[140px]" />
                            </div>
                            <div className="flex-1 min-w-[180px]">
                              <label className="text-[10px] uppercase tracking-wide text-ink-mute">Reference (cheque/UTR)</label>
                              <input type="text" value={pRef} onChange={(e) => setPRef(e.target.value)} className="input py-1 text-xs" />
                            </div>
                            <button type="button" onClick={() => void handleSave(b.id)} disabled={busy} className="btn-primary text-xs">
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              Save payment
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Payment history rows */}
                    {ps.length > 0 && (
                      <tr className="bg-cloud/30 border-t border-line/30">
                        <td colSpan={7} className="px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-ink-mute mb-1">Payment history</div>
                          <table className="w-full text-xs">
                            <thead className="text-[10px] text-ink-mute">
                              <tr>
                                <th className="text-left  px-1 py-1">Date</th>
                                <th className="text-left  px-1 py-1">Pay No</th>
                                <th className="text-left  px-1 py-1">Mode</th>
                                <th className="text-left  px-1 py-1">Reference</th>
                                <th className="text-right px-1 py-1">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ps.map((p) => (
                                <tr key={p.id} className="border-t border-line/40">
                                  <td className="px-1 py-1">{fmtDate(p.payment_date)}</td>
                                  <td className="px-1 py-1 font-mono">{p.payment_no}</td>
                                  <td className="px-1 py-1 capitalize">{p.mode}</td>
                                  <td className="px-1 py-1 text-ink-soft">{p.reference ?? '-'}</td>
                                  <td className="px-1 py-1 text-right num font-semibold">{fmtRs(p.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
