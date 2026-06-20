'use client';
/**
 * Filter bar for the Wages register.
 *
 * Drives the list via URL search params (employee + period range) so the
 * server component can re-query on navigation and the filter state is
 * shareable / bookmarkable. "Period" filters on the work period
 * (period_start..period_end) overlapping the chosen From..To range.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

interface EmployeeOption {
  id: number;
  code: string;
  full_name: string;
}

interface WageFiltersProps {
  employees: EmployeeOption[];
}

export function WageFilters({ employees }: WageFiltersProps): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();

  const emp = params.get('emp') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  function setParam(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());
    if (value === '') next.delete(key);
    else next.set(key, value);
    router.push(`/app/wages?${next.toString()}`);
  }

  const hasFilters = emp !== '' || from !== '' || to !== '';

  return (
    <div className="card p-3 mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">Employee</label>
        <select
          value={emp}
          onChange={(e) => setParam('emp', e.target.value)}
          className="input input-sm min-w-[200px]"
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name} ({e.code})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">Period from</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setParam('from', e.target.value)}
          className="input input-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wide text-ink-mute">Period to</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setParam('to', e.target.value)}
          className="input input-sm"
        />
      </div>

      <div className="flex items-center gap-2 text-[11px] text-ink-mute">
        <Search className="w-3.5 h-3.5" />
        <span>Filters apply instantly</span>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => router.push('/app/wages')}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
