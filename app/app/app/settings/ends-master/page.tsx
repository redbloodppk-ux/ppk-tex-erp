'use client';
/**
 * Ends Master — catalogues the standard warp-end specs used across the
 * mill (60-ends, 80-ends, 100-ends, etc). Today the "ends" integer lives
 * on three tables (pavu.ends, bobbin.ends_per_bobbin, costing.warp_ends),
 * with no shared lookup; this page is the single place to define the
 * canonical list so downstream forms can switch to dropdowns.
 *
 * Writes go straight to the `ends_master` table; RLS allows
 * owner / mill_manager to insert and update.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2 } from 'lucide-react';

interface EndsRow {
  id: number;
  code: string;
  ends_count: number;
  name: string;
  active: boolean;
  notes: string | null;
}

interface NewEnds {
  code: string;
  ends_count: string;
  name: string;
  notes: string;
}

const EMPTY_NEW: NewEnds = {
  code: '',
  ends_count: '',
  name: '',
  notes: '',
};

function toIntOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  if (Number.isNaN(n) || !Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export default function EndsMasterPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<EndsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewEnds>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('ends_master')
      .select('id, code, ends_count, name, active, notes')
      .order('ends_count');
    if (err) {
      setError(err.message);
    } else {
      setRows((data ?? []) as unknown as EndsRow[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    setError(null);
    setSavedMsg(null);

    const code = neu.code.trim();
    const name = neu.name.trim();
    const ec = toIntOrNull(neu.ends_count);

    if (code === '') {
      setError('Enter a short code (e.g. E60).');
      return;
    }
    if (ec === null || ec <= 0) {
      setError('Enter a positive integer ends count (e.g. 60).');
      return;
    }
    if (name === '') {
      setError('Enter a friendly display name.');
      return;
    }
    if (rows.some((r) => r.code.toLowerCase() === code.toLowerCase())) {
      setError(`Code "${code}" already exists.`);
      return;
    }

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('ends_master').insert({
      code,
      ends_count: ec,
      name,
      active: true,
      notes: neu.notes.trim() === '' ? null : neu.notes.trim(),
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg(`Added ${code}.`);
    await load();
  }

  async function updateRow(id: number, patch: Partial<EndsRow>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('ends_master')
      .update(patch)
      .eq('id', id);
    setBusyId(null);

    if (err) {
      setError(err.message);
      await load();
      return;
    }
    setSavedMsg('Saved.');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ends Master"
        subtitle="Standard warp-end specs (60, 80, 100…) reused across bobbin, pavu and costing forms."
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Ends Master' },
        ]}
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add an ends spec</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="ne-code">Code</label>
            <input
              id="ne-code"
              type="text"
              className="input w-28"
              placeholder="E60"
              value={neu.code}
              onChange={(e) => setNeu((n) => ({ ...n, code: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="ne-count">Ends</label>
            <input
              id="ne-count"
              type="number"
              min={1}
              step="1"
              className="input num w-24"
              placeholder="60"
              value={neu.ends_count}
              onChange={(e) => setNeu((n) => ({ ...n, ends_count: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="ne-name">Display name</label>
            <input
              id="ne-name"
              type="text"
              className="input w-72"
              placeholder="60 Ends (standard shirting)"
              value={neu.name}
              onChange={(e) => setNeu((n) => ({ ...n, name: e.target.value }))}
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label" htmlFor="ne-notes">Notes</label>
            <input
              id="ne-notes"
              type="text"
              className="input w-full"
              placeholder="(optional)"
              value={neu.notes}
              onChange={(e) => setNeu((n) => ({ ...n, notes: e.target.value }))}
            />
          </div>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={handleAdd}
            disabled={adding}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add ends
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading ends specs…
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No ends specs yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Ends</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{r.code}</td>
                    <td className="py-2 pr-3 num">{r.ends_count}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-72"
                        value={r.name}
                        onChange={(e) => updateRow(r.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={r.active}
                          onChange={(e) => updateRow(r.id, { active: e.target.checked })}
                        />
                        <span className="text-xs text-ink-soft">
                          {r.active ? 'Yes' : 'No'}
                        </span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-full min-w-[12rem]"
                        value={r.notes ?? ''}
                        onChange={(e) =>
                          updateRow(r.id, {
                            notes: e.target.value === '' ? null : e.target.value,
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      {busyId === r.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
