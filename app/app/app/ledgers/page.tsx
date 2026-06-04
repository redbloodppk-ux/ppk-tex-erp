import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil } from 'lucide-react';
import { LedgerDeleteButton } from './delete-button';

export const metadata = { title: 'Ledgers' };
export const dynamic = 'force-dynamic';

interface LedgerListRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  area: string | null;
  active: boolean;
  ledger_type: { name: string } | null;
  ledger_group: { name: string } | null;
}

export default async function LedgersPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('ledger')
    .select('id, code, name, gstin, phone, area, active, ledger_type:type_id(name), ledger_group:group_id(name)')
    .order('name');

  const rows = (data ?? []) as unknown as LedgerListRow[];

  return (
    <div>
      <PageHeader
        title="Ledgers"
        subtitle="Master of every accounting ledger. Type and Group are mandatory; code auto-generated."
        actions={
          <Link href="/app/ledgers/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Ledger
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load ledgers: {error.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Ledger Name</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Type</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Group</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">GSTIN</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Area</th>
              <th className="text-center px-4 py-3">Active</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                <td className="px-4 py-3">
                  <Link href={`/app/ledgers/${r.id}`} className="font-semibold text-ink hover:text-indigo">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft">{r.ledger_type?.name ?? '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft">{r.ledger_group?.name ?? '-'}</td>
                <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs">{r.gstin ?? '-'}</td>
                <td className="px-4 py-3 hidden lg:table-cell text-ink-soft">{r.area ?? '-'}</td>
                <td className="px-4 py-3 text-center">
                  {r.active
                    ? <span className="pill bg-emerald-50 text-emerald-700">active</span>
                    : <span className="pill bg-slate-100 text-slate-500">inactive</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-2">
                    <Link href={`/app/ledgers/${r.id}`} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 font-semibold" title="Edit ledger">
                      <Pencil className="w-3 h-3" /> Edit
                    </Link>
                    <LedgerDeleteButton id={r.id} name={r.name} />
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No ledgers yet. <Link href="/app/ledgers/new" className="text-indigo font-semibold">Add the first one &rarr;</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
