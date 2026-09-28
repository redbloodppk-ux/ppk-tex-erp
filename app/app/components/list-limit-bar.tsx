/**
 * "Showing 200 of 594 · Load 200 more · Show all" under a register.
 * Server-friendly (plain links): Load more re-requests the page with a
 * bigger ?limit=, keeping every other filter in the URL.
 * Renders nothing when the whole list is already on screen.
 * See lib/list-limit.ts.
 */
import Link from 'next/link';
import { MAX_LIST_LIMIT } from '@/lib/list-limit';

interface ListLimitBarProps {
  /** Rows on screen. */
  shown: number;
  /** Exact number of matching rows (PostgREST count). null = unknown. */
  total: number | null;
  /** Current page size (the ?limit= in force). */
  limit: number;
  /** Path of this page, e.g. '/app/wages'. */
  basePath: string;
  /** The page's current search params, preserved on the links. */
  params?: Record<string, string | string[] | undefined>;
  /** What the rows are, for the label ("entries", "invoices"...). */
  noun?: string;
}

function hrefWith(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
  limit: number,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === 'limit' || v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== '') qs.set(k, v);
  }
  qs.set('limit', String(limit));
  return `${basePath}?${qs.toString()}`;
}

export function ListLimitBar({
  shown, total, limit, basePath, params = {}, noun = 'entries',
}: ListLimitBarProps): React.ReactElement | null {
  const more = total == null ? shown >= limit : total > shown;
  if (!more) return null;
  const step = limit;
  const nextLimit = Math.min(limit + step, MAX_LIST_LIMIT);
  const allLimit = total == null ? MAX_LIST_LIMIT : Math.min(total, MAX_LIST_LIMIT);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-3 text-xs text-ink-soft">
      <span>
        Showing the latest <strong className="num">{shown.toLocaleString('en-IN')}</strong>
        {total != null && <> of <strong className="num">{total.toLocaleString('en-IN')}</strong></>} {noun}
      </span>
      {nextLimit > limit && (
        <Link href={hrefWith(basePath, params, nextLimit)} scroll={false} className="btn-secondary text-xs">
          Load {Math.min(step, (total ?? nextLimit) - shown).toLocaleString('en-IN')} more
        </Link>
      )}
      {allLimit > nextLimit && (
        <Link href={hrefWith(basePath, params, allLimit)} scroll={false} className="text-indigo-700 font-semibold underline">
          Show all
        </Link>
      )}
    </div>
  );
}
