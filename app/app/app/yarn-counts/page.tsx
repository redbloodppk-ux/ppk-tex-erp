'use client';
/**
 * Count Master - catalogues yarn counts purchased / used in the mill.
 *
 * Code is auto-generated server-side (YC-NNNN) via trg_yarn_count_autogen_code.
 *
 * Yarn-type handling per the build guide:
 *   - cotton    -> user enters Ne (English count). Denier left blank.
 *   - polyester -> user enters denier; Nec auto-computed as 5315 / denier.
 *   - blend     -> user can fill either Ne or denier; both editable.
 *
 * nec_computed is a Postgres GENERATED ALWAYS column - we never send it in
 * insert / update payloads. The server computes it from yarn_type / denier
 * / ne via a CASE expression. The UI shows it after each read.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2 } from 'lucide-react';

type YarnType = 'cotton' | 'polyester' | 'blend';
type RecordStatus = 'active' | 'inactive' | 'archived';

interface CountRow {
  id: number;
  code: string;
  display_name: string;
  yarn_type: YarnType;
  ne: number | null;
  denier: number | null;
  nec_computed: number | null;
  is_doubled: boolean;
  is_slub: boolean;
  notes: string | null;
  status: RecordStatus;
  /** Routes the count to either the Yarn Stock page or the Porvai
   *  Yarn Stock page. Server default = 'yarn'. */
  default_yarn_kind: 'yarn' | 'porvai';
}

interface NewCount {
  display_name: string;
  yarn_type: YarnType;
  ne: string;
  denier: string;
  is_doubled: boolean;
  is_slub: boolean;
  notes: string;
  default_yarn_kind: 'yarn' | 'porvai';
}

const EMPTY_NEW: NewCount = {
  display_name: '',
  yarn_type: 'cotton',
  ne: '',
  denier: '',
  is_doubled: false,
  is_slub: false,
  notes: '',
  default_yarn_kind: 'yarn',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Client-side preview of Nec for polyester rows (DB computes the real value). */
function computeNecPreview(denier: number | null): number | null {
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
        'id, code, display_name, yarn_type, ne, denier, nec_computed, is_doubled, is_slub, notes, status, default_yarn_kind',
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

  const necPreview = useMemo<number | null>(() => {
    if (neu.yarn_type !== 'polyester') return null;
    return computeNecPreview(toNumOrNull(neu.denier));
  }, [neu.yarn_type, neu.denier]);

  async function handleAdd() {
    setError(null);
    setSavedMsg(null);

    const displayName = neu.display_name.trim();
    if (displayName === '') {
      setError('Enter a display name (e.g. "60s combed").');
      return;
    }

    const ne = toNumOrNull(neu.ne);
    const denier = toNumOrNull(neu.denier);

    if (neu.yarn_type === 'cotton' && ne === null) {
      setError('Cotton yarn needs an Ne value.');
      return;
    }
    if (neu.yarn_type === 'polyester' && denier === null) {
      setError('Polyester yarn needs a denier value.');
      return;
    }

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('yarn_count').insert({
      // code omitted - trg_yarn_count_autogen_code fills it (YC-NNNN)
      // nec_computed omitted - GENERATED ALWAYS column
      display_name: displayName,
      yarn_type: neu.yarn_type,
      ne,
      denier,
      is_doubled: neu.is_doubled,
      is_slub: neu.is_slub,
      reorder_kg: 0,
      notes: neu.notes.trim() === '' ? null : neu.notes.trim(),
      status: 'active',
      default_yarn_kind: neu.default_yarn_kind,
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg('Added new count.');
    await load();
  }

  async function updateRow(id: number, patch: Partial<CountRow>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    // Strip nec_computed from any caller patch defensively.
    const safePatch: Partial<CountRow> = { ...patch };
    delete safePatch.nec_computed;

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...safePatch } : r)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('yarn_count')
      .update(safePatch)
      .eq('id', id);
    setBusyId(null);

    if (err) {
      setError(err.message);
      await load();
      return;
    }
    // Reload so the DB-computed nec_computed reflects the latest values.
    await load();
    setSavedMsg('Saved.');
  }

  async function deleteRow(id: number, code: string) {
    const ok = window.confirm(
      'Delete count ' + code + '?\n\nIf this count is referenced by other records the database will block the delete.',
    );
    if (ok === false) return;

    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('yarn_count').delete().eq('id', id);
    setBusyId(null);

    if (err) {
      const archiveOk = window.confirm(
        'Hard delete failed (' + err.message + ').\n\nArchive it instead so it stops appearing in lists?',
      );
      if (archiveOk) {
        await updateRow(id, { status: 'archived' });
        setRows((prev) => prev.filter((r) => r.id !== id));
        setSavedMsg('Archived ' + code + '.');
      } else {
        setError(err.message);
      }
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + code + '.');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yarn Counts"
        subtitle="Master of yarn counts (Ne / denier). Code auto-generated. For polyester, Nec = 5315 / denier."
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
            <label className="label" htmlFor="nc-kind">Kind *</label>
            <select
              id="nc-kind"
              className="input w-full"
              value={neu.default_yarn_kind}
              onChange={(e) => setNeu((n) => ({ ...n, default_yarn_kind: e.target.value as 'yarn' | 'porvai' }))}
              title="Routes the count to either the Yarn Stock page or the Porvai Yarn Stock page."
            >
              <option value="yarn">Yarn (warp / weft)</option>
              <option value="porvai">Porvai (selvedge)</option>
            </select>
          </div>
          <div>
            <label className="label">Code</label>
            <div className="input num bg-cloud/40 text-ink-mute select-none">
              Auto (YC-NNNN)
            </div>
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
            <label className="label">Nec (auto)</label>
            <div className="input num w-full bg-cloud/40 text-ink-soft">
              {necPreview ?? '-'}
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
          Loading counts...
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
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Ne</th>
                  <th className="py-2 pr-3">Denier</th>
                  <th className="py-2 pr-3">Nec</th>
                  <th className="py-2 pr-3">2-ply</th>
                  <th className="py-2 pr-3">Slub</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium font-mono text-xs">{c.code}</td>
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
                      <select
                        className="input w-24"
                        value={c.default_yarn_kind}
                        onChange={(e) =>
                          updateRow(c.id, { default_yarn_kind: e.target.value as 'yarn' | 'porvai' })
                        }
                        title="Routes the count to either the Yarn Stock page or the Porvai Yarn Stock page."
                      >
                        <option value="yarn">Yarn</option>
                        <option value="porvai">Porvai</option>
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
                    <td className="py-2 pr-3 num text-ink-soft">
                      {c.nec_computed ?? '-'}
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
                      <div className="flex items-center gap-2">
                        {busyId === c.id && (
                          <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
                        )}
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-red-50 text-red-600"
                          title="Delete this count"
                          onClick={() => deleteRow(c.id, c.code)}
                          disabled={busyId === c.id}
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
