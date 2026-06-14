'use client';
/**
 * Sizing Payment tab. Lists every sizing bill (one row per
 * sizing_job with a bill_no) with its paid + balance + status pill.
 *
 * "Record payment" is now a deep-link to the unified Payments page
 * (/app/payments?party=X&direction=out). Migration 165 added
 * sizing_job.party_id (backfilled by joining the bill's
 * sizing_ledger -> party by name) and a payment_sizing_allocation
 * table whose trigger keeps sizing_job.amount_paid in sync. So the
 * sizing bill appears in the Payments page "Unpaid bills" list, the
 * operator ticks it, saves, and the status pill on this page
 * updates automatically.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Wallet, ArrowUpRight } from 'lucide-react';

interface BillRow {
  id: number;                 // sizing_job.id
  job_code: string;
  bill_no: string;
  bill_date: string | null;
  total_amount: number | string;
  amount_paid: number | string;
  charges_amount: number | string;
  gst_pct: number | string;
  sizing_vendor_name: string | null;
  party_id: number | null;    // linked party for the "Record payment" deep-link
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

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const [billRes, payRes] = await Promise.all([
      sb.from('sizing_job')
        .select(`
          id, job_code, bill_no, bill_date,
          total_amount, amount_paid, charges_amount, gst_pct,
          party_id,
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
    ]);

    if (billRes.error) { setError(billRes.error.message); setLoading(false); return; }

    setBills(((billRes.data ?? []) as Array<{
      id: number; job_code: string; bill_no: string; bill_date: string | null;
      total_amount: number | string; amount_paid: number | string;
      charges_amount: number | string; gst_pct: number | string;
      party_id: number | null;
      sizing_vendor: { name: string } | null;
    }>).map((r) => ({
      id:                 r.id,
      job_code:           r.job_code,
      bill_no:            r.bill_no,
      bill_date:          r.bill_date,
      total_amount:       r.total_amount,
      amount_paid:        r.amount_paid,
      charges_amount:     r.charges_amount,
      gst_pct:            r.gst_pct,
      party_id:           r.party_id ?? null,
      sizing_vendor_name: r.sizing_vendor?.name ?? null,
    })));
    setPayments(((payRes.data ?? []) as PaymentRow[]) ?? []);
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

  // sizing_job.amount_paid is now maintained by triggers
  // (fn_psa_recalc_paid on payment_sizing_allocation, and a parallel
  // trigger fn_payment_resync_sizing_paid on the payment table for
  // legacy direct rows) — so we use it as the source of truth instead
  // of summing payments client-side.
  function statusFor(total: number, paid: number): Status {
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
      paid   += Number(b.amount_paid ?? 0);
    }
    return { billed, paid, due: billed - paid };
  }, [bills]);

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
              const paid  = Number(b.amount_paid ?? 0);
              const bal   = total - paid;
              const st    = statusFor(total, paid);
              const history = paymentsByBill.get(b.id) ?? [];
              // Deep-link to the unified Payments page pre-selecting
              // this bill's party (sizing mill) on the outflow side.
              // The Unpaid bills list there will surface this bill
              // (and any other unpaid bills of the same party) for
              // tick-and-adjust. amount_paid + the status pill update
              // automatically once the operator saves the payment,
              // because migration 165's allocation triggers keep
              // sizing_job.amount_paid in sync.
              const payHref = b.party_id != null
                ? `/app/payments?party=${b.party_id}&direction=out`
                : null;
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
                      ) : payHref ? (
                        <Link
                          href={payHref}
                          className="btn-primary text-xs py-1 px-3 inline-flex items-center gap-1"
                          title="Open the Payments page with this sizing mill pre-selected"
                        >
                          Record payment <ArrowUpRight className="w-3 h-3" />
                        </Link>
                      ) : (
                        <span
                          className="text-amber-700 text-[11px]"
                          title="This sizing job has no party_id — open it once and re-save to link the sizing mill to a party."
                        >
                          No party linked
                        </span>
                      )}
                    </td>
                  </tr>

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
