'use client';
/**
 * Jobwork "Payment Status" tab. READ-ONLY view of every jobwork /
 * weaving bill (invoice.doc_type = 'jobwork_invoice') with its paid
 * amount, balance and status chip. Paid / balance come straight off
 * the invoice row — the Payments page keeps them in sync via the
 * payment_allocation trigger (bill-to-bill adjustment).
 *
 * Recording a payment is NOT done here any more: the "Record payment"
 * button redirects to /app/payments with the party pre-selected, where
 * the operator can adjust the receipt against the open bills.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Wallet } from 'lucide-react';
import { CardFilter } from '@/app/components/card-filter';

interface BillRow {
  id: number;
  invoice_no: string;
  invoice_date: string;
  total: number | string;
  amount_paid: number | string;
  balance: number | string;
  status: string;
  jobwork_party_id: number | null;
}

/** One row of payment history against a bill — either a legacy payment
 *  stamped directly with invoice_id, or a payment_allocation slice
 *  written from the Payments page. */
interface HistoryRow {
  key: string;
  payment_no: string;
  payment_date: string;
  mode: string | null;
  reference: string | null;
  amount: number;
}

interface PartyOpt { id: number; code: string; name: string }

interface JobworkPaymentTabProps {
  parties?: ReadonlyArray<PartyOpt>;
  /** Route variant. `outsource` swaps the visible bill noun so the
   *  table says "weaving bills" instead of "jobwork bills". */
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

function statusChip(status: string, balance: number): { label: string; cls: string } {
  if (status === 'paid' || balance <= 0) return { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' };
  if (status === 'partial_paid' || status === 'partial') return { label: 'Partial', cls: 'bg-amber-50 text-amber-700' };
  if (status === 'overdue') return { label: 'Overdue', cls: 'bg-rose-50 text-rose-700' };
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'bg-cloud text-ink-mute' };
  return { label: 'Unpaid', cls: 'bg-rose-50 text-rose-700' };
}

export function JobworkPaymentTab(props: JobworkPaymentTabProps): React.ReactElement {
  const billLabel: string = props.kind === 'outsource' ? 'weaving bill' : 'jobwork bill';
  const partyTypeName: 'Outsource Weaver' | 'Jobwork Party' =
    props.kind === 'outsource' ? 'Outsource Weaver' : 'Jobwork Party';
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError]     = useState<string | null>(null);
  const [bills, setBills]     = useState<BillRow[]>([]);
  const [historyByBill, setHistoryByBill] = useState<Map<number, HistoryRow[]>>(new Map());
  const [partiesMap, setPartiesMap] = useState<Map<number, string>>(new Map());

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Resolve party_type so the bills narrow to the right party kind
    // (Jobwork Party vs Outsource Weaver).
    const ptRes = await sb.from('party_type_master').select('id').eq('name', partyTypeName).maybeSingle();
    const partyTypeId: number | null = ptRes.data?.id ?? null;
    let allowedPartyIds: number[] = [];
    if (partyTypeId != null) {
      const apRes = await sb.from('party')
        .select('id, party_type_ids, party_type_id')
        .eq('status', 'active');
      const partyRows = (apRes.data ?? []) as Array<{ id: number; party_type_ids: number[] | null; party_type_id: number | null }>;
      allowedPartyIds = partyRows
        .filter((p) => {
          const ids = Array.isArray(p.party_type_ids) ? p.party_type_ids.map((x) => Number(x)) : [];
          const single = p.party_type_id != null ? Number(p.party_type_id) : null;
          return ids.includes(partyTypeId) || single === partyTypeId;
        })
        .map((p) => p.id);
    }

    const [billRes, payRes, allocRes, partyRes] = await Promise.all([
      sb.from('invoice')
        .select('id, invoice_no, invoice_date, total, amount_paid, balance, status, jobwork_party_id')
        .eq('doc_type', 'jobwork_invoice')
        .order('invoice_date', { ascending: false })
        .order('id', { ascending: false }),
      // Legacy payments recorded directly against the bill.
      sb.from('payment')
        .select('id, payment_no, invoice_id, amount, payment_date, mode, reference')
        .not('invoice_id', 'is', null)
        .eq('status', 'active'),
      // Bill-to-bill slices written from the Payments page.
      sb.from('payment_allocation')
        .select('id, invoice_id, amount, payment:payment_id ( id, payment_no, payment_date, mode, reference, status )'),
      sb.from('party').select('id, code, name').eq('status', 'active'),
    ]);

    if (billRes.error) { setError(billRes.error.message); setLoading(false); return; }

    const allowedSet = new Set<number>(allowedPartyIds);
    const rawBills = (billRes.data ?? []) as BillRow[];
    setBills(partyTypeId == null
      ? rawBills
      : rawBills.filter((b) => b.jobwork_party_id != null && allowedSet.has(b.jobwork_party_id)));

    // Merge both payment sources into one history map per bill.
    const hist = new Map<number, HistoryRow[]>();
    const push = (invoiceId: number, row: HistoryRow): void => {
      const arr = hist.get(invoiceId) ?? [];
      arr.push(row);
      hist.set(invoiceId, arr);
    };
    type LegacyPay = { id: number; payment_no: string; invoice_id: number | null; amount: number | string; payment_date: string; mode: string | null; reference: string | null };
    for (const p of ((payRes.data ?? []) as LegacyPay[])) {
      if (p.invoice_id == null) continue;
      push(p.invoice_id, {
        key: 'p' + String(p.id),
        payment_no: p.payment_no,
        payment_date: p.payment_date,
        mode: p.mode,
        reference: p.reference,
        amount: Number(p.amount ?? 0),
      });
    }
    type AllocRow = { id: number; invoice_id: number; amount: number | string; payment: { id: number; payment_no: string; payment_date: string; mode: string | null; reference: string | null; status: string } | null };
    for (const a of ((allocRes.data ?? []) as AllocRow[])) {
      if (a.payment === null || a.payment.status !== 'active') continue;
      push(a.invoice_id, {
        key: 'a' + String(a.id),
        payment_no: a.payment.payment_no,
        payment_date: a.payment.payment_date,
        mode: a.payment.mode,
        reference: a.payment.reference,
        amount: Number(a.amount ?? 0),
      });
    }
    for (const arr of hist.values()) {
      arr.sort((x, y) => (x.payment_date < y.payment_date ? 1 : x.payment_date > y.payment_date ? -1 : 0));
    }
    setHistoryByBill(hist);

    const pMap = new Map<number, string>();
    for (const p of ((partyRes.data ?? []) as PartyOpt[])) pMap.set(p.id, p.name);
    setPartiesMap(pMap);
    setLoading(false);
  }, [supabase, partyTypeName]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    let billed = 0, paid = 0;
    for (const b of bills) {
      billed += Number(b.total ?? 0);
      paid   += Number(b.amount_paid ?? 0);
    }
    return { billed, paid, due: billed - paid };
  }, [bills]);

  /** Recording happens on the Payments page — jump there with the
   *  party pre-selected so the open bills show up for adjustment. */
  function gotoPayments(b: BillRow): void {
    const party = b.jobwork_party_id != null ? `&party=${b.jobwork_party_id}` : '';
    router.push(`/app/payments?tab=new&direction=in${party}`);
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
          <Loader2 className="w-4 h-4 animate-spin" /> Loading payment status...
        </div>
      ) : bills.length === 0 ? (
        <div className="card p-6 text-center text-ink-mute text-sm">
          No {billLabel}s yet. Create one from <span className="font-mono">/app/invoices/new/jobwork-bill</span>.
        </div>
      ) : (
        <>
        {/* Mobile / PWA: card view. The wide bill table forces horizontal
            scrolling on a phone, so below md we render each bill as a
            tap-friendly card. The table below is hidden on mobile. */}
        <CardFilter placeholder="Search bills…">
          {bills.map((b) => {
            const paid = Number(b.amount_paid ?? 0);
            const due  = Number(b.balance ?? (Number(b.total ?? 0) - paid));
            const chip = statusChip(b.status, due);
            const ps = historyByBill.get(b.id) ?? [];
            return (
              <div key={b.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-ink break-words">{b.invoice_no}</span>
                    <div className="text-sm font-medium mt-0.5 break-words">
                      {b.jobwork_party_id != null ? (partiesMap.get(b.jobwork_party_id) ?? '-') : '-'}
                    </div>
                  </div>
                  <span className={'inline-block px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 ' + chip.cls}>
                    {chip.label}
                  </span>
                </div>

                <div className="text-xs text-ink-soft mt-1">
                  <span className="text-ink-mute">Date: </span>{fmtDate(b.invoice_date)}
                </div>

                <div className="flex items-end justify-between mt-2">
                  <div className="text-xs text-ink-soft">
                    <div>Bill total: <span className="num font-semibold">{fmtRs(b.total)}</span></div>
                    <div>Paid: <span className="num text-emerald-700">{fmtRs(paid)}</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">Balance</div>
                    <div className={'num font-semibold text-base ' + (due > 0 ? 'text-rose-700' : 'text-emerald-700')}>{fmtRs(due)}</div>
                  </div>
                </div>

                {ps.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-line/40">
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute mb-1">Payment history</div>
                    <ul className="space-y-0.5 text-xs">
                      {ps.map((p) => (
                        <li key={p.key} className="flex flex-wrap items-center gap-2">
                          <span>{fmtDate(p.payment_date)}</span>
                          <span className="font-mono text-ink-soft">{p.payment_no}</span>
                          <span className="capitalize">{(p.mode ?? '-').replace('_', ' ')}</span>
                          {p.reference && <span className="text-ink-soft">· {p.reference}</span>}
                          <span className="num font-semibold ml-auto">{fmtRs(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {due > 0 && (
                  <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                    <button type="button" onClick={() => gotoPayments(b)} className="btn-primary text-xs"
                      title="Opens the Payments page with this party pre-selected">
                      <Wallet className="w-3.5 h-3.5" /> Record payment
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Bill No</th>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Party</th>
                <th className="text-right px-3 py-3">Bill total</th>
                <th className="text-right px-3 py-3">Paid</th>
                <th className="text-right px-3 py-3">Balance</th>
                <th className="text-left  px-3 py-3">Status</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const paid = Number(b.amount_paid ?? 0);
                const due  = Number(b.balance ?? (Number(b.total ?? 0) - paid));
                const chip = statusChip(b.status, due);
                const ps = historyByBill.get(b.id) ?? [];
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
                      <td className="px-3 py-2">
                        <span className={'inline-block px-2 py-0.5 rounded text-[11px] font-semibold ' + chip.cls}>
                          {chip.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {due > 0 && (
                          <button type="button" onClick={() => gotoPayments(b)} className="btn-primary text-xs"
                            title="Opens the Payments page with this party pre-selected">
                            <Wallet className="w-3.5 h-3.5" /> Record payment
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Payment history rows */}
                    {ps.length > 0 && (
                      <tr className="bg-cloud/30 border-t border-line/30">
                        <td colSpan={8} className="px-3 py-2">
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
                                <tr key={p.key} className="border-t border-line/40">
                                  <td className="px-1 py-1">{fmtDate(p.payment_date)}</td>
                                  <td className="px-1 py-1 font-mono">{p.payment_no}</td>
                                  <td className="px-1 py-1 capitalize">{(p.mode ?? '-').replace('_', ' ')}</td>
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
        </>
      )}
    </div>
  );
}
