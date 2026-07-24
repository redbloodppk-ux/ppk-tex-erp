/**
 * Ledger View — A4 print / PDF view.
 *
 * Same data as the Ledgers → Ledger View tab, rendered without the app
 * shell for clean printing. Honours the same querystring filters:
 *   ?ledger_id=123&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Query + merge logic (all ten sources, running balance, credit-note
 * exclusion) is shared with the interactive tab via ./ledger-view-query
 * so the two views can never drift out of sync.
 */
import { createClient } from '@/lib/supabase/server';
import { BrandLogo } from '@/app/components/brand-logo';
import { fetchLedgerView, withRunningBalance, ledgerTotals } from '../ledger-view-query';
import { PrintActions } from './print-actions';

export const metadata = { title: 'Ledger Statement' };
export const dynamic = 'force-dynamic';

function fmtINR(n: number | string | null | undefined): string {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return '0.00';
  const sign = x < 0 ? '-' : '';
  return sign + Math.abs(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear());
}

function sourceLabel(source: string, billKind?: string): string {
  if (source === 'bill') return billKind ?? 'bill';
  if (source === 'bank') return billKind === 'bank_in' ? 'bank in' : 'bank out';
  return source;
}

interface PageProps {
  searchParams: Promise<{
    ledger_id?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function LedgerViewPrintPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const ledgerIdNum = sp.ledger_id ? Number(sp.ledger_id) : null;
  const from = sp.from || null;
  const to = sp.to || null;
  const backHref =
    `/app/ledgers?tab=view` + (sp.ledger_id ? `&ledger=${sp.ledger_id}` : '');

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  if (!ledgerIdNum) {
    return (
      <>
        <PrintActions backHref={backHref} ledgerName="Ledger" from={from} to={to} />
        <div className="statement-page p-8 mx-auto bg-paper text-ink" style={{ maxWidth: '210mm' }}>
          <div className="p-8 text-center text-ink-soft border border-line/60 rounded-md">
            No ledger selected. Go back and click <b>Show</b> on a ledger first.
          </div>
        </div>
      </>
    );
  }

  const [ledgerRes, cpRes, entries] = await Promise.all([
    sb.from('ledger')
      .select('id, code, name, type_id, ledger_type:type_id(name)')
      .eq('id', ledgerIdNum)
      .maybeSingle(),
    sb.from('company_profile')
      .select('legal_name, display_name, gstin, address_line1, address_line2, city, state, pincode, phone')
      .limit(1)
      .maybeSingle(),
    fetchLedgerView(sb, { ledgerId: ledgerIdNum, startDate: from ?? undefined, endDate: to ?? undefined }),
  ]);

  const ledgerRow = (ledgerRes?.data ?? null) as {
    id: number;
    code: string;
    name: string;
    type_id: number | null;
    ledger_type: { name: string } | null;
  } | null;
  const ledgerName = ledgerRow?.name ?? `Ledger #${ledgerIdNum}`;

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
  const companyAddress = [
    cp.address_line1,
    cp.address_line2,
    [cp.city, cp.state, cp.pincode].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n');

  const rows = withRunningBalance(entries);
  const totals = ledgerTotals(entries);

  return (
    <>
      <PrintActions backHref={backHref} ledgerName={ledgerName} from={from} to={to} />

      <div className="statement-page p-8 mx-auto bg-paper text-ink" style={{ maxWidth: '210mm', minHeight: '297mm' }}>
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-ink pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BrandLogo variant="mark" height={56} />
              <span className="text-4xl font-display font-extrabold tracking-tight text-ink leading-none">
                {cp.display_name ?? 'PPK TEX'}
              </span>
            </div>
            {companyAddress && (
              <pre className="text-xs text-ink-soft mt-0.5 whitespace-pre-line font-sans">{companyAddress}</pre>
            )}
            {cp.gstin && (
              <div className="text-xs text-ink-soft mt-0.5">
                GSTIN: <span className="font-mono">{cp.gstin}</span>
              </div>
            )}
            {cp.phone && <div className="text-xs text-ink-soft">Phone: {cp.phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-ink-mute">Ledger Statement</div>
            <div className="text-sm font-semibold">{ledgerName}</div>
            {ledgerRow?.ledger_type?.name && (
              <div className="text-xs text-ink-soft mt-0.5">{ledgerRow.ledger_type.name}</div>
            )}
            <div className="text-xs text-ink-soft mt-0.5">
              {from ? fmtDate(from) : 'Beginning'} to {to ? fmtDate(to) : 'Today'}
            </div>
          </div>
        </div>

        {/* Summary band */}
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <SummaryCell label="Total Debit (Rs)" value={fmtINR(totals.inflow)} />
          <SummaryCell label="Total Credit (Rs)" value={fmtINR(totals.outflow)} />
          <SummaryCell
            label="Closing balance (Rs)"
            value={fmtINR(totals.balance)}
            tone={totals.balance < 0 ? 'rose' : 'emerald'}
          />
        </div>

        {/* Transaction table */}
        {rows.length === 0 ? (
          <div className="p-8 text-center text-ink-soft border border-line/60 rounded-md">
            No transactions for {ledgerName}{(from || to) ? ' in the chosen date range' : ''}.
          </div>
        ) : (
          <table className="w-full text-xs border border-line/60">
            <thead className="bg-cloud/50 text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-2 py-1.5 border-b border-line/60">Date</th>
                <th className="text-left px-2 py-1.5 border-b border-line/60">Voucher</th>
                <th className="text-left px-2 py-1.5 border-b border-line/60">Counterparty</th>
                <th className="text-left px-2 py-1.5 border-b border-line/60">Bank / Cash</th>
                <th className="text-left px-2 py-1.5 border-b border-line/60">Reference</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Debit</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Credit</th>
                <th className="text-right px-2 py-1.5 border-b border-line/60">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line/40">
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {r.voucher}
                    {r.source !== 'payment' && (
                      <span className="ml-1 text-[9px] text-ink-mute">
                        ({sourceLabel(r.source, r.bill_kind)})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{r.counterparty}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.mode}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.reference ?? '-'}</td>
                  <td className="px-2 py-1.5 text-right num text-emerald-700">
                    {r.inflow > 0 ? fmtINR(r.inflow) : '-'}
                  </td>
                  <td className="px-2 py-1.5 text-right num text-rose-700">
                    {r.outflow > 0 ? fmtINR(r.outflow) : '-'}
                  </td>
                  <td className={
                    'px-2 py-1.5 text-right num font-semibold ' +
                    (r.balance > 0 ? 'text-emerald-700' : r.balance < 0 ? 'text-rose-700' : 'text-ink-soft')
                  }>
                    {fmtINR(r.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-cloud/40 font-bold">
              <tr>
                <td className="px-2 py-2" colSpan={5}>Totals</td>
                <td className="px-2 py-2 text-right num text-emerald-700">{fmtINR(totals.inflow)}</td>
                <td className="px-2 py-2 text-right num text-rose-700">{fmtINR(totals.outflow)}</td>
                <td className={
                  'px-2 py-2 text-right num ' +
                  (totals.balance > 0 ? 'text-emerald-700' : totals.balance < 0 ? 'text-rose-700' : 'text-ink-soft')
                }>
                  {fmtINR(totals.balance)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Footer note */}
        <div className="mt-6 text-[11px] text-ink-soft leading-relaxed border-t border-line/40 pt-3">
          <p>
            Debit raises the running balance (Dr); Credit lowers it (Cr). A positive closing
            balance means the party owes you (Dr); negative means you owe the party (Cr).
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
  tone?: 'rose' | 'emerald';
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line/60 p-2 bg-cloud/20">
      <div className="text-[10px] uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={
        'text-base font-extrabold num ' +
        (tone === 'rose' ? 'text-rose-700' : tone === 'emerald' ? 'text-emerald-700' : '')
      }>
        {value}
      </div>
    </div>
  );
}
