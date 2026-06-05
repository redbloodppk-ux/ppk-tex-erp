import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil, CheckCircle2 } from 'lucide-react';
import { LedgerDeleteButton } from './delete-button';
import { LedgerViewTab } from './ledger-view-tab';

export const metadata = { title: 'Ledgers' };
export const dynamic = 'force-dynamic';

type Tab = 'master' | 'view';

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

// Row shape passed into <LedgerViewTab>. Includes the joined type
// name so the dropdown can show "Name (TYPE)".
interface LedgerOpt {
  id: number;
  code: string;
  name: string;
  type_name: string | null;
}

export default async function LedgersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; type?: string; group?: string; ledger?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'view' ? 'view' : 'master';
  const typeFilter  = sp.type  ?? '';
  const groupFilter = sp.group ?? '';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Always load types / groups for the filter strip on Master tab.
  const [typesRes, groupsRes] = await Promise.all([
    sb.from('ledger_type').select('id, name').eq('active', true).order('name'),
    sb.from('ledger_group').select('id, name').eq('active', true).order('name'),
  ]);
  const types  = (typesRes.data  ?? []) as TypeOpt[];
  const groups = (groupsRes.data ?? []) as GroupOpt[];

  // On Master tab we render the filtered table. On View tab we just
  // need the full ledger list (flattened with type name) to populate
  // the dropdown inside the client component.
  let rows: LedgerListRow[] = [];
  let listError: { message: string } | null = null;
  let viewLedgers: LedgerOpt[] = [];

  if (tab === 'master') {
    let q = sb
      .from('ledger')
      .select('id, code, name, gstin, gstin_verified_at, phone, area, active, type_id, group_id, ledger_type:type_id(name), ledger_group:group_id(name)')
      .order('name');
    if (typeFilter)  q = q.eq('type_id',  Number(typeFilter));
    if (groupFilter) q = q.eq('group_id', Number(groupFilter));
    const res = await q;
    rows = (res.data ?? []) as unknown as LedgerListRow[];
    listError = res.error;
  } else {
    const res = await sb
      .from('ledger')
      .select('id, code, name, ledger_type:type_id(name)')
      .eq('active', true)
      .order('name');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    viewLedgers = ((res.data ?? []) as any[]).map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      type_name: l.ledger_type?.name ?? null,
    }));
    listError = res.error;
  }

  // Helper to build filter / tab links that preserve the other params.
  function buildHref(next: Partial<{ tab: Tab; type: string | null; group: string | null }>): string {
    const params = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t === 'view') params.set('tab', 'view');
    // Preserve ledger filter on the View tab.
    if (t === 'view' && sp.ledger) params.set('ledger', sp.ledger);
    // Preserve type / group only on the Master tab.
    if (t === 'master') {
      const ty = next.type  !== undefined ? next.type  : typeFilter;
      const gr = next.group !== undefined ? next.group : groupFilter;
      if (ty) params.set('type',  ty);
      if (gr) params.set('group', gr);
    }
    const qs = params.toString();
    return qs ? `/app/ledgers?${qs}` : '/app/ledgers';
  }

  return (
    <div>
      <PageHeader
        title="Ledgers"
        subtitle="Master of every accounting ledger. Pick a ledger from the Ledger View tab to see its transaction history."
        actions={
          <Link href="/app/ledgers/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Ledger
          </Link>
        }
      />

      {/* Tabs */}
      <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
        <Link href={buildHref({ tab: 'master' })}
          className={
            'px-4 py-2 text-sm font-semibold border-b-2 -mb-px ' +
            (tab === 'master' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-ink-soft hover:text-ink')
          }>
          Master
        </Link>
        <Link href={buildHref({ tab: 'view' })}
          className={
            'px-4 py-2 text-sm font-semibold border-b-2 -mb-px ' +
            (tab === 'view' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-ink-soft hover:text-ink')
          }>
          Ledger View
        </Link>
      </div>

      {tab === 'view' ? (
        <LedgerViewTab ledgers={viewLedgers} />
      ) : (
        <>
          {/* Filter strip — Type + Group dropdowns. Forms with method=GET
              submit the new query string back to /app/ledgers, which
              re-runs the server component with the picked filters.
              No JS needed — works as a plain HTML form. */}
          <form method="GET" action="/app/ledgers" className="card p-3 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label">Type</label>
              <select name="type" defaultValue={typeFilter} className="input">
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t.id} value={String(t.id)}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Group</label>
              <select name="group" defaultValue={groupFilter} className="input">
                <option value="">All groups</option>
                {groups.map((g) => (
                  <option key={g.id} value={String(g.id)}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary">Apply</button>
              <Link href="/app/ledgers" className="btn-ghost">Clear</Link>
            </div>
          </form>

          {listError && (
            <div className="card p-4 text-sm text-err mb-4">
              Could not load ledgers: {listError.message}
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
        </>
      )}
    </div>
  );
}
