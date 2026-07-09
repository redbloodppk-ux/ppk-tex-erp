import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatRupee } from '@/lib/utils';
import {
  Receipt, ArrowUpRight, Hammer, Truck,
  Wallet, Landmark, ClipboardList, ClockArrowUp, ShoppingCart,
} from 'lucide-react';
import { TodayAttendanceWidget } from '@/app/components/dashboard/today-attendance';
import { OutstandingByParty, type PartyGroup } from '@/app/components/dashboard/outstanding-by-party';
import { ProductionAnalytics } from './production-analytics';

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

interface OpeningLedgerRow {
  id: number;
  invoice_no: string | null;
  invoice_date: string | null;
  party_id: number | null;
  balance: number | string | null;
}

/** Net each party's pre-ERP opening-ledger balance into an existing
 *  invoice-based outstanding total. A party's opening ledger can be a
 *  due (positive balance, adds to what they owe) or a credit / past
 *  overpayment (negative balance, offsets it) — both are folded into
 *  the same per-party total here so this widget agrees with the
 *  Ledger page's running balance for that party.
 *
 *  Parties whose net total drops to zero or below (their opening
 *  credit fully offsets or exceeds any open invoices) are NOT
 *  dropped — they still show up, just flagged "in credit" in the UI,
 *  so the operator always sees the full picture for a party rather
 *  than having them silently disappear from the list. */
function mergeOpeningLedger(
  groups: PartyGroup[],
  ledgerRows: OpeningLedgerRow[],
  partyNameById: Map<number, string>,
  now: number,
): PartyGroup[] {
  const byParty = new Map<number, OpeningLedgerRow[]>();
  for (const r of ledgerRows) {
    const bal = Number(r.balance ?? 0);
    if (r.party_id == null || Math.abs(bal) < 0.005) continue;
    const list = byParty.get(r.party_id) ?? [];
    list.push(r);
    byParty.set(r.party_id, list);
  }
  if (byParty.size === 0) return groups;

  const usedPartyIds = new Set<number>();
  const result: PartyGroup[] = groups.map((g) => {
    const rows = g.party_id != null ? byParty.get(g.party_id) : undefined;
    if (!rows) return g;
    usedPartyIds.add(g.party_id as number);
    const ledgerSum = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
    const ledgerBills = rows.map((r) => ({
      id: -r.id, // negative namespace so it can't collide with an invoice id
      invoice_no: r.invoice_no ?? 'Opening balance',
      invoice_date: r.invoice_date ?? '',
      balance: Number(r.balance ?? 0),
    }));
    return { ...g, total: g.total + ledgerSum, bills: [...g.bills, ...ledgerBills] };
  });

  // Parties with an opening-ledger balance but no open invoice at all —
  // still surface them (due or credit) so nothing silently disappears.
  for (const [partyId, rows] of byParty.entries()) {
    if (usedPartyIds.has(partyId)) continue;
    const ledgerSum = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
    let oldest = 0;
    for (const r of rows) {
      const due = r.invoice_date
        ? Math.max(0, Math.floor((now - new Date(r.invoice_date).getTime()) / 86_400_000))
        : 0;
      if (due > oldest) oldest = due;
    }
    result.push({
      key: `id:${partyId}`,
      party_label: partyNameById.get(partyId) ?? `(party ${partyId})`,
      party_id: partyId,
      total: ledgerSum,
      oldest_due: oldest,
      bills: rows.map((r) => ({
        id: -r.id,
        invoice_no: r.invoice_no ?? 'Opening balance',
        invoice_date: r.invoice_date ?? '',
        balance: Number(r.balance ?? 0),
      })),
    });
  }

  return result.sort((a, b) => b.total - a.total);
}

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

interface DashboardPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const sp = await searchParams;
  const tab: 'overview' | 'outstanding' = sp.tab === 'outstanding' ? 'outstanding' : 'overview';
  const supabase = await createClient();

  // Pull headline numbers + every open bill in parallel. RLS scopes
  // each query to what the signed-in user can see.
  const BILL_COLS = 'id, invoice_no, party_name, invoice_date, customer_id, jobwork_party_id, total, amount_paid, balance';
  const [
    { data: outstanding },
    { data: jobworkInvoices },
    { data: weavingBillInvoices },
    { data: customerInvoices },
    { data: partyMaster },
    { data: sizingBills },
    { data: bobbinBills },
    { data: yarnBills },
    { data: fabricBills },
    { data: openingPayables },
    { data: agentComm },
    { data: openingReceivables },
  ] = await Promise.all([
    supabase.from('v_customer_outstanding').select('outstanding').limit(500),
    // Every unpaid / part-paid JOB WORK bill, oldest first. These are
    // the older jobwork_invoice doc type — bills WE owe an outside
    // jobworker for work done on our cloth. Shown in its own card.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('invoice')
      .select(BILL_COLS)
      .eq('doc_type', 'jobwork_invoice')
      .gt('balance', 0)
      .order('invoice_date', { ascending: true }),
    // Every unpaid / part-paid OUTSOURCE WEAVING bill, oldest first.
    // The newer dedicated weaving_bill doc type — kept in a separate
    // card from job work so each vendor stream is visible on its own.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('invoice')
      .select(BILL_COLS)
      .eq('doc_type', 'weaving_bill')
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
    // ── Supplier payable bills ───────────────────────────────
    // Sizing bills with balance (total - amount_paid > 0).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('sizing_job')
      .select('id, bill_no, bill_date, total_amount, amount_paid, party_id')
      .not('bill_no', 'is', null)
      .gt('total_amount', 0)
      .order('bill_date', { ascending: true }),
    // Bobbin purchases.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('bobbin_purchase')
      .select('id, invoice_no, purchase_date, total_amount, amount_paid, vendor_id')
      .gt('total_amount', 0)
      .order('purchase_date', { ascending: true }),
    // Yarn lots.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('yarn_lot')
      .select('id, lot_code, invoice_no, received_date, total_amount, amount_paid, supplier_party_id')
      .gt('total_amount', 0)
      .order('received_date', { ascending: true }),
    // Supplier-mode fabric resale rows only — customer-adjustment
    // rows are settled via synthetic payments at entry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('fabric_purchase')
      .select('id, code, invoice_no, received_date, total_amount, amount_paid, supplier_party_id')
      .eq('source', 'supplier')
      .eq('status', 'active')
      .gt('total_amount', 0)
      .order('received_date', { ascending: true }),
    // Opening payables — pre-ERP balances we owe to suppliers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('party_opening_ledger')
      .select('id, invoice_no, invoice_date, party_id, amount, amount_paid, balance')
      .eq('status', 'active')
      .eq('direction', 'payable')
      .gt('balance', 0)
      .order('invoice_date', { ascending: true }),
    // Agent / broker commission payables (from fabric invoices). The
    // commission we owe each agent that hasn't been paid yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('agent_commission')
      .select('id, agent_party_id, amount, amount_paid, balance, invoice:invoice_id ( invoice_no, invoice_date ), yarn_lot:yarn_lot_id ( lot_code, received_date ), fabric_purchase:fabric_purchase_id ( code, received_date )')
      .eq('status', 'active')
      .gt('balance', 0),
    // Opening receivables — pre-ERP balances a customer owes us, or
    // (negative balance) a past overpayment / credit sitting on their
    // account. No balance filter here: unlike the payable side, we
    // need the credits (negative) too, to net into their total below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('party_opening_ledger')
      .select('id, invoice_no, invoice_date, party_id, balance')
      .eq('status', 'active')
      .eq('direction', 'receivable')
      .order('invoice_date', { ascending: true }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalOutstanding = (outstanding ?? []).reduce((s: number, r: any) => s + Number(r.outstanding ?? 0), 0);

  const openJobworkBills:  OpenBillRow[] = (jobworkInvoices ?? [])     as OpenBillRow[];
  const openWeavingBills:  OpenBillRow[] = (weavingBillInvoices ?? []) as OpenBillRow[];
  const openCustomerBills: OpenBillRow[] = (customerInvoices ?? [])    as OpenBillRow[];
  const parties: PartyMasterRow[] = (partyMaster ?? []) as unknown as PartyMasterRow[];
  const partyNameById = new Map<number, string>();
  for (const p of parties) partyNameById.set(p.id, p.name);

  const now = Date.now();

  // Customer side: identity is the party_name stamped on the invoice.
  // Net each party's opening-ledger due/credit into their total so
  // this widget agrees with the Ledger page's running balance.
  const customerGroups = mergeOpeningLedger(
    groupByParty(
      openCustomerBills,
      parties,
      (b) => ({ id: null, label: b.party_name ?? '' }),
      now,
    ),
    (openingReceivables ?? []) as OpeningLedgerRow[],
    partyNameById,
    now,
  );
  // Job work side: identity is jobwork_party_id (FK). The label comes
  // from party_name on the invoice. Bills raised against jobworkers.
  const jobworkGroups = groupByParty(
    openJobworkBills,
    parties,
    (b) => ({ id: b.jobwork_party_id ?? null, label: b.party_name ?? '' }),
    now,
  );
  // Outsource-weaving side: identity is jobwork_party_id (FK). The
  // label comes from party_name on the invoice. These are bills
  // raised against outsource weavers we sent cloth to.
  const weavingGroups = groupByParty(
    openWeavingBills,
    parties,
    (b) => ({ id: b.jobwork_party_id ?? null, label: b.party_name ?? '' }),
    now,
  );

  // ── Supplier payables — merge 5 sources into one OpenBillRow[]
  // shape so groupByParty works the same way as the existing two
  // sections. The "balance" we compute is total_amount - amount_paid
  // (sizing / bobbin / yarn / fabric) or the existing balance column
  // (opening payable). Anything <= 0 is filtered out so a fully
  // settled bill doesn't keep its party group alive.
  const supplierBills: OpenBillRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((sizingBills ?? []) as any[])) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    supplierBills.push({
      id:               r.id,
      invoice_no:       r.bill_no ?? `SZ-${r.id}`,
      party_name:       r.party_id ? (partyNameById.get(r.party_id) ?? null) : null,
      invoice_date:     r.bill_date ?? '',
      customer_id:      null,
      jobwork_party_id: r.party_id ?? null,
      total:            r.total_amount,
      amount_paid:      r.amount_paid,
      balance:          bal,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((bobbinBills ?? []) as any[])) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    supplierBills.push({
      id:               r.id,
      invoice_no:       r.invoice_no ?? `BB-${r.id}`,
      party_name:       r.vendor_id ? (partyNameById.get(r.vendor_id) ?? null) : null,
      invoice_date:     r.purchase_date ?? '',
      customer_id:      null,
      jobwork_party_id: r.vendor_id ?? null,
      total:            r.total_amount,
      amount_paid:      r.amount_paid,
      balance:          bal,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((yarnBills ?? []) as any[])) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    supplierBills.push({
      id:               r.id,
      invoice_no:       r.invoice_no ?? r.lot_code ?? `YL-${r.id}`,
      party_name:       r.supplier_party_id ? (partyNameById.get(r.supplier_party_id) ?? null) : null,
      invoice_date:     r.received_date ?? '',
      customer_id:      null,
      jobwork_party_id: r.supplier_party_id ?? null,
      total:            r.total_amount,
      amount_paid:      r.amount_paid,
      balance:          bal,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((fabricBills ?? []) as any[])) {
    const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
    if (bal <= 0.005) continue;
    supplierBills.push({
      id:               r.id,
      invoice_no:       r.invoice_no ?? r.code ?? `FP-${r.id}`,
      party_name:       r.supplier_party_id ? (partyNameById.get(r.supplier_party_id) ?? null) : null,
      invoice_date:     r.received_date ?? '',
      customer_id:      null,
      jobwork_party_id: r.supplier_party_id ?? null,
      total:            r.total_amount,
      amount_paid:      r.amount_paid,
      balance:          bal,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((openingPayables ?? []) as any[])) {
    const bal = Number(r.balance ?? 0);
    if (bal <= 0.005) continue;
    supplierBills.push({
      id:               r.id,
      invoice_no:       r.invoice_no ?? `OP-${r.id}`,
      party_name:       r.party_id ? (partyNameById.get(r.party_id) ?? null) : null,
      invoice_date:     r.invoice_date ?? '',
      customer_id:      null,
      jobwork_party_id: r.party_id ?? null,
      total:            r.amount,
      amount_paid:      r.amount_paid,
      balance:          bal,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((agentComm ?? []) as any[])) {
    const bal = Number(r.balance ?? 0);
    if (bal <= 0.005) continue;
    // Commission points at exactly one source: fabric sales invoice,
    // yarn lot, or fabric purchase. Label + date come from whichever set.
    const srcNo = r.invoice?.invoice_no ?? r.yarn_lot?.lot_code ?? r.fabric_purchase?.code ?? null;
    const srcDate = r.invoice?.invoice_date ?? r.yarn_lot?.received_date ?? r.fabric_purchase?.received_date ?? '';
    supplierBills.push({
      id:               r.id,
      invoice_no:       (srcNo ? `${srcNo} (Comm)` : `COMM-${r.id}`),
      party_name:       r.agent_party_id ? (partyNameById.get(r.agent_party_id) ?? null) : null,
      invoice_date:     srcDate,
      customer_id:      null,
      jobwork_party_id: r.agent_party_id ?? null,
      total:            r.amount,
      amount_paid:      r.amount_paid,
      balance:          bal,
    });
  }
  // Group across all sources by the supplier / agent party id.
  const supplierGroups = groupByParty(
    supplierBills,
    parties,
    (b) => ({ id: b.jobwork_party_id ?? null, label: b.party_name ?? '' }),
    now,
  );

  // Total of every open supplier-side bill across the three sections
  // below it (outsource-weaving + sizing/bobbin/yarn/fabric + opening
  // payables). Drives the new Outstanding Payable KPI card replacing
  // the Active-Customers count the operator wasn't using day to day.
  const totalPayable =
      jobworkGroups .reduce((s, g) => s + g.total, 0)
    + weavingGroups .reduce((s, g) => s + g.total, 0)
    + supplierGroups.reduce((s, g) => s + g.total, 0);

  const cards = [
    { label: 'Outstanding Receivable (Rs)', value: formatRupee(totalOutstanding, { compact: true }), icon: Receipt, href: '/app/invoices', tone: 'from-rose-500 to-orange-500' },
    { label: 'Outstanding Payable (Rs)',    value: formatRupee(totalPayable,     { compact: true }), icon: Truck,   href: '/app/payments?direction=out', tone: 'from-violet-500 to-fuchsia-500' },
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
    <div className="space-y-4 dash-stagger">
      <style>{`
        .dash-stagger > * { animation: dashRise 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .dash-stagger > *:nth-child(1) { animation-delay: 40ms; }
        .dash-stagger > *:nth-child(2) { animation-delay: 110ms; }
        .dash-stagger > *:nth-child(3) { animation-delay: 180ms; }
        .dash-stagger > *:nth-child(4) { animation-delay: 250ms; }
        .dash-stagger > *:nth-child(5) { animation-delay: 320ms; }
        .dash-stagger > *:nth-child(6) { animation-delay: 390ms; }
        .dash-stagger > *:nth-child(7) { animation-delay: 460ms; }
        .dash-stagger > *:nth-child(n+8) { animation-delay: 520ms; }
        @keyframes dashRise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dash-stagger > * { animation: none; }
        }
      `}</style>
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-display font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-xs text-ink-soft mt-0.5">Today&rsquo;s snapshot of PPK Tex operations.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/costing" className="btn-ghost">New Costing</Link>
          <Link href="/app/delivery-challan/new" className="btn-primary">
            <ShoppingCart className="w-4 h-4" /> New DC
          </Link>
        </div>
      </header>

      {/* Tabs — Overview (KPIs, quick entry, analytics, attendance) vs
          Outstanding (the four receivable / payable sections). */}
      <nav className="flex gap-1 border-b border-line/60">
        {([
          { key: 'overview',    label: 'Overview',    href: '/app/dashboard' },
          { key: 'outstanding', label: 'Outstanding', href: '/app/dashboard?tab=outstanding' },
        ] as const).map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-indigo text-indigo bg-indigo-50/60'
                : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (
      <>
      <section className="grid grid-cols-2 gap-3">
        {cards.map(c => (
          <Link
            key={c.label}
            href={c.href}
            className="card p-3 group hover:shadow-emboss transition-shadow"
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${c.tone} text-white grid place-items-center shrink-0`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="num text-xl font-bold text-ink leading-tight">{c.value}</div>
                <div className="text-[11px] text-ink-soft uppercase tracking-wide">{c.label}</div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-ink-mute opacity-0 group-hover:opacity-100 transition-opacity ml-auto self-start" />
            </div>
          </Link>
        ))}
      </section>

      {/* Quick Entry — shortcuts to the screens the operator hits every
          day. */}
      <section>
        <h2 className="font-display font-bold text-sm mb-2">Quick Entry</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {quickEntries.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="card p-3 group hover:shadow-emboss transition-shadow flex items-center gap-3"
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${q.tone} text-white grid place-items-center shrink-0`}>
                <q.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-ink text-sm leading-tight">{q.label}</div>
                <div className="text-[11px] text-ink-soft">{q.sub}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Production Analytics — loom utilisation, daily production and
          top weavers, with a 7d / 30d / this-month selector. */}
      <ProductionAnalytics />

      <TodayAttendanceWidget />
      </>
      )}

      {tab === 'outstanding' && (
      /* Money sections — two-up on desktop so the operator sees
         receivables next to payables without scrolling. */
      <div className="grid lg:grid-cols-2 gap-4 items-start">

      {/* Outstanding Customer Payments — grouped by party with
          expand-to-detail. Top row = party name + total outstanding;
          click to see the actual unpaid invoices. */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
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
          footnote={'Customers with one or more open sale invoices, netted against any pre-ERP opening balance (due or credit) — matches the Ledger page\u2019s running balance. A party fully offset by an old credit still shows up, flagged "In credit". Click a row to see the bills. "Days due" = days since the invoice date.'}
        />
      </section>

      {/* Outstanding Job Work Bills — grouped by the jobwork party.
          These are the older jobwork_invoice doc type. */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Hammer className="w-4 h-4 text-amber-700" />
            <h2 className="font-display font-bold text-base">Outstanding Job Work Bills</h2>
          </div>
          <Link href="/app/payments" className="text-xs text-indigo font-semibold">All payments &rarr;</Link>
        </div>
        <OutstandingByParty
          groups={jobworkGroups}
          direction="out"
          actionLabel="Pay"
          emptyText="No outstanding job work bills — every jobworker is paid up."
          footnote={'Job work parties with one or more open bills against work they did on our cloth. Click a row to see their unpaid bills. "Days due" = days since the bill date.'}
        />
      </section>

      {/* Outstanding Outsourcing Weaving Bills — grouped by the
          outsource weaver. These are the newer weaving_bill doc type. */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-rose-700" />
            <h2 className="font-display font-bold text-base">Outstanding Outsourcing Weaving Bills</h2>
          </div>
          <Link href="/app/payments" className="text-xs text-indigo font-semibold">All payments &rarr;</Link>
        </div>
        <OutstandingByParty
          groups={weavingGroups}
          direction="out"
          actionLabel="Pay"
          emptyText="No outstanding outsourcing weaving bills — every weaver is paid up."
          footnote={'Outsource weavers with one or more open bills against work they did on our cloth. Click a row to see their unpaid bills. "Days due" = days since the bill date.'}
        />
      </section>

      {/* Outstanding Supplier Payables — every open bill from
          sizing mills, bobbin / yarn / fabric suppliers, and any
          pre-ERP opening payable. Grouped by supplier so the
          operator sees totals per party first; click to drill in. */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-violet-700" />
            <h2 className="font-display font-bold text-base">Outstanding Supplier Payables</h2>
          </div>
          <Link href="/app/payments" className="text-xs text-indigo font-semibold">All payments &rarr;</Link>
        </div>
        <OutstandingByParty
          groups={supplierGroups}
          direction="out"
          actionLabel="Pay"
          emptyText="No outstanding supplier bills — every sizing / bobbin / yarn / fabric purchase is settled."
          footnote={'Suppliers with one or more open bills across sizing, bobbin, yarn, fabric purchases, and opening payables. Click a row to see the individual bills. "Days due" = days since the bill date.'}
        />
      </section>

      </div>
      )}
    </div>
  );
}
