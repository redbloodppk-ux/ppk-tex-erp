'use client';
/**
 * RememberFilters — keeps a list page's filters (party, dates, tab…) on
 * this device, so coming back to the page shows what you were looking at.
 *
 *   <RememberFilters path="/app/expenses" keys={['category', 'from', 'to']} />
 *
 * - Whenever the URL carries any of `keys`, they are saved (localStorage).
 * - When the page is OPENED with none of them (e.g. from the sidebar), the
 *   saved ones are put back with router.replace.
 * - Clearing the filters while on the page (the Clear button) saves the
 *   empty state, so they do not come back.
 * Storage failures (private mode, blocked site data) are ignored.
 */
import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface Props {
  /** The page path these filters belong to. */
  path: string;
  /** Query-string keys that are filters (not ?limit, not ids). */
  keys: string[];
}

function storageKey(path: string): string {
  return `ppk.filters:${path}`;
}

function Inner({ path, keys }: Props): null {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const first = useRef(true);
  const qs = params.toString();

  useEffect(() => {
    if (pathname !== path) return;
    const picked = new URLSearchParams();
    for (const k of keys) {
      for (const v of params.getAll(k)) if (v !== '') picked.append(k, v);
    }
    const current = picked.toString();

    if (first.current) {
      first.current = false;
      if (current === '') {
        let saved = '';
        try { saved = window.localStorage.getItem(storageKey(path)) ?? ''; } catch { /* ignore */ }
        if (saved !== '') {
          // Keep any non-filter params (e.g. ?limit) the URL already had.
          const merged = new URLSearchParams(params.toString());
          for (const [k, v] of new URLSearchParams(saved)) merged.append(k, v);
          router.replace(`${path}?${merged.toString()}`, { scroll: false });
        }
        return;
      }
    }
    try { window.localStorage.setItem(storageKey(path), current); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, pathname]);

  return null;
}

export function RememberFilters(props: Props): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  );
}
