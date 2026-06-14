'use client';
/**
 * GlobalSearch — the search box that lives in the desktop topbar.
 *
 * The operator types two or more characters, and after a 300ms
 * debounce the box queries four sources in parallel and shows a
 * grouped dropdown of matches:
 *
 *   - Invoice           -> /app/invoices/{id}
 *   - Delivery Challan  -> /app/delivery-challan/{id}
 *   - Party             -> /app/parties/{id}
 *   - Sizing bill       -> /app/sizing/{id}
 *
 * Click (or Enter on the highlighted row) navigates. Escape closes
 * the dropdown. The bar replaces the static <input type="search">
 * placeholder that used to live in topbar.tsx — that one had no
 * onChange/onSubmit wired up at all, which is why typing "did
 * nothing".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Search, FileText, Truck, Users, Receipt, Loader2 } from 'lucide-react';

type ResultKind = 'invoice' | 'dc' | 'party' | 'sizing';

interface SearchResult {
  kind:    ResultKind;
  id:      number;
  label:   string;            // e.g. "INV-2026-0001"
  sub:     string;            // e.g. party name + date
  href:    string;            // route to navigate to on click
}

const KIND_LABEL: Record<ResultKind, string> = {
  invoice: 'Invoices',
  dc:      'Delivery Challans',
  party:   'Parties',
  sizing:  'Sizing Bills',
};

const KIND_ICON: Record<ResultKind, React.ComponentType<{ className?: string }>> = {
  invoice: FileText,
  dc:      Truck,
  party:   Users,
  sizing:  Receipt,
};

/** Order in which result groups appear in the dropdown. */
const KIND_ORDER: ResultKind[] = ['invoice', 'dc', 'party', 'sizing'];

/** Max rows returned per source — keeps the dropdown short. */
const PER_SOURCE_LIMIT = 6;

function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

export function GlobalSearch(): React.ReactElement {
  const router   = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [query,     setQuery]     = useState<string>('');
  const [results,   setResults]   = useState<SearchResult[]>([]);
  const [loading,   setLoading]   = useState<boolean>(false);
  const [open,      setOpen]      = useState<boolean>(false);
  const [highlight, setHighlight] = useState<number>(0);

  const rootRef  = useRef<HTMLDivElement | null>(null);
  const listRef  = useRef<HTMLUListElement | null>(null);
  // Used to discard out-of-order responses when the operator keeps
  // typing — only the most-recent query's results are accepted.
  const seqRef   = useRef<number>(0);

  // ── Run the search whenever the (debounced) query changes ────────
  const runSearch = useCallback(async (q: string): Promise<void> => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const mySeq = ++seqRef.current;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const wildcard = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;

    const [invRes, dcRes, partyRes, sizingRes] = await Promise.all([
      sb.from('invoice')
        .select('id, invoice_no, party_name, invoice_date, doc_type')
        .or(`invoice_no.ilike.${wildcard},party_name.ilike.${wildcard}`)
        .order('invoice_date', { ascending: false })
        .limit(PER_SOURCE_LIMIT),
      sb.from('delivery_challan')
        .select('id, code, bill_to_name, dc_date')
        .or(`code.ilike.${wildcard},bill_to_name.ilike.${wildcard}`)
        .order('dc_date', { ascending: false })
        .limit(PER_SOURCE_LIMIT),
      sb.from('party')
        .select('id, code, name, status')
        .eq('status', 'active')
        .or(`code.ilike.${wildcard},name.ilike.${wildcard}`)
        .order('name', { ascending: true })
        .limit(PER_SOURCE_LIMIT),
      sb.from('sizing_job')
        .select('id, bill_no, bill_date, sizing_vendor:sizing_ledger_id ( name )')
        .not('bill_no', 'is', null)
        .ilike('bill_no', wildcard)
        .order('bill_date', { ascending: false, nullsFirst: false })
        .limit(PER_SOURCE_LIMIT),
    ]);

    // Drop stale responses (operator typed faster than the round trip).
    if (mySeq !== seqRef.current) return;

    const out: SearchResult[] = [];

    for (const r of (invRes.data ?? []) as Array<{
      id: number; invoice_no: string; party_name: string | null;
      invoice_date: string | null; doc_type: string | null;
    }>) {
      out.push({
        kind:  'invoice',
        id:    r.id,
        label: r.invoice_no,
        sub:   [r.party_name, fmtDate(r.invoice_date)].filter(Boolean).join(' · '),
        href:  `/app/invoices/${r.id}`,
      });
    }

    for (const r of (dcRes.data ?? []) as Array<{
      id: number; code: string; bill_to_name: string | null; dc_date: string | null;
    }>) {
      out.push({
        kind:  'dc',
        id:    r.id,
        label: r.code,
        sub:   [r.bill_to_name, fmtDate(r.dc_date)].filter(Boolean).join(' · '),
        href:  `/app/delivery-challan/${r.id}`,
      });
    }

    for (const r of (partyRes.data ?? []) as Array<{
      id: number; code: string; name: string;
    }>) {
      out.push({
        kind:  'party',
        id:    r.id,
        label: r.name,
        sub:   r.code,
        href:  `/app/parties/${r.id}`,
      });
    }

    for (const r of (sizingRes.data ?? []) as Array<{
      id: number; bill_no: string; bill_date: string | null;
      sizing_vendor: { name: string } | null;
    }>) {
      out.push({
        kind:  'sizing',
        id:    r.id,
        label: r.bill_no,
        sub:   [r.sizing_vendor?.name, fmtDate(r.bill_date)].filter(Boolean).join(' · '),
        href:  `/app/sizing/${r.id}`,
      });
    }

    // Group sort: invoice -> dc -> party -> sizing (then keep DB order).
    const grouped: SearchResult[] = [];
    for (const k of KIND_ORDER) {
      for (const r of out) {
        if (r.kind === k) grouped.push(r);
      }
    }
    setResults(grouped);
    setHighlight(0);
    setLoading(false);
  }, [supabase]);

  // 300ms debounce on the query so we don't fire 6 calls per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => { void runSearch(query); }, 300);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  // Close on click outside.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Keep highlighted row scrolled into view as the operator arrows.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function pick(r: SearchResult): void {
    setOpen(false);
    setQuery('');
    setResults([]);
    router.push(r.href);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Don't let Enter submit any surrounding form.
      e.preventDefault();
      const r = results[highlight] ?? results[0];
      if (r) pick(r);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showDropdown =
    open && query.trim().length >= 2 && (loading || results.length > 0 || true);

  return (
    <div ref={rootRef} className="relative w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-mute pointer-events-none" />
      <input
        type="search"
        placeholder="Search invoice, DC, party, sizing bill…"
        className="input pl-9 h-9 text-sm w-full"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
        onKeyDown={handleKeyDown}
      />

      {showDropdown && (
        <div className="absolute z-40 mt-1 w-[28rem] max-w-[80vw] right-0 sm:right-auto sm:left-0 rounded-lg border border-line bg-white shadow-lg overflow-hidden">
          {loading && results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-ink-mute flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-ink-mute">
              No matches for &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            <ul ref={listRef} className="max-h-96 overflow-auto py-1 text-sm">
              {KIND_ORDER.map((kind) => {
                const group = results.filter((r) => r.kind === kind);
                if (group.length === 0) return null;
                const Icon = KIND_ICON[kind];
                return (
                  <li key={kind}>
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-ink-mute bg-cloud/40 flex items-center gap-1.5">
                      <Icon className="w-3 h-3" /> {KIND_LABEL[kind]}
                    </div>
                    <ul>
                      {group.map((r) => {
                        const idx = results.indexOf(r);
                        const isHi = idx === highlight;
                        return (
                          <li
                            key={`${r.kind}-${r.id}`}
                            data-idx={idx}
                            // onMouseDown (not onClick) so the navigation
                            // lands before the input's blur handler
                            // closes the list.
                            onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                            onMouseEnter={() => setHighlight(idx)}
                            className={
                              'px-3 py-2 cursor-pointer flex items-center justify-between gap-3 ' +
                              (isHi ? 'bg-indigo-50' : 'hover:bg-haze/60')
                            }
                          >
                            <div className="min-w-0">
                              <div className="font-mono text-xs font-semibold text-ink truncate">{r.label}</div>
                              {r.sub && <div className="text-[11px] text-ink-mute truncate">{r.sub}</div>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="px-3 py-1.5 text-[10px] text-ink-mute border-t border-line/40 bg-cloud/20">
            Press <kbd className="px-1 py-0.5 rounded border border-line bg-white">↑↓</kbd>
            {' '}to navigate, <kbd className="px-1 py-0.5 rounded border border-line bg-white">Enter</kbd>
            {' '}to open, <kbd className="px-1 py-0.5 rounded border border-line bg-white">Esc</kbd>
            {' '}to close.
          </div>
        </div>
      )}
    </div>
  );
}
