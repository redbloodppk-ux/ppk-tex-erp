'use client';
/**
 * Count Master — catalogues yarn counts purchased / used in the mill.
 *
 * Yarn-type handling per the build guide:
 *   * cotton    → user enters Ne  (English count). Denier / tex left blank.
 *   * polyester → user enters denier; Nec auto-computed as 5315 / denier.
 *   * blend     → user can fill either Ne or denier; both editable.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2 } from 'lucide-react';

type YarnType = 'cotton' | 'polyester' | 'blend';
type RecordStatus = 'active' | 'inactive' | 'archived';

interface CountRow {
  id: number;
  code: string;
  display_name: string;
  yarn_type: YarnType;
  ne: number | null;
  denier: number | null;
  tex: number | null;
  nec_computed: number | null;
  is_doubled: boolean;
  is_slub: boolean;
  reorder_kg: number;
  notes: string | null;
  status: RecordStatus;
}

interface NewCount {
  code: string;
  display_name: string;
  yarn_type: YarnType;
  ne: string;
  denier: string;
  tex: string;
  is_doubled: boolean;
  is_slub: boolean;
  reorder_kg: string;
  notes: string;
}

const EMPTY_NEW: NewCount = {
  code: '',
  display_name: '',
  yarn_type: 'cotton',
  ne: '',
  denier: '',
  tex: '',
  is_doubled: false,
  is_slub: false,
  reorder_kg: '0',
  notes: '',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Polyester reference: Nec = 5315 / denier (per build guide). Returns null
 * when no usable denier is available.
 */
function computeNecFromDenier(denier: number | null): number | null {
  if (denier === null || denier <= 0) return null;
  return Math.round((5315 / denier) * 100) / 100;
}

export default function YarnCountsPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<CountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewCount>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('yarn_count')
      .select(
        'id, code, display_name, yarn_type, ne, denier, tex, nec_computed, is_doubled, is_slub, reorder_kg, notes, status',
      )
      .neq('status', 'archived')
      .order('code');
    if (err) {
      setError(err.message);
    } else {
      setRows((data ?? []) as unknown as CountRow[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-derived Nec preview for the Add form when yarn_type=polyester.
  const necPreview = useMemo<number | null>(() => {
    if (neu.yarn_type !== 'polyester') return null;
    return computeNecFromDenier(toNumOrNull(neu.denier));
  }, [neu.yarn_type, neu.denier]);

  async function handleAdd() {
    setError(null);
    setSavedMsg(null);

    const code = neu.code.trim();
    const displayName = neu.display_name.trim();
    if (code === '') {
      setError('Enter a count code (e.g. 60s, 75D).');
      return;
    }
    if (displayName === '') {
      setError('Enter a display name (e.g. "60s combed").');
      return;
    }
    if (rows.some((r) => r.code.toLowerCase() === code.toLowerCase())) {
      setError(`Count code "${code}" already exists.`);
      return;
    }

    const ne = toNumOrNull(neu.ne);
    const denier = toNumOrNull(neu.denier);
    const tex = toNumOrNull(neu.tex);
    const reorderKg = toNumOrNull(neu.reorder_kg) ?? 0;

    if (neu.yarn_type === 'cotton' && ne === null) {
      setError('Cotton yarn needs an Ne value.');
      return;
    }
    if (neu.yarn_type === 'polyester' && denier === null) {
      setError('Polyester yarn needs a denier value.');
      return;
    }

    const necComputed =
      neu.yarn_type === 'polyester' ? computeNecFromDenier(denier) : null;

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('yarn_count').insert({
      code,
      display_name: displayName,
      yarn_type: neu.yarn_type,
      ne,
      denier,
      tex,
      nec_computed: necComputed,
      is_doubled: neu.is_doubled,
      is_slub: neu.is_slub,
      reorder_kg: reorderKg,
      notes: neu.notes.trim() === '' ? null : neu.notes.trim(),
      status: 'active',
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg(`Added count ${code}.`);
    await load();
  }

  async function updateRow(id: number, patch: Partial<CountRow>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    // optimistic
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const merged: CountRow = { ...r, ...patch };
        // Recompute nec when polyester and denier changed.
        if (merged.yarn_type === 'polyester') {
          merged.nec_computed = computeNecFromDenier(merged.denier);
        }
        return merged;
      }),
    );

    // If denier or yarn_type was patched on a polyester row, persist nec too.
    const target = rows.find((r) => r.id === id);
    const yarnType = (patch.yarn_type ?? target?.yarn_type) as YarnType | undefined;
    const denier = patch.denier !== undefined ? patch.denier : target?.denier ?? null;
    const fullPatch: Partial<CountRow> =
      yarnType === 'polyester'
        ? { ...patch, nec_computed: computeNecFromDenier(denier ?? null) }
        : patch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('yarn_count')
      .update(fullPatch)
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
        title="Yarn Counts"
        subtitle="Master of yarn counts (Ne / denier / tex). For polyester, Nec auto-computes as 5315 / denier."
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a count</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="nc-code">Code *</label>
            <input
              id="nc-code"
              type="text"
              className="input w-full"
              placeholder="60s, 75D, 30/2"
              value={neu.code}
              onChange={(e) => setNeu((n) => ({ ...n, code: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="nc-name">Display name *</label>
            <input
              id="nc-name"
              type="text"
              className="input w-full"
              placeholder="60s combed"
              value={neu.display_name}
              onChange={(e) => setNeu((n) => ({ ...n, display_name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nc-type">Yarn type *</label>
            <select
              id="nc-type"
              className="input w-full"
              value={neu.yarn_type}
              onChange={(e) => setNeu((n) => ({ ...n, yarn_type: e.target.value as YarnType }))}
            >
              <option value="cotton">Cotton</option>
              <option value="polyester">Polyester</option>
              <option value="blend">Blend</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nc-ne">Ne {neu.yarn_type === 'cotton' && '*'}</label>
            <input
              id="nc-ne"
              type="number"
              min={0}
              step="0.01"
              className="input num w-full"
              placeholder="e.g. 60"
              value={neu.ne}
              onChange={(e) => setNeu((n) => ({ ...n, ne: e.target.value }))}
              disabled={neu.yarn_type === 'polyester'}
            />
          </div>
          <div>
            <label className="label" htmlFor="nc-denier">Denier {neu.yarn_type === 'polyester' && '*'}</label>
            <input
              id="nc-denier"
              type="number"
              min={0}
              step="0.01"
              className="input num w-full"
              placeholder="e.g. 75"
              value={neu.denier}
              onChange={(e) => setNeu((n) => ({ ...n, denier: e.target.value }))}
              disabled={neu.yarn_type === 'cotton'}
            />
          </div>
          <div>
            <label className="label" htmlFor="nc-tex">Tex</label>
            <input
              id="nc-tex"
              type="number"
              min={0}
              step="0.01"
              className="input num w-full"
              value={neu.tex}
              onChange={(e) => setNeu((n) => ({ ...n, tex: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Nec (auto)</label>
            <div className="input num w-full bg-cloud/40 text-ink-soft">
              {necPreview ?? '—'}
            </div>
          </div>
          <div className="flex items-end gap-4">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={neu.is_doubled}
                onChange={(e) => setNeu((n) => ({ ...n, is_doubled: e.target.checked }))}
              />
              <span className="text-xs text-ink-soft">Doubled</span>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={neu.is_slub}
                onChange={(e) => setNeu((n) => ({ ...n, is_slub: e.target.checked }))}
              />
              <span className="text-xs text-ink-soft">Slub</span>
            </label>
          </div>
          <div>
            <label className="label" htmlFor="nc-reorder">Reorder (kg)</label>
            <input
              id="nc-reorder"
              type="number"
              min={0}
              step="0.01"
              className="input num w-full"
              value={neu.reorder_kg}
              onChange={(e) => setNeu((n) => ({ ...n, reorder_kg: e.target.value }))}
            />
          </div>
          <div className="md:col-span-3">
            <label className="label" htmlFor="nc-notes">Notes</label>
            <input
              id="nc-notes"
              type="text"
              className="input w-full"
              placeholder="(optional)"
              value={neu.notes}
              onChange={(e) => setNeu((n) => ({ ...n, notes: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={handleAdd}
            disabled={adding}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add count
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading counts…
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No counts yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Display name</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Ne</th>
                  <th className="py-2 pr-3">Denier</th>
                  <th className="py-2 pr-3">Tex</th>
                  <th className="py-2 pr-3">Nec</th>
                  <th className="py-2 pr-3">2-ply</th>
                  <th className="py-2 pr-3">Slub</th>
                  <th className="py-2 pr-3">Reorder kg</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{c.code}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-48"
                        value={c.display_name}
                        onChange={(e) => updateRow(c.id, { display_name: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="input w-28"
                        value={c.yarn_type}
                        onChange={(e) =>
                          updateRow(c.id, { yarn_type: e.target.value as YarnType })
                        }
                      >
                        <option value="cotton">Cotton</option>
                        <option value="polyester">Polyester</option>
                        <option value="blend">Blend</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-20"
                        value={c.ne ?? ''}
                        disabled={c.yarn_type === 'polyester'}
                        onChange={(e) =>
                          updateRow(c.id, {
                            ne: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-20"
                        value={c.denier ?? ''}
                        disabled={c.yarn_type === 'cotton'}
                        onChange={(e) =>
                          updateRow(c.id, {
                            denier: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-20"
                        value={c.tex ?? ''}
                        onChange={(e) =>
                          updateRow(c.id, {
                            tex: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3 num text-ink-soft">
                      {c.nec_computed ?? '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={c.is_doubled}
                        onChange={(e) => updateRow(c.id, { is_doubled: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={c.is_slub}
                        onChange={(e) => updateRow(c.id, { is_slub: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-20"
                        value={c.reorder_kg}
                        onChange={(e) =>
                          updateRow(c.id, { reorder_kg: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={c.status === 'active'}
                          onChange={(e) =>
                            updateRow(c.id, {
                              status: e.target.checked ? 'active' : 'inactive',
                            })
                          }
                        />
                        <span className="text-xs text-ink-soft">
                          {c.status === 'active' ? 'Yes' : 'No'}
                        </span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      {busyId === c.id && (
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
