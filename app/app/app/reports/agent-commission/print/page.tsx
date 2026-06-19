/**
 * Agent-wise Commission Report — A4 print / PDF view.
 *
 * Same data as /app/reports/agent-commission, rendered without the app
 * shell for clean printing. Honours the same querystring filters:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD&agent_id=123
 *
 * When agent_id is set, the per-agent document drill-down is printed
 * below the summary; otherwise just the per-agent summary table.
 *
 * Source: view `public.v_agent_commission_report` (migration 206).
 */
import { createClient } from '@/lib/supabase/server';
import { PrintActions } from './print-actions';

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

function startOfFinYearISO(): string {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtINR(n: number | null | undefined, decimals = 2): string {
  const num = Number(n ?? 0);
  const sign = num < 0 ? '-' : '';
  return (
    sign +
    Math.abs(num).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear()).slice(2)
  );
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
      return s ?? '-';
  }
}

function typeLabel(t: string | null): string {
  switch (t) {
    case 'pcs':
      return 'Rs/pc';
    case 'metre':
      return 'Rs/m';
    case 'bag':
      return 'Rs/bag';
    case 'percent':
      return '%';
    default:
      return t ?? '-';
  }
}

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    agent_id?: string;
  }>;
}

export default async function AgentCommissionPrintPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const from = sp.from ?? startOfFinYearISO();
  const to = sp.to ?? todayISO();
  const agentIdParam = sp.agent_id ?? '';
  const agentIdNum = agentIdParam ? Number(agentIdParam) : null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('v_agent_commission_report')
    .select('*')
    .gte('doc_date', from)
    .lte('doc_date', to)
    .order('doc_date', { ascending: false });

  const rows = (data as unknown as ReportRow[]) ?? [];

  // company header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cpRes = await (supabase as any)
    .from('company_profile')
    .select('legal_name, display_name, gstin, address_line1, address_line2, city, state, pincode, phone')
    .limit(1)
    .maybeSingle();
  const cp = (cpRes?.data ?? {}) as {
    legal_name?: string;
    display_name?: string;
    gstin?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
  };
  const companyName = cp.legal_name ?? cp.display_name ?? 'Your Company';
  const companyAddress = [
    cp.address_line1,
    cp.address_line2,
    [cp.city, cp.state, cp.pincode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join('\n');

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

  const tSalesBiz = agents.reduce((s, a) => s + a.salesBiz, 0);
  const tSalesComm = agents.reduce((s, a) => s + a.salesComm, 0);
  const tPurchaseBiz = agents.reduce((s, a) => s + a.purchaseBiz, 0);
  const tPurchaseComm = agents.reduce((s, a) => s + a.purchaseComm, 0);
  const tComm = agents.reduce((s, a) => s + a.comm, 0);
  const tPaid = agents.reduce((s, a) => s + a.paid, 0);
  const tBalance = agents.reduce((s, a) => s + a.balance, 0);

  const selectedAgent = agentIdNum != null ? byAgent.get(agentIdNum) ?? null : null;
  const detailRows =
    agentIdNum != null
      ? rows
          .filter((r) => r.agent_party_id === agentIdNum)
          .sort((x, y) => (y.doc_date ?? '').localeCompare(x.doc_date ?? ''))
      : [];

  const backHref =
    `/app/reports/agent-commission?from=${from}&to=${to}` +
    (agentIdParam ? `&agent_id=${agentIdParam}` : '');

  return (
    <>
      <PrintActions
        backHref={backHref}
        from={from}
        to={to}
        agentName={selectedAgent?.agent_name ?? null}
      />

      <div
        className="statement-page p-8 mx-auto bg-paper text-ink"
        style={{ maxWidth: '210mm', minHeight: '297mm' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-ink pb-3 mb-4">
          <div>
            <h1 className="text-2xl font-display font-extrabold tracking-tight">{companyName}</h1>
            {companyAddress && (
              <pre className="text-xs text-ink-soft mt-0.5 whitespace-pre-line font-sans">
                {companyAddress}
              </pre>
            )}
            {cp.gstin && (
              <div className="text-xs text-ink-soft mt-0.5">
                GSTIN: <span className="font-mono">{cp.gstin}</span>
              </div>
            )}
            {cp.phone && <div className="text-xs text-ink-soft">Phone: {cp.phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-ink-mute">
              Agent Commission Report
            </div>
            <div className="text-sm font-semibold">
              {fmtDate(from)} to {fmtDate(to)}
            </div>
            {selectedAgent && (
              <div className="text-xs text-ink-soft mt-0.5">
                {selectedAgent.agent_name}
                {selectedAgent.agent_code ? ` (${selectedAgent.agent_code})` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Summary band */}
        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          <SummaryCell label="Agents" value={String(agents.length)} />
          <SummaryCell label="Sales comm (Rs)" value={fmtINR(tSalesComm)} />
          <SummaryCell label="Purchase comm (Rs)" value={fmtINR(tPurchaseComm)} />
          <SummaryCell label="Outstanding (Rs)" value={fmtINR(tBalance)} tone="rose" />
        </div>

        {/* Per-agent summary table */}
        {agents.length === 0 ? (
          <div className="p-8 text-center text-ink-soft border border-line/60 rounded-md">
            No agent commission recorded in this window.
          </div>
        ) : (
          <table className="w-full text-xs border border-line/60">
            <thead className="bg-cloud/50 text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-2 py-1.5 border-b border-line/60">Agent</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Sales value</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Sales comm</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Purch value</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Purch comm</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Total comm</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Paid</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.agent_party_id} className="border-b border-line/40">
                  <td className="px-2 py-1.5">
                    {a.agent_name ?? '-'}
                    {a.agent_code ? (
                      <span className="text-ink-mute"> ({a.agent_code})</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right num text-ink-soft">{fmtINR(a.salesBiz, 0)}</td>
                  <td className="px-2 py-1.5 text-right num">{fmtINR(a.salesComm)}</td>
                  <td className="px-2 py-1.5 text-right num text-ink-soft">{fmtINR(a.purchaseBiz, 0)}</td>
                  <td className="px-2 py-1.5 text-right num">{fmtINR(a.purchaseComm)}</td>
                  <td className="px-2 py-1.5 text-right num font-semibold">{fmtINR(a.comm)}</td>
                  <td className="px-2 py-1.5 text-right num text-emerald-700">{fmtINR(a.paid)}</td>
                  <td className="px-2 py-1.5 text-right num text-rose-700 font-medium">
                    {fmtINR(a.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-cloud/40 font-bold">
              <tr>
                <td className="px-2 py-2">Totals ({agents.length})</td>
                <td className="px-2 py-2 text-right num">{fmtINR(tSalesBiz, 0)}</td>
                <td className="px-2 py-2 text-right num">{fmtINR(tSalesComm)}</td>
                <td className="px-2 py-2 text-right num">{fmtINR(tPurchaseBiz, 0)}</td>
                <td className="px-2 py-2 text-right num">{fmtINR(tPurchaseComm)}</td>
                <td className="px-2 py-2 text-right num">{fmtINR(tComm)}</td>
                <td className="px-2 py-2 text-right num text-emerald-700">{fmtINR(tPaid)}</td>
                <td className="px-2 py-2 text-right num text-rose-700">{fmtINR(tBalance)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Drill-down for a selected agent */}
        {selectedAgent && detailRows.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold mb-2">
              {selectedAgent.agent_name}
              {selectedAgent.agent_code ? ` (${selectedAgent.agent_code})` : ''} — documents
            </h2>
            <table className="w-full text-xs border border-line/60">
              <thead className="bg-cloud/50 text-[10px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-2 py-1.5 border-b border-line/60">Date</th>
                  <th className="text-left px-2 py-1.5 border-b border-line/60">Type</th>
                  <th className="text-left px-2 py-1.5 border-b border-line/60">Doc #</th>
                  <th className="text-left px-2 py-1.5 border-b border-line/60">Party</th>
                  <th className="text-right px-2 py-1.5 border-b border-line/60">Business</th>
                  <th className="text-left px-2 py-1.5 border-b border-line/60">Rate</th>
                  <th className="text-right px-2 py-1.5 border-b border-line/60">Comm</th>
                  <th className="text-right px-2 py-1.5 border-b border-line/60">Paid</th>
                  <th className="text-right px-2 py-1.5 border-b border-line/60">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((r) => (
                  <tr key={r.commission_id} className="border-b border-line/40">
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(r.doc_date)}</td>
                    <td className="px-2 py-1.5">{sourceLabel(r.source)}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px]">{r.doc_no ?? '-'}</td>
                    <td className="px-2 py-1.5">{r.counterparty_name ?? '-'}</td>
                    <td className="px-2 py-1.5 text-right num text-ink-soft">
                      {fmtINR(r.business_value, 0)}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-ink-soft whitespace-nowrap">
                      {r.commission_rate != null
                        ? `${Number(r.commission_rate)} ${typeLabel(r.commission_type)}`
                        : typeLabel(r.commission_type)}
                    </td>
                    <td className="px-2 py-1.5 text-right num font-semibold">
                      {fmtINR(r.commission_amount)}
                    </td>
                    <td className="px-2 py-1.5 text-right num text-emerald-700">
                      {fmtINR(r.commission_paid)}
                    </td>
                    <td className="px-2 py-1.5 text-right num text-rose-700">
                      {fmtINR(r.commission_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-cloud/40 font-bold">
                <tr>
                  <td className="px-2 py-2" colSpan={4}>
                    {detailRows.length} document{detailRows.length === 1 ? '' : 's'}
                  </td>
                  <td className="px-2 py-2 text-right num">
                    {fmtINR(
                      detailRows.reduce((s, r) => s + Number(r.business_value ?? 0), 0),
                      0,
                    )}
                  </td>
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2 text-right num">{fmtINR(selectedAgent.comm)}</td>
                  <td className="px-2 py-2 text-right num text-emerald-700">
                    {fmtINR(selectedAgent.paid)}
                  </td>
                  <td className="px-2 py-2 text-right num text-rose-700">
                    {fmtINR(selectedAgent.balance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Footer note */}
        <div className="mt-6 text-[11px] text-ink-soft leading-relaxed border-t border-line/40 pt-3">
          <p>
            Business value is the invoice / bill total the commission was calculated on.
            Commission is always payable to the agent (an outflow), whether it sits on a sale
            or a purchase.
          </p>
          <p className="mt-2 italic">
            This is a system-generated report and does not require a signature.
          </p>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .statement-page { padding: 12mm !important; }
          @page { size: A4; margin: 8mm; }
        }
      `}</style>
    </>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'rose';
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line/60 p-2 bg-cloud/20">
      <div className="text-[10px] uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={'text-base font-extrabold num ' + (tone === 'rose' ? 'text-rose-700' : '')}>
        {value}
      </div>
    </div>
  );
}
