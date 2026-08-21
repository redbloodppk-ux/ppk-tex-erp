import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { Plus, Pencil, CheckCircle2 } from 'lucide-react';
import { LedgerDeleteButton } from './delete-button';
import { LedgerViewTab } from './ledger-view-tab';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Ledgers' };
export const dynamic = 'force-dynamic';

type Tab = 'master' | 'view';

// Columns the operator can sort by on the Master tab.
const SORTABLE_COLUMNS = new Set(['code', 'name']);

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

interface TypeOpt { id: number; name: string; }
interface NameOpt { name: string; }

// Row shape passed into <LedgerViewTab>. type_id drives the cascading
// Type → Ledger dropdown; type_name is for display.
interface LedgerOpt {
  id: number;
  code: string;
  name: string;
  type_id: number | null;
  type_name: string | null;
}

export default async function LedgersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; type?: string; name?: string; ledger?: string; sort?: string; dir?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'view' ? 'view' : 'master';
  const typeFilter = sp.type ?? '';
  const nameFilter = sp.name ?? '';
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'name';
  const dir: SortDir = sp.dir === 'desc' ? 'desc' : 'asc';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Filter strip on the Master tab: Type dropdown + a ledger-name
  // auto-suggest. We load every active ledger name to feed the
  // <datalist> so the browser suggests matches as the operator types.
  const [typesRes, namesRes] = await Promise.all([
    sb.from('ledger_type').select('id, name').eq('active', true).order('name'),
    sb.from('ledger').select('name').eq('active', true).order('name'),
  ]);
  const types = (typesRes.data ?? []) as TypeOpt[];
  const nameOptions = (namesRes.data ?? []) as NameOpt[];

  // ── Operational accounts vs party mirrors ────────────────────────
  // Ledger types in this set are auto-created one-per-party by triggers
  // (see migration 121): every customer, supplier, agent and jobwork
  // party gets a mirror ledger. There are 186 of them against 21 real
  // accounts, so unfiltered this list is a duplicate of the party master
  // with your banks and expense heads lost inside it.
  //
  // The mirrors are NOT dead — party.ledger_id points at them and that
  // is how Ledger View finds a party's bills and the statement finds
  // their bank entries. They are just not what you come to this screen
  // to manage, so they are hidden by default rather than removed.
  const PARTY_MIRROR_TYPES = new Set([
    'CUSTOMER', 'SUPPLIER', 'AGENT',
    'JOB WORK(CUSTOMER)', 'JOB WORK(VENDOR)', 'SIZING(VENDOR)', 'WEAVING(VENDOR)',
  ]);
  const operationalTypeIds = types
    .filter((t) => !PARTY_MIRROR_TYPES.has((t.name ?? '').toUpperCase()))
    .map((t) => t.id);
  /** 'operational' (default) hides the per-party mirrors; 'all' shows everything. */
  const scope: 'operational' | 'all' = sp.scope === 'all' ? 'all' : 'operational';

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
      .order(sort, { ascending: dir === 'asc' });
    if (typeFilter) {
      // An explicit Type choice always wins over the scope toggle —
      // picking "CUSTOMER" should show customer ledgers.
      q = q.eq('type_id', Number(typeFilter));
    } else if (scope === 'operational' && operationalTypeIds.length > 0) {
      q = q.in('type_id', operationalTypeIds);
    }
    if (nameFilter) q = q.ilike('name', `%${nameFilter}%`);
    const res = await q;
    rows = (res.data ?? []) as unknown as LedgerListRow[];
    listError = res.error;
  } else {
    const res = await sb
      .from('ledger')
      .select('id, code, name, type_id, ledger_type:type_id(name)')
      .eq('active', true)
      .order('name');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    viewLedgers = ((res.data ?? []) as any[]).map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      type_id: l.type_id ?? null,
      type_name: l.ledger_type?.name ?? null,
    }));
    listError = res.error;
  }

  // Helper to build filter / tab links that preserve the other params.
  function buildHref(next: Partial<{ tab: Tab; type: string | null; name: string | null; scope: 'operational' | 'all' }>): string {
    const params = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t === 'view') params.set('tab', 'view');
    // Preserve ledger filter on the View tab.
    if (t === 'view' && sp.ledger) params.set('ledger', sp.ledger);
    // Preserve type / name / scope only on the Master tab.
    if (t === 'master') {
      const ty = next.type !== undefined ? next.type : typeFilter;
      const nm = next.name !== undefined ? next.name : nameFilter;
      const sc = next.scope !== undefined ? next.scope : scope;
      if (ty) params.set('type', ty);
      if (nm) params.set('name', nm);
      // 'operational' is the default, so only 'all' needs to be in the URL.
      if (sc === 'all') params.set('scope', 'all');
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
          {/* Filter strip — Type dropdown + a ledger-name auto-suggest.
              The text input is backed by a <datalist>, so the browser
              suggests matching ledger names as the operator types. Forms
              with method=GET submit the new query string back to
              /app/ledgers, which re-runs the server component with the
              picked filters. No JS needed — works as a plain HTML form. */}
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
              <label className="label">Ledger name</label>
              <input
                type="text"
                name="name"
                defaultValue={nameFilter}
                list="ledger-name-options"
                autoComplete="off"
                placeholder="Start typing a ledger name…"
                className="input"
              />
              <datalist id="ledger-name-options">
                {nameOptions.map((n) => (
                  <option key={n.name} value={n.name} />
                ))}
              </datalist>
            </div>
            <div className="flex items-end gap-2">
              {/* Carry the scope through the GET form, otherwise applying
                  a name filter would silently snap back to the default. */}
              {scope === 'all' && <input type="hidden" name="scope" value="all" />}
              <button type="submit" className="btn-primary">Apply</button>
              <Link href="/app/ledgers" className="btn-ghost">Clear</Link>
            </div>
          </form>

          {/* Scope toggle. The Master list is 210 rows, but 186 of those
              are auto-created one per customer / supplier / agent / jobwork
              party — a duplicate of the party master. Your ~21 real
              accounts (banks, cash, expense heads, wages) get lost in it,
              so party ledgers are hidden unless asked for. */}
          {!typeFilter && (
            <div className="flex items-center gap-2 mb-4 text-xs">
              <span className="text-ink-mute">Showing</span>
              <Link
                href={buildHref({ scope: 'operational' })}
                className={
                  'px-2.5 py-1 rounded border font-medium ' +
                  (scope === 'operational'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-ink-soft border-line hover:border-indigo-400')
                }
              >
                Operational accounts
              </Link>
              <Link
                href={buildHref({ scope: 'all' })}
                className={
                  'px-2.5 py-1 rounded border font-medium ' +
                  (scope === 'all'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-ink-soft border-line hover:border-indigo-400')
                }
              >
                All, including party ledgers
              </Link>
              <span className="text-ink-mute">
                {scope === 'operational'
                  ? 'banks, cash, expense heads, wages — party ledgers hidden'
                  : 'includes one auto-created ledger per party'}
              </span>
            </div>
          )}

          {listError && (
            <div className="card p-4 text-sm text-err mb-4">
              Could not load ledgers: {listError.message}
            </div>
          )}

          {/* Mobile / PWA: card view. A wide table is hard to read and
              forces horizontal scrolling on a phone, so below md we render
              each ledger as a tap-friendly card instead. The table below is
              hidden on mobile and shown from md upward. */}
          <CardFilter placeholder="Search ledgers…">
            {rows.length ? rows.map((r) => (
              <div key={r.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/app/ledgers/${r.id}`} className="font-semibold text-ink hover:text-indigo break-words">
                      {r.name}
                    </Link>
                    {r.gstin_verified_at && (
                      <span className="inline-flex align-text-bottom ml-1.5" title="GSTIN verified">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="GSTIN verified" />
                      </span>
                    )}
                    <div className="font-mono text-xs text-ink-soft mt-0.5">{r.code}</div>
                  </div>
                  {r.active
                    ? <span className="pill bg-emerald-50 text-emerald-700 shrink-0">active</span>
                    : <span className="pill bg-slate-100 text-slate-500 shrink-0">inactive</span>}
                </div>

                <div className="text-xs text-ink-soft mt-2">
                  {r.ledger_type?.name ?? '-'} · {r.ledger_group?.name ?? '-'}
                </div>
                {r.gstin && (
                  <div className="text-xs mt-1">
                    <span className="text-ink-mute">GSTIN: </span>
                    <span className="font-mono">{r.gstin}</span>
                  </div>
                )}
                {r.area && (
                  <div className="text-xs mt-1">
                    <span className="text-ink-mute">Area: </span>{r.area}
                  </div>
                )}

                <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                  <Link href={`/app/ledgers/${r.id}`} className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold" title="Edit ledger">
                    <Pencil className="w-3 h-3" /> Edit
                  </Link>
                  <LedgerDeleteButton id={r.id} name={r.name} />
                </div>
              </div>
            )) : (
              <div className="card p-6 text-center text-sm text-ink-soft">
                No ledgers match the current filter.{' '}
                <Link href="/app/ledgers" className="text-indigo font-semibold">Clear filters →</Link>
              </div>
            )}
          </CardFilter>

          <div className="card overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <SortableTh column="code" label="Code" sort={sort} dir={dir} basePath="/app/ledgers" extraParams={{ type: typeFilter, name: nameFilter }} className="text-left px-4 py-3" />
                  <SortableTh column="name" label="Ledger Name" sort={sort} dir={dir} basePath="/app/ledgers" extraParams={{ type: typeFilter, name: nameFilter }} className="text-left px-4 py-3" />
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
