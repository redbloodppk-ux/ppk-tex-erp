'use client';
/**
 * NotificationBell — CORR-H6
 *
 * Bell icon in the topbar that polls /api/notifications/count every
 * 60 s. The dot colour reflects the worst-severity pending item:
 *   - rose-500    → at least one 'critical' (out-of-stock yarn)
 *   - amber-500   → at least one 'warn'     (low stock / pending approval)
 *   - no dot      → nothing pending
 *
 * Click expands a dropdown panel listing the top 10 items. Each item
 * links straight to where the operator can act on it (approvals page,
 * days-of-cover report). A "See all" footer link goes to the full
 * /app/notifications page.
 *
 * Polling: window.setInterval restarted whenever the tab regains
 * visibility — saves bandwidth in background tabs. Auto-refresh after
 * an item is clicked (the operator might have just resolved one).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, AlertTriangle, CheckCircle2 } from 'lucide-react';

const POLL_INTERVAL_MS = 60_000;
type Severity = 'info' | 'warn' | 'critical';

interface FeedItem {
  id: string;
  kind: 'costing_approval' | 'yarn_low';
  title: string;
  body: string;
  link: string;
  occurred_at: string;
  severity: Severity;
}

interface Feed {
  total: number;
  worstSeverity: Severity | null;
  items: FeedItem[];
}

export function NotificationBell(): React.ReactElement {
  const [feed, setFeed] = useState<Feed>({ total: 0, worstSeverity: null, items: [] });
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // When the dropdown is open we want the full items; otherwise
      // count-only is enough to drive the badge.
      const url = open ? '/api/notifications' : '/api/notifications/count';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json() as Partial<Feed>;
      setFeed((prev) => ({
        total: json.total ?? prev.total,
        worstSeverity: json.worstSeverity ?? prev.worstSeverity,
        items: 'items' in json && Array.isArray(json.items) ? (json.items as FeedItem[]) : prev.items,
      }));
    } catch {
      // Network blips are fine — next poll will retry. Don't log to console
      // (CI rules; rely on the visible spinner state instead).
    } finally {
      setLoading(false);
    }
  }, [open]);

  // Initial fetch + recurring poll.
  useEffect(() => {
    void refresh();
    pollTimer.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refresh();
    }, POLL_INTERVAL_MS);
    function onVisible(): void {
      if (document.visibilityState === 'visible') void refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // When the dropdown opens, fetch items if we don't have them yet.
  useEffect(() => {
    if (open && feed.items.length === 0 && feed.total > 0) void refresh();
  }, [open, feed.items.length, feed.total, refresh]);

  const dotClass = feed.worstSeverity === 'critical'
    ? 'bg-rose-500'
    : feed.worstSeverity === 'warn'
      ? 'bg-amber-500'
      : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-cloud"
        aria-label={`Notifications (${feed.total} pending)`}
      >
        <Bell className="w-5 h-5 text-ink-soft" />
        {dotClass && (
          <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${dotClass}`} />
        )}
        {feed.total > 0 && (
          <span className={
            'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ' +
            (feed.worstSeverity === 'critical' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-white')
          }>
            {feed.total > 99 ? '99+' : feed.total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-paper rounded-xl border border-line shadow-card z-40 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-line/60 flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">
                Notifications
                {feed.total > 0 && <span className="text-ink-mute font-normal"> ({feed.total})</span>}
              </div>
              {loading && (
                <span className="text-[10px] text-ink-mute">Refreshing…</span>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {feed.items.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-ink-mute">
                  <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-emerald-500" />
                  No pending notifications.
                </div>
              ) : feed.items.slice(0, 10).map((it) => {
                const sevTone = it.severity === 'critical'
                  ? 'border-l-rose-500'
                  : it.severity === 'warn'
                    ? 'border-l-amber-500'
                    : 'border-l-slate-300';
                return (
                  <Link
                    key={it.id}
                    href={it.link}
                    onClick={() => setOpen(false)}
                    className={`block px-3 py-2 border-l-2 ${sevTone} border-b border-line/40 hover:bg-haze/60`}
                  >
                    <div className="flex items-start gap-2">
                      {it.severity !== 'info' && (
                        <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                          it.severity === 'critical' ? 'text-rose-500' : 'text-amber-500'
                        }`} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-ink truncate">{it.title}</div>
                        <div className="text-[11px] text-ink-mute truncate">{it.body}</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {feed.items.length > 0 && (
              <Link
                href="/app/notifications"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-center text-xs font-semibold text-indigo-700 bg-cloud/40 hover:bg-cloud/60 border-t border-line/60"
              >
                See all notifications →
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
