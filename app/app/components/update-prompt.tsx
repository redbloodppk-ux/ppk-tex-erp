'use client';
/**
 * UpdatePrompt - polls the service worker for new builds and shows a
 * non-blocking banner when a fresh version is ready to install. The
 * user clicks Reload, the page tells the waiting SW to skip waiting,
 * then reloads itself so the new build takes over cleanly.
 *
 * Why this exists: next-pwa generates a service worker that caches the
 * app shell + key pages for offline use. The SW does its job too well -
 * even after a Vercel deploy, the previous version keeps serving from
 * cache until you hard-refresh. This banner removes the guesswork:
 * deploy lands -> within a minute, every open tab sees "New version
 * available", one click and you're on the new build.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

type Mode = 'idle' | 'available';

export function UpdatePrompt(): React.ReactElement | null {
  const [mode, setMode] = useState<Mode>('idle');
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    // Reload as soon as the new SW takes control (Workbox skipWaiting flow).
    let reloading = false;
    const onControllerChange = (): void => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (cancelled || !reg) return;

      // If a new SW is already waiting at mount, surface the banner right away.
      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(reg.waiting);
        setMode('available');
      }

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // A new SW is installed AND an old one is still in charge:
            // that's the "update available" condition.
            setWaitingWorker(nw);
            setMode('available');
          }
        });
      });

      // Poll for updates every 5 minutes so long-open tabs eventually
      // notice a new deploy without the user navigating.
      const poll = window.setInterval(() => {
        void reg.update().catch(() => { /* swallow - offline etc. */ });
      }, 5 * 60 * 1000);

      return () => window.clearInterval(poll);
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  function handleReload(): void {
    if (waitingWorker) {
      // Tell the waiting SW to take over. Workbox listens for this
      // standard message and calls self.skipWaiting().
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } else {
      // No waiting worker found (rare edge case) - just hard-reload.
      window.location.reload();
    }
  }

  if (mode === 'idle' || dismissed) return null;

  return (
    <div className="no-print sticky top-0 z-50 bg-indigo-600 text-white text-xs px-4 py-2 flex items-center gap-2 shadow">
      <RefreshCw className="w-4 h-4 shrink-0" />
      <span className="font-semibold">New version available.</span>
      <span className="text-indigo-50/90 hidden sm:inline">
        Reload to pick up the latest changes.
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={handleReload}
          className="inline-flex items-center gap-1 rounded-md bg-white/15 hover:bg-white/25 px-2.5 py-1 text-xs font-semibold"
        >
          Reload now
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-white/15"
          title="Hide for this session"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
