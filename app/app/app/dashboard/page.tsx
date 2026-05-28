import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatRupee, formatMetres } from '@/lib/utils';
import {
  TrendingUp, AlertTriangle, Package, Users, Factory, Receipt,
  ClockAlert, ArrowUpRight, Boxes, ShoppingCart,
} from 'lucide-react';
import { TodayAttendanceWidget } from '@/app/components/dashboard/today-attendance';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const supabase = await createClient();

  // Pull a handful of headline numbers in parallel. Each query is RLS-scoped
  // so it just reflects what the signed-in user is allowed to see.
  const [
    { count: customerCount },
    { count: openOrderCount },
    { data: outstanding },
    { data: lowYarn },
    { data: recentOrders },
    { data: recentInvoices },
    { data: loomUtil },
  ] = await Promise.all([
    supabase.from('customer').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    // "Open" = not yet in a terminal state. Excludes paid + cancelled.
    supabase.from('sales_order').select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'pending_approval', 'approved', 'in_production', 'partial_dispatch']),
    supabase.from('v_customer_outstanding').select('outstanding_amount').limit(500),
    supabase.from('v_yarn_days_of_cover').select('yarn_count_code, days_of_cover, on_hand_kg').lte('days_of_cover', 14).order('days_of_cover', { ascending: true }).limit(5),
    supabase.from('sales_order').select('doc_no, customer_name, total_amount, status, order_date').order('order_date', { ascending: false }).limit(5),
    supabase.from('invoice').select('doc_no, customer_name, total_amount, status, invoice_date').order('invoice_date', { ascending: false }).limit(5),
    supabase.from('v_loom_shift_utilisation').select('loom_code, shift_count, total_metres, avg_metres_per_shift, last_log_date').order('loom_code'),
  ]);

  const loggedLooms = (loomUtil ?? []).filter((r: any) => Number(r.shift_count ?? 0) > 0);

  const totalOutstanding = (outstanding ?? []).reduce((s, r: any) => s + Number(r.outstanding_amount ?? 0), 0);

  const cards = [
    { label: 'Active Customers', value: customerCount ?? 0,         icon: Users,        href: '/app/customers',  tone: 'from-indigo to-violet' },
    { label: 'Open Sales Orders', value: openOrderCount ?? 0,        icon: ShoppingCart, href: '/app/orders',     tone: 'from-emerald-500 to-teal-500' },
    { label: 'Outstanding (Rs)',  value: formatRupee(totalOutstanding, { compact: true }), icon: Receipt, href: '/app/invoices', tone: 'from-rose-500 to-orange-500' },
    { label: 'Low-Stock Yarn',    value: lowYarn?.length ?? 0,       icon: Boxes,        href: '/app/yarn',       tone: 'from-amber-500 to-yellow-500' },
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

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

      <TodayAttendanceWidget />

      <section className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-base">Recent Sales Orders</h2>
            <Link href="/app/orders" className="text-xs text-indigo font-semibold">View all &rarr;</Link>
          </div>
          {!recentOrders?.length ? (
            <EmptyHint icon={ShoppingCart} text="No sales orders yet - create your first one." href="/app/orders/new" cta="New SO" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
                <tr><th className="text-left py-2">Doc No</th><th className="text-left">Customer</th><th className="text-right">Amount</th><th className="text-right">Status</th></tr>
              </thead>
              <tbody>
                {recentOrders.map((o: any) => (
                  <tr key={o.doc_no} className="border-b border-line/40 last:border-0">
                    <td className="py-2.5 font-mono text-xs">{o.doc_no}</td>
                    <td className="truncate max-w-[180px]">{o.customer_name}</td>
                    <td className="text-right num">{formatRupee(o.total_amount, { compact: true })}</td>
                    <td className="text-right"><StatusPill status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="font-display font-bold text-base">Yarn Running Low</h2>
          </div>
          {!lowYarn?.length ? (
            <p className="text-sm text-ink-soft">All yarn counts are above the 14-day cover threshold.</p>
          ) : (
            <ul className="space-y-2">
              {lowYarn.map((y: any) => (
                <li key={y.yarn_count_code} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs">{y.yarn_count_code}</span>
                  <span className="text-ink-soft text-xs">
                    <span className="num font-semibold text-rose-600">{Number(y.days_of_cover).toFixed(1)}</span> days
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/yarn" className="mt-4 block text-xs text-indigo font-semibold">Manage yarn lots &rarr;</Link>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Factory className="w-4 h-4 text-indigo" />
            <h2 className="font-display font-bold text-base">Loom Utilisation</h2>
          </div>
          <Link href="/app/production/shift-log" className="text-xs text-indigo font-semibold">Log a shift &rarr;</Link>
        </div>
        {!loggedLooms.length ? (
          <EmptyHint
            icon={Factory}
            text="No shifts logged yet - record loom output to see metres here."
            href="/app/production/shift-log"
            cta="Log a Shift"
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
              <tr>
                <th className="text-left py-2">Loom</th>
                <th className="text-right">Shifts</th>
                <th className="text-right">Metres / Shift</th>
                <th className="text-right">Total Metres</th>
              </tr>
            </thead>
            <tbody>
              {loggedLooms.map((l: any) => (
                <tr key={l.loom_code} className="border-b border-line/40 last:border-0">
                  <td className="py-2.5 font-mono text-xs">{l.loom_code}</td>
                  <td className="text-right num">{l.shift_count}</td>
                  <td className="text-right num">
                    {l.avg_metres_per_shift == null ? '-' : formatMetres(l.avg_metres_per_shift)}
                  </td>
                  <td className="text-right num">{formatMetres(l.total_metres)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
