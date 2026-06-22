/**
 * LOOMS Calibration — change history.
 *
 * Pulls every UPDATE on system_config where the row key is
 * 'looms_overhead_breakdown' from the audit_log. Renders a timeline
 * with: timestamp, who edited, before/after of each of the 5
 * components, and the delta on the totals — so the owner can correlate
 * a sudden margin shift with a specific overhead change.
 *
 * No new table needed — audit_log already captures system_config edits
 * (mig 025 + auto-applied trigger on the table).
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ArrowLeft, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { formatRupee } from '@/lib/utils';

export const metadata = { title: 'LOOMS Calibration · History' };
export const dynamic = 'force-dynamic';

const CONFIG_KEY = 'looms_overhead_breakdown';

const FIELDS: ReadonlyArray<{ id: keyof Breakdown; label: string }> = [
  { id: 'power',        label: 'Power (EB)'        },
  { id: 'labour',       label: 'Labour & wages'    },
  { id: 'maintenance',  label: 'Maintenance'       },
  { id: 'depreciation', label: 'Depreciation'      },
  { id: 'insurance',    label: 'Insurance & misc'  },
];

interface Breakdown {
  power: number | null;
  labour: number | null;
  maintenance: number | null;
  depreciation: number | null;
  insurance: number | null;
}

interface AuditRow {
  id: number;
  changed_at: string;
  changed_by: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: { value?: Record<string, unknown>; key?: string } | null;
  new_data: { value?: Record<string, unknown>; key?: string } | null;
}

function pickBreakdown(j: { value?: Record<string, unknown> } | null): Breakdown {
  const v = (j?.value ?? {}) as Record<string, unknown>;
  const n = (x: unknown): number | null => {
    if (x == null || x === '') return null;
    const num = Number(x);
    return Number.isFinite(num) ? num : null;
  };
  return {
    power:        n(v.power),
    labour:       n(v.labour),
    maintenance:  n(v.maintenance),
    depreciation: n(v.depreciation),
    insurance:    n(v.insurance),
  };
}

function totalOf(b: Breakdown): number {
  return (b.power ?? 0) + (b.labour ?? 0) + (b.maintenance ?? 0) + (b.depreciation ?? 0) + (b.insurance ?? 0);
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function LoomsHistoryPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: auditRaw, error } = await sb
    .from('audit_log')
    .select('id, changed_at, changed_by, action, old_data, new_data')
    .eq('table_name', 'system_config')
    .order('changed_at', { ascending: false })
    .limit(200);
  const audits = ((auditRaw ?? []) as AuditRow[]).filter(
    (r) => (r.new_data?.key ?? r.old_data?.key) === CONFIG_KEY,
  );

  const userIds = Array.from(new Set(audits.map((r) => r.changed_by).filter((x): x is string => !!x)));
  let userById = new Map<string, { full_name: string; email: string }>();
  if (userIds.length > 0) {
    const { data: users } = await sb.from('app_user').select('id, full_name, email').in('id', userIds);
    userById = new Map(((users ?? []) as Array<{ id: string; full_name: string; email: string }>).map((u) => [u.id, u]));
  }

  return (
    <div>
      <PageHeader
        title="LOOMS Calibration · History"
        subtitle="Every change to the per-metre overhead is captured. Use this to correlate a margin shift on the Profit-by-Quality report with a specific calibration update."
        crumbs={[
          { label: 'Settings',           href: '/app/settings' },
          { label: 'LOOMS Calibration',  href: '/app/settings/looms-calibration' },
          { label: 'History' },
        ]}
        actions={
          <Link href="/app/settings/looms-calibration" className="btn-secondary text-xs">
            <ArrowLeft className="w-4 h-4" /> Back to editor
          </Link>
        }
      />

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">
          Could not load history: {error.message}
        </div>
      )}

      {audits.length === 0 && !error ? (
        <div className="card p-8 text-center text-ink-soft text-sm">
          No calibration changes recorded yet. Once an owner edits and saves the
          LOOMS overhead, every change appears here.
        </div>
      ) : (
        <>
        {/* Mobile / PWA: card view. The wide before/after grid is hard to
            read on a phone; below md each change renders as a card. The
            table is hidden on mobile and shown from md upward. */}
        <CardFilter placeholder="Search history…">
          {audits.map((r) => {
            const before = pickBreakdown(r.old_data);
            const after  = pickBreakdown(r.new_data);
            const totalBefore = totalOf(before);
            const totalAfter  = totalOf(after);
            const totalDelta  = totalAfter - totalBefore;
            const user = r.changed_by ? userById.get(r.changed_by) : null;
            return (
              <div key={r.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink">{fmtTs(r.changed_at)}</div>
                    <div className="text-xs text-ink-soft mt-0.5">
                      {user
                        ? <>{user.full_name} <span className="text-ink-mute">· {user.email}</span></>
                        : <span className="text-ink-mute italic">{r.changed_by ?? 'system'}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total / m</div>
                    <div className="num font-bold text-indigo-900">{formatRupee(totalAfter, { decimals: 2 })}</div>
                    {totalDelta !== 0 && (
                      <div className={'text-[10px] ' + (totalDelta > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                        {totalDelta > 0 ? '+' : ''}{formatRupee(totalDelta, { decimals: 2 })} / m
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 pt-2 border-t border-line/40">
                  {FIELDS.map((f) => {
                    const b = before[f.id];
                    const a = after[f.id];
                    const delta = (a ?? 0) - (b ?? 0);
                    return (
                      <div key={f.id} className="text-xs flex items-baseline justify-between gap-2">
                        <span className="text-ink-mute">{f.label}</span>
                        <span className="text-right">
                          <span className="num font-semibold">{a != null ? formatRupee(a, { decimals: 2 }) : '—'}</span>
                          {b != null && delta !== 0 && (
                            <span className={'block text-[10px] inline-flex items-center gap-0.5 justify-end ' +
                              (delta > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                              {delta > 0 ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                              {formatRupee(Math.abs(delta), { decimals: 2 })}
                            </span>
                          )}
                          {b != null && delta === 0 && (
                            <span className="block text-[10px] text-ink-mute inline-flex items-center gap-0.5 justify-end">
                              <Minus className="w-2.5 h-2.5" /> unchanged
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">When</th>
                <th className="text-left  px-3 py-3">Who</th>
                <th className="text-right px-3 py-3">Power</th>
                <th className="text-right px-3 py-3">Labour</th>
                <th className="text-right px-3 py-3">Maint.</th>
                <th className="text-right px-3 py-3">Depr.</th>
                <th className="text-right px-3 py-3">Insur.</th>
                <th className="text-right px-3 py-3 bg-indigo-50">Total Δ</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((r) => {
                const before = pickBreakdown(r.old_data);
                const after  = pickBreakdown(r.new_data);
                const totalBefore = totalOf(before);
                const totalAfter  = totalOf(after);
                const totalDelta  = totalAfter - totalBefore;
                const user = r.changed_by ? userById.get(r.changed_by) : null;
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60 align-top">
                    <td className="px-3 py-3 text-xs text-ink-soft whitespace-nowrap">{fmtTs(r.changed_at)}</td>
                    <td className="px-3 py-3 text-xs">
                      {user
                        ? <>{user.full_name}<div className="text-[10px] text-ink-mute">{user.email}</div></>
                        : <span className="text-ink-mute italic">{r.changed_by ?? 'system'}</span>}
                    </td>
                    {FIELDS.map((f) => {
                      const b = before[f.id];
                      const a = after[f.id];
                      const delta = (a ?? 0) - (b ?? 0);
                      return (
                        <td key={f.id} className="px-3 py-3 text-right text-xs num">
                          <div className="font-semibold">{a != null ? formatRupee(a, { decimals: 2 }) : '—'}</div>
                          {b != null && delta !== 0 && (
                            <div className={'text-[10px] mt-0.5 inline-flex items-center gap-0.5 ' +
                              (delta > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                              {delta > 0 ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                              {formatRupee(Math.abs(delta), { decimals: 2 })}
                              <span className="text-ink-mute">from {formatRupee(b, { decimals: 2 })}</span>
                            </div>
                          )}
                          {b != null && delta === 0 && (
                            <div className="text-[10px] mt-0.5 text-ink-mute inline-flex items-center gap-0.5">
                              <Minus className="w-2.5 h-2.5" /> unchanged
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-right num font-bold bg-indigo-50/50">
                      <div className="text-indigo-900">{formatRupee(totalAfter, { decimals: 2 })}</div>
                      {totalDelta !== 0 && (
                        <div className={'text-[10px] mt-0.5 ' + (totalDelta > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                          {totalDelta > 0 ? '+' : ''}{formatRupee(totalDelta, { decimals: 2 })} / m
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <p className="text-[11px] text-ink-mute mt-4">
        Source: <code className="font-mono text-[11px] bg-cloud/40 px-1 rounded">audit_log</code> rows where{' '}
        <code className="font-mono text-[11px] bg-cloud/40 px-1 rounded">table_name = &lsquo;system_config&rsquo;</code>{' '}
        and the row key is <code className="font-mono text-[11px] bg-cloud/40 px-1 rounded">{CONFIG_KEY}</code>.
      </p>
    </div>
  );
}
