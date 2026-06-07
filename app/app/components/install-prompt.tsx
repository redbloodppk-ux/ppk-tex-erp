'use client';
/**
 * InstallPrompt — CORR-H1
 *
 * Shows a small "Install app" pill in the corner when the browser fires
 * `beforeinstallprompt`. Tapping it triggers the native install dialog.
 * Once the user installs (or dismisses), the prompt hides for the rest
 * of the session. A long-term dismissal is stored in localStorage so
 * the user isn't pestered on every visit if they say no.
 *
 * Why a custom prompt instead of letting the browser show its own?
 *  - Chrome's mini-infobar only shows once per visit and is easy to miss.
 *  - We want the prompt where the operator's eye already goes (bottom
 *    right corner of the dashboard).
 *  - It lets us pause-then-revive the prompt logic if needed (e.g. show
 *    it only after the user has been in the app 30 seconds).
 *
 * Compatibility: `beforeinstallprompt` is Chrome / Edge / Samsung
 * Internet only. Safari (desktop + iOS) doesn't fire it — those users
 * get a static hint instead pointing them to the Share → Add to Home
 * Screen flow. We detect Safari/iOS via UA.
 */
import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

const DISMISS_KEY = 'ppk:install-dismissed-at';
// Once dismissed, don't show again for 14 days. Plenty of breathing
// room without letting the prompt disappear forever for a casual user
// who later decides they do want the install.
const DISMISS_DAYS = 14;

// Minimal shape of the BeforeInstallPromptEvent — the global type is
// non-standard and not included in TypeScript's lib.dom by default.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return ageDays < DISMISS_DAYS;
  } catch {
    return false;
  }
}

function rememberDismiss(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage may be full / disabled; non-fatal.
  }
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  const isStandalone =
    'standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true;
  // Only show the iOS hint when not already running as an installed PWA.
  return isIos && !isStandalone;
}

function isAlreadyInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  // display-mode: standalone is true once the PWA has been installed
  // and the user opens it from the home screen.
  return window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function InstallPrompt(): React.ReactElement | null {
  // The captured event we'll fire on click.
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  // Visible state — separate from `evt` so we can hide after dismiss
  // without losing the captured event (in case the user changes their
  // mind in the same session — unlikely but cheap).
  const [show, setShow] = useState<boolean>(false);
  const [showIosHint, setShowIosHint] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAlreadyInstalled()) return;
    if (wasRecentlyDismissed()) return;

    // iOS Safari path — show a small "use Share → Add to Home Screen"
    // hint since `beforeinstallprompt` never fires there.
    if (isIosSafari()) {
      setShowIosHint(true);
      return;
    }

    function onBeforeInstallPrompt(e: Event): void {
      // Stop Chrome's mini-infobar; we'll show our own button.
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setShow(true);
    }
    function onInstalled(): void {
      // The user installed — hide the prompt for good this session.
      setShow(false);
      setShowIosHint(false);
      setEvt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall(): Promise<void> {
    if (!evt) return;
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === 'dismissed') rememberDismiss();
    } catch {
      // Prompt can fail if the gesture chain breaks — fall through.
    }
    setShow(false);
    setEvt(null);
  }

  function handleDismiss(): void {
    rememberDismiss();
    setShow(false);
    setShowIosHint(false);
  }

  if (showIosHint) {
    return (
      <div className="no-print fixed bottom-4 left-4 z-40 max-w-xs rounded-xl border border-indigo-200 bg-white p-3 text-xs shadow-lg">
        <div className="flex items-start gap-2">
          <Share className="h-4 w-4 shrink-0 text-indigo-600" />
          <div className="flex-1 leading-snug text-ink">
            <div className="font-semibold text-ink mb-0.5">Install PPK TEX</div>
            Tap <Share className="inline h-3 w-3 -mt-0.5" /> Share, then <span className="font-semibold">Add to Home Screen</span> to use this app like a native app.
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md p-1 text-ink-mute hover:bg-cloud"
            aria-label="Dismiss install hint"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  if (!show || !evt) return null;

  return (
    <div className="no-print fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800 shadow-lg">
      <Download className="h-3.5 w-3.5" />
      <button type="button" onClick={() => void handleInstall()} className="hover:underline">
        Install PPK TEX
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="ml-1 rounded-full p-0.5 opacity-60 hover:opacity-100"
        aria-label="Dismiss install prompt"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
