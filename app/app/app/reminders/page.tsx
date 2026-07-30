/**
 * Reminders register — office/factory to-dos: maintenance, supplier
 * calls, bill payments, purchases. See db/migrations/245_reminder.sql.
 *
 * Due/overdue active reminders also surface in the notification bell
 * (lib/notifications/source.ts) and a wider upcoming+due window shows on
 * the dashboard. This page is the full management view: add, filter by
 * category/status, mark done (rolls due_date forward if repeating), and
 * delete (soft — status='archived').
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { formatDate } from '@/lib/utils';
import { Plus, Repeat, CheckCircle2, AlertTriangle, Settings } from 'lucide-react';
import { MarkDoneButton } from '@/app/components/reminders/mark-done-button';
import { DeleteReminderButton } from '@/app/components/reminders/delete-reminder-button';
import {
  formatRepeatLabel, fetchAllCategories, fetchCategoryLabelMap,
  type ReminderCategory, type ReminderRepeat,
} from '@/lib/reminders/constants';

export const metadata = { title: 'Reminders' };
export const dynamic = 'force-dynamic';

interface ReminderRow {
  id: number;
  title: string;
  description: string | null;
  category: ReminderCategory;
  due_date: string;
  repeat: ReminderRepeat;
  repeat_weekdays: number[] | null;
  repeat_monthdays: number[] | null;
  status: 'active' | 'done' | 'archived';
}

interface PageProps {
  searchParams: Promise<{ category?: string; status?: string }>;
}

export default async function RemindersPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const statusFilter = (sp.status === 'done' || sp.status === 'archived' || sp.status === 'all')
    ? sp.status
    : 'active';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [categories, categoryLabels] = await Promise.all([
    fetchAllCategories(sb),
    fetchCategoryLabelMap(sb),
  ]);
  const categoryFilter = categories.some((c) => c.key === sp.category) ? (sp.category as string) : null;

  let query = sb
    .from('reminder')
    .select('id, title, description, category, due_date, repeat, repeat_weekdays, repeat_monthdays, status')
    .order('due_date', { ascending: true })
    .limit(300);
  if (statusFilter !== 'all') query = query.eq('status', statusFilter);
  if (categoryFilter) query = query.eq('category', categoryFilter);

  const { data, error } = await query;
  const rows = (data as ReminderRow[] | null) ?? [];

  const todayIso = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const overdueCount = rows.filter((r) => r.status === 'active' && r.due_date < todayIso).length;
  const dueTodayCount = rows.filter((r) => r.status === 'active' && r.due_date === todayIso).length;
  const upcomingCount = rows.filter((r) => r.status === 'active' && r.due_date > todayIso && r.due_date <= in7).length;

  function baseHref(overrides: { category?: string | null; status?: string }): string {
    const params = new URLSearchParams();
    const cat = overrides.category !== undefined ? overrides.category : categoryFilter;
    const st = overrides.status !== undefined ? overrides.status : statusFilter;
    if (cat) params.set('category', cat);
    if (st && st !== 'active') params.set('status', st);
    const qs = params.toString();
    return qs ? `/app/reminders?${qs}` : '/app/reminders';
  }

  return (
    <div>
      <PageHeader
        title="Reminders"
        subtitle="Office & factory to-dos — maintenance, supplier calls, bill payments, purchases. Due/overdue ones also show in the bell; a wider window shows on the dashboard."
        actions={
          <>
            <Link href="/app/reminders/categories" className="btn-secondary">
              <Settings className="w-4 h-4" /> Manage Categories
            </Link>
            <Link href="/app/reminders/new" className="btn-primary">
              <Plus className="w-4 h-4" /> New Reminder
            </Link>
          </>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load reminders: {error.message}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Overdue</div>
          <div className="num text-xl font-bold text-rose-700">{overdueCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Due today</div>
          <div className="num text-xl font-bold text-amber-700">{dueTodayCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Next 7 days</div>
          <div className="num text-xl font-bold text-ink">{upcomingCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill href={baseHref({ category: null })} active={!categoryFilter} label="All categories" />
          {categories.filter((c) => c.active).map((c) => (
            <FilterPill key={c.key} href={baseHref({ category: c.key })} active={categoryFilter === c.key} label={c.label} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill href={baseHref({ status: 'active' })} active={statusFilter === 'active'} label="Active" />
          <FilterPill href={baseHref({ status: 'done' })} active={statusFilter === 'done'} label="Done" />
          <FilterPill href={baseHref({ status: 'archived' })} active={statusFilter === 'archived'} label="Deleted" />
          <FilterPill href={baseHref({ status: 'all' })} active={statusFilter === 'all'} label="All" />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
          <div className="text-sm font-semibold text-ink mb-1">Nothing here</div>
          <div className="text-xs text-ink-mute">
            {statusFilter === 'active'
              ? <>No pending reminders. <Link href="/app/reminders/new" className="text-indigo-700 underline">Add one →</Link></>
              : 'Nothing matches this filter.'}
          </div>
        </div>
      ) : (
        <>
        <CardFilter placeholder="Search reminders…">
          {rows.map((r) => (
            <ReminderCard key={r.id} r={r} todayIso={todayIso} categoryLabel={categoryLabels[r.category] ?? r.category} />
          ))}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3 w-32">Due</th>
                <th className="text-left px-3 py-3 w-40">Category</th>
                <th className="text-left px-3 py-3">Detail</th>
                <th className="text-left px-3 py-3 w-32">Repeat</th>
                <th className="text-right px-3 py-3 w-56" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3">
                    <DueBadge dueDate={r.due_date} todayIso={todayIso} status={r.status} />
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{categoryLabels[r.category] ?? r.category}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-sm text-ink">{r.title}</div>
                    {r.description && <div className="text-xs text-ink-mute mt-0.5">{r.description}</div>}
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">
                    {r.repeat !== 'none' && (
                      <span className="inline-flex items-center gap-1">
                        <Repeat className="w-3 h-3" />
                        {formatRepeatLabel(r.repeat, r.repeat_weekdays, r.repeat_monthdays)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {r.status === 'active' && (
                      <div className="inline-flex items-center gap-1.5">
                        <MarkDoneButton id={r.id} repeats={r.repeat !== 'none'} />
                        <DeleteReminderButton id={r.id} label={r.title} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function ReminderCard({ r, todayIso, categoryLabel }: { r: ReminderRow; todayIso: string; categoryLabel: string }): React.ReactElement {
  const repeatLabel = formatRepeatLabel(r.repeat, r.repeat_weekdays, r.repeat_monthdays);

  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm text-ink break-words">{r.title}</div>
          {r.description && <div className="text-xs text-ink-mute mt-0.5 break-words">{r.description}</div>}
        </div>
        <div className="shrink-0">
          <DueBadge dueDate={r.due_date} todayIso={todayIso} status={r.status} />
        </div>
      </div>
      <div className="text-xs text-ink-soft mt-1">
        <span className="text-ink-mute">Category: </span>{categoryLabel}
        {r.repeat !== 'none' && (
          <>
            <span className="text-ink-mute"> · </span>
            <span className="inline-flex items-center gap-1"><Repeat className="w-3 h-3" /> {repeatLabel}</span>
          </>
        )}
      </div>
      {r.status === 'active' && (
        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-line/40">
          <MarkDoneButton id={r.id} repeats={r.repeat !== 'none'} />
          <DeleteReminderButton id={r.id} label={r.title} />
        </div>
      )}
    </div>
  );
}

function DueBadge({ dueDate, todayIso, status }: { dueDate: string; todayIso: string; status: string }): React.ReactElement {
  if (status !== 'active') {
    return <span className="text-xs text-ink-mute num">{formatDate(dueDate)}</span>;
  }
  if (dueDate < todayIso) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-100">
        <AlertTriangle className="w-3 h-3" /> {formatDate(dueDate)}
      </span>
    );
  }
  if (dueDate === todayIso) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-100">
        <AlertTriangle className="w-3 h-3" /> Today
      </span>
    );
  }
  return <span className="text-xs text-ink-soft num">{formatDate(dueDate)}</span>;
}

function FilterPill({ href, active, label }: { href: string; active: boolean; label: string }): React.ReactElement {
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
