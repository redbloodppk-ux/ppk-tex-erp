'use client';
/**
 * Combobox — a custom, fully-styled autocomplete dropdown.
 *
 * Replaces the native <input list> + <datalist> pairing (whose popup
 * looks different in every browser) with a consistent, app-themed
 * suggestion list. Type to filter, click or press Enter to pick, arrow
 * keys to move, Escape to close. Clicking outside closes and restores
 * the current selection's label.
 *
 * The component is controlled: the parent owns the selected id (`value`)
 * and is notified via `onChange`. Typing only filters the list; the
 * selection commits when the operator clicks a row or presses Enter.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboOption {
  id: string;
  label: string;
  /** Muted secondary text shown on the right of each row (e.g. a code). */
  hint?: string;
}

interface ComboboxProps {
  options: ComboOption[];
  /** Selected option id, or '' for no selection. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Shown inside the list when nothing matches the query. */
  emptyText?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Type or pick…',
  disabled = false,
  emptyText = 'No matches',
}: ComboboxProps): React.ReactElement {
  const [open, setOpen]   = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [active, setActive] = useState<number>(0);

  const rootRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId   = useId();

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  // When the box is closed the input shows the selected label. When open
  // it shows whatever the operator is typing. An empty query (or a query
  // that still equals the current selection) shows the whole list so the
  // operator can browse; otherwise filter by substring on label + hint.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === (selected?.label ?? '').toLowerCase()) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) ||
      (o.hint ? o.hint.toLowerCase().includes(q) : false),
    );
  }, [options, query, selected]);

  // Close on any click outside the component.
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Keep the active row in range whenever the filtered list changes.
  useEffect(() => {
    setActive((a) => (a >= filtered.length ? 0 : a));
  }, [filtered.length]);

  function openList(): void {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    // Pre-highlight the current selection so Enter re-picks it.
    const idx = filtered.findIndex((o) => o.id === value);
    setActive(idx >= 0 ? idx : 0);
  }

  function commit(opt: ComboOption | undefined): void {
    if (!opt) return;
    onChange(opt.id);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      openList();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(filtered[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  const inputValue = open ? query : (selected?.label ?? '');

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          className="input pr-8"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
        />
        <ChevronDown
          className={cn(
            'w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-line bg-paper shadow-card py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-mute">{emptyText}</li>
          ) : (
            filtered.map((o, i) => {
              const isSel = o.id === value;
              const isActive = i === active;
              return (
                <li
                  key={o.id}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); commit(o); }}
                  className={cn(
                    'flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer',
                    isActive ? 'bg-indigo/10 text-ink' : 'text-ink-soft',
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Check className={cn('w-3.5 h-3.5 shrink-0', isSel ? 'text-indigo' : 'opacity-0')} />
                    <span className="truncate font-medium">{o.label}</span>
                  </span>
                  {o.hint && (
                    <span className="shrink-0 text-[11px] text-ink-mute font-mono">{o.hint}</span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
