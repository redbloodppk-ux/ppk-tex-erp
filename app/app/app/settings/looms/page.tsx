'use client';
/**
 * Looms — manage the loom register.
 *
 * Lists every loom in the mill grouped by weaving shed (1-4). From here you
 * can add a new loom, change its type / fabric quality / status, and move a
 * loom to a different shed. The shed assignment (`loom.shed_no`) drives the
 * 4-tab layout on the Shift Production Log.
 *
 * Width is no longer entered directly on the loom — it now lives on the
 * fabric quality master (Settings → Fabric Qualities). Picking a quality
 * here also copies its width into loom.width_in for legacy reports.
 *
 * Writes go straight to the `loom` table; RLS allows owner / mill_manager to
 * insert and update.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
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
  fabric_quality_id: number | null;
  // Migration 079: date the loom became non-running. Shift log entries
  // dated on or after this are locked; entries before stay editable.
  // NULL when status = 'running'.
  idle_since: string | null;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface FabricQuality {
  id: number;
  code: string;
  name: string;
  width_in: number | null;
  active: boolean;
}

interface NewLoom {
  loom_code: string;
  loom_type: string;
  fabric_quality_id: string;
  status: string;
  shed_no: string;
  default_rate_per_m: string;
}

const EMPTY_NEW: NewLoom = {
  loom_code: '',
  loom_type: 'powerloom',
  fabric_quality_id: '',
  status: 'running',
  shed_no: '1',
  default_rate_per_m: '',
};

export default function LoomsPage() {
  const supabase = createClient();

  const [looms, setLooms] = useState<Loom[]>([]);
  const [qualities, setQualities] = useState<FabricQuality[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [newLoom, setNewLoom] = useState<NewLoom>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loomsP = (supabase as any)
      .from('loom')
      .select(
        'id, loom_code, loom_type, width_in, status, shed_no, default_rate_per_m, fabric_quality_id, idle_since',
      )
      .order('loom_code');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qualsP = (supabase as any)
      .from('fabric_quality')
      .select('id, code, name, width_in, active')
      .order('code');

    const [{ data: loomData, error: loomErr }, { data: qData, error: qErr }] =
      await Promise.all([loomsP, qualsP]);

    if (loomErr) {
      setError(loomErr.message);
    } else if (qErr) {
      setError(qErr.message);
    } else {
      setLooms((loomData ?? []) as unknown as Loom[]);
      setQualities((qData ?? []) as unknown as FabricQuality[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const qualityById = useMemo(() => {
    const m = new Map<number, FabricQuality>();
    for (const q of qualities) m.set(q.id, q);
    return m;
  }, [qualities]);

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
    const qid = newLoom.fabric_quality_id === '' ? null : Number(newLoom.fabric_quality_id);
    const widthFromQ = qid != null ? qualityById.get(qid)?.width_in ?? null : null;

    const rate =
      newLoom.default_rate_per_m.trim() === '' ? null : Number(newLoom.default_rate_per_m);
    if (rate !== null && (Number.isNaN(rate) || rate < 0)) {
      setError('Default rate must be a number greater than or equal to 0, or leave it blank.');
      return;
    }

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('loom').insert({
      loom_code: code,
      loom_type: newLoom.loom_type.trim() || 'powerloom',
      width_in: widthFromQ,
      status: newLoom.status,
      shed_no: Number(newLoom.shed_no),
      default_rate_per_m: rate,
      fabric_quality_id: qid,
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

  async function updateLoom(id: number, patch: Partial<Loom>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    const effective: Partial<Loom> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'fabric_quality_id')) {
      const qid = patch.fabric_quality_id;
      effective.width_in = qid != null ? qualityById.get(qid)?.width_in ?? null : null;
    }

    // When the status flips between running and non-running we auto-sync
    // idle_since so the operator doesn't have to remember to also touch
    // the date. Going non-running -> default the date to today (operator
    // can still override). Going back to running -> clear the date.
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const prev = looms.find((l) => l.id === id);
      const oldStatus = prev?.status ?? 'running';
      const newStatus = patch.status ?? oldStatus;
      const wasRunning = oldStatus === 'running';
      const nowRunning = newStatus === 'running';
      if (wasRunning && !nowRunning) {
        // Only default if the operator didn't already pass an idle_since.
        if (!Object.prototype.hasOwnProperty.call(patch, 'idle_since')) {
          effective.idle_since = prev?.idle_since ?? todayISO();
        }
      } else if (!wasRunning && nowRunning) {
        effective.idle_since = null;
      }
    }

    setLooms((prev) => prev.map((l) => (l.id === id ? { ...l, ...effective } : l)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('loom').update(effective).eq('id', id);
    setBusyId(null);

    if (err) {
      setError(err.message);
      await load();
      return;
    }
    // Append to the dated status-change log (viewable on the Pavu Assign
    // page → loom history → Status log). Best-effort: the status update
    // above already succeeded.
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const prev = looms.find((l) => l.id === id);
      if (patch.status && patch.status !== prev?.status) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('loom_status_log').insert({
          loom_id: id,
          old_status: prev?.status ?? null,
          new_status: patch.status,
        });
      }
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
  const activeQualities = qualities.filter((q) => q.active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Looms"
        subtitle="Add looms, pick the fabric quality each is set up for, set status, and assign each loom to a weaving shed."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Looms' }]}
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      {qualities.length === 0 && (
        <div className="card p-4 text-sm bg-amber-50 border-amber-200">
          No fabric qualities set up yet. Add some in{' '}
          <a href="/app/settings/fabric-qualities" className="text-indigo-700 font-semibold underline">
            Settings → Fabric Qualities
          </a>{' '}
          first.
        </div>
      )}

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
            <label className="label" htmlFor="nl-quality">Fabric quality</label>
            <select
              id="nl-quality"
              className="input w-80"
              value={newLoom.fabric_quality_id}
              onChange={(e) =>
                setNewLoom((n) => ({ ...n, fabric_quality_id: e.target.value }))
              }
            >
              <option value="">— pick one —</option>
              {activeQualities.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.code} · {q.name}
                  {q.width_in != null ? ` (${q.width_in}in)` : ''}
                </option>
              ))}
            </select>
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
            <label className="label" htmlFor="nl-rate">Default rate /m</label>
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

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading looms...
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
                  qualities={activeQualities}
                  onUpdate={updateLoom}
                />
              </div>
            );
          })}

          {unassigned.length > 0 && (
            <div className="card p-5 space-y-3">
              <h2 className="font-display font-bold text-base">Not assigned to a shed</h2>
              <LoomTable
                rows={unassigned}
                busyId={busyId}
                qualities={activeQualities}
                onUpdate={updateLoom}
              />
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
  qualities: FabricQuality[];
  onUpdate: (id: number, patch: Partial<Loom>) => void;
}

function LoomTable({ rows, busyId, qualities, onUpdate }: LoomTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft py-2">No looms in this shed yet.</p>;
  }
  return (
    <>
    {/* Mobile / PWA: card view. Below md each loom renders as a card with
        the same inline editors. The table is hidden on mobile and shown
        from md upward. */}
    <CardFilter placeholder="Search looms…">
      {rows.map((l) => (
        <div key={l.id} className="card p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">{l.loom_code}</div>
            {busyId === l.id && <Loader2 className="h-4 w-4 animate-spin text-ink-mute shrink-0" />}
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[8rem]">
              <label className="label text-xs">Type</label>
              <input
                type="text"
                className="input w-full"
                value={l.loom_type}
                onChange={(e) => onUpdate(l.id, { loom_type: e.target.value })}
              />
            </div>
            <div className="flex-1 min-w-[12rem]">
              <label className="label text-xs">Fabric quality</label>
              <select
                className="input w-full"
                value={l.fabric_quality_id ?? ''}
                onChange={(e) =>
                  onUpdate(l.id, { fabric_quality_id: e.target.value === '' ? null : Number(e.target.value) })
                }
              >
                <option value="">— none —</option>
                {qualities.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.code} · {q.name}
                    {q.width_in != null ? ` (${q.width_in}in)` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label text-xs">Status</label>
              <select
                className="input w-36"
                value={l.status}
                onChange={(e) => onUpdate(l.id, { status: e.target.value })}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Shed</label>
              <select
                className="input w-28"
                value={l.shed_no ?? ''}
                onChange={(e) => onUpdate(l.id, { shed_no: Number(e.target.value) })}
              >
                {SHEDS.map((s) => (
                  <option key={s} value={s}>Shed {s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Default /m</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="input num w-24"
                value={l.default_rate_per_m ?? ''}
                onChange={(e) =>
                  onUpdate(l.id, { default_rate_per_m: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </div>
          </div>
          {l.status !== 'running' && (
            <div>
              <label className="label text-xs">Idle since</label>
              <input
                type="date"
                className="input w-40 text-xs"
                value={l.idle_since ?? ''}
                onChange={(e) =>
                  onUpdate(l.id, { idle_since: e.target.value === '' ? null : e.target.value })
                }
                title="Shift log entries dated on or after this are locked for this loom."
              />
            </div>
          )}
        </div>
      ))}
    </CardFilter>

    <div className="overflow-x-auto hidden md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line/60 text-left text-ink-mute">
            <th className="py-2 pr-3">Loom</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Fabric quality</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Idle since</th>
            <th className="py-2 pr-3">Shed</th>
            <th className="py-2 pr-3">Default /m</th>
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
                <select
                  className="input w-full min-w-[20rem]"
                  value={l.fabric_quality_id ?? ''}
                  onChange={(e) =>
                    onUpdate(l.id, {
                      fabric_quality_id:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">— none —</option>
                  {qualities.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.code} · {q.name}
                      {q.width_in != null ? ` (${q.width_in}in)` : ''}
                    </option>
                  ))}
                </select>
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
                {l.status === 'running' ? (
                  <span className="text-ink-mute text-xs">—</span>
                ) : (
                  <input
                    type="date"
                    className="input w-40 text-xs"
                    value={l.idle_since ?? ''}
                    onChange={(e) =>
                      onUpdate(l.id, {
                        idle_since: e.target.value === '' ? null : e.target.value,
                      })
                    }
                    title="Shift log entries dated on or after this are locked for this loom."
                  />
                )}
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
    </>
  );
}
