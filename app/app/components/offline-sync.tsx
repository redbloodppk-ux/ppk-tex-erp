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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  listQueued,
  removeQueued,
  queueCount,
  type QueuedPayload,
} from '@/lib/attendance/offlineQueue';
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle, X } from 'lucide-react';

// Retry every 30 s while there is still a pending item and the device says
// it's online. Covers the common case where the `online` event fires before
// the connection has actually stabilised.
const RETRY_INTERVAL_MS = 30_000;

export function OfflineSync(): ReactElement | null {
  const supabase = createClient();
  const [online, setOnline] = useState<boolean>(true);
  const [pending, setPending] = useState<number>(0);
  const [flushing, setFlushing] = useState<boolean>(false);
  const [justSynced, setJustSynced] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshPending = useCallback((): void => {
    setPending(queueCount());
  }, []);

  const flushOne = useCallback(
    async (item: QueuedPayload): Promise<{ ok: boolean; error?: string }> => {
      // Refresh the session first — the access token may have expired while
      // we were offline. Without this, the upsert below silently fails with
      // an RLS denial because auth.uid() returns null.
      try {
        await supabase.auth.refreshSession();
      } catch {
        // Non-fatal — if refresh fails getUser() below will surface it.
      }

      // 1. Upsert the attendance_day row.
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp?.user) {
        return { ok: false, error: 'Not signed in. Please log in again to sync.' };
      }
      const userId = userResp.user.id;

      const { data: day, error: dayErr } = await supabase
        .from('attendance_day')
        .upsert(
          {
            attendance_date: item.mark_date,
            shift: item.shift,
            is_working: item.non_working_reason == null,
            reason: item.non_working_reason ?? null,
            remark: item.non_working_note ?? null,
            marked_by: userId,
            marked_at: item.queued_at,
            sync_source: 'offline_pwa',
          } as never,
          { onConflict: 'attendance_date,shift' },
        )
        .select('id')
        .single();
      if (dayErr || !day) {
        return { ok: false, error: dayErr?.message ?? 'attendance_day upsert returned no row' };
      }

      // 2. If this was a non-working day there are no per-employee rows.
      if (item.entries.length === 0) return { ok: true };

      const rows = item.entries.map((e) => ({
        attendance_day_id: (day as { id: number }).id,
        employee_id: Number(e.employee_id),
        status: e.status,
        actual_in_time: e.actual_in_time ?? null,
        actual_out_time: e.actual_out_time ?? null,
        shed_no: e.shed_no ?? null,
        shed_nos: e.shed_nos ?? null,
        sync_source: 'offline_pwa',
        marked_by: userId,
        marked_at: item.queued_at,
      }));

      const { error: entErr } = await supabase
        .from('attendance_entry')
        .upsert(rows as never, { onConflict: 'attendance_day_id,employee_id' });
      if (entErr) return { ok: false, error: entErr.message };
      return { ok: true };
    },
    [supabase],
  );

  const flushAll = useCallback(async (): Promise<void> => {
    if (flushing) return;
    const items = listQueued();
    if (items.length === 0) {
      setLastError(null);
      return;
    }
    setFlushing(true);
    let ok = 0;
    let firstError: string | null = null;
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      const result = await flushOne(item);
      if (result.ok) {
        removeQueued(item.id);
        ok += 1;
      } else if (firstError == null && result.error) {
        firstError = result.error;
      }
    }
    setFlushing(false);
    refreshPending();
    setLastError(firstError);
    if (ok > 0) {
      setJustSynced(ok);
      window.dispatchEvent(new Event('ppk:queue-changed'));
      // Clear the success pill after a few seconds.
      window.setTimeout(() => setJustSynced(0), 5000);
    }
  }, [flushing, flushOne, refreshPending]);

  const discardAll = useCallback((): void => {
    const items = listQueued();
    if (items.length === 0) return;
    const ok = window.confirm(
      `Discard ${items.length} pending offline save${items.length === 1 ? '' : 's'}? ` +
      `This is only safe if you have already re-entered the attendance manually.`,
    );
    if (!ok) return;
    for (const it of items) removeQueued(it.id);
    setLastError(null);
    refreshPending();
    window.dispatchEvent(new Event('ppk:queue-changed'));
  }, [refreshPending]);

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

    // Periodic retry — covers the case where `online` fires before the
    // connection is actually usable, or where flushOne failed transiently.
    retryTimer.current = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine && queueCount() > 0) {
        void flushAll();
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('ppk:queue-changed', onQueueChanged);
      if (retryTimer.current) {
        clearInterval(retryTimer.current);
        retryTimer.current = null;
      }
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
        <div
          className={
            'flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs shadow-sm ' +
            (lastError
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-amber-200 bg-amber-50 text-amber-800')
          }
        >
          <div className="flex items-center gap-2">
            {lastError ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <RefreshCw className={'h-3.5 w-3.5 ' + (flushing ? 'animate-spin' : '')} />
            )}
            <button
              type="button"
              onClick={() => void flushAll()}
              disabled={flushing}
              className="font-medium hover:underline disabled:opacity-60"
            >
              {flushing ? 'Syncing…' : `${pending} pending — sync now`}
            </button>
            <button
              type="button"
              onClick={discardAll}
              title="Discard pending offline saves"
              className="ml-1 opacity-60 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {lastError && (
            <div className="max-w-[280px] text-[11px] leading-snug">
              Could not sync: {lastError}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
