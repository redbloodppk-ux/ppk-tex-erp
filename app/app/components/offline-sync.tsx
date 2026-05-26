'use client';
/**
 * OfflineSync — CORR-A7
 *
 * Mounted once in the app shell. Listens for the browser `online` event and
 * drains any attendance saves stashed in localStorage by the mark page.
 * Each replayed entry is written with sync_source = 'offline_pwa' so the
 * audit trail shows which rows came from the queued path.
 *
 * It also shows a small pill in the corner whenever the device is offline
 * or there is at least one pending save.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  listQueued,
  removeQueued,
  queueCount,
  type QueuedPayload,
} from '@/lib/attendance/offlineQueue';
import { WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';

export function OfflineSync(): JSX.Element | null {
  const supabase = createClient();
  const [online, setOnline] = useState<boolean>(true);
  const [pending, setPending] = useState<number>(0);
  const [flushing, setFlushing] = useState<boolean>(false);
  const [justSynced, setJustSynced] = useState<number>(0);

  const refreshPending = useCallback((): void => {
    setPending(queueCount());
  }, []);

  const flushOne = useCallback(
    async (item: QueuedPayload): Promise<boolean> => {
      // 1. Upsert the attendance_day row.
      const { data: { user } } = await supabase.auth.getUser();
      const { data: day, error: dayErr } = await supabase
        .from('attendance_day')
        .upsert(
          {
            attendance_date: item.mark_date,
            shift: item.shift,
            is_working: item.non_working_reason == null,
            reason: item.non_working_reason ?? null,
            remark: item.non_working_note ?? null,
            marked_by: user?.id ?? null,
            marked_at: item.queued_at,
            sync_source: 'offline_pwa',
          } as never,
          { onConflict: 'attendance_date,shift' },
        )
        .select('id')
        .single();
      if (dayErr || !day) return false;

      // 2. If this was a non-working day there are no per-employee rows.
      if (item.entries.length === 0) return true;

      const rows = item.entries.map((e) => ({
        attendance_day_id: (day as { id: number }).id,
        employee_id: Number(e.employee_id),
        status: e.status,
        actual_in_time: e.actual_in_time ?? null,
        actual_out_time: e.actual_out_time ?? null,
        sync_source: 'offline_pwa',
        marked_by: user?.id ?? null,
        marked_at: item.queued_at,
      }));

      const { error: entErr } = await supabase
        .from('attendance_entry')
        .upsert(rows as never, { onConflict: 'attendance_day_id,employee_id' });
      return !entErr;
    },
    [supabase],
  );

  const flushAll = useCallback(async (): Promise<void> => {
    if (flushing) return;
    const items = listQueued();
    if (items.length === 0) return;
    setFlushing(true);
    let ok = 0;
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      const success = await flushOne(item);
      if (success) {
        removeQueued(item.id);
        ok += 1;
      }
    }
    setFlushing(false);
    refreshPending();
    if (ok > 0) {
      setJustSynced(ok);
      window.dispatchEvent(new Event('ppk:queue-changed'));
      // Clear the success pill after a few seconds.
      window.setTimeout(() => setJustSynced(0), 5000);
    }
  }, [flushing, flushOne, refreshPending]);

  // Wire up listeners on mount.
  useEffect(() => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    refreshPending();

    function onOnline(): void {
      setOnline(true);
      void flushAll();
    }
    function onOffline(): void {
      setOnline(false);
    }
    function onQueueChanged(): void {
      refreshPending();
    }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('ppk:queue-changed', onQueueChanged);

    // If we mounted while online and the queue already has items (e.g. user
    // closed the tab before sync completed), drain immediately.
    if (typeof navigator === 'undefined' || navigator.onLine) {
      void flushAll();
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('ppk:queue-changed', onQueueChanged);
    };
  }, [flushAll, refreshPending]);

  // Nothing to show when everything is healthy.
  if (online && pending === 0 && justSynced === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {justSynced > 0 ? (
        <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-sm">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Synced {justSynced} pending save{justSynced === 1 ? '' : 's'}.
        </div>
      ) : !online ? (
        <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm">
          <WifiOff className="h-3.5 w-3.5" />
          Offline{pending > 0 ? ` — ${pending} pending` : ''}
        </div>
      ) : pending > 0 ? (
        <button
          type="button"
          onClick={() => void flushAll()}
          className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-100"
          disabled={flushing}
        >
          <RefreshCw className={'h-3.5 w-3.5 ' + (flushing ? 'animate-spin' : '')} />
          {flushing ? 'Syncing…' : `${pending} pending — sync now`}
        </button>
      ) : null}
    </div>
  );
}
