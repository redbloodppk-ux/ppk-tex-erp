import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatRupee } from '@/lib/utils';
import {
  Users, Receipt, ArrowUpRight, Hammer,
  Wallet, Landmark, ClipboardList, ClockArrowUp, ShoppingCart,
} from 'lucide-react';
import { TodayAttendanceWidget } from '@/app/components/dashboard/today-attendance';
import { OutstandingByParty, type PartyGroup } from '@/app/components/dashboard/outstanding-by-party';

export const metadata = { title: 'Dashboard' };

interface OpenBillRow {
  id: number;
  invoice_no: string;
  party_name: string | null;
  invoice_date: string;
  customer_id: number | null;
  jobwork_party_id: number | null;
  total:       number | string | null;
  amount_paid: number | string | null;
  balance:     number | string | null;
}

interface PartyMasterRow { id: number; name: string }

/** Group a flat list of open bills by party. For customer invoices we
 *  match on party_name (ilike against the party master); for jobwork
 *  we use the FK directly. The returned list is sorted by total
 *  outstanding descending so the biggest debtor / creditor sits on
 *  top of the dashboard. */
function groupByParty(
  bills: OpenBillRow[],
  parties: PartyMasterRow[],
  partyKeyFn: (b: OpenBillRow) => { id: number | null; label: string },
  now: number,
): PartyGroup[] {
  const byName = new Map<string, number>();
  for (const p of parties) byName.set(p.name.trim().toUpperCase(), p.id);

  const groups = new Map<string, PartyGroup>();
  for (const b of bills) {
    const balance = Number(b.balance ?? 0);
    if (balance <= 0) continue;
    const { id: partyId, label } = partyKeyFn(b);
    const norm = label.trim().toUpperCase();
    const key  = partyId != null ? `id:${partyId}` : `name:${norm}`;
    const resolvedId = partyId ?? (byName.get(norm) ?? null);

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        party_label: label.trim() || '(unknown party)',
        party_id:    resolvedId,
        total:       0,
        oldest_due:  0,
        bills:       [],
      };
      groups.set(key, g);
    }
    g.total += balance;
    g.bills.push({
      id:           b.id,
      invoice_no:   b.invoice_no,
      invoice_date: b.invoice_date,
      balance,
    });
    const due = b.invoice_date
      ? Math.max(0, Math.floor((now - new Date(b.invoice_date).getTime()) / 86_400_000))
      : 0;
    if (due > g.oldest_due) g.oldest_due = due;
  }

  // Sort bills oldest-first inside each party so days-due reads top-down.
  for (const g of groups.values()) {
    g.bills.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || (a.id - b.id));
  }

  return Array.from(groups.values()).sort((a, b) => b.total - a.total);
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // Pull headline numbers + every open bill in parallel. RLS scopes
  // each query to what the signed-in user can see.
  const BILL_COLS = 'id, invoice_no, party_name, invoice_date, customer_id, jobwork_party_id, total, amount_paid, balance';
  const [
    { count: customerCount },
    { data: outstanding },
    { data: jobworkInvoices },
    { data: customerInvoices },
    { data: partyMaster },
  ] = await Promise.all([
    supabase.from('customer').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('v_customer_outstanding').select('outstanding').limit(500),
    // Every unpaid / part-paid jobwork bill, oldest first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('invoice')
      .select(BILL_COLS)
      .eq('doc_type', 'jobwork_invoice')
      .gt('balance', 0)
      .order('invoice_date', { ascending: true }),
    // Every unpaid / part-paid customer sale invoice.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('invoice')
      .select(BILL_COLS)
      .in('doc_type', ['tax_invoice', 'yarn_sale', 'general_sale'])
      .gt('balance', 0)
      .order('invoice_date', { ascending: true }),
    // Party master for name -> id lookup so the "Collect" deep-link
    // can be assembled. Customer invoices carry party_name as text
    // only; we resolve it back to a party.id here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('party').select('id, name').eq('status', 'active'),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalOutstanding = (outstanding ?? []).reduce((s: number, r: any) => s + Number(r.outstanding ?? 0), 0);

  const openJobworkBills:  OpenBillRow[] = (jobworkInvoices ?? [])  as OpenBillRow[];
  const openCustomerBills: OpenBillRow[] = (customerInvoices ?? []) as OpenBillRow[];
  const parties: PartyMasterRow[] = (partyMaster ?? []) as unknown as PartyMasterRow[];

  const now = Date.now();

  // Customer side: identity is the party_name stamped on the invoice.
  const customerGroups = groupByParty(
    openCustomerBills,
    parties,
    (b) => ({ id: null, label: b.party_name ?? '' }),
    now,
  );
  // Jobwork side: identity is jobwork_party_id (FK). Label still
  // comes from party_name for display.
  const jobworkGroups = groupByParty(
    openJobworkBills,
    parties,
    (b) => ({ id: b.jobwork_party_id ?? null, label: b.party_name ?? '' }),
    now,
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
          day. */}
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

      {/* Outstanding Customer Payments — grouped by party with
          expand-to-detail. Top row = party name + total outstanding;
          click to see the actual unpaid invoices. */}
      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-rose-600" />
            <h2 className="font-display font-bold text-base">Outstanding Customer Payments</h2>
          </div>
          <Link href="/app/invoices" className="text-xs text-indigo font-semibold">All invoices &rarr;</Link>
        </div>
        <OutstandingByParty
          groups={customerGroups}
          direction="in"
          actionLabel="Collect"
          emptyText="No outstanding customer invoices — everything is collected."
          footnote={'Customers with one or more open sale invoices. Click a row to see their unpaid bills. "Days due" = days since the invoice date.'}
        />
      </section>

      {/* Outstanding Jobwork Payments — grouped by jobwork party. */}
      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Hammer className="w-4 h-4 text-amber-700" />
            <h2 className="font-display font-bold text-base">Outstanding Jobwork Payments</h2>
          </div>
          <Link href="/app/payments" className="text-xs text-indigo font-semibold">All payments &rarr;</Link>
        </div>
        <OutstandingByParty
          groups={jobworkGroups}
          direction="out"
          actionLabel="Pay"
          emptyText="No outstanding jobwork bills — everything is paid up."
          footnote={'Jobwork parties with one or more open bills. Click a row to see their unpaid bills. "Days due" = days since the bill date.'}
        />
      </section>
    </div>
  );
}
