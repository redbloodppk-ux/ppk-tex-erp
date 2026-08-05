'use client';
/**
 * TableScrollSync — a horizontal scrollbar that stays reachable.
 *
 * Problem: every wide data table in the app (Yarn Stock, Bobbin Stock,
 * Fabric Stock, reports, ledgers, etc.) lives inside a `.card
 * overflow-x-auto` wrapper with its own horizontal scrollbar. On a table
 * with many rows, that scrollbar sits at the very bottom of the table
 * element — so a desktop/mouse user has to scroll all the way down the
 * page past every row before they can even see it, let alone drag it.
 *
 * Fix: this component watches the page (no per-page changes needed — it
 * finds any `.card.overflow-x-auto` wrapper that contains a table and is
 * currently overflowing) and, whenever one is on screen but its own
 * scrollbar isn't reachable yet, draws a thin proxy scrollbar pinned to
 * the bottom of the viewport. Dragging it scrolls the real table
 * side-to-side, and vice versa — they're kept in sync both ways.
 *
 * Scoped to md+ (desktop/mouse) screens only: on mobile every one of
 * these tables already has a `hidden md:block` desktop-only wrapper (with
 * a separate card-list view for small screens), and touch users can swipe
 * a table directly without needing to grab a scrollbar handle, so the
 * "can't reach the scrollbar" problem doesn't apply there.
 *
 * Mounted once in AppShell so it covers every /app/* page automatically.
 */
import { useEffect, useRef, useState } from 'react';

const SELECTOR = 'main .card.overflow-x-auto';
const POLL_MS = 250;
const BAR_HEIGHT = 14;

interface ProxyRect {
  left: number;
  width: number;
  scrollWidth: number;
  clientWidth: number;
}

export function TableScrollSync() {
  const [rect, setRect] = useState<ProxyRect | null>(null);
  const activeElRef = useRef<HTMLElement | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');

    function findActive(): HTMLElement | null {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter(
        (el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1 && el.querySelector('table'),
      );
      const vh = window.innerHeight;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        const onScreen = r.top < vh && r.bottom > 0;
        // Only take over once the table's own scrollbar (at its bottom
        // edge) has scrolled out of view — once it's reachable natively,
        // the proxy would just be a redundant second scrollbar.
        const nativeScrollbarReachable = r.bottom <= vh + 2;
        if (onScreen && !nativeScrollbarReachable) return el;
      }
      return null;
    }

    function recompute(): void {
      if (!mq.matches) {
        if (rect) setRect(null);
        activeElRef.current = null;
        return;
      }
      const el = findActive();
      activeElRef.current = el;
      if (!el) {
        setRect((prev) => (prev ? null : prev));
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, width: r.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      if (proxyRef.current && !syncingRef.current) {
        proxyRef.current.scrollLeft = el.scrollLeft;
      }
    }

    function onTableScroll(e: Event): void {
      const target = e.target as HTMLElement;
      if (target !== activeElRef.current || !proxyRef.current) return;
      syncingRef.current = true;
      proxyRef.current.scrollLeft = target.scrollLeft;
      syncingRef.current = false;
    }

    recompute();
    const interval = window.setInterval(recompute, POLL_MS);
    window.addEventListener('scroll', recompute, { passive: true, capture: true });
    window.addEventListener('resize', recompute);
    // Capture-phase so it catches scroll events bubbling from any table
    // container, without needing to attach/detach a listener per element.
    document.addEventListener('scroll', onTableScroll, { passive: true, capture: true });

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
      document.removeEventListener('scroll', onTableScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rect) return null;

  return (
    <div
      ref={proxyRef}
      onScroll={() => {
        if (!activeElRef.current) return;
        syncingRef.current = true;
        activeElRef.current.scrollLeft = proxyRef.current!.scrollLeft;
        syncingRef.current = false;
      }}
      className="hidden md:block fixed bottom-0 z-30 overflow-x-auto overflow-y-hidden bg-paper/95 border-t border-line shadow-[0_-2px_8px_rgba(15,23,42,0.06)] backdrop-blur-sm"
      style={{ left: rect.left, width: rect.width, height: BAR_HEIGHT }}
      aria-label="Table horizontal scroll"
      role="scrollbar"
      aria-orientation="horizontal"
    >
      <div style={{ width: rect.scrollWidth, height: 1 }} />
    </div>
  );
}
