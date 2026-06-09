import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatRupee, formatMetres } from '@/lib/utils';
import {
  Users, Receipt, ArrowUpRight, Hammer,
  Wallet, Landmark, ClipboardList, ClockArrowUp, ShoppingCart,
} from 'lucide-react';
import { TodayAttendanceWidget } from '@/app/components/dashboard/today-attendance';

export const metadata = { title: 'Dashboard' };

interface JobworkStatusRow {
  party_id: number;
  party_code: string | null;
  party_name: string;
  metres_received_ytd: number | string | null;
  payments_out_ytd:    number | string | null;
  last_receipt_date:   string | null;
  last_payment_date:   string | null;
  days_since_last_payment: number | null;
  days_since_last_receipt: number | null;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // Pull a handful of headline numbers in parallel. Each query is RLS-scoped
  // so it just reflects what the signed-in user is allowed to see.
  const [
    { count: customerCount },
    { data: outstanding },
    { data: jobworkStatus },
  ] = await Promise.all([
    supabase.from('customer').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('v_customer_outstanding').select('outstanding_amount').limit(500),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('v_jobwork_payment_status')
      .select('party_id, party_code, party_name, metres_received_ytd, payments_out_ytd, last_receipt_date, last_payment_date, days_since_last_payment, days_since_last_receipt')
      // Longest-unpaid first; NULL last_payment (never paid) at top.
      .order('days_since_last_payment', { ascending: false, nullsFirst: true })
      .limit(10),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalOutstanding = (outstanding ?? []).reduce((s: number, r: any) => s + Number(r.outstanding_amount ?? 0), 0);

  const jobworkRows: JobworkStatusRow[] = (jobworkStatus ?? []) as JobworkStatusRow[];
  // Only show jobwork parties that actually have some activity. A
  // party with zero receipts and zero payments is noise on the dash.
  const activeJobworkRows = jobworkRows.filter(
    (r) => Number(r.metres_received_ytd ?? 0) > 0 || Number(r.payments_out_ytd ?? 0) > 0,
  );

  const cards = [
    { label: 'Active Customers', value: customerCount ?? 0,         icon: Users,        href: '/app/customers',  tone: 'from-indigo to-violet' },
    { label: 'Outstanding (Rs)',  value: formatRupee(totalOutstanding, { compact: true }), icon: Receipt, href: '/app/invoices', tone: 'from-rose-500 to-orange-500' },
  ];

  // Frequent-entry shortcuts — surface the screens the operator opens
  // every day so they're one click from the dashboard.
  const quickEntries: Array<{ label: string; sub: string; href: string; icon: typeof Wallet; tone: string }> = [
    { label: 'Payment',     sub: 'Customer / supplier receipt',  href: '/app/payments',              icon: Wallet,        tone: 'from-emerald-500 to-teal-500' },
    { label: 'Wages',       sub: 'Weaver / staff payout',        href: '/app/wages',                 icon: ClipboardList, tone: 'from-amber-500 to-yellow-500' },
    { label: 'Bank Entry',  sub: 'Cash / bank ledger',           href: '/app/bank-entries',          icon: Landmark,      tone: 'from-indigo to-violet' },
    { label: 'Shift Log',   sub: 'Loom production for a shift',  href: '/app/production/shift-log',  icon: ClockArrowUp,  tone: 'from-rose-500 to-orange-500' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-ink-soft mt-0.5">Today&rsquo;s snapshot of PPK Tex operations.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/costing" className="btn-ghost">New Costing</Link>
          <Link href="/app/orders/new" className="btn-primary">
            <ShoppingCart className="w-4 h-4" /> New Sales Order
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4">
        {cards.map(c => (
          <Link
            key={c.label}
            href={c.href}
            className="card p-4 group hover:shadow-emboss transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${c.tone} text-white grid place-items-center`}>
                <c.icon className="w-5 h-5" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-ink-mute opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="mt-3 num text-xl font-bold text-ink">{c.value}</div>
            <div className="text-xs text-ink-soft uppercase tracking-wide mt-0.5">{c.label}</div>
          </Link>
        ))}
      </section>

      {/* Quick Entry — shortcuts to the screens the operator hits every
          day. Replaces the read-only Recent Sales Orders / Yarn Running
          Low / Loom Utilisation panels that nobody acted on. */}
      <section>
        <h2 className="font-display font-bold text-base mb-3">Quick Entry</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {quickEntries.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="card p-4 group hover:shadow-emboss transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${q.tone} text-white grid place-items-center`}>
                  <q.icon className="w-5 h-5" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-ink-mute opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="mt-3 font-semibold text-ink">{q.label}</div>
              <div className="text-[11px] text-ink-soft mt-0.5">{q.sub}</div>
            </Link>
          ))}
        </div>
      </section>

      <TodayAttendanceWidget />

      {/* Outstanding Jobwork Payments — per-weaver YTD tracker. Sorted
          by days_since_last_payment so the longest-unpaid jobworker is
          at the top. The "Pay" link drops the operator straight into
          the Payments page with the party pre-selected. */}
      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Hammer className="w-4 h-4 text-amber-700" />
            <h2 className="font-display font-bold text-base">Outstanding Jobwork Payments</h2>
          </div>
          <Link href="/app/payments" className="text-xs text-indigo font-semibold">All payments &rarr;</Link>
        </div>
        {activeJobworkRows.length === 0 ? (
          <p className="text-sm text-ink-soft py-4">
            No jobwork activity yet this financial year.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
              <tr>
                <th className="text-left py-2">Party</th>
                <th className="text-right">Received (m) YTD</th>
                <th className="text-right">Paid YTD</th>
                <th className="text-right">Last Receipt</th>
                <th className="text-right">Last Payment</th>
                <th className="text-right">Days Unpaid</th>
                <th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {activeJobworkRows.map((r) => {
                const daysUnpaid = r.days_since_last_payment;
                const tone = daysUnpaid == null
                  ? 'text-rose-600'
                  : daysUnpaid > 30
                    ? 'text-rose-600'
                    : daysUnpaid > 14
                      ? 'text-amber-600'
                      : 'text-emerald-700';
                return (
                  <tr key={r.party_id} className="border-b border-line/40 last:border-0">
                    <td className="py-2.5 font-medium truncate max-w-[220px]" title={r.party_name}>{r.party_name}</td>
                    <td className="text-right num">{formatMetres(Number(r.metres_received_ytd ?? 0))}</td>
                    <td className="text-right num">{formatRupee(Number(r.payments_out_ytd ?? 0), { compact: true })}</td>
                    <td className="text-right text-xs text-ink-soft whitespace-nowrap">{r.last_receipt_date ?? '—'}</td>
                    <td className="text-right text-xs text-ink-soft whitespace-nowrap">{r.last_payment_date ?? '—'}</td>
                    <td className={'text-right num font-semibold ' + tone}>
                      {daysUnpaid == null ? 'never' : `${daysUnpaid}d`}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/app/payments?party=${r.party_id}`}
                        className="text-xs text-indigo font-semibold hover:underline"
                        title={`Open payments filtered to ${r.party_name}`}
                      >
                        Pay &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-ink-mute mt-3">
          YTD = from 1-April of the running financial year. &ldquo;Days Unpaid&rdquo; counts from the last payment to today; &ldquo;never&rdquo; means no payment has ever been recorded for this party.
        </p>
      </section>
    </div>
  );
}

