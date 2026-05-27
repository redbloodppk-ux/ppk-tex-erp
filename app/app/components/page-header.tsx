import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { HeaderNavButtons } from './header-nav-buttons';

interface Crumb { label: string; href?: string }

export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
}: {
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-end justify-between flex-wrap gap-3">
      <div>
        <HeaderNavButtons />
        {crumbs?.length ? (
          <nav className="text-xs text-ink-mute mb-1.5 flex items-center gap-1">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.href ? (
                  <Link href={c.href} className="hover:text-ink">{c.label}</Link>
                ) : (
                  <span>{c.label}</span>
                )}
                {i < crumbs.length - 1 && <ChevronRight className="w-3 h-3" />}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-2xl font-display font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-soft mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function ComingSoon({ note }: { note?: string }) {
  return (
    <div className="card p-10 text-center">
      <div className="inline-block px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold tracking-wide mb-3">
        UNDER CONSTRUCTION
      </div>
      <p className="text-sm text-ink-soft max-w-md mx-auto">
        {note ?? 'This module is wired into the database but the UI is being built. The screen below the prototype already shows the final design — we are porting it page-by-page.'}
      </p>
    </div>
  );
}
