'use client';
/**
 * InhouseStockTabs — a shared tab strip that sits at the top of the
 * three In-house Stock pages (Yarn, Porvai Yarn, Bobbin). Each tab is a
 * Next.js Link to its own route, so each tab keeps its own dedicated
 * page (good for deep-linking + back-compat with the old URLs); the
 * tabs just give the user a single visual section to bounce between.
 *
 * The active tab is detected from the current pathname.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface TabDef {
  href: string;
  label: string;
}

const TABS: readonly TabDef[] = [
  { href: '/app/yarn-stock',        label: 'Yarn Stock' },
  { href: '/app/porvai-yarn-stock', label: 'Porvai Yarn Stock' },
  { href: '/app/bobbin',            label: 'Bobbin Stock' },
  { href: '/app/fabric-stock',      label: 'Fabric Stock' },
];

export function InhouseStockTabs(): React.ReactElement {
  const pathname = usePathname();
  return (
    <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
              active
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
