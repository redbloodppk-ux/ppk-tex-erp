/**
 * Agent-wise Commission Report
 *
 * Combined view of every agent / broker's activity across both sides of the
 * business — sales invoices on one side, yarn + fabric purchases on the other.
 *
 * For each agent it shows the underlying brokered business value AND the
 * commission earned / paid / outstanding. Click an agent to drill into the
 * individual documents behind their totals.
 *
 * Source: view `public.v_agent_commission_report` (migration 206).
 *
 * Filters via querystring:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (defaults: 1st of this FY-ish month → today)
 *   ?agent_id=123                    (optional — opens the drill-down section)
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  Users,
  TrendingUp,
  ShoppingCart,
  Wallet,
  AlertCircle,
} from 'lucide-react';

export const metadata = { title: 'Agent Commission' };
export const dynamic = 'force-dynamic';

interface ReportRow {
  commission_id: number;
  side: 'sales' | 'purchase';
  source: 'sales' | 'yarn_purchase' | 'fabric_purchase';
  source_id: number | null;
  doc_no: string | null;
  doc_date: string | null;
  agent_party_id: number;
  agent_code: string | null;
  agent_name: string | null;
  counterparty_name: string | null;
  business_value: number | null;
  commission_type: string | null;
  commission_rate: number | null;
  commission_amount: number | null;
  commission_paid: number | null;
  commission_balance: number | null;
  status: string | null;
}

interface AgentSummary {
  agent_party_id: number;
  agent_code: string | null;
  agent_name: string | null;
  salesBiz: number;
  salesComm: number;
  purchaseBiz: number;
  purchaseComm: number;
  comm: number;
  paid: number;
  balance: number;
  docs: number;
}

/* ─────────────── date / format helpers ─────────────── */

function startOfFinYearISO(): string {
  // Indian FY starts 1 April. Pick the current FY's April 1.
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtRupees(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  return (
    sign +
    '₹' +
    Math.abs(num).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function sourceLabel(s: string | null): string {
  switch (s) {
    case 'sales':
      return 'Sale';
    case 'yarn_purchase':
      return 'Yarn';
    case 'fabric_purchase':
      return 'Fabric';
    default:
      return s ?? '—';
  }
}

function sourceTone(s: string | null): string {
  if (s === 'sales') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (s === 'yarn_purchase')
    return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-violet-50 text-violet-700 border-violet-200';
}

function typeLabel(t: string | null): string {
  switch (t) {
    case 'pcs':
      return '₹/pc';
    case 'metre':
      return '₹/m';
    case 'bag':
      return '₹/bag';
    case 'percent':
      return '%';
    default:
      return t ?? '—';
  }
}

/* drill-down link target — only sales invoices have a detail page */
function docHref(r: ReportRow): string | null {
  if (r.source === 'sales' && r.source_id != null) {
    return `/app/invoices/${r.source_id}`;
  }
  return null;
}

/* ─────────────── page ─────────────── */

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    agent_id?: string;
  }>;
}

export default async function AgentCommissionReport({
  searchParams,
}: PageProps) {
  const sp = await searchParams;
  const from = sp.from ?? startOfFinYearISO();
  const to = sp.to ?? todayISO();
  const agentIdParam = sp.agent_id ?? '';
  const agentIdNum = agentIdParam ? Number(agentIdParam) : null;

  const supabase = await createClient();

  const { data, error } = await (supabase as any)
    .from('v_agent_commission_report')
    .select('*')
    .gte('doc_date', from)
    .lte('doc_date', to)
    .order('doc_date', { ascending: false });

  const rows = (data as unknown as ReportRow[]) ?? [];

  /* roll up by agent */
  const byAgent = new Map<number, AgentSummary>();
  for (const r of rows) {
    let a = byAgent.get(r.agent_party_id);
    if (!a) {
      a = {
        agent_party_id: r.agent_party_id,
        agent_code: r.agent_code,
        agent_name: r.agent_name,
        salesBiz: 0,
        salesComm: 0,
        purchaseBiz: 0,
        purchaseComm: 0,
        comm: 0,
        paid: 0,
        balance: 0,
        docs: 0,
      };
      byAgent.set(r.agent_party_id, a);
    }
    const biz = Number(r.business_value ?? 0);
    const comm = Number(r.commission_amount ?? 0);
    if (r.side === 'sales') {
      a.salesBiz += biz;
      a.salesComm += comm;
    } else {
      a.purchaseBiz += biz;
      a.purchaseComm += comm;
    }
    a.comm += comm;
    a.paid += Number(r.commission_paid ?? 0);
    a.balance += Number(r.commission_balance ?? 0);
    a.docs += 1;
  }
  const agents = Array.from(byAgent.values()).sort((x, y) => y.comm - x.comm);

  /* grand totals */
  const tSalesBiz = agents.reduce((s, a) => s + a.salesBiz, 0);
  const tSalesComm = agents.reduce((s, a) => s + a.salesComm, 0);
  const tPurchaseBiz = agents.reduce((s, a) => s + a.purchaseBiz, 0);
  const tPurchaseComm = agents.reduce((s, a) => s + a.purchaseComm, 0);
  const tComm = agents.reduce((s, a) => s + a.comm, 0);
  const tPaid = agents.reduce((s, a) => s + a.paid, 0);
  const tBalance = agents.reduce((s, a) => s + a.balance, 0);

  /* selected agent drill-down rows */
  const selectedAgent =
    agentIdNum != null ? byAgent.get(agentIdNum) ?? null : null;
  const detailRows =
    agentIdNum != null
      ? rows
          .filter((r) => r.agent_party_id === agentIdNum)
          .sort((x, y) => (y.doc_date ?? '').localeCompare(x.doc_date ?? ''))
      : [];

  /* Excel export — the per-agent summary */
  const exportColumns: ExcelColumn[] = [
    { key: 'agent', label: 'Agent', type: 'text', width: 26 },
    { key: 'docs', label: 'Docs', type: 'number', width: 8, total: true },
    { key: 'salesBiz', label: 'Sales Value', type: 'rupee', width: 15, total: true },
    { key: 'salesComm', label: 'Sales Comm', type: 'rupee', width: 14, total: true },
    { key: 'purchaseBiz', label: 'Purchase Value', type: 'rupee', width: 15, total: true },
    { key: 'purchaseComm', label: 'Purchase Comm', type: 'rupee', width: 14, total: true },
    { key: 'comm', label: 'Total Comm', type: 'rupee', width: 14, total: true },
    { key: 'paid', label: 'Paid', type: 'rupee', width: 13, total: true },
    { key: 'balance', label: 'Outstanding', type: 'rupee', width: 14, total: true },
  ];
  const exportRows = agents.map((a) => ({
    agent: a.agent_code ? `${a.agent_name} (${a.agent_code})` : a.agent_name ?? '',
    docs: a.docs,
    salesBiz: a.salesBiz,
    salesComm: a.salesComm,
    purchaseBiz: a.purchaseBiz,
    purchaseComm: a.purchaseComm,
    comm: a.comm,
    paid: a.paid,
    balance: a.balance,
  }));

  /* helper to build querystrings that preserve the date window */
  const dateQs = `from=${from}&to=${to}`;

  return (
    <div>
      <PageHeader
        title="Agent Commission"
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Agent Commission' },
        ]}
        subtitle={`Agent-wise sales & purchase brokerage between ${from} and ${to}. Business value is the brokered invoice/bill amount. Commission — on both sales and purchases — is always payable to the agent (a cash outflow).`}
        actions={
          <ExcelExportButton
            filename="agent-commission"
            sheetName="Agent Commission"
            title={`Agent Commission · ${from} to ${to}`}
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* ─────────────── Filter strip ─────────────── */}
      <form
        className="card p-3 mb-4 flex flex-wrap gap-3 items-end text-sm"
        action=""
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Agent</span>
          <select
            name="agent_id"
            defaultValue={agentIdParam}
            className="input min-w-[200px]"
          >
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.agent_party_id} value={a.agent_party_id}>
                {a.agent_code ? `${a.agent_code} — ${a.agent_name}` : a.agent_name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
        <a
          href="/app/reports/agent-commission"
          className="text-xs text-ink-mute self-center hover:text-ink underline"
        >
          Reset
        </a>
      </form>

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi
          icon={<Users className="w-4 h-4" />}
          label="Agents"
          value={fmtNum(agents.length)}
          sub={`${fmtNum(rows.length)} document${rows.length === 1 ? '' : 's'}`}
        />
        <Kpi
          icon={<TrendingUp className="w-4 h-4" />}
          label="Sales commission"
          value={fmtRupees(tSalesComm)}
          sub={`on ${fmtRupees(tSalesBiz)} brokered sales`}
        />
        <Kpi
          icon={<ShoppingCart className="w-4 h-4" />}
          label="Purchase commission"
          value={fmtRupees(tPurchaseComm)}
          sub={`on ${fmtRupees(tPurchaseBiz)} brokered purchases`}
        />
        <Kpi
          icon={<Wallet className="w-4 h-4" />}
          label="Payable (outstanding)"
          value={fmtRupees(tBalance)}
          sub={`${fmtRupees(tComm)} payable · ${fmtRupees(tPaid)} paid`}
        />
      </div>

      {/* ─────────────── Error / empty ─────────────── */}
      {error && (
        <div className="card p-4 text-sm text-err mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load agent commission data.</div>
            <div className="text-xs opacity-80 mt-1">{error.message}</div>
          </div>
        </div>
      )}

      {!error && agents.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No agent commission recorded in this window.
        </div>
      ) : null}

      {/* ─────────────── Per-agent summary ─────────────── */}
      {agents.length > 0 && (
        <div className="card p-0 overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Agent</th>
                <th className="text-right px-3 py-2">Sales value</th>
                <th className="text-right px-3 py-2">Sales comm</th>
                <th className="text-right px-3 py-2">Purchase value</th>
                <th className="text-right px-3 py-2">Purchase comm</th>
                <th className="text-right px-3 py-2">Total comm</th>
                <th className="text-right px-3 py-2">Paid</th>
                <th className="text-right px-3 py-2">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const isSel = a.agent_party_id === agentIdNum;
                return (
                  <tr
                    key={a.agent_party_id}
                    className={`border-t border-line/40 ${isSel ? 'bg-sky-50/40' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/app/reports/agent-commission?${dateQs}&agent_id=${a.agent_party_id}`}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        {a.agent_name ?? '—'}
                      </Link>
                      {a.agent_code ? (
                        <span className="ml-1 text-xs text-ink-mute">
                          ({a.agent_code})
                        </span>
                      ) : null}
                      <span className="ml-2 text-[11px] text-ink-mute">
                        {a.docs} doc{a.docs === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right num text-ink-soft">
                      {fmtRupees(a.salesBiz)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(a.salesComm, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-ink-soft">
                      {fmtRupees(a.purchaseBiz)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(a.purchaseComm, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold">
                      {fmtRupees(a.comm, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-emerald-700">
                      {fmtRupees(a.paid, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num text-rose-700 font-medium">
                      {fmtRupees(a.balance, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-cloud/40 font-semibold text-xs">
              <tr className="border-t-2 border-line">
                <td className="px-3 py-2">Totals ({agents.length} agents)</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tSalesBiz)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tSalesComm, 2)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tPurchaseBiz)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tPurchaseComm, 2)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tComm, 2)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tPaid, 2)}</td>
                <td className="px-3 py-2 text-right num">{fmtRupees(tBalance, 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ─────────────── Drill-down for a selected agent ─────────────── */}
      {selectedAgent && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">
              {selectedAgent.agent_name}
              {selectedAgent.agent_code ? (
                <span className="ml-1 text-sm text-ink-mute">
                  ({selectedAgent.agent_code})
                </span>
              ) : null}{' '}
              — documents
            </h2>
            <a
              href={`/app/reports/agent-commission?${dateQs}`}
              className="text-xs text-ink-mute hover:text-ink underline"
            >
              Close
            </a>
          </div>

          {detailRows.length === 0 ? (
            <div className="card p-6 text-center text-sm text-ink-mute">
              No documents for this agent in the window.
            </div>
          ) : (
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Doc #</th>
                    <th className="text-left px-3 py-2">Party</th>
                    <th className="text-right px-3 py-2">Business ₹</th>
                    <th className="text-left px-3 py-2">Rate</th>
                    <th className="text-right px-3 py-2">Comm ₹</th>
                    <th className="text-right px-3 py-2">Paid</th>
                    <th className="text-right px-3 py-2">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((r) => {
                    const href = docHref(r);
                    return (
                      <tr
                        key={r.commission_id}
                        className="border-t border-line/40"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {fmtDate(r.doc_date)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${sourceTone(r.source)}`}
                          >
                            {sourceLabel(r.source)}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {href ? (
                            <Link
                              href={href}
                              className="text-sky-700 hover:underline"
                            >
                              {r.doc_no ?? '—'}
                            </Link>
                          ) : (
                            r.doc_no ?? '—'
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.counterparty_name ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right num text-ink-soft">
                          {fmtRupees(r.business_value)}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">
                          {r.commission_rate != null
                            ? `${Number(r.commission_rate)} ${typeLabel(r.commission_type)}`
                            : typeLabel(r.commission_type)}
                        </td>
                        <td className="px-3 py-2 text-right num font-semibold">
                          {fmtRupees(r.commission_amount, 2)}
                        </td>
                        <td className="px-3 py-2 text-right num text-emerald-700">
                          {fmtRupees(r.commission_paid, 2)}
                        </td>
                        <td className="px-3 py-2 text-right num text-rose-700">
                          {fmtRupees(r.commission_balance, 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-cloud/40 font-semibold text-xs">
                  <tr className="border-t-2 border-line">
                    <td className="px-3 py-2" colSpan={4}>
                      {detailRows.length} document
                      {detailRows.length === 1 ? '' : 's'}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(
                        detailRows.reduce(
                          (s, r) => s + Number(r.business_value ?? 0),
                          0,
                        ),
                      )}
                    </td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(selectedAgent.comm, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(selectedAgent.paid, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtRupees(selectedAgent.balance, 2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-ink-mute mt-4">
        Source: <span className="font-mono">v_agent_commission_report</span>{' '}
        (migration 206). Business value is the invoice / bill total the
        commission was calculated on. Commission is always payable to the agent
        (an outflow), whether it sits on a sale or a purchase. Click an agent to
        see their documents; sale documents link to the invoice.
      </p>
    </div>
  );
}

/* ─────────────── presentational helpers ─────────────── */

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function Kpi({ icon, label, value, sub }: KpiProps) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-mute">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub ? (
        <div className="text-[11px] text-ink-mute mt-0.5">{sub}</div>
      ) : null}
    </div>
  );
}
