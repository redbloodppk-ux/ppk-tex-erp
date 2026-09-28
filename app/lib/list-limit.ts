/**
 * Page-size helpers for register pages.
 *
 * Registers used to read `.limit(200)` and say nothing, so a list (and any
 * total built from it) silently stopped at 200 rows — Expenses showed
 * Rs 4.47 L against Rs 5.31 L real (2026-09-23). Each list now:
 *   - reads its page size from ?limit= (default per page),
 *   - asks PostgREST for the exact count, and
 *   - renders <ListLimitBar> so "200 of 594" is visible, with Load more.
 */

/** Hard ceiling for one request (PostgREST's own cap is 1000). */
export const MAX_LIST_LIMIT = 1000;

/** Page size from a `?limit=` value, clamped to [1, MAX_LIST_LIMIT]. */
export function readLimit(raw: string | string[] | undefined, fallback: number): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = v != null && /^\d+$/.test(v) ? Number(v) : fallback;
  return Math.min(Math.max(n, 1), MAX_LIST_LIMIT);
}
