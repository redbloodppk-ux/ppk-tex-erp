'use client';
/**
 * Ends Master - catalogues standard warp-end specs pinned to a yarn count.
 *
 * Display name is auto-generated as `{ends} /{count}` using the linked
 * yarn count's natural notation:
 *   - cotton    -> "2400 /40's"     (Ne value + apostrophe-s)
 *   - polyester -> "2400 /75D"      (denier + D)
 *   - blend     -> "2400 /60s combed" (yarn_count.display_name)
 *   - no count  -> just the ends number
 *
 * Code is auto-generated server-side (EN-NNNN) via trg_ends_master_autogen_code.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2 } from 'lucide-react';

type YarnType = 'cotton' | 'polyester' | 'blend';

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
  yarn_type: YarnType;
  ne: number | null;
  denier: number | null;
}

interface NewEnds {
  ends_count: string;
  count_id: string;
  notes: string;
}

const EMPTY_NEW: NewEnds = {
  ends_count: '',
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

/**
 * Build the "/count" suffix the way weavers say it.
 *   cotton    -> Ne + "'s"   e.g. "40's"
 *   polyester -> denier + D  e.g. "75D"
 *   blend     -> display_name as-is
 */
function buildCountSuffix(c: CountOption | undefined | null): string {
  if (c == null) return '';
  if (c.yarn_type === 'cotton' && c.ne != null) return String(c.ne) + "'s";
  if (c.yarn_type === 'polyester' && c.denier != null) return String(c.denier) + 'D';
  return c.display_name;
}

function buildDisplayName(ends: number | null, c: CountOption | undefined | null): string {
  if (ends == null || ends <= 0) return c == null ? '' : buildCountSuffix(c);
  const suffix = buildCountSuffix(c);
  return suffix === '' ? String(ends) : String(ends) + ' /' + suffix;
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
        .select('id, code, display_name, yarn_type, ne, denier')
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

  const countById = useMemo<Map<number, CountOption>>(() => {
    const m = new Map<number, CountOption>();
    counts.forEach((c) => m.set(c.id, c));
    return m;
  }, [counts]);

  const namePreview = useMemo<string>(() => {
    const ec = toIntOrNull(neu.ends_count);
    const c = neu.count_id === '' ? null : countById.get(Number(neu.count_id));
    return buildDisplayName(ec, c);
  }, [neu.ends_count, neu.count_id, countById]);

  async function handleAdd() {
    setError(null);
    setSavedMsg(null);

    const ec = toIntOrNull(neu.ends_count);
    if (ec === null || ec <= 0) {
      setError('Enter a positive integer ends count (e.g. 2400).');
      return;
    }
    const countId = neu.count_id === '' ? null : Number(neu.count_id);
    const count = countId === null ? null : countById.get(countId);
    const name = buildDisplayName(ec, count);
    if (name === '') {
      setError('Pick a yarn count, or enter an ends value.');
      return;
    }

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('ends_master').insert({
      // code omitted - trg_ends_master_autogen_code fills it (EN-NNNN)
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
    setSavedMsg('Added ' + name + '.');
    await load();
  }

  /**
   * Apply the patch + recompute the display name if ends_count or
   * count_id changed (so the persisted name stays in sync).
   */
  async function updateRow(id: number, patch: Partial<EndsRow>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    const current = rows.find((r) => r.id === id);
    const merged: EndsRow = { ...(current as EndsRow), ...patch };

    const nameRecalcNeeded =
      Object.prototype.hasOwnProperty.call(patch, 'ends_count') ||
      Object.prototype.hasOwnProperty.call(patch, 'count_id');

    let persistPatch: Partial<EndsRow> = patch;
    if (nameRecalcNeeded) {
      const c = merged.count_id === null ? null : countById.get(merged.count_id);
      const newName = buildDisplayName(merged.ends_count, c);
      persistPatch = { ...patch, name: newName };
      merged.name = newName;
    }

    setRows((prev) => prev.map((r) => (r.id === id ? merged : r)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('ends_master')
      .update(persistPatch)
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ends Master"
        subtitle='Warp-end specs pinned to a yarn count. Display name auto-formats as "ends /count" (e.g. 2400 /40&#39;s).'
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
              className="input num w-28"
              placeholder="2400"
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
          <div className="min-w-[14rem]">
            <label className="label">Display name (auto)</label>
            <div className="input bg-cloud/40 text-ink-soft select-none">
              {namePreview === '' ? '-' : namePreview}
            </div>
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
                  <th className="py-2 pr-3">Display name</th>
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
                        className="input num w-24"
                        value={r.ends_count}
                        onChange={(e) =>
                          updateRow(r.id, { ends_count: Number(e.target.value) || 1 })
                        }
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
                      >
                        <option value="">--- none ---</option>
                        {counts.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.code} - {c.display_name}
                          </option>
                        ))}
                          </select>
                    </td>
                    <td className="py-2 pr-3 font-semibold text-ink">{r.name}</td>
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
