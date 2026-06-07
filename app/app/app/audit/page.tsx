/**
 * Audit Log viewer — CORR-H3
 *
 * Browse the `audit_log` table written by `fn_audit_row()` (see schema.sql
 * line ~30). Every INSERT/UPDATE/DELETE on a watched table produces a row
 * with table_name, row_pk, action, old_data, new_data, changed_by.
 *
 * URL params drive the filters so links to specific filtered views are
 * shareable / bookmarkable:
 *   ?table=<entity>    — exact match on table_name
 *   ?action=<verb>     — INSERT | UPDATE | DELETE
 *   ?from=YYYY-MM-DD   — inclusive lower bound on changed_at
 *   ?to=YYYY-MM-DD     — inclusive upper bound on changed_at (end of day)
 *   ?actor=<email>     — substring match on the user's email
 *   ?row=<row_pk>      — exact match on the affected row's primary key
 *   ?page=N            — 1-based page number for pagination (50 / page)
 *
 * The user list dropdown is populated from app_user (changed_by → uuid →
 * app_user.email). Old rows where changed_by is NULL show as '— system —'.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import { formatDate } from '@/lib/utils';
import { Eye, AlertTriangle } from 'lucide-react';

export const metadata = { title: 'Audit Log' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface AuditRow {
  id: number;
  table_name: string;
  row_pk: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_at: string;
  changed_by: string | null;
}

interface UserOpt {
  id: string;
  email: string;
  full_name: string;
}

interface PageProps {
  searchParams: Promise<{
    table?: string;
    action?: string;
    from?: string;
    to?: string;
    actor?: string;
    row?: string;
    page?: string;
  }>;
}

function actionPill(a: AuditRow['action']): { label: string; cls: string } {
  switch (a) {
    case 'INSERT': return { label: 'Created',  cls: 'bg-emerald-50 text-emerald-700' };
    case 'UPDATE': return { label: 'Updated',  cls: 'bg-amber-50 text-amber-700' };
    case 'DELETE': return { label: 'Deleted',  cls: 'bg-rose-50 text-rose-700' };
    default:       return { label: String(a), cls: 'bg-slate-100 text-slate-600' };
  }
}

function isValidIsoDate(s: string | undefined): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export default async function AuditPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tableFilter  = sp.table?.trim() || null;
  const actionFilter = sp.action && ['INSERT','UPDATE','DELETE'].includes(sp.action) ? sp.action : null;
  const fromDate     = isValidIsoDate(sp.from) ? sp.from : null;
  const toDate       = isValidIsoDate(sp.to)   ? sp.to   : null;
  const actorFilter  = sp.actor?.trim() || null;
  const rowFilter    = sp.row?.trim() || null;
  const page         = Math.max(1, Number(sp.page ?? '1') || 1);
  const offset       = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // ── User dropdown options ───────────────────────────────────────
  // app_user is small (a handful of operators), so fetch the whole
  // active list for the picker. We also use it to resolve uuids to
  // emails on the displayed rows below.
  const { data: usersRaw } = await sb
    .from('app_user')
    .select('id, email, full_name')
    .order('email');
  const users: UserOpt[] = (usersRaw ?? []) as UserOpt[];
  const userById = new Map(users.map((u) => [u.id, u]));

  // If actor filter is an email, resolve to uuid for an exact query.
  const actorUuid = actorFilter
    ? users.find((u) => u.email.toLowerCase() === actorFilter.toLowerCase())?.id ?? null
    : null;

  // ── Distinct tables for the dropdown ────────────────────────────
  // Pulled from the schema's hard-coded list of audited tables. Listed
  // alphabetically for the picker. New audited tables should be added
  // here as they're added to the fn_audit_row triggers — keeping this
  // hand-curated avoids an expensive DISTINCT scan on audit_log.
  const AUDITED_TABLES: ReadonlyArray<string> = [
    'app_user',
    'attendance_day',
    'attendance_entry',
    'bobbin',
    'company_profile',
    'costing_master',
    'customer',
    'delivery_challan',
    'employee',
    'fabric_quality',
    'fabric_receipt',
    'fabric_receipt_item',
    'jobwork_party',
    'ledger',
    'opening_stock',
    'party',
    'pavu',
    'payment',
    'production_batch',
    'purchase_invoice',
    'purchase_invoice_item',
    'sales_invoice',
    'sales_invoice_item',
    'sizing_job',
    'wage_entry',
    'yarn_count',
    'yarn_lot',
  ];

  // ── Main query ──────────────────────────────────────────────────
  let q = sb
    .from('audit_log')
    .select('id, table_name, row_pk, action, changed_at, changed_by', { count: 'exact' })
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (tableFilter)  q = q.eq('table_name', tableFilter);
  if (actionFilter) q = q.eq('action', actionFilter);
  if (fromDate)     q = q.gte('changed_at', `${fromDate}T00:00:00`);
  if (toDate)       q = q.lte('changed_at', `${toDate}T23:59:59.999`);
  if (actorUuid)    q = q.eq('changed_by', actorUuid);
  if (rowFilter)    q = q.eq('row_pk', rowFilter);
  const { data, count, error } = await q;
  const rows: AuditRow[] = (data ?? []) as AuditRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build a "preserve filters across page links" base path
  const qs = new URLSearchParams();
  if (tableFilter)  qs.set('table', tableFilter);
  if (actionFilter) qs.set('action', actionFilter);
  if (fromDate)     qs.set('from', fromDate);
  if (toDate)       qs.set('to', toDate);
  if (actorFilter)  qs.set('actor', actorFilter);
  if (rowFilter)    qs.set('row', rowFilter);
  const baseQs = qs.toString();
  const pageHref = (p: number): string => {
    const next = new URLSearchParams(qs);
    next.set('page', String(p));
    return `/app/audit?${next.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Every insert, update and delete on costing, orders, invoices, payments, and master data. Drill into any entry to see the before/after snapshot."
      />

      {/* Filter row */}
      <form action="/app/audit" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="table" className="text-[10px] uppercase tracking-wide text-ink-mute">Table</label>
          <select id="table" name="table" defaultValue={tableFilter ?? ''} className="input py-1 text-xs min-w-[180px]">
            <option value="">All tables</option>
            {AUDITED_TABLES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="action" className="text-[10px] uppercase tracking-wide text-ink-mute">Action</label>
          <select id="action" name="action" defaultValue={actionFilter ?? ''} className="input py-1 text-xs">
            <option value="">All</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="actor" className="text-[10px] uppercase tracking-wide text-ink-mute">Actor</label>
          <select id="actor" name="actor" defaultValue={actorFilter ?? ''} className="input py-1 text-xs min-w-[200px]">
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.email}>{u.email}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="from" className="text-[10px] uppercase tracking-wide text-ink-mute">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate ?? ''} className="input py-1 text-xs max-w-[150px]" />
        </div>
        <div className="flex flex-col">
          <label htmlFor="to" className="text-[10px] uppercase tracking-wide text-ink-mute">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate ?? ''} className="input py-1 text-xs max-w-[150px]" />
        </div>
        <div className="flex flex-col">
          <label htmlFor="row" className="text-[10px] uppercase tracking-wide text-ink-mute">Row ID</label>
          <input id="row" name="row" type="text" defaultValue={rowFilter ?? ''} placeholder="e.g. 4221" className="input py-1 text-xs max-w-[120px] font-mono" />
        </div>
        <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
        {baseQs && (
          <Link href="/app/audit" className="text-xs text-ink-mute hover:text-ink underline self-center">
            Clear filters
          </Link>
        )}
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Matching entries</div>
          <div className="num text-xl font-bold">{total.toLocaleString('en-IN')}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Page</div>
          <div className="num text-xl font-bold">{page} / {totalPages}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Showing</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Distinct actors (page)</div>
          <div className="num text-xl font-bold">{new Set(rows.map((r) => r.changed_by).filter(Boolean)).size}</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Could not load audit log: {error.message}
        </div>
      )}

      {rows.length === 0 && !error ? (
        <ComingSoon note={baseQs
          ? 'No audit entries match these filters. Try widening the date range or clearing the filters.'
          : 'No audit entries yet. They appear here as soon as data starts changing.'} />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-3 py-3">When</th>
                  <th className="text-left px-3 py-3">Who</th>
                  <th className="text-left px-3 py-3">Table</th>
                  <th className="text-left px-3 py-3">Row ID</th>
                  <th className="text-left px-3 py-3">Action</th>
                  <th className="text-right px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pill = actionPill(r.action);
                  const u = r.changed_by != null ? userById.get(r.changed_by) : null;
                  return (
                    <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                      <td className="px-3 py-2 text-ink-soft text-xs">
                        {formatDate(r.changed_at, 'long')}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {u
                          ? <span title={u.full_name}>{u.email}</span>
                          : (r.changed_by
                              ? <span className="font-mono text-[10px] text-ink-mute" title="User no longer in app_user">{r.changed_by.slice(0, 8)}…</span>
                              : <span className="text-ink-mute italic">system</span>)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.table_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.row_pk}</td>
                      <td className="px-3 py-2">
                        <span className={`pill ${pill.cls} text-xs uppercase tracking-wide`}>{pill.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/app/audit/${r.id}`}
                          className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex"
                          title="View before / after"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <div className="text-ink-mute text-xs">
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
              </div>
              <div className="flex items-center gap-1">
                {page > 1 && (
                  <Link href={pageHref(page - 1)} className="btn-secondary text-xs py-1 px-3">
                    ← Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={pageHref(page + 1)} className="btn-secondary text-xs py-1 px-3">
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
