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
 * scrollbar isn't reachable yet, draws a track + thumb pinned to the
 * bottom of the viewport that mirrors that table's horizontal scroll
 * position. Unlike a first attempt at this (a real `overflow-x-auto` div
 * standing in as a "proxy"), this is a hand-built thumb dragged with
 * pointer events directly — a native scrollbar squeezed into a ~16px
 * strip barely renders/grabs reliably across browsers, so we don't rely
 * on one.
 *
 * Scoped to md+ (desktop/mouse) screens only: on mobile every one of
 * these tables already has a `hidden md:block` desktop-only wrapper (with
 * a separate card-list view for small screens), and touch users can swipe
 * a table directly without needing to grab a scrollbar handle, so the
 * "can't reach the scrollbar" problem doesn't apply there.
 *
 * Mounted once in AppShell so it covers every /app/* page automatically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const SELECTOR = 'main .card.overflow-x-auto';
const POLL_MS = 250;
const BAR_HEIGHT = 16;
const MIN_THUMB_WIDTH = 48;

interface BarState {
  left: number;
  width: number;
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}

interface DragState {
  startX: number;
  startScrollLeft: number;
  trackWidth: number;
  thumbWidth: number;
  maxScrollLeft: number;
}

export function TableScrollSync() {
  const [bar, setBar] = useState<BarState | null>(null);
  const activeElRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const readFromEl = useCallback((el: HTMLElement): BarState => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      width: r.width,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
    };
  }, []);

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
        // this proxy would just be a redundant second scrollbar.
        const nativeScrollbarReachable = r.bottom <= vh + 2;
        if (onScreen && !nativeScrollbarReachable) return el;
      }
      return null;
    }

    function recompute(): void {
      // Don't fight an in-progress drag with a stale re-measure.
      if (dragRef.current) return;
      if (!mq.matches) {
        activeElRef.current = null;
        setBar((prev) => (prev ? null : prev));
        return;
      }
      const el = findActive();
      activeElRef.current = el;
      setBar(el ? readFromEl(el) : null);
    }

    function onTableScroll(e: Event): void {
      if (dragRef.current) return;
      const target = e.target as HTMLElement;
      if (target !== activeElRef.current) return;
      setBar(readFromEl(target));
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
  }, [readFromEl]);

  if (!bar) return null;

  const maxScrollLeft = Math.max(bar.scrollWidth - bar.clientWidth, 0);
  const thumbWidth = Math.max(MIN_THUMB_WIDTH, (bar.clientWidth / bar.scrollWidth) * bar.width);
  const maxThumbTravel = Math.max(bar.width - thumbWidth, 0);
  const thumbLeft = maxScrollLeft > 0 ? (bar.scrollLeft / maxScrollLeft) * maxThumbTravel : 0;

  function scrollActiveTo(next: number): void {
    const el = activeElRef.current;
    if (!el) return;
    const clamped = Math.min(Math.max(next, 0), maxScrollLeft);
    el.scrollLeft = clamped;
    setBar((prev) => (prev ? { ...prev, scrollLeft: clamped } : prev));
  }

  function beginDrag(e: React.PointerEvent<HTMLDivElement>): void {
    const track = trackRef.current;
    if (!track || !activeElRef.current) return;
    const clickX = e.clientX - track.getBoundingClientRect().left;
    const onThumb = clickX >= thumbLeft && clickX <= thumbLeft + thumbWidth;

    let startScrollLeft = bar!.scrollLeft;
    if (!onThumb) {
      // Clicked the bare track — jump so the thumb is centered under the
      // click, then start dragging from there. More forgiving than
      // requiring a precise grab on a ~16px-tall thumb.
      const targetThumbLeft = Math.min(Math.max(clickX - thumbWidth / 2, 0), maxThumbTravel);
      startScrollLeft = maxThumbTravel > 0 ? (targetThumbLeft / maxThumbTravel) * maxScrollLeft : 0;
      scrollActiveTo(startScrollLeft);
    }

    dragRef.current = {
      startX: e.clientX,
      startScrollLeft,
      trackWidth: bar!.width,
      thumbWidth,
      maxScrollLeft,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDragMove(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = e.clientX - drag.startX;
    const travel = drag.trackWidth - drag.thumbWidth;
    const scrollDelta = travel > 0 ? (deltaX / travel) * drag.maxScrollLeft : 0;
    scrollActiveTo(drag.startScrollLeft + scrollDelta);
  }

  function endDrag(): void {
    dragRef.current = null;
  }

  return (
    <div
      ref={trackRef}
      onPointerDown={beginDrag}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="hidden md:block fixed bottom-0 z-30 rounded-t-md bg-cloud/70 border-t border-line shadow-[0_-2px_8px_rgba(15,23,42,0.06)] backdrop-blur-sm cursor-pointer select-none touch-none"
      style={{ left: bar.left, width: bar.width, height: BAR_HEIGHT }}
      aria-label="Table horizontal scroll"
      role="scrollbar"
      aria-orientation="horizontal"
      aria-valuenow={maxScrollLeft > 0 ? Math.round((bar.scrollLeft / maxScrollLeft) * 100) : 0}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-md bg-slate-400/80 hover:bg-slate-500/80 active:bg-slate-600/80 transition-colors cursor-grab active:cursor-grabbing"
        style={{ width: thumbWidth, transform: `translateX(${thumbLeft}px)` }}
      />
    </div>
  );
}
