import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { formatRupee } from '@/lib/utils';
import Link from 'next/link';
import { Plus, Phone, MapPin, Star, CheckCircle2 } from 'lucide-react';

export const metadata = { title: 'Customers' };

interface PageProps {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}

// Columns the operator can sort by. Anything else falls back to the
// default — VIPs first, then alphabetical by name.
const SORTABLE_COLUMNS = new Set(['code', 'name']);

export default async function CustomersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'name';
  const dir: SortDir = sp.dir === 'desc' ? 'desc' : 'asc';

  const supabase = await createClient();
  let q = supabase
    .from('customer')
    .select('id, code, name, gstin, gstin_verified_at, phone, email, city, credit_limit, payment_terms_days, status, is_vip');

  // VIPs always float to the top of the list; the operator-chosen sort
  // applies within each tier.
  q = q.order('is_vip', { ascending: false });
  q = q.order(sort, { ascending: dir === 'asc' });

  const { data: customers, error } = await q;

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

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <SortableTh column="code" label="Code" sort={sort} dir={dir} basePath="/app/customers" className="text-left px-4 py-3" />
              <SortableTh column="name" label="Name" sort={sort} dir={dir} basePath="/app/customers" className="text-left px-4 py-3" />
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
                  <span className="inline-flex items-center gap-1.5">
                    {c.is_vip && (
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" aria-label="VIP customer" />
                    )}
                    <Link href={`/app/customers/${c.id}`} className="font-semibold text-ink hover:text-indigo">
                      {c.name}
                    </Link>
                    {c.gstin_verified_at && (
                      <span title="GSTIN verified" className="inline-flex">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="GSTIN verified" />
                      </span>
                    )}
                  </span>
                  {c.status !== 'active' && (
                    <span className="ml-2 pill bg-slate-100 text-slate-500">{c.status}</span>
                  )}
                  <div className="md:hidden text-xs text-ink-mute font-mono mt-0.5">{c.gstin ?? '—'}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">
                  {c.gstin ? (
                    <span className="inline-flex items-center gap-1">
                      {c.gstin}
                      {c.gstin_verified_at && (
                        <span title={`Verified on ${new Date(c.gstin_verified_at).toLocaleDateString()}`}>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-label="verified" />
                        </span>
                      )}
                    </span>
                  ) : '—'}
                </td>
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
