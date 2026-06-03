'use client';
/**
 * OfflineBanner - a slim status strip that pops up at the top of every
 * page when the browser loses network. Listens to the standard `online`
 * and `offline` window events so it picks up Wi-Fi drops + airplane mode
 * without any polling.
 *
 * Two states:
 *   - Offline: red strip. Tells the operator forms won't save until
 *     reconnect. Pages already cached by the service worker still load
 *     normally.
 *   - Just-came-back-online: brief green flash confirming "back online".
 *
 * Drop-in for AppShell. Renders nothing on the server (returns null on
 * first paint) so it never causes a hydration mismatch.
 */
import { useEffect, useState } from 'react';
import { WifiOff, CheckCircle2 } from 'lucide-react';

type Mode = 'idle' | 'offline' | 'just-back';

export function OfflineBanner(): React.ReactElement | null {
  const [mode, setMode] = useState<Mode>('idle');

  useEffect(() => {
    // Bail out cleanly on SSR / first paint - navigator only exists in
    // the browser.
    if (typeof navigator === 'undefined') return;

    function handleOffline(): void {
      setMode('offline');
    }
    function handleOnline(): void {
      setMode('just-back');
      // Auto-hide the "back online" flash after 3 seconds.
      window.setTimeout(() => setMode('idle'), 3000);
    }

    // Sync to current state at mount in case we loaded already-offline.
    if (!navigator.onLine) setMode('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (mode === 'idle') return null;

  if (mode === 'offline') {
    return (
      <div className="no-print sticky top-0 z-50 bg-rose-600 text-white text-xs px-4 py-2 flex items-center gap-2 shadow">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span className="font-semibold">You&apos;re offline.</span>
        <span className="text-rose-50/90">
          Anything you change won&apos;t save until the network is back. Pages already loaded still work.
        </span>
      </div>
    );
  }

  // just-back
  return (
    <div className="no-print sticky top-0 z-50 bg-emerald-600 text-white text-xs px-4 py-2 flex items-center gap-2 shadow">
      <CheckCircle2 className="w-4 h-4 shrink-0" />
      <span className="font-semibold">Back online.</span>
      <span className="text-emerald-50/90">Saving should work again.</span>
    </div>
  );
}
