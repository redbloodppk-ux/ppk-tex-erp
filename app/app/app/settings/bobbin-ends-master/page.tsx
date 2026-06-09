'use client';
/**
 * Bobbin Ends Master — catalogue of valid ends-per-bobbin specs.
 *
 * Distinct from the Ends Master (warp ends pinned to yarn count).
 * This master constrains the "Ends per bobbin" dropdown on the
 * in-house bobbin opening stock form so the operator picks from a
 * known list (e.g. 30 / 40 / 60 / 80 / 100) instead of free-typing.
 *
 * RLS: read for any auth user; write only for owner / mill_manager.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2 } from 'lucide-react';

interface BobbinEndsRow {
  id: number;
  ends_count: number;
  label: string;
  active: boolean;
  notes: string | null;
}

interface NewRow {
  ends_count: string;
  label: string;
  notes: string;
}

const EMPTY_NEW: NewRow = { ends_count: '', label: '', notes: '' };

function toIntOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  if (Number.isNaN(n) || !Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function defaultLabel(endsCount: number | null): string {
  if (endsCount === null || endsCount <= 0) return '';
  return `${endsCount} ends/bobbin`;
}

export default function BobbinEndsMasterPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<BobbinEndsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewRow>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (supabase as any)
      .from('bobbin_ends_master')
      .select('id, ends_count, label, active, notes')
      .order('ends_count');
    if (res.error) {
      setError(res.error.message);
    } else {
      setRows((res.data ?? []) as unknown as BobbinEndsRow[]);
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
    const ec = toIntOrNull(neu.ends_count);
    if (ec === null || ec <= 0) {
      setError('Enter a positive integer ends count (e.g. 60).');
      return;
    }
    const label = neu.label.trim() === '' ? defaultLabel(ec) : neu.label.trim();
    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('bobbin_ends_master').insert({
      ends_count: ec,
      label,
      active: true,
      notes: neu.notes.trim() === '' ? null : neu.notes.trim(),
    });
    setAdding(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg(`Added ${label}.`);
    await load();
  }

  async function updateRow(id: number, patch: Partial<BobbinEndsRow>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);
    const current = rows.find((r) => r.id === id);
    if (!current) {
      setBusyId(null);
      return;
    }
    const merged: BobbinEndsRow = { ...current, ...patch };
    setRows((prev) => prev.map((r) => (r.id === id ? merged : r)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('bobbin_ends_master')
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

  async function deleteRow(id: number, ends: number) {
    const ok = window.confirm(`Delete ${ends} ends/bobbin entry?`);
    if (!ok) return;
    setError(null);
    setSavedMsg(null);
    setBusyId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('bobbin_ends_master').delete().eq('id', id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg(`Deleted ${ends} ends/bobbin.`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bobbin Ends Master"
        subtitle="Valid 'ends per bobbin' specs. Active rows populate the dropdown on the in-house bobbin opening stock form."
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Bobbin Ends Master' },
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
        <h2 className="font-display font-bold text-base">Add an ends-per-bobbin spec</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="be-count">Ends *</label>
            <input
              id="be-count"
              type="number"
              min={1}
              step="1"
              className="input num w-28"
              placeholder="60"
              value={neu.ends_count}
              onChange={(e) => setNeu((n) => ({ ...n, ends_count: e.target.value }))}
            />
          </div>
          <div className="min-w-[14rem]">
            <label className="label" htmlFor="be-label">Label</label>
            <input
              id="be-label"
              type="text"
              className="input w-full"
              placeholder={defaultLabel(toIntOrNull(neu.ends_count)) || 'e.g. 60 ends/bobbin'}
              value={neu.label}
              onChange={(e) => setNeu((n) => ({ ...n, label: e.target.value }))}
            />
            <p className="text-[10px] text-ink-mute mt-1">Defaults to &ldquo;N ends/bobbin&rdquo; if blank.</p>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label" htmlFor="be-notes">Notes</label>
            <input
              id="be-notes"
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
          No bobbin ends specs yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Ends</th>
                  <th className="py-2 pr-3">Label</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={1}
                        step="1"
                        className="input num w-24"
                        value={r.ends_count}
                        onChange={(e) =>
                          updateRow(r.id, { ends_count: Number(e.target.value) || 1 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-full min-w-[12rem]"
                        value={r.label}
                        onChange={(e) => updateRow(r.id, { label: e.target.value })}
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
                      <div className="flex items-center gap-2">
                        {busyId === r.id && (
                          <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
                        )}
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-red-50 text-red-600"
                          title="Delete this ends spec"
                          onClick={() => deleteRow(r.id, r.ends_count)}
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
