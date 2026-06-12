'use client';
/**
 * Global guard: scrolling the mouse wheel (or trackpad) over a FOCUSED
 * number input silently changes its value in most browsers — a classic
 * source of wrong metres/kgs/rates saved without the operator noticing.
 *
 * Mounted once in the root layout. On every wheel event whose target is
 * a number input, the input is blurred BEFORE the browser applies the
 * spin, so the value never changes and the page scrolls normally.
 * Covers every present and future <input type="number"> in the app —
 * no per-field wiring needed.
 */
import { useEffect } from 'react';

export function NumberWheelGuard(): null {
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === 'number') {
        // Blur first so the wheel spin can't change the value; the
        // event itself stays passive so page scrolling is unaffected.
        t.blur();
      }
    };
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);
  return null;
}
