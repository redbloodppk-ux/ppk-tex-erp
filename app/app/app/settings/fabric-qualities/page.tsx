'use client';
/**
 * Fabric Qualities — manage the master of cloth qualities a loom can be set
 * up to weave (count / sort / article). Each row carries width, weight and an
 * optional reference rate ₹/m. The picked quality on the Looms page also
 * copies its width into loom.width_in for legacy reports.
 *
 * Writes go straight to the `fabric_quality` table; RLS allows
 * owner / mill_manager to insert and update.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2 } from 'lucide-react';

interface Quality {
  id: number;
  code: string;
  name: string;
  width_in: number | null;
  weight_gsm: number | null;
  rate_per_m: number | null;
  active: boolean;
  notes: string | null;
}

interface NewQuality {
  code: string;
  name: string;
  width_in: string;
  weight_gsm: string;
  rate_per_m: string;
  notes: string;
}

const EMPTY_NEW: NewQuality = {
  code: '',
  name: '',
  width_in: '',
  weight_gsm: '',
  rate_per_m: '',
  notes: '',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

export default function FabricQualitiesPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<Quality[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewQuality>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('fabric_quality')
      .select('id, code, name, width_in, weight_gsm, rate_per_m, active, notes')
      .order('code');
    if (err) {
      setError(err.message);
    } else {
      setRows((data ?? []) as unknown as Quality[]);
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
    if (code === '') {
      setError('Enter a quality code (e.g. 60s-poplin).');
      return;
    }
    if (name === '') {
      setError('Enter a quality name.');
      return;
    }
    if (rows.some((r) => r.code.toLowerCase() === code.toLowerCase())) {
      setError(`Quality code "${code}" already exists.`);
      return;
    }
    const w = toNumOrNull(neu.width_in);
    const g = toNumOrNull(neu.weight_gsm);
    const r = toNumOrNull(neu.rate_per_m);
    if (w !== null && w <= 0) {
      setError('Width must be a positive number, or leave it blank.');
      return;
    }
    if (g !== null && g <= 0) {
      setError('Weight (gsm) must be a positive number, or leave it blank.');
      return;
    }
    if (r !== null && r < 0) {
      setError('Rate ₹/m must be a number ≥ 0, or leave it blank.');
      return;
    }

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('fabric_quality').insert({
      code,
      name,
      width_in: w,
      weight_gsm: g,
      rate_per_m: r,
      active: true,
      notes: neu.notes.trim() === '' ? null : neu.notes.trim(),
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg(`Added quality ${code}.`);
    await load();
  }

  async function updateRow(id: number, patch: Partial<Quality>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    // optimistic UI
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('fabric_quality')
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
        title="Fabric Qualities"
        subtitle="Counts / sorts / articles a loom can be set up to weave. Width and weight set here flow into the Looms register and downstream reports."
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Fabric Qualities' },
        ]}
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      {/* Add a quality */}
      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a quality</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="nq-code">Code</label>
            <input
              id="nq-code"
              type="text"
              className="input w-40"
              placeholder="60s-poplin"
              value={neu.code}
              onChange={(e) => setNeu((n) => ({ ...n, code: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nq-name">Name</label>
            <input
              id="nq-name"
              type="text"
              className="input w-56"
              placeholder="60s Combed Poplin"
              value={neu.name}
              onChange={(e) => setNeu((n) => ({ ...n, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nq-width">Width (in)</label>
            <input
              id="nq-width"
              type="number"
              min={0}
              step="0.01"
              className="input num w-24"
              value={neu.width_in}
              onChange={(e) => setNeu((n) => ({ ...n, width_in: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nq-gsm">Weight (gsm)</label>
            <input
              id="nq-gsm"
              type="number"
              min={0}
              step="0.01"
              className="input num w-28"
              value={neu.weight_gsm}
              onChange={(e) => setNeu((n) => ({ ...n, weight_gsm: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nq-rate">Rate ₹/m</label>
            <input
              id="nq-rate"
              type="number"
              min={0}
              step="0.01"
              className="input num w-28"
              value={neu.rate_per_m}
              onChange={(e) => setNeu((n) => ({ ...n, rate_per_m: e.target.value }))}
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label" htmlFor="nq-notes">Notes</label>
            <input
              id="nq-notes"
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
            Add quality
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading qualities…
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No fabric qualities yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Width (in)</th>
                  <th className="py-2 pr-3">Weight (gsm)</th>
                  <th className="py-2 pr-3">Rate ₹/m</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{q.code}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-56"
                        value={q.name}
                        onChange={(e) => updateRow(q.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-24"
                        value={q.width_in ?? ''}
                        onChange={(e) =>
                          updateRow(q.id, {
                            width_in: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-28"
                        value={q.weight_gsm ?? ''}
                        onChange={(e) =>
                          updateRow(q.id, {
                            weight_gsm: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-24"
                        value={q.rate_per_m ?? ''}
                        onChange={(e) =>
                          updateRow(q.id, {
                            rate_per_m: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={q.active}
                          onChange={(e) => updateRow(q.id, { active: e.target.checked })}
                        />
                        <span className="text-xs text-ink-soft">
                          {q.active ? 'Yes' : 'No'}
                        </span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-full min-w-[12rem]"
                        value={q.notes ?? ''}
                        onChange={(e) =>
                          updateRow(q.id, {
                            notes: e.target.value === '' ? null : e.target.value,
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      {busyId === q.id && (
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
