'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';

interface CardFilterProps {
  children: ReactNode;
  placeholder?: string;
  className?: string;
}

/**
 * Mobile card-list search box. Renders a search input above a card
 * container and filters the cards client-side by matching the typed
 * text against each card's visible text. Used on list pages where the
 * desktop table is replaced by tap-friendly cards below the md
 * breakpoint.
 *
 * Server components can pass server-rendered cards as children —
 * filtering happens in the browser against the already-rendered DOM, so
 * no data needs to be re-sent to the client. Each direct child of the
 * inner container is treated as one filterable card.
 */
export function CardFilter({ children, placeholder = 'Search…', className }: CardFilterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [noMatches, setNoMatches] = useState(false);

  function handleChange(value: string): void {
    const needle = value.trim().toLowerCase();
    const el = containerRef.current;
    if (!el) return;
    let visible = 0;
    Array.from(el.children).forEach((child) => {
      const node = child as HTMLElement;
      const match = needle === '' || (node.textContent ?? '').toLowerCase().includes(needle);
      node.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    setNoMatches(needle !== '' && visible === 0);
  }

  return (
    <div className={'md:hidden ' + (className ?? '')}>
      <div className="relative mb-2">
        <Search className="w-4 h-4 text-ink-mute absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className="input pl-9"
          aria-label="Search"
        />
      </div>
      <div ref={containerRef} className="space-y-2">
        {children}
      </div>
      {noMatches && (
        <div className="card p-6 text-center text-sm text-ink-soft">No cards match your search.</div>
      )}
    </div>
  );
}
