import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil, CheckCircle2 } from 'lucide-react';
import { LedgerDeleteButton } from './delete-button';

export const metadata = { title: 'Ledgers' };
export const dynamic = 'force-dynamic';

interface LedgerListRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  gstin_verified_at: string | null;
  phone: string | null;
  area: string | null;
  active: boolean;
  type_id: number | null;
  group_id: number | null;
  ledger_type: { name: string } | null;
  ledger_group: { name: string } | null;
}

interface TypeOpt  { id: number; name: string; }
interface GroupOpt { id: number; name: string; }

export default async function LedgersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; group?: string }>;
}) {
  const sp = await searchParams;
  const typeFilter  = sp.type  ?? '';
  const groupFilter = sp.group ?? '';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Pull all types / groups for the filter dropdowns. Plus the ledger
  // list itself, narrowed by the active filters.
  const [typesRes, groupsRes] = await Promise.all([
    sb.from('ledger_type').select('id, name').eq('active', true).order('name'),
    sb.from('ledger_group').select('id, name').eq('active', true).order('name'),
  ]);

  let query = sb
    .from('ledger')
    .select('id, code, name, gstin, gstin_verified_at, phone, area, active, type_id, group_id, ledger_type:type_id(name), ledger_group:group_id(name)')
    .order('name');
  if (typeFilter)  query = query.eq('type_id',  Number(typeFilter));
  if (groupFilter) query = query.eq('group_id', Number(groupFilter));

  const { data, error } = await query;
  const rows  = (data ?? []) as unknown as LedgerListRow[];
  const types  = (typesRes.data  ?? []) as TypeOpt[];
  const groups = (groupsRes.data ?? []) as GroupOpt[];

  // Helper to build filter links that preserve the other filter.
  function filterHref(next: { type?: string | null; group?: string | null }): string {
    const params = new URLSearchParams();
    const t = next.type !== undefined ? next.type : typeFilter;
    const g = next.group !== undefined ? next.group : groupFilter;
    if (t) params.set('type',  t);
    if (g) params.set('group', g);
    const qs = params.toString();
    return qs ? `/app/ledgers?${qs}` : '/app/ledgers';
  }

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

      {/* Filter strip — pills for Type and Group. Selecting one keeps the
          other in place via filterHref(). Clear filter via the "All" pill. */}
      <div className="card p-3 mb-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-mute font-semibold uppercase">Type:</span>
          <Link href={filterHref({ type: null })}
            className={'pill ' + (typeFilter === '' ? 'bg-indigo-600 text-white' : 'bg-cloud text-ink-soft hover:bg-indigo-50')}>
            All
          </Link>
          {types.map((t) => (
            <Link key={t.id} href={filterHref({ type: String(t.id) })}
              className={'pill ' + (typeFilter === String(t.id) ? 'bg-indigo-600 text-white' : 'bg-cloud text-ink-soft hover:bg-indigo-50')}>
              {t.name}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-mute font-semibold uppercase">Group:</span>
          <Link href={filterHref({ group: null })}
            className={'pill ' + (groupFilter === '' ? 'bg-indigo-600 text-white' : 'bg-cloud text-ink-soft hover:bg-indigo-50')}>
            All
          </Link>
          {groups.map((g) => (
            <Link key={g.id} href={filterHref({ group: String(g.id) })}
              className={'pill ' + (groupFilter === String(g.id) ? 'bg-indigo-600 text-white' : 'bg-cloud text-ink-soft hover:bg-indigo-50')}>
              {g.name}
            </Link>
          ))}
        </div>
      </div>

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
                  {r.gstin_verified_at && (
                    <span className="inline-flex align-text-bottom ml-1.5" title="GSTIN verified">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="GSTIN verified" />
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft">{r.ledger_type?.name ?? '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft">{r.ledger_group?.name ?? '-'}</td>
                <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs">
                  {r.gstin ? (
                    <span className="inline-flex items-center gap-1">
                      {r.gstin}
                      {r.gstin_verified_at && (
                        <span title={`Verified on ${new Date(r.gstin_verified_at).toLocaleDateString()}`}>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-label="verified" />
                        </span>
                      )}
                    </span>
                  ) : '-'}
                </td>
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
                  No ledgers match the current filter. <Link href="/app/ledgers" className="text-indigo font-semibold">Clear filters →</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
