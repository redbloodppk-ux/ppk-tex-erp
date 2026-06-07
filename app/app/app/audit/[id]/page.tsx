/**
 * Audit Log entry detail — CORR-H3
 *
 * Shows one row of `audit_log` with a side-by-side before/after diff of
 * the old_data and new_data JSONB columns. The diff highlights changed
 * fields, hides unchanged ones by default (toggleable), and gives the
 * operator a fast way to see exactly what changed and who did it.
 *
 * Diff rules:
 *   - INSERT: only the new row exists. Show every field, all as
 *     "added".
 *   - DELETE: only the old row exists. Show every field, all as
 *     "removed".
 *   - UPDATE: show changed fields side-by-side; collapse unchanged
 *     fields into a "+N unchanged" summary the operator can expand.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatDate } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

export const metadata = { title: 'Audit entry' };
export const dynamic = 'force-dynamic';

interface AuditDetail {
  id: number;
  table_name: string;
  row_pk: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_at: string;
  changed_by: string | null;
}

interface UserOpt {
  id: string;
  email: string;
  full_name: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length === 0 ? '—' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  // For nested objects / arrays just stringify — the audit rows aren't
  // huge and shallow JSON equality is good enough for diff highlight.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export default async function AuditDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from('audit_log')
    .select('id, table_name, row_pk, action, old_data, new_data, changed_at, changed_by')
    .eq('id', id)
    .single();
  if (error || !data) notFound();
  const row: AuditDetail = data as AuditDetail;

  // Resolve the actor's email / name in a separate query so the audit
  // table doesn't have to duplicate user info.
  let actor: UserOpt | null = null;
  if (row.changed_by) {
    const { data: u } = await sb
      .from('app_user')
      .select('id, email, full_name')
      .eq('id', row.changed_by)
      .maybeSingle();
    actor = (u ?? null) as UserOpt | null;
  }

  // Build the field list for the diff. Union of keys from both sides.
  const oldData = isObject(row.old_data) ? row.old_data : {};
  const newData = isObject(row.new_data) ? row.new_data : {};
  const keys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)])).sort();

  const changed: string[] = [];
  const unchanged: string[] = [];
  const onlyOld: string[] = [];   // present in OLD but not NEW (rare; usually means column dropped)
  const onlyNew: string[] = [];   // present in NEW but not OLD (column added, or INSERT)

  for (const k of keys) {
    const inOld = Object.prototype.hasOwnProperty.call(oldData, k);
    const inNew = Object.prototype.hasOwnProperty.call(newData, k);
    if (inOld && inNew) {
      if (shallowEqual(oldData[k], newData[k])) unchanged.push(k);
      else changed.push(k);
    } else if (inOld) onlyOld.push(k);
    else onlyNew.push(k);
  }

  const actionLabel = row.action === 'INSERT' ? 'Created' : row.action === 'DELETE' ? 'Deleted' : 'Updated';
  const actionTone = row.action === 'INSERT'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : row.action === 'DELETE'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Audit #${row.id}`}
        subtitle={`${actionLabel} ${row.table_name} row ${row.row_pk}`}
        crumbs={[
          { label: 'Audit Log', href: '/app/audit' },
          { label: `#${row.id}` },
        ]}
        actions={
          <Link href="/app/audit" className="btn-secondary text-xs">
            <ArrowLeft className="w-4 h-4" /> Back to list
          </Link>
        }
      />

      {/* Header card */}
      <div className="card p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">When</div>
            <div className="font-medium text-sm">{formatDate(row.changed_at, 'long')}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Who</div>
            <div className="font-medium text-sm">
              {actor
                ? <>{actor.full_name} <span className="text-ink-mute text-xs">({actor.email})</span></>
                : row.changed_by
                  ? <span className="font-mono text-xs">{row.changed_by}</span>
                  : <span className="text-ink-mute italic">system</span>}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Table · Row</div>
            <div className="font-mono text-sm">{row.table_name} · {row.row_pk}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Action</div>
            <span className={`inline-block px-2 py-1 rounded border ${actionTone} text-xs font-semibold`}>
              {actionLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Summary line */}
      <div className="text-xs text-ink-mute mb-3">
        {row.action === 'INSERT' && (
          <>{onlyNew.length + changed.length} fields recorded on create.</>
        )}
        {row.action === 'UPDATE' && (
          <>
            {changed.length} field{changed.length === 1 ? '' : 's'} changed
            {unchanged.length > 0 && <>, {unchanged.length} unchanged</>}
            {(onlyOld.length + onlyNew.length) > 0 && <>, {onlyOld.length + onlyNew.length} schema-only</>}
            .
          </>
        )}
        {row.action === 'DELETE' && (
          <>{onlyOld.length + changed.length} fields recorded at deletion.</>
        )}
      </div>

      {/* Diff table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3 w-1/4">Field</th>
              <th className="text-left px-3 py-3">Before</th>
              <th className="text-left px-3 py-3">After</th>
            </tr>
          </thead>
          <tbody>
            {changed.length === 0 && onlyOld.length === 0 && onlyNew.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-ink-soft text-sm">
                  No field-level changes recorded. {row.action === 'UPDATE'
                    ? 'The trigger fired but old_data and new_data are identical for the audited columns — likely a no-op write.'
                    : 'old_data and new_data are both empty.'}
                </td>
              </tr>
            )}
            {changed.map((k) => (
              <tr key={k} className="border-t border-line/40">
                <td className="px-3 py-2 font-mono text-xs text-ink-soft align-top">{k}</td>
                <td className="px-3 py-2 align-top">
                  <pre className="whitespace-pre-wrap text-xs font-mono text-rose-700 bg-rose-50/40 rounded px-2 py-1">
                    {fmtValue(oldData[k])}
                  </pre>
                </td>
                <td className="px-3 py-2 align-top">
                  <pre className="whitespace-pre-wrap text-xs font-mono text-emerald-700 bg-emerald-50/40 rounded px-2 py-1">
                    {fmtValue(newData[k])}
                  </pre>
                </td>
              </tr>
            ))}
            {onlyNew.map((k) => (
              <tr key={k} className="border-t border-line/40">
                <td className="px-3 py-2 font-mono text-xs text-ink-soft align-top">{k}</td>
                <td className="px-3 py-2 align-top text-ink-mute italic text-xs">(not present)</td>
                <td className="px-3 py-2 align-top">
                  <pre className="whitespace-pre-wrap text-xs font-mono text-emerald-700 bg-emerald-50/40 rounded px-2 py-1">
                    {fmtValue(newData[k])}
                  </pre>
                </td>
              </tr>
            ))}
            {onlyOld.map((k) => (
              <tr key={k} className="border-t border-line/40">
                <td className="px-3 py-2 font-mono text-xs text-ink-soft align-top">{k}</td>
                <td className="px-3 py-2 align-top">
                  <pre className="whitespace-pre-wrap text-xs font-mono text-rose-700 bg-rose-50/40 rounded px-2 py-1">
                    {fmtValue(oldData[k])}
                  </pre>
                </td>
                <td className="px-3 py-2 align-top text-ink-mute italic text-xs">(not present)</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unchanged fields — collapsed by default via <details> so the
          operator can peek without us cluttering the main diff. */}
      {unchanged.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ink-mute hover:text-ink">
            Show {unchanged.length} unchanged field{unchanged.length === 1 ? '' : 's'}
          </summary>
          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {unchanged.map((k) => (
                  <tr key={k} className="border-t border-line/40">
                    <td className="px-3 py-2 font-mono text-xs text-ink-soft align-top w-1/4">{k}</td>
                    <td className="px-3 py-2">
                      <pre className="whitespace-pre-wrap text-xs font-mono text-ink-soft">
                        {fmtValue(newData[k])}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
