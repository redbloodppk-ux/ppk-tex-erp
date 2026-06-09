import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatRupee } from '@/lib/utils';
import {
  Users, Receipt, ArrowUpRight,
  ShoppingCart, Wallet, Landmark, ClipboardList, ClockArrowUp,
} from 'lucide-react';
import { TodayAttendanceWidget } from '@/app/components/dashboard/today-attendance';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const supabase = await createClient();

  // Pull a handful of headline numbers in parallel. Each query is RLS-scoped
  // so it just reflects what the signed-in user is allowed to see.
  // After the dashboard trim only Active Customers + Outstanding (Rs) +
  // Recent Invoices remain — the rest of the widgets the operator never
  // looked at were removed in this revision.
  const [
    { count: customerCount },
    { data: outstanding },
    { data: recentInvoices },
  ] = await Promise.all([
    supabase.from('customer').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('v_customer_outstanding').select('outstanding_amount').limit(500),
    supabase.from('invoice').select('doc_no, customer_name, total_amount, status, invoice_date').order('invoice_date', { ascending: false }).limit(5),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalOutstanding = (outstanding ?? []).reduce((s: number, r: any) => s + Number(r.outstanding_amount ?? 0), 0);

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

      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-base">Recent Invoices</h2>
          <Link href="/app/invoices" className="text-xs text-indigo font-semibold">View all &rarr;</Link>
        </div>
        {!recentInvoices?.length ? (
          <EmptyHint icon={Receipt} text="No invoices yet." href="/app/invoices/new" cta="New Invoice" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
              <tr><th className="text-left py-2">Doc No</th><th className="text-left">Customer</th><th className="text-right">Amount</th><th className="text-right">Status</th></tr>
            </thead>
            <tbody>
              {recentInvoices.map((i: any) => (
                <tr key={i.doc_no} className="border-b border-line/40 last:border-0">
                  <td className="py-2.5 font-mono text-xs">{i.doc_no}</td>
                  <td className="truncate max-w-[260px]">{i.customer_name}</td>
                  <td className="text-right num">{formatRupee(i.total_amount, { compact: true })}</td>
                  <td className="text-right"><StatusPill status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:               'bg-slate-100 text-slate-600',
    open:                'bg-indigo-50 text-indigo-700',
    partially_invoiced:  'bg-amber-50 text-amber-700',
    invoiced:            'bg-emerald-50 text-emerald-700',
    paid:                'bg-emerald-50 text-emerald-700',
    partially_paid:      'bg-amber-50 text-amber-700',
    overdue:             'bg-rose-50 text-rose-700',
    cancelled:           'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`pill ${map[status] ?? 'bg-cloud text-ink-soft'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function EmptyHint({ icon: Icon, text, href, cta }: { icon: any; text: string; href: string; cta: string }) {
  return (
    <div className="py-6 text-center text-sm text-ink-soft">
      <Icon className="w-8 h-8 mx-auto mb-2 text-ink-mute" />
      <p>{text}</p>
      <Link href={href} className="mt-3 btn-primary inline-flex">{cta}</Link>
    </div>
  );
}
