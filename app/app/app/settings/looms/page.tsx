'use client';
/**
 * Looms — manage the loom register.
 *
 * Lists every loom in the mill grouped by weaving shed (1-4). From here you
 * can add a new loom, change a loom's type / width / status, and move a loom
 * to a different shed. The shed assignment (`loom.shed_no`) drives the 4-tab
 * layout on the Shift Production Log.
 *
 * Writes go straight to the `loom` table; RLS allows owner / mill_manager to
 * insert and update.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2 } from 'lucide-react';

const SHEDS = [1, 2, 3, 4] as const;

const STATUSES = [
  { value: 'running', label: 'Running' },
  { value: 'idle', label: 'Idle' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'breakdown', label: 'Breakdown' },
] as const;

interface Loom {
  id: number;
  loom_code: string;
  loom_type: string;
  width_in: number | null;
  status: string;
  shed_no: number | null;
  default_rate_per_m: number | null;
}

interface NewLoom {
  loom_code: string;
  loom_type: string;
  width_in: string;
  status: string;
  shed_no: string;
  default_rate_per_m: string;
}

const EMPTY_NEW: NewLoom = {
  loom_code: '',
  loom_type: 'powerloom',
  width_in: '56',
  status: 'running',
  shed_no: '1',
  default_rate_per_m: '',
};

export default function LoomsPage() {
  const supabase = createClient();

  const [looms, setLooms] = useState<Loom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [newLoom, setNewLoom] = useState<NewLoom>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // default_rate_per_m was added in migration 033 — types not yet regenerated.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('loom')
      .select('id, loom_code, loom_type, width_in, status, shed_no, default_rate_per_m')
      .order('loom_code');
    if (err) {
      setError(err.message);
    } else {
      setLooms((data ?? []) as unknown as Loom[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── add a new loom ─────────────────────────────────────────────────────────
  async function handleAdd() {
    setError(null);
    setSavedMsg(null);

    const code = newLoom.loom_code.trim();
    if (code === '') {
      setError('Enter a loom code (e.g. L-57).');
      return;
    }
    if (looms.some((l) => l.loom_code.toLowerCase() === code.toLowerCase())) {
      setError(`Loom code "${code}" already exists.`);
      return;
    }
    const width = newLoom.width_in.trim() === '' ? null : Number(newLoom.width_in);
    if (width !== null && (Number.isNaN(width) || width <= 0)) {
      setError('Width must be a positive number, or leave it blank.');
      return;
    }
    const rate =
      newLoom.default_rate_per_m.trim() === '' ? null : Number(newLoom.default_rate_per_m);
    if (rate !== null && (Number.isNaN(rate) || rate < 0)) {
      setError('Default rate ₹/m must be a number ≥ 0, or leave it blank.');
      return;
    }

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('loom').insert({
      loom_code: code,
      loom_type: newLoom.loom_type.trim() || 'powerloom',
      width_in: width,
      status: newLoom.status,
      shed_no: Number(newLoom.shed_no),
      default_rate_per_m: rate,
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNewLoom(EMPTY_NEW);
    setSavedMsg(`Added loom ${code}.`);
    await load();
  }

  // ── update a loom field ────────────────────────────────────────────────────
  async function updateLoom(id: number, patch: Partial<Loom>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    // optimistic UI
    setLooms((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('loom').update(patch).eq('id', id);
    setBusyId(null);

    if (err) {
      setError(err.message);
      await load(); // revert to server truth
      return;
    }
    setSavedMsg('Saved.');
  }

  const bySheD = useMemo(() => {
    const map = new Map<number | 'none', Loom[]>();
    for (const l of looms) {
      const key = l.shed_no == null ? 'none' : l.shed_no;
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return map;
  }, [looms]);

  const unassigned = bySheD.get('none') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Looms"
        subtitle="Add looms, set their status and width, and assign each loom to a weaving shed."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Looms' }]}
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      {/* Add a loom */}
      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a loom</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="nl-code">Loom code</label>
            <input
              id="nl-code"
              type="text"
              className="input w-32"
              placeholder="L-57"
              value={newLoom.loom_code}
              onChange={(e) => setNewLoom((n) => ({ ...n, loom_code: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nl-type">Type</label>
            <input
              id="nl-type"
              type="text"
              className="input w-36"
              placeholder="powerloom"
              value={newLoom.loom_type}
              onChange={(e) => setNewLoom((n) => ({ ...n, loom_type: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nl-width">Width (in)</label>
            <input
              id="nl-width"
              type="number"
              min={0}
              step="0.01"
              className="input num w-24"
              value={newLoom.width_in}
              onChange={(e) => setNewLoom((n) => ({ ...n, width_in: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nl-status">Status</label>
            <select
              id="nl-status"
              className="input w-36"
              value={newLoom.status}
              onChange={(e) => setNewLoom((n) => ({ ...n, status: e.target.value }))}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nl-shed">Shed</label>
            <select
              id="nl-shed"
              className="input w-28"
              value={newLoom.shed_no}
              onChange={(e) => setNewLoom((n) => ({ ...n, shed_no: e.target.value }))}
            >
              {SHEDS.map((s) => (
                <option key={s} value={s}>Shed {s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nl-rate">Default rate ₹/m</label>
            <input
              id="nl-rate"
              type="number"
              min={0}
              step="0.01"
              className="input num w-28"
              placeholder="e.g. 4.50"
              value={newLoom.default_rate_per_m}
              onChange={(e) =>
                setNewLoom((n) => ({ ...n, default_rate_per_m: e.target.value }))
              }
            />
          </div>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={handleAdd}
            disabled={adding}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add loom
          </button>
        </div>
      </div>

      {/* Loom register */}
      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading looms…
        </div>
      ) : (
        <>
          {SHEDS.map((shed) => {
            const rows = bySheD.get(shed) ?? [];
            return (
              <div key={shed} className="card p-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display font-bold text-base">Shed {shed}</h2>
                  <span className="text-xs text-ink-mute">
                    {rows.length} loom{rows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <LoomTable
                  rows={rows}
                  busyId={busyId}
                  onUpdate={updateLoom}
                />
              </div>
            );
          })}

          {unassigned.length > 0 && (
            <div className="card p-5 space-y-3">
              <h2 className="font-display font-bold text-base">Not assigned to a shed</h2>
              <LoomTable rows={unassigned} busyId={busyId} onUpdate={updateLoom} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface LoomTableProps {
  rows: Loom[];
  busyId: number | null;
  onUpdate: (id: number, patch: Partial<Loom>) => void;
}

function LoomTable({ rows, busyId, onUpdate }: LoomTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft py-2">No looms in this shed yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line/60 text-left text-ink-mute">
            <th className="py-2 pr-3">Loom</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Width (in)</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Shed</th>
            <th className="py-2 pr-3">Default ₹/m</th>
            <th className="py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="border-b border-line/60">
              <td className="py-2 pr-3 font-medium">{l.loom_code}</td>
              <td className="py-2 pr-3">
                <input
                  type="text"
                  className="input w-36"
                  value={l.loom_type}
                  onChange={(e) => onUpdate(l.id, { loom_type: e.target.value })}
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input num w-24"
                  value={l.width_in ?? ''}
                  onChange={(e) =>
                    onUpdate(l.id, {
                      width_in: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </td>
              <td className="py-2 pr-3">
                <select
                  className="input w-36"
                  value={l.status}
                  onChange={(e) => onUpdate(l.id, { status: e.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-3">
                <select
                  className="input w-28"
                  value={l.shed_no ?? ''}
                  onChange={(e) => onUpdate(l.id, { shed_no: Number(e.target.value) })}
                >
                  {SHEDS.map((s) => (
                    <option key={s} value={s}>Shed {s}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-3">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input num w-24"
                  value={l.default_rate_per_m ?? ''}
                  onChange={(e) =>
                    onUpdate(l.id, {
                      default_rate_per_m:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </td>
              <td className="py-2 pr-3">
                {busyId === l.id && (
                  <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
