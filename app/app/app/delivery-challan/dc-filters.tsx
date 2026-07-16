'use client';
/**
 * Filter bar for the Delivery Challan list — party, fabric quality, and DC
 * date range. Lives below the mode tab strip (All / In-house / Job Work /
 * Outsource Weaving) and applies on top of whichever tab is active: it
 * drives the same ?party=&quality=&from=&to= URL params the server page
 * (page.tsx) reads, and preserves whatever ?mode= is already in the URL
 * since it only ever adds/removes its own keys.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

interface PartyOption {
  id: number;
  code: string | null;
  name: string;
}

interface QualityOption {
  id: number;
  code: string | null;
  name: string | null;
}

interface DcFiltersProps {
  parties: PartyOption[];
  qualities: QualityOption[];
}

export function DcFilters({ parties, qualities }: DcFiltersProps): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();

  const party = params.get('party') ?? '';
  const quality = params.get('quality') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  function setParam(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());
    if (value === '') next.delete(key);
    else next.set(key, value);
    router.push(`/app/delivery-challan?${next.toString()}`, { scroll: false });
  }

  const hasFilters = party !== '' || quality !== '' || from !== '' || to !== '';

  return (
    <div className="card p-3 mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">Party</label>
        <select
          value={party}
          onChange={(e) => setParam('party', e.target.value)}
          className="input input-sm min-w-[180px]"
        >
          <option value="">All parties</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.code ? ` (${p.code})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">Fabric quality</label>
        <select
          value={quality}
          onChange={(e) => setParam('quality', e.target.value)}
          className="input input-sm min-w-[160px]"
        >
          <option value="">All qualities</option>
          {qualities.map((q) => (
            <option key={q.id} value={q.id}>
              {q.code ?? q.name ?? `#${q.id}`}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">From</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setParam('from', e.target.value)}
          className="input input-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">To</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setParam('to', e.target.value)}
          className="input input-sm"
        />
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.delete('party');
            next.delete('quality');
            next.delete('from');
            next.delete('to');
            const qs = next.toString();
            router.push(qs ? `/app/delivery-challan?${qs}` : '/app/delivery-challan', { scroll: false });
          }}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          <X className="w-3.5 h-3.5" /> Clear filters
        </button>
      )}
    </div>
  );
}
