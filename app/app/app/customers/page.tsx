import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import Link from 'next/link';
import { Plus, Phone, MapPin } from 'lucide-react';

export const metadata = { title: 'Customers' };

export default async function CustomersPage() {
  const supabase = await createClient();
  const { data: customers, error } = await supabase
    .from('customer')
    .select('id, code, name, gstin, phone, email, city, credit_limit, payment_terms_days, status')
    .order('name');

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Master list of buyers — garment exporters, traders, retail brands."
        actions={
          <Link href="/app/customers/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Customer
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load customers: {error.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">GSTIN</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Contact</th>
              <th className="text-right px-4 py-3">Credit Limit</th>
              <th className="text-right px-4 py-3">Terms</th>
            </tr>
          </thead>
          <tbody>
            {customers?.length ? customers.map((c: any) => (
              <tr key={c.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                <td className="px-4 py-3">
                  <Link href={`/app/customers/${c.id}`} className="font-semibold text-ink hover:text-indigo">
                    {c.name}
                  </Link>
                  {c.status !== 'active' && (
                    <span className="ml-2 pill bg-slate-100 text-slate-500">{c.status}</span>
                  )}
                  <div className="md:hidden text-xs text-ink-mute font-mono mt-0.5">{c.gstin ?? '—'}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">{c.gstin ?? '—'}</td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                  <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {c.phone ?? '—'}</div>
                  {c.city && <div className="flex items-center gap-1.5 mt-0.5"><MapPin className="w-3 h-3" /> {c.city}</div>}
                </td>
                <td className="px-4 py-3 text-right num">{formatRupee(c.credit_limit, { compact: true })}</td>
                <td className="px-4 py-3 text-right num text-ink-soft">{c.payment_terms_days ?? 0}d</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No customers yet. <Link href="/app/customers/new" className="text-indigo font-semibold">Add the first one →</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
