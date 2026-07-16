'use client';
/**
 * Filter bar for the Delivery Challan list — party, fabric quality, and DC
 * date range. Lives below the mode tab strip (All / In-house / Job Work /
 * Outsource Weaving) and applies on top of whichever tab is active: it
 * drives the same ?party=&quality=&from=&to= URL params the server page
 * (page.tsx) reads, and preserves whatever ?mode= is already in the URL
 * since it only ever adds/removes its own keys.
 */
import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';

interface PartyOption {
  id: number;
  code: string | null;
  name: string;
  party_type_ids: number[] | null;
}

interface QualityOption {
  id: number;
  code: string | null;
  name: string | null;
  is_merged: boolean | null;
  merged_name: string | null;
}

interface DcFiltersProps {
  parties: PartyOption[];
  qualities: QualityOption[];
  /** party_type_master ids for the 3 tab-scoped roles — resolved by name on
   *  the server so nothing here is hardcoded. Whichever tab (mode) is
   *  active, the party list is narrowed to that role only, same rule the
   *  New DC form uses, so the operator can't pick a party of the wrong kind. */
  partyTypeIds: { inhouse: number | null; jobwork: number | null; outsource: number | null };
}

export function DcFilters({ parties, qualities, partyTypeIds }: DcFiltersProps): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();

  const party = params.get('party') ?? '';
  const quality = params.get('quality') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const mode = params.get('mode') ?? '';

  // Scope the party list to whichever tab is active. "All" tab (no mode)
  // keeps every active party available, since it spans all 3 flows.
  const scopedParties = useMemo(() => {
    const typeId = mode === 'inhouse' ? partyTypeIds.inhouse
      : mode === 'jobwork' ? partyTypeIds.jobwork
      : mode === 'outsource' ? partyTypeIds.outsource
      : null;
    if (typeId === null) return parties;
    return parties.filter((p) => (p.party_type_ids ?? []).includes(typeId));
  }, [parties, mode, partyTypeIds]);

  const partyOptions: SearchSelectOption[] = useMemo(
    () => scopedParties.map((p) => ({
      value: String(p.id),
      label: p.code ? `${p.name} (${p.code})` : p.name,
    })),
    [scopedParties],
  );

  // Several physically-distinct fabric_quality rows can share one merged
  // name (e.g. "COLOR OE" covers two yarn-count variants) — group those
  // into a single option whose value is every underlying id joined with a
  // comma, so picking it filters DCs matching ANY of them. Non-merged
  // qualities stay as individual options, same as before.
  const qualityOptions: SearchSelectOption[] = useMemo(() => {
    const merged = new Map<string, number[]>();
    const singles: SearchSelectOption[] = [];
    for (const q of qualities) {
      if (q.is_merged && q.merged_name) {
        const ids = merged.get(q.merged_name) ?? [];
        ids.push(q.id);
        merged.set(q.merged_name, ids);
      } else {
        singles.push({ value: String(q.id), label: q.code ?? q.name ?? `#${q.id}` });
      }
    }
    const groups: SearchSelectOption[] = Array.from(merged.entries()).map(([name, ids]) => ({
      value: ids.slice().sort((a, b) => a - b).join(','),
      label: name,
    }));
    return [...groups, ...singles].sort((a, b) => a.label.localeCompare(b.label));
  }, [qualities]);

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
        <SearchSelect
          options={partyOptions}
          value={party}
          onChange={(v) => setParam('party', v)}
          placeholder="All parties — type to search…"
          className="min-w-[220px]"
          noMatchText="No party found for this tab."
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">Fabric quality</label>
        <SearchSelect
          options={qualityOptions}
          value={quality}
          onChange={(v) => setParam('quality', v)}
          placeholder="All qualities — type to search…"
          className="min-w-[200px]"
          noMatchText="No quality found."
        />
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
