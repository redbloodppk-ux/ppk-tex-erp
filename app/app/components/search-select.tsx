'use client';
/**
 * SearchSelect — a type-ahead replacement for a native <select>.
 *
 * The operator types a few letters and the list narrows to options whose
 * label contains every typed word (case-insensitive, any order — so
 * "tex sri" still finds "SRI MURUGAN TEX"). Click or Enter picks one.
 *
 * Behaviour notes:
 *   - Closed state shows the selected option's label.
 *   - Opening (focus/click) clears the box so the full list shows and
 *     typing starts a fresh search; closing without picking reverts to
 *     the previously selected label, never losing the selection.
 *   - Enter inside the box never submits the surrounding form — it picks
 *     the highlighted option instead.
 *   - A small ✕ clears the selection (only when one exists).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export interface SearchSelectOption {
  value: string;
  label: string;
}

interface SearchSelectProps {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  /** Shown in the dropdown when no option matches the typed text. */
  noMatchText?: string;
}

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'Type to search…',
  required = false,
  className = '',
  noMatchText = 'No match found',
}: SearchSelectProps): React.ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [highlight, setHighlight] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = useMemo<SearchSelectOption | null>(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  // Every typed word must appear somewhere in the label (AND match,
  // order-independent) so partial typing in any order works. Matching
  // is:
  //   - SPACE/PUNCTUATION-INSENSITIVE: "SR TEX" finds "S R TEX",
  //     "rscotton" finds "R S COTTON MILL"
  //   - INITIALS-AWARE: "sm tex" finds both "S M TEX FEB" and
  //     "SRI MURUGAN TEX" (the "sm" matches the run of first letters),
  //     "vcm" finds "VARNAA COTTON MILLS".
  //
  // Matched options are RANKED by relevance, not just shown in the
  // original order — exact label hits and word-prefix hits float to
  // the top so the right party is the first row even when many
  // others also contain the typed letters.
  const filtered = useMemo<SearchSelectOption[]>(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return options;
    const squash = (s: string): string => s.replace(/[\s.\-/&]+/g, '');
    /** First letter of every space-separated word, concatenated.
     *  E.g. "sri murugan tex" -> "smt"; "s m tex feb" -> "smtf". */
    const initialsOf = (s: string): string =>
      s.split(/\s+/)
       .map((w) => w[0] ?? '')
       .join('')
       .replace(/[^a-z0-9]/g, '');
    const words = q.split(/\s+/).filter((w) => w.length > 0);
    const squashedQuery = squash(q);

    type Scored = { opt: SearchSelectOption; score: number };
    const scored: Scored[] = [];
    for (const o of options) {
      const label          = o.label.toLowerCase();
      const squashedLabel  = squash(label);
      const labelInitials  = initialsOf(label);
      const labelWords     = label.split(/\s+/).filter((w) => w.length > 0);

      // Every typed word must hit at least one of these to keep the
      // row at all. Inside the loop we also accumulate a relevance
      // score so the strongest match floats to the top.
      let score = 0;
      const allWordsHit = words.every((w) => {
        const sw = squash(w);
        // Score the most specific kind of hit and bail when found.
        // Order matters: stronger hits give bigger jumps in score.
        if (labelWords.includes(w))                 { score += 80;  return true; } // exact word match
        if (labelWords.some((lw) => lw.startsWith(w))) { score += 50;  return true; } // word-prefix
        if (squashedLabel.startsWith(sw))           { score += 60;  return true; } // prefix of squashed label
        if (labelInitials.startsWith(sw))           { score += 55;  return true; } // initials prefix
        if (labelInitials.includes(sw))             { score += 30;  return true; } // initials substring
        if (label.includes(w))                      { score += 20;  return true; } // generic substring
        if (squashedLabel.includes(sw))             { score += 15;  return true; } // squashed substring
        return false;
      });

      if (!allWordsHit) {
        // Last-resort fallback: the whole query as one squashed run
        // (catches "srimurugantex"). Treat it as a low-quality hit.
        if (squashedLabel.includes(squashedQuery)) {
          scored.push({ opt: o, score: 10 });
        }
        continue;
      }

      // Bonuses for very strong overall matches.
      if (label === q || squashedLabel === squashedQuery)      score += 200; // exact label
      else if (label.startsWith(q) || squashedLabel.startsWith(squashedQuery)) score += 100; // label prefix
      if (labelInitials === squashedQuery)                     score += 120; // exact initials
      else if (labelInitials.startsWith(squashedQuery))        score += 70;  // initials prefix
      // Slight penalty for very long labels so a short exact match
      // beats a longer label that just happens to contain it.
      score -= Math.min(20, Math.floor(label.length / 10));

      scored.push({ opt: o, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.opt.label.localeCompare(b.opt.label);
    });
    return scored.map((s) => s.opt);
  }, [options, query]);

  // Keep the highlighted row inside the filtered range.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Close when clicking anywhere outside the component.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Keep the highlighted option scrolled into view while arrowing.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function openList(): void {
    setOpen(true);
    setQuery('');
    setHighlight(0);
  }

  function pick(opt: SearchSelectOption): void {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function clear(): void {
    onChange('');
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { openList(); return; }
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Never let Enter bubble up and submit the form from here.
      e.preventDefault();
      if (open && filtered.length > 0) {
        const opt = filtered[highlight] ?? filtered[0];
        if (opt) pick(opt);
      } else if (!open) {
        openList();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  }

  const displayValue = open ? query : (selected?.label ?? '');

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        className="input w-full pr-14"
        autoComplete="off"
        spellCheck={false}
        required={required && value === ''}
        placeholder={selected ? selected.label : placeholder}
        value={displayValue}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="absolute inset-y-0 right-2 flex items-center gap-1">
        {selected !== null && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            className="p-0.5 rounded text-ink-mute hover:text-rose-600 hover:bg-rose-50"
            title="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <ChevronDown className="w-4 h-4 text-ink-mute pointer-events-none" />
      </div>
      {open && (
        <ul
          ref={listRef}
          className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-line bg-white shadow-lg py-1 text-sm"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-ink-mute text-xs">{noMatchText}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                data-idx={i}
                // onMouseDown (not onClick) so the pick lands before the
                // input's blur/outside-click handlers close the list.
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setHighlight(i)}
                className={
                  'px-3 py-2 cursor-pointer ' +
                  (i === highlight ? 'bg-indigo-50 text-indigo-800' : 'text-ink-soft') +
                  (o.value === value ? ' font-semibold' : '')
                }
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
