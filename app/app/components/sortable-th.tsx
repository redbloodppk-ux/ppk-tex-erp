/**
 * Sortable column header for list tables.
 *
 * Usage (server-rendered tables):
 *
 *   const sortKey = sp.sort ?? 'code';
 *   const dir     = sp.dir  === 'desc' ? 'desc' : 'asc';
 *   const rows    = await sb.from('foo')
 *     .select('...')
 *     .order(sortKey, { ascending: dir === 'asc' });
 *
 *   <SortableTh column="code" label="Code" sort={sortKey} dir={dir} />
 *   <SortableTh column="name" label="Name" sort={sortKey} dir={dir} />
 *
 * Clicking a header navigates to the same page with `?sort=...&dir=...`
 * toggled (asc → desc → asc). Any other query params already on the URL
 * are preserved via `extraParams`.
 *
 * This is a plain server component (a Link wrapper) so we don't pay the
 * cost of dehydrating an extra client bundle per list page.
 */
import Link from 'next/link';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

interface SortableThProps {
  /** Column key passed as ?sort= — must be a valid orderable column on
   *  the underlying query (PostgREST will 400 if not). */
  column: string;
  /** Human label shown in the header cell. */
  label: string;
  /** The currently-active sort key (from searchParams). */
  sort: string;
  /** The currently-active direction (from searchParams). */
  dir: SortDir;
  /** Base path to navigate to. Defaults to the current page (`?`). */
  basePath?: string;
  /** Extra query params to preserve on click (e.g. tab=, filter=). */
  extraParams?: Record<string, string | undefined>;
  /** Tailwind alignment classes for the cell — defaults to text-left. */
  className?: string;
}

export function SortableTh({
  column,
  label,
  sort,
  dir,
  basePath = '',
  extraParams = {},
  className = 'text-left px-3 py-3',
}: SortableThProps): React.ReactElement {
  const isActive = sort === column;
  // Clicking an already-active column flips direction; clicking an
  // inactive one starts at ascending.
  const nextDir: SortDir = isActive && dir === 'asc' ? 'desc' : 'asc';

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extraParams)) {
    if (v != null && v !== '') params.set(k, v);
  }
  params.set('sort', column);
  params.set('dir', nextDir);
  const href = `${basePath}?${params.toString()}`;

  // Icon: arrow up/down when active, faint up/down when inactive so the
  // user knows the column is sortable but not currently the sort key.
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <th className={className}>
      <Link
        href={href}
        scroll={false}
        className={
          'inline-flex items-center gap-1 hover:text-ink ' +
          (isActive ? 'text-ink font-semibold' : 'text-ink-soft')
        }
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon className="w-3 h-3" />
      </Link>
    </th>
  );
}
