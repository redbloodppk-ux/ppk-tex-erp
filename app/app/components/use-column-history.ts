'use client';
/**
 * useColumnHistory — pull distinct historical values of a column into
 * a typed list, ordered most-recent-first, for autocomplete / "pick
 * from history" UIs.
 *
 * Used by the invoice forms to remember Vehicle Number and Notes so
 * the operator doesn't re-type them every bill. Caller is responsible
 * for rendering — this hook just returns the list.
 *
 * Usage:
 *   const vehicles = useColumnHistory('invoice', 'vehicle_no', 50);
 *   const notes    = useColumnHistory('invoice', 'notes',      50);
 *
 *   <input list="vehicle-history" />
 *   <datalist id="vehicle-history">
 *     {vehicles.map(v => <option key={v} value={v} />)}
 *   </datalist>
 */
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useColumnHistory(
  table: string,
  column: string,
  limit: number = 100,
): string[] {
  const [values, setValues] = useState<string[]>([]);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      // Pull recent non-null rows; client-side dedupes. Supabase doesn't
      // expose DISTINCT through PostgREST, so we trade a bigger fetch
      // for simplicity — limit keeps it cheap.
      const { data, error } = await sb
        .from(table)
        .select(`${column}, created_at`)
        .not(column, 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (error || !data) return;
      // Trim, drop empties, dedupe case-insensitively but keep the
      // first (most-recent) casing.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const row of data as Array<Record<string, unknown>>) {
        const raw = row[column];
        if (typeof raw !== 'string') continue;
        const t = raw.trim();
        if (t === '') continue;
        const k = t.toUpperCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
      }
      setValues(out);
    })();
    return () => { cancelled = true; };
  }, [supabase, table, column, limit]);

  return values;
}
