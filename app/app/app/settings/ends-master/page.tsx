'use client';
/**
 * Ends Master - catalogues standard warp-end specs (60, 80, 100...) pinned
 * to a specific yarn count. Code is auto-generated server-side (EN-NNNN)
 * via trg_ends_master_autogen_code.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2 } from 'lucide-react';

interface EndsRow {
  id: number;
  code: string;
  ends_count: number;
  name: string;
  count_id: number | null;
  active: boolean;
  notes: string | null;
}

interface CountOption {
  id: number;
  code: string;
  display_name: string;
}

interface NewEnds {
  ends_count: string;
  name: string;
  count_id: string;
  notes: string;
}

const EMPTY_NEW: NewEnds = {
  ends_count: '',
  name: '',
  count_id: '',
  notes: '',
};

function toIntOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  if (Number.isNaN(n) || Number.isFinite(n) === false) return null;
  return Math.trunc(n);
}

export default function EndsMasterPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<EndsRow[]>([]);
  const [counts, setCounts] = useState<CountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewEnds>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [endsRes, countRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('ends_master')
        .select('id, code, ends_count, name, count_id, active, notes')
        .order('ends_count'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('yarn_count')
        .select('id, code, display_name')
        .neq('status', 'archived')
        .order('code'),
    ]);
    if (endsRes.error) {
      setError(endsRes.error.message);
    } else if (countRes.error) {
      setError(countRes.error.message);
    } else {
      setRows((endsRes.data ?? []) as unknown as EndsRow[]);
      setCounts((countRes.data ?? []) as unknown as CountOption[]);
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

    const name = neu.name.trim();
    const ec = toIntOrNull(neu.ends_count);

    if (ec === null || ec <= 0) {
      setError('Enter a positive integer ends count (e.g. 60).');
      return;
    }
    if (name === '') {
      setError('Enter a friendly display name.');
      return;
    }
    const countId = neu.count_id === '' ? null : Number(neu.count_id);

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('ends_master').insert({
      ends_count: ec,
      name,
      count_id: countId,
      active: true,
      notes: neu.notes.trim() === '' ? null : neu.notes.trim(),
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg('Added new ends spec.');
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

  async function deleteRow(id: number, code: string) {
    const ok = window.confirm('Delete ends spec ' + code + '?');
    if (ok === false) return;

    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('ends_master').delete().eq('id', id);
    setBusyId(null);

    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + code + '.');
  }

  function countLabel(id: number | null): string {
    if (id === null) return '-';
    const c = counts.find((x) => x.id === id);
    return c ? c.code + ' - ' + c.display_name : '#' + String(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ends Master"
        subtitle="Standard warp-end specs (60, 80, 100...) pinned to a specific yarn count. Code auto-generated."
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
            <label className="label">Code</label>
            <div className="input num w-28 bg-cloud/40 text-ink-mute select-none">
              Auto (EN-NNNN)
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ne-count">Ends *</label>
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
            <label className="label" htmlFor="ne-count-id">Yarn count</label>
            <select
              id="ne-count-id"
              className="input w-56"
              value={neu.count_id}
              onChange={(e) => setNeu((n) => ({ ...n, count_id: e.target.value }))}
            >
              <option value="">--- none ---</option>
              {counts.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.code} - {c.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ne-name">Display name *</label>
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
          Loading ends specs...
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
                  <th className="py-2 pr-3">Yarn count</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium font-mono text-xs">{r.code}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={1}
                        step="1"
                        className="input num w-20"
                        value={r.ends_count}
                        onChange={(e) => updateRow(r.id, { ends_count: Number(e.target.value) || 1 })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="input w-48"
                        value={r.count_id === null ? '' : String(r.count_id)}
                        onChange={(e) =>
                          updateRow(r.id, {
                            count_id: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        title={countLabel(r.count_id)}
                      >
                        <option value="">--- none ---</option>
                        {counts.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.code} - {c.display_name}
                          </option>
                        ))}
                      </select>
                    </td>
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
                        <span className="text-xs text-ink-soft">{r.active ? 'Yes' : 'No'}</span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-full min-w-[12rem]"
                        value={r.notes ?? ''}
                        onChange={(e) =>
                          updateRow(r.id, { notes: e.target.value === '' ? null : e.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {busyId === r.id && <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />}
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-red-50 text-red-600"
                          title="Delete this ends spec"
                          onClick={() => deleteRow(r.id, r.code)}
                          disabled={busyId === r.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
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
