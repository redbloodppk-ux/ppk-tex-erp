/**
 * TDS payable — the monthly position and the challans already paid.
 *
 * Tax withheld from supplier bills is owed to the government, not to the
 * supplier it was withheld from. PPK pays the mill net and the portal
 * separately, so this liability lives on its own rather than inside any
 * party balance.
 *
 * Everything here is derived by lib/tds/liability.ts except the challans,
 * which nothing can infer — the government portal is outside this system.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import { Plus, AlertTriangle } from 'lucide-react';
import { loadTdsMonths, daysUntil, todayISO } from '@/lib/tds/liability-data';
import { totalTdsPayable } from '@/lib/tds/liability';
import { fetchAll } from '@/lib/supabase/fetch-all';

export const metadata = { title: 'TDS Payable' };
export const dynamic = 'force-dynamic';

interface PaidRow {
  id: number;
  period_month: string;
  amount: number | string;
  interest_amount: number | string;
  paid_date: string;
  challan_no: string | null;
}

export default async function TdsPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  const today = todayISO();

  const { months, error } = await loadTdsMonths(supabase, today);
  const open = months.filter((m) => m.outstanding > 0.005);
  const totals = totalTdsPayable(open);
  const overdue = open.filter((m) => m.overdue);

  const paidRes = await fetchAll<PaidRow>((lo, hi) => (supabase as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (t: string) => any;
  }).from('tds_payment')
    .select('id, period_month, amount, interest_amount, paid_date, challan_no')
    .order('id', { ascending: true })
    .range(lo, hi));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader
        title="TDS Payable"
        subtitle="Tax withheld from supplier bills, owed to the government. Due by the 5th of the month after deduction."
        actions={
          <Link href="/app/tds/new" className="btn-primary inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Record challan
          </Link>
        }
      />

      {error && (
        <div className="rounded-md border-2 border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          The TDS position could not be loaded, so the figures below are
          incomplete: {error}
        </div>
      )}

      {overdue.length > 0 && (
        <div className="rounded-md border-2 border-rose-300 bg-rose-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
            <div>
              <div className="text-sm font-semibold text-rose-900">
                {overdue.length === 1 ? '1 month is overdue' : `${overdue.length} months are overdue`}
                {' '}&mdash; {formatRupee(totals.interest)} of interest so far
              </div>
              <div className="mt-1 text-xs text-rose-800">
                Section 201(1A) charges 1.5% per month or <strong>part</strong> of a
                month, counted from the date of deduction. A single day late costs a
                whole month, and the amount steps up again on the 1st.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-4 py-3">Month deducted</th>
              <th className="text-left  px-4 py-3">Due by</th>
              <th className="text-left  px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">TDS</th>
              <th className="text-right px-4 py-3">Interest</th>
              <th className="text-right px-4 py-3">Payable</th>
              <th className="text-right px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {open.length ? open.map((m) => {
              const days = daysUntil(m.dueDate, today);
              return (
                <tr key={m.month} className="border-t border-line/40 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{m.label}</div>
                    <div className="text-[11px] text-ink-mute">
                      {m.sources.map((x) => `Bill ${x.ref}`).join(' · ')}
                    </div>
                  </td>
                  <td className="px-4 py-3 num text-ink-soft">{m.dueDate}</td>
                  <td className="px-4 py-3">
                    {m.overdue ? (
                      <span className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                        {Math.abs(days)} days late · {m.interestMonths} months
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        due in {days} day{days === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right num">{formatRupee(m.outstanding)}</td>
                  <td className="px-4 py-3 text-right num text-rose-700">
                    {m.interest > 0 ? formatRupee(m.interest) : <span className="text-ink-mute">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right num font-semibold">{formatRupee(m.payable)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/app/tds/new?month=${m.month}`} className="text-xs text-indigo font-semibold">
                      Pay &rarr;
                    </Link>
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-soft">
                  Nothing owed. Every month of withheld tax has been remitted.
                </td>
              </tr>
            )}
          </tbody>
          {open.length > 0 && (
            <tfoot className="border-t-2 border-line bg-cloud/40 text-sm font-semibold">
              <tr>
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right num">{formatRupee(totals.outstanding)}</td>
                <td className="px-4 py-3 text-right num text-rose-700">{formatRupee(totals.interest)}</td>
                <td className="px-4 py-3 text-right num">{formatRupee(totals.payable)}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <section className="card p-4">
        <h2 className="font-display font-bold text-base mb-3">Challans paid</h2>
        {paidRes.rows.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No challans recorded yet. Once you pay on the portal, record it here so
            the month stops accruing interest.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-2">For month</th>
                <th className="text-left  px-3 py-2">Paid on</th>
                <th className="text-left  px-3 py-2">Challan</th>
                <th className="text-right px-3 py-2">TDS</th>
                <th className="text-right px-3 py-2">Interest</th>
              </tr>
            </thead>
            <tbody>
              {paidRes.rows.map((r) => (
                <tr key={r.id} className="border-t border-line/40">
                  <td className="px-3 py-2">{r.period_month}</td>
                  <td className="px-3 py-2 num text-ink-soft">{r.paid_date}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.challan_no ?? '—'}</td>
                  <td className="px-3 py-2 text-right num">{formatRupee(Number(r.amount))}</td>
                  <td className="px-3 py-2 text-right num">{formatRupee(Number(r.interest_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
