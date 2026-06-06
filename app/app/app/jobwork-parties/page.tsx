import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { formatRupee } from '@/lib/utils';
import Link from 'next/link';
import { Plus, Phone, MapPin } from 'lucide-react';

export const metadata = { title: 'Jobwork Parties' };
export const dynamic = 'force-dynamic';

// Columns the operator can sort by — defaults to name.
const SORTABLE_COLUMNS = new Set(['code', 'name']);

interface JWPRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  credit_limit: number | string | null;
  payment_terms_days: number | null;
  status: 'active' | 'inactive' | 'archived';
}

export default async function JobworkPartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'name';
  const dir: SortDir = sp.dir === 'desc' ? 'desc' : 'asc';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('jobwork_party')
    .select('id, code, name, gstin, phone, email, city, credit_limit, payment_terms_days, status')
    .order(sort, { ascending: dir === 'asc' });

  const rows = (data ?? []) as unknown as JWPRow[];

  return (
    <div>
      <PageHeader
        title="Jobwork Parties"
        subtitle="Master list of parties you send bobbins / fabric to for outside weaving."
        actions={
          <Link href="/app/jobwork-parties/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Jobwork Party
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load jobwork parties: {error.message}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <SortableTh column="code" label="Code" sort={sort} dir={dir} basePath="/app/jobwork-parties" className="text-left px-4 py-3" />
              <SortableTh column="name" label="Name" sort={sort} dir={dir} basePath="/app/jobwork-parties" className="text-left px-4 py-3" />
              <th className="text-left px-4 py-3 hidden md:table-cell">GSTIN</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Contact</th>
              <th className="text-right px-4 py-3">Credit Limit</th>
              <th className="text-right px-4 py-3">Terms</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((c) => (
              <tr key={c.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                <td className="px-4 py-3">
                  <Link href={`/app/jobwork-parties/${c.id}`} className="font-semibold text-ink hover:text-indigo">
                    {c.name}
                  </Link>
                  {c.status !== 'active' && (
                    <span className="ml-2 pill bg-slate-100 text-slate-500">{c.status}</span>
                  )}
                  <div className="md:hidden text-xs text-ink-mute font-mono mt-0.5">{c.gstin ?? '-'}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">{c.gstin ?? '-'}</td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                  <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {c.phone ?? '-'}</div>
                  {c.city && <div className="flex items-center gap-1.5 mt-0.5"><MapPin className="w-3 h-3" /> {c.city}</div>}
                </td>
                <td className="px-4 py-3 text-right num">{formatRupee(c.credit_limit, { compact: true })}</td>
                <td className="px-4 py-3 text-right num text-ink-soft">{c.payment_terms_days ?? 0}d</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No jobwork parties yet. <Link href="/app/jobwork-parties/new" className="text-indigo font-semibold">Add the first one &rarr;</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
