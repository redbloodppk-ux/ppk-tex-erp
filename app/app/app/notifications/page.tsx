/**
 * /app/notifications — CORR-H6
 *
 * Full list of every pending notification, grouped by severity. Server-
 * rendered using the shared lib/notifications/source helper so the bell
 * dropdown and this page never drift.
 *
 * Filters:
 *   ?kind=costing_approval | yarn_low — narrow to one source
 *   ?severity=critical | warn | info — narrow to one urgency tier
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatDate } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { fetchNotifications, type NotificationItem } from '@/lib/notifications/source';
import { ClearAllButton } from './clear-all-button';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<NotificationItem['kind'], string> = {
  costing_approval: 'Costing approval',
  bill_due:         'Bill due',
};

interface PageProps {
  searchParams: Promise<{
    kind?: string;
    severity?: string;
  }>;
}

export default async function NotificationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kindFilter     = (sp.kind === 'costing_approval' || sp.kind === 'bill_due') ? sp.kind : null;
  const sevFilter      = (sp.severity === 'info' || sp.severity === 'warn' || sp.severity === 'critical') ? sp.severity : null;

  const supabase = await createClient();
  const feed = await fetchNotifications(supabase);

  const items = feed.items
    .filter((i) => kindFilter == null || i.kind === kindFilter)
    .filter((i) => sevFilter == null || i.severity === sevFilter);

  const sevCounts = feed.items.reduce(
    (acc, i) => {
      acc[i.severity] += 1;
      return acc;
    },
    { critical: 0, warn: 0, info: 0 } as Record<NotificationItem['severity'], number>,
  );

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Party-wise bill dues and pending costing approvals. Refresh the page or wait — the bell in the header auto-polls every minute."
        actions={<ClearAllButton disabled={feed.items.length === 0} />}
      />

      {/* Severity KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard
          label="Total pending"
          value={feed.items.length}
          href="/app/notifications"
          active={!kindFilter && !sevFilter}
        />
        <KpiCard
          label="Critical"
          value={sevCounts.critical}
          tone="rose"
          href="/app/notifications?severity=critical"
          active={sevFilter === 'critical'}
        />
        <KpiCard
          label="Warnings"
          value={sevCounts.warn}
          tone="amber"
          href="/app/notifications?severity=warn"
          active={sevFilter === 'warn'}
        />
        <KpiCard
          label="Info"
          value={sevCounts.info}
          tone="slate"
          href="/app/notifications?severity=info"
          active={sevFilter === 'info'}
        />
      </div>

      {/* Kind filter pills */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterPill href="/app/notifications" active={!kindFilter && !sevFilter} label="All sources" />
        <FilterPill href="/app/notifications?kind=bill_due" active={kindFilter === 'bill_due'} label="Bill dues" />
        <FilterPill href="/app/notifications?kind=costing_approval" active={kindFilter === 'costing_approval'} label="Costing approvals" />
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
          <div className="text-sm font-semibold text-ink mb-1">No pending notifications</div>
          <div className="text-xs text-ink-mute">
            {kindFilter || sevFilter
              ? <>Nothing matches these filters. <Link href="/app/notifications" className="text-indigo-700 underline">Clear filters</Link>.</>
              : <>No bills pending and no costings waiting for approval. Check back later.</>}
          </div>
        </div>
      ) : (
        <>
        {/* Mobile / PWA: card view. The wide notification table forces
            horizontal scrolling on a phone, so below md we render each
            notification as a tap-friendly card. The table is hidden on mobile. */}
        <CardFilter placeholder="Search notifications…">
          {items.map((it) => (
            <div key={it.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-ink break-words">{it.title}</div>
                  {it.body && <div className="text-xs text-ink-mute mt-0.5 break-words">{it.body}</div>}
                </div>
                <div className="shrink-0">
                  <SeverityPill severity={it.severity} />
                </div>
              </div>
              <div className="text-xs text-ink-soft mt-1">
                <span className="text-ink-mute">Source: </span>{KIND_LABEL[it.kind]}
                <span className="text-ink-mute"> · When: </span>{formatDate(it.occurred_at, 'long')}
              </div>
              <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                <Link
                  href={it.link}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700"
                >
                  Act on it <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          ))}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3 w-24">Severity</th>
                <th className="text-left px-3 py-3 w-40">Source</th>
                <th className="text-left px-3 py-3">Detail</th>
                <th className="text-left px-3 py-3 w-40">When</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3">
                    <SeverityPill severity={it.severity} />
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{KIND_LABEL[it.kind]}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-sm text-ink">{it.title}</div>
                    {it.body && <div className="text-xs text-ink-mute mt-0.5">{it.body}</div>}
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">
                    {formatDate(it.occurred_at, 'long')}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={it.link}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline"
                    >
                      Act on it <ChevronRight className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <p className="text-[11px] text-ink-mute mt-4">
        Sources: party-wise bill dues (to collect and to pay) + pending costing approvals.
        &ldquo;Clear all&rdquo; hides everything currently listed; a new bill or a new pending costing brings the party back automatically.
      </p>
    </div>
  );
}

function KpiCard({
  label, value, href, active, tone = 'indigo',
}: {
  label: string;
  value: number;
  href: string;
  active: boolean;
  tone?: 'indigo' | 'rose' | 'amber' | 'slate';
}) {
  const numTone = {
    indigo: 'text-indigo-700',
    rose:   'text-rose-700',
    amber:  'text-amber-700',
    slate:  'text-ink',
  }[tone];
  return (
    <Link
      href={href}
      className={
        'card p-3 transition ' +
        (active ? 'ring-2 ring-indigo-300' : 'hover:bg-haze/60')
      }
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={`num text-xl font-bold ${numTone}`}>{value}</div>
    </Link>
  );
}

function FilterPill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition ' +
        (active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-paper text-ink-soft border-line hover:bg-cloud/60')
      }
    >
      {label}
    </Link>
  );
}

function SeverityPill({ severity }: { severity: NotificationItem['severity'] }) {
  if (severity === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 text-xs font-semibold uppercase tracking-wide border border-rose-100">
        <AlertTriangle className="w-3 h-3" /> Critical
      </span>
    );
  }
  if (severity === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-semibold uppercase tracking-wide border border-amber-100">
        <AlertTriangle className="w-3 h-3" /> Warn
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold uppercase tracking-wide">
      Info
    </span>
  );
}
