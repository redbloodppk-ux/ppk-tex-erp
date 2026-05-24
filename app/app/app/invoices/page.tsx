import Link from 'next/link';
import { Plus, FileText, Coins, Briefcase, RotateCcw, ArrowDownLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';

export const metadata = { title: 'Invoices' };

const DOC_TABS = [
  { key: 'all',           label: 'All',           icon: FileText        },
  { key: 'tax_invoice',   label: 'Fabric Sales',  icon: FileText        },
  { key: 'yarn_sale',     label: 'Yarn Sales',    icon: Coins           },
  { key: 'general_sale',  label: 'General Sales', icon: Briefcase       },
  { key: 'credit_note',   label: 'Sales Returns', icon: RotateCcw       },
  { key: 'debit_note',    label: 'Purchase Returns', icon: ArrowDownLeft },
] as const;

const STATUS_STYLE: Record<string, string> = {
  draft:        'bg-slate-100 text-slate-700',
  issued:       'bg-indigo-50 text-indigo-700',
  partial_paid: 'bg-amber-50 text-amber-700',
  paid:         'bg-emerald-50 text-emerald-700',
  overdue:      'bg-rose-50 text-rose-700',
  cancelled:    'bg-slate-100 text-slate-500 line-through',
};

const DOC_LABEL: Record<string, string> = {
  tax_invoice:  'Fabric',
  yarn_sale:    'Yarn',
  general_sale: 'General',
  credit_note:  'Sales Return',
  debit_note:   'Purchase Return',
};

const DOC_PILL: Record<string, string> = {
  tax_invoice:  'bg-indigo-50 text-indigo-700',
  yarn_sale:    'bg-amber-50 text-amber-700',
  general_sale: 'bg-slate-100 text-slate-700',
  credit_note:  'bg-rose-50 text-rose-700',
  debit_note:   'bg-violet-50 text-violet-700',
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const activeTab = sp.type ?? 'all';
  const supabase = await createClient();

  let q = supabase
    .from('invoice')
    .select(`
      id, invoice_no, doc_type, invoice_date, due_date,
      taxable_value, cgst_amount, sgst_amount, igst_amount, total, balance, status,
      customer:customer_id ( name ),
      vendor:vendor_id     ( name ),
      original_invoice_id
    `)
    .order('invoice_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);

  if (activeTab !== 'all') {
    // activeTab is a URL param (string). Cast to the enum so the typed
    // filter accepts it. Invalid values just return an empty list.
    type DocType = 'tax_invoice' | 'yarn_sale' | 'general_sale' | 'credit_note' | 'debit_note';
    q = q.eq('doc_type', activeTab as DocType);
  }

  const { data: invoices, error } = await q;

  // KPI counts per tab
  const { data: counts } = await supabase
    .from('invoice')
    .select('doc_type');
  const tally = (counts ?? []).reduce<Record<string, number>>((a, r: any) => {
    a[r.doc_type] = (a[r.doc_type] ?? 0) + 1;
    return a;
  }, {});

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Tax invoices, yarn sales, general sales, and returns — all in one place."
        actions={
          <Link href={`/app/invoices/new${activeTab !== 'all' ? `?type=${activeTab}` : ''}`} className="btn-primary">
            <Plus className="w-4 h-4" /> New Invoice
          </Link>
        }
      />

      {/* Doc-type tabs */}
      <div className="card p-2 mb-4 flex flex-wrap gap-1">
        {DOC_TABS.map(t => {
          const Icon = t.icon;
          const n = t.key === 'all'
            ? Object.values(tally).reduce((a, b) => a + b, 0)
            : (tally[t.key] ?? 0);
          const active = activeTab === t.key;
          return (
            <Link
              key={t.key}
              href={`/app/invoices${t.key === 'all' ? '' : `?type=${t.key}`}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition
                ${active ? 'bg-indigo text-white' : 'text-ink-soft hover:bg-haze'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
              <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] num
                ${active ? 'bg-white/20' : 'bg-cloud text-ink-soft'}`}>
                {n}
              </span>
            </Link>
          );
        })}
      </div>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load invoices: {error.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-4 py-3">Doc No</th>
                <th className="text-left  px-4 py-3">Type</th>
                <th className="text-left  px-4 py-3">Date</th>
                <th className="text-left  px-4 py-3">Party</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Taxable</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">GST</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Balance</th>
                <th className="text-left  px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices?.length ? invoices.map((inv: any) => {
                const gst = Number(inv.cgst_amount) + Number(inv.sgst_amount) + Number(inv.igst_amount);
                const partyName = inv.customer?.name ?? inv.vendor?.name ?? '—';
                return (
                  <tr key={inv.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">
                      <Link href={`/app/invoices/${inv.id}`} className="hover:text-indigo">
                        {inv.invoice_no}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${DOC_PILL[inv.doc_type] ?? ''}`}>
                        {DOC_LABEL[inv.doc_type] ?? inv.doc_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{inv.invoice_date}</td>
                    <td className="px-4 py-3">{partyName}</td>
                    <td className="px-4 py-3 text-right num hidden md:table-cell">{Number(inv.taxable_value).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right num hidden lg:table-cell">{gst.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right num font-semibold">{Number(inv.total).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right num hidden md:table-cell">
                      {inv.doc_type === 'debit_note' || inv.doc_type === 'credit_note'
                        ? '—'
                        : Number(inv.balance ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${STATUS_STYLE[inv.status] ?? ''}`}>
                        {inv.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-soft">
                    No invoices in this view yet.{' '}
                    <Link href={`/app/invoices/new${activeTab !== 'all' ? `?type=${activeTab}` : ''}`}
                      className="text-indigo font-semibold">
                      Create one →
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
