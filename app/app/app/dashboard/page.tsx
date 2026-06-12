import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatRupee } from '@/lib/utils';
import {
  Users, Receipt, ArrowUpRight, Hammer,
  Wallet, Landmark, ClipboardList, ClockArrowUp, ShoppingCart,
} from 'lucide-react';
import { TodayAttendanceWidget } from '@/app/components/dashboard/today-attendance';

export const metadata = { title: 'Dashboard' };

interface JobworkInvoiceRow {
  id: number;
  invoice_no: string;
  party_name: string | null;
  invoice_date: string;
  jobwork_party_id: number | null;
  total:       number | string | null;
  amount_paid: number | string | null;
  balance:     number | string | null;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // Pull a handful of headline numbers in parallel. Each query is RLS-scoped
  // so it just reflects what the signed-in user is allowed to see.
  const [
    { count: customerCount },
    { data: outstanding },
    { data: jobworkInvoices },
  ] = await Promise.all([
    supabase.from('customer').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('v_customer_outstanding').select('outstanding_amount').limit(500),
    // Unpaid / part-paid jobwork bills, oldest first so the longest-due
    // bill sits at the top of the dashboard list.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('invoice')
      .select('id, invoice_no, party_name, invoice_date, jobwork_party_id, total, amount_paid, balance')
      .eq('doc_type', 'jobwork_invoice')
      .gt('balance', 0)
      .order('invoice_date', { ascending: true })
      .limit(10),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalOutstanding = (outstanding ?? []).reduce((s: number, r: any) => s + Number(r.outstanding_amount ?? 0), 0);

  const openJobworkBills: JobworkInvoiceRow[] = (jobworkInvoices ?? []) as JobworkInvoiceRow[];
  const today = new Date();
  const daysDue = (d: string) =>
    Math.max(0, Math.floor((today.getTime() - new Date(d).getTime()) / 86_400_000));

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

      {/* Outstanding Jobwork Payments — open (unpaid / part-paid) jobwork
          bills, oldest first. One row per bill: invoice no, balance due,
          days due. The "Pay" link drops the operator straight into the
          Payments page with the party pre-selected. */}
      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Hammer className="w-4 h-4 text-amber-700" />
            <h2 className="font-display font-bold text-base">Outstanding Jobwork Payments</h2>
          </div>
          <Link href="/app/payments" className="text-xs text-indigo font-semibold">All payments &rarr;</Link>
        </div>
        {openJobworkBills.length === 0 ? (
          <p className="text-sm text-ink-soft py-4">
            No outstanding jobwork bills — everything is paid up.
          </p>
        ) : (
          <>
            {/* Card layout for small screens. */}
            <ul className="md:hidden space-y-2">
              {openJobworkBills.map((r) => {
                const due = daysDue(r.invoice_date);
                const tone = due > 30 ? 'text-rose-600' : due > 14 ? 'text-amber-600' : 'text-emerald-700';
                return (
                  <li key={r.id} className="border border-line/40 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <Link
                        href={`/app/invoices/${r.id}`}
                        className="font-semibold text-sm text-indigo hover:underline truncate"
                        title={r.party_name ?? undefined}
                      >
                        {r.invoice_no}
                      </Link>
                      {r.jobwork_party_id != null && (
                        <Link
                          href={`/app/payments?party=${r.jobwork_party_id}`}
                          className="text-xs text-indigo font-semibold hover:underline shrink-0"
                        >
                          Pay &rarr;
                        </Link>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-y-1 text-xs">
                      <dt className="text-ink-soft">Balance</dt>
                      <dd className="text-right num font-semibold">{formatRupee(Number(r.balance ?? 0))}</dd>
                      <dt className="text-ink-soft">Due</dt>
                      <dd className={'text-right num font-semibold ' + tone}>{due}d</dd>
                    </dl>
                  </li>
                );
              })}
            </ul>

            {/* Table layout for md+ screens. */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
                  <tr>
                    <th className="text-left py-2">Invoice No</th>
                    <th className="text-right">Balance</th>
                    <th className="text-right">Due</th>
                    <th className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {openJobworkBills.map((r) => {
                    const due = daysDue(r.invoice_date);
                    const tone = due > 30 ? 'text-rose-600' : due > 14 ? 'text-amber-600' : 'text-emerald-700';
                    return (
                      <tr key={r.id} className="border-b border-line/40 last:border-0">
                        <td className="py-2.5">
                          <Link
                            href={`/app/invoices/${r.id}`}
                            className="font-medium text-indigo hover:underline"
                            title={r.party_name ?? undefined}
                          >
                            {r.invoice_no}
                          </Link>
                        </td>
                        <td className="text-right num font-semibold">{formatRupee(Number(r.balance ?? 0))}</td>
                        <td className={'text-right num font-semibold ' + tone}>{due}d</td>
                        <td className="text-right">
                          {r.jobwork_party_id != null && (
                            <Link
                              href={`/app/payments?party=${r.jobwork_party_id}`}
                              className="text-xs text-indigo font-semibold hover:underline"
                              title={`Open payments filtered to ${r.party_name ?? r.invoice_no}`}
                            >
                              Pay &rarr;
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-[10px] text-ink-mute mt-3">
          Open jobwork bills only (unpaid or part-paid), oldest first. &ldquo;Due&rdquo; counts days since the bill date. Balance = bill total minus payments recorded against it.
        </p>
      </section>
    </div>
  );
}

