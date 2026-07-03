'use client';
/**
 * Loom-view Pavu Assignment
 *
 * Shows every loom as a card. For each loom, displays the currently mounted
 * pavu (if any) and an "Assign" button that opens a small modal letting the
 * user pick an in-stock pavu + quality and create a pavu_assign row in one
 * click. Designed for the floor operator on a tablet.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Wrench, X, Loader2, Plus, RotateCw, CheckCircle2, Pencil, Trash2 } from 'lucide-react';

interface Loom {
  id: number;
  loom_code: string;
  loom_type: string;
  width_in: number | null;
  status: string;
}

interface ActiveAssignment {
  id: number;
  loom_id: number;
  status: string;
  metres_produced: number;
  start_date: string | null;
  metres_start_date: string | null;
  pavu: {
    id: number; pavu_code: string; beam_no: string; ends: number; meters: number;
    sizing_job?: { warp_count?: { code: string } | null } | null;
  } | null;
  costing: { id: number; quality_code: string; quality_name: string } | null;
}

interface PavuInStock {
  id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  meters: number;
  sizing_job?: { set_no?: string | null; warp_count?: { code: string } | null } | null;
}

interface Quality {
  id: number;
  quality_code: string;
  quality_name: string;
}

const STATUS_STYLE: Record<string, string> = {
  running:    'bg-emerald-50 text-emerald-700',
  idle:       'bg-slate-100 text-slate-600',
  maintenance:'bg-amber-50 text-amber-700',
  breakdown:  'bg-rose-50 text-rose-700',
};

/** Adds one day to a yyyy-mm-dd date string, returning the same format. */
function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function PavuAssignPage() {
  const supabase = createClient();
  const [looms, setLooms]             = useState<Loom[]>([]);
  const [active, setActive]           = useState<ActiveAssignment[]>([]);
  const [stock, setStock]             = useState<PavuInStock[]>([]);
  const [qualities, setQualities]     = useState<Quality[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Modal state — which loom is being assigned right now, or which active
  // assignment is being edited (quality / mounted date) or removed.
  const [assignFor, setAssignFor] = useState<Loom | null>(null);
  const [editFor, setEditFor] = useState<ActiveAssignment | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  /** Fetch all four datasets in parallel. Wrapped so we can call again on save. */
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    const [l, a, p, q] = await Promise.all([
      supabase.from('loom')
        .select('id, loom_code, loom_type, width_in, status')
        .order('loom_code'),
      supabase.from('pavu_assign')
        .select(`
          id, loom_id, status, metres_produced, start_date, metres_start_date,
          pavu:pavu_id (
            id, pavu_code, beam_no, ends, meters,
            sizing_job:sizing_job_id ( warp_count:warp_count_id ( code ) )
          ),
          costing:costing_id ( id, quality_code, quality_name )
        `)
        .in('status', ['queued', 'mounted', 'running']),
      supabase.from('pavu')
        .select(`
          id, pavu_code, beam_no, ends, meters,
          sizing_job:sizing_job_id ( set_no, warp_count:warp_count_id ( code ) )
        `)
        .eq('status', 'in_stock')
        .eq('production_mode', 'in_house')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('costing_master')
        .select('id, quality_code, quality_name')
        .eq('status', 'active')
        .order('quality_code'),
    ]);
    if (l.error || a.error || p.error || q.error) {
      setError(l.error?.message ?? a.error?.message ?? p.error?.message ?? q.error?.message ?? 'Load failed');
    }
    setLooms(l.data ?? []);
    setActive((a.data as any) ?? []);
    setStock((p.data as any) ?? []);
    setQualities(q.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { reload(); }, [reload]);

  /** Unmount the pavu from a loom — marks the assignment "removed"; a
   *  trigger flips the pavu back to available stock ("finished"). */
  async function removeAssignment(a: ActiveAssignment): Promise<void> {
    const ok = window.confirm(
      `Remove ${a.pavu?.pavu_code ?? 'this pavu'} from this loom?`,
    );
    if (!ok) return;
    setRemoving(a.id);
    const { error: rmErr } = await supabase
      .from('pavu_assign')
      .update({ status: 'removed', end_date: new Date().toISOString().slice(0, 10) })
      .eq('id', a.id);
    setRemoving(null);
    if (rmErr) { setError(rmErr.message); return; }
    await supabase.rpc('fn_recompute_pavu_assign_metres', { p_loom_id: a.loom_id });
    reload();
  }

  /** Quick lookup: loomId → current active assignment (if any). */
  const activeByLoom = useMemo(() => {
    const m = new Map<number, ActiveAssignment>();
    for (const a of active) m.set(a.loom_id, a);
    return m;
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Pavu Assignment"
        subtitle="What's currently mounted on each loom. Tap a loom to assign or change the pavu."
        actions={
          <button onClick={reload} className="btn-ghost" disabled={loading}>
            <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">Could not load: {error}</div>
      )}

      {loading && !looms.length ? (
        <div className="card p-10 text-center text-ink-soft text-sm">
          <Loader2 className="w-5 h-5 inline animate-spin mr-2" /> Loading looms…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {looms.map(l => {
            const cur = activeByLoom.get(l.id);
            return (
              <div key={l.id} className="card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-ink-mute" />
                    <span className="font-mono font-bold text-ink">{l.loom_code}</span>
                    <span className="text-xs text-ink-mute">{l.loom_type}</span>
                  </div>
                  <span className={`pill ${STATUS_STYLE[l.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {l.status}
                  </span>
                </div>

                {cur && cur.pavu ? (
                  <div className="rounded-lg bg-indigo/5 border border-indigo/15 p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo" />
                        <span className="font-mono font-semibold text-indigo">{cur.pavu.pavu_code}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Edit quality / mounted date"
                          className="p-1 rounded hover:bg-indigo/10 text-ink-mute hover:text-indigo"
                          onClick={() => setEditFor(cur)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove pavu from loom"
                          className="p-1 rounded hover:bg-rose-50 text-ink-mute hover:text-rose-600"
                          onClick={() => removeAssignment(cur)}
                          disabled={removing === cur.id}
                        >
                          {removing === cur.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-ink-soft">
                      Beam {cur.pavu.beam_no} ·{' '}
                      {cur.pavu.sizing_job?.warp_count?.code ?? '—'} · {cur.pavu.ends} ends ·{' '}
                      {Number(cur.pavu.meters).toFixed(0)} m
                    </div>
                    {cur.costing && (
                      <div className="text-xs text-ink-soft">
                        Quality: <span className="font-semibold">{cur.costing.quality_code}</span>
                      </div>
                    )}
                    {cur.start_date && (
                      <div className="text-xs text-ink-soft">
                        Mounted: <span className="font-semibold">{cur.start_date}</span>
                      </div>
                    )}
                    {cur.metres_start_date && (
                      <div className="text-xs text-ink-soft">
                        Counting from: <span className="font-semibold">{cur.metres_start_date}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] uppercase tracking-wide text-ink-mute">{cur.status}</span>
                      <span className="text-xs num">
                        {Number(cur.metres_produced).toFixed(0)} m made
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-line p-3 text-center text-sm text-ink-mute">
                    No pavu mounted
                  </div>
                )}

                <button
                  className="btn-ghost text-xs"
                  onClick={() => setAssignFor(l)}
                  disabled={stock.length === 0}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {cur ? 'Replace pavu' : 'Assign pavu'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {looms.length > 0 && stock.length === 0 && (
        <div className="card p-4 mt-4 text-sm text-amber-700 bg-amber-50/40">
          No in-house pavu in stock. Create a{' '}
          <a href="/app/sizing/new" className="underline font-semibold">new sizing job</a>{' '}
          with in-house beams first.
        </div>
      )}

      {assignFor && (
        <AssignModal
          loom={assignFor}
          stock={stock}
          qualities={qualities}
          currentAssignment={activeByLoom.get(assignFor.id) ?? null}
          onClose={() => setAssignFor(null)}
          onDone={() => { setAssignFor(null); reload(); }}
        />
      )}

      {editFor && (
        <EditAssignmentModal
          assignment={editFor}
          qualities={qualities}
          onClose={() => setEditFor(null)}
          onDone={() => { setEditFor(null); reload(); }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Assign modal — picks a pavu + quality and inserts a pavu_assign row.
// If the loom already has an active assignment we first mark it "removed"
// so the partial-unique-index constraint stays happy.
// ───────────────────────────────────────────────────────────────────────────
function AssignModal({
  loom, stock, qualities, currentAssignment, onClose, onDone,
}: {
  loom: Loom;
  stock: PavuInStock[];
  qualities: Quality[];
  currentAssignment: ActiveAssignment | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [setNoFilter, setSetNoFilter] = useState('');
  const [pavuId, setPavuId] = useState('');
  const [costingId, setCostingId] = useState('');
  const [status, setStatus] = useState<'queued' | 'mounted' | 'running'>('mounted');
  const [mountedDate, setMountedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [metresStartDate, setMetresStartDate] = useState(() => addOneDay(new Date().toISOString().slice(0, 10)));
  const [metresStartTouched, setMetresStartTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep the metres-count start date defaulted to mounted date + 1 day,
  // unless the user has manually edited it — shift logs are sometimes
  // entered late, so this should stay independently editable.
  function onMountedDateChange(value: string): void {
    setMountedDate(value);
    if (!metresStartTouched) setMetresStartDate(addOneDay(value));
  }

  // Distinct SET NO values present in the in-stock pavu list, so the
  // operator can narrow the (potentially long) pavu dropdown down to one
  // vendor set before picking the exact beam.
  const setNos = useMemo(
    () => Array.from(new Set(
      stock.map(s => s.sizing_job?.set_no).filter((v): v is string => !!v),
    )).sort(),
    [stock],
  );
  const filteredStock = setNoFilter
    ? stock.filter(s => s.sizing_job?.set_no === setNoFilter)
    : stock;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);

    // Free up the loom first if something else is on it.
    if (currentAssignment) {
      const { error: rmErr } = await supabase
        .from('pavu_assign')
        .update({ status: 'removed', end_date: new Date().toISOString().slice(0, 10) })
        .eq('id', currentAssignment.id);
      if (rmErr) { setErr(`Could not remove existing: ${rmErr.message}`); setBusy(false); return; }
    }

    const payload = {
      pavu_id:       Number(pavuId),
      loom_id:       loom.id,
      costing_id:    costingId ? Number(costingId) : null,
      assigned_date: new Date().toISOString().slice(0, 10),
      start_date:    status === 'running' || status === 'mounted' ? mountedDate : null,
      metres_start_date: status === 'running' || status === 'mounted' ? metresStartDate : null,
      status,
    };
    const { error } = await supabase.from('pavu_assign').insert(payload);
    if (error) { setBusy(false); setErr(error.message); return; }
    await supabase.rpc('fn_recompute_pavu_assign_metres', { p_loom_id: loom.id });
    setBusy(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-paper rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md border border-line/60">
        <div className="flex items-center justify-between p-4 border-b border-line/60">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-mute">Assign to</div>
            <div className="font-mono font-bold">{loom.loom_code}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-cloud">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4 space-y-4">
          {currentAssignment?.pavu && (
            <div className="text-xs p-3 rounded-lg bg-amber-50 text-amber-800">
              Loom currently has <span className="font-mono font-semibold">{currentAssignment.pavu.pavu_code}</span>.
              Saving will mark it removed.
            </div>
          )}

          {setNos.length > 0 && (
            <div>
              <label className="label">Filter by set no</label>
              <select
                value={setNoFilter}
                onChange={e => { setSetNoFilter(e.target.value); setPavuId(''); }}
                className="input"
              >
                <option value="">All sets</option>
                {setNos.map(sn => (
                  <option key={sn} value={sn}>SET {sn}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Pavu *</label>
            <select required value={pavuId} onChange={e => setPavuId(e.target.value)} className="input">
              <option value="" disabled>Select an in-stock pavu…</option>
              {filteredStock.map(s => (
                <option key={s.id} value={s.id}>
                  {s.pavu_code} — Beam {s.beam_no} · {s.sizing_job?.warp_count?.code ?? ''} · {s.ends} ends · {Number(s.meters).toFixed(0)} m
                  {s.sizing_job?.set_no ? ` · Set ${s.sizing_job.set_no}` : ''}
                </option>
              ))}
            </select>
            {filteredStock.length === 0 && (
              <p className="text-xs text-ink-mute mt-1">No in-stock pavu for this set.</p>
            )}
          </div>

          <div>
            <label className="label">Quality being woven</label>
            <select value={costingId} onChange={e => setCostingId(e.target.value)} className="input">
              <option value="">— Not set —</option>
              {qualities.map(q => (
                <option key={q.id} value={q.id}>{q.quality_code} — {q.quality_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Initial status</label>
            <select value={status} onChange={e => setStatus(e.target.value as any)} className="input">
              <option value="queued">Queued (planned)</option>
              <option value="mounted">Mounted</option>
              <option value="running">Running</option>
            </select>
          </div>

          {(status === 'mounted' || status === 'running') && (
            <div>
              <label className="label">Mounted date</label>
              <input
                type="date"
                value={mountedDate}
                onChange={e => onMountedDateChange(e.target.value)}
                className="input"
              />
            </div>
          )}

          {(status === 'mounted' || status === 'running') && (
            <div>
              <label className="label">Count metres from</label>
              <input
                type="date"
                value={metresStartDate}
                onChange={e => { setMetresStartDate(e.target.value); setMetresStartTouched(true); }}
                className="input"
              />
              <p className="text-xs text-ink-mute mt-1">
                Defaults to mounted date + 1 day. Change this if shift logs for this beam actually started on a different date.
              </p>
            </div>
          )}

          {err && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy || !pavuId} className="btn-primary">
              {busy ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Edit modal — updates quality and mounted date on an already-active
// assignment, without unmounting/replacing the pavu itself.
// ───────────────────────────────────────────────────────────────────────────
function EditAssignmentModal({
  assignment, qualities, onClose, onDone,
}: {
  assignment: ActiveAssignment;
  qualities: Quality[];
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [costingId, setCostingId] = useState(assignment.costing?.id ? String(assignment.costing.id) : '');
  const [mountedDate, setMountedDate] = useState(assignment.start_date ?? '');
  const [metresStartDate, setMetresStartDate] = useState(assignment.metres_start_date ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase
      .from('pavu_assign')
      .update({
        costing_id: costingId ? Number(costingId) : null,
        start_date: mountedDate || null,
        metres_start_date: metresStartDate || null,
      })
      .eq('id', assignment.id);
    if (error) { setBusy(false); setErr(error.message); return; }
    await supabase.rpc('fn_recompute_pavu_assign_metres', { p_loom_id: assignment.loom_id });
    setBusy(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-paper rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md border border-line/60">
        <div className="flex items-center justify-between p-4 border-b border-line/60">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-mute">Edit assignment</div>
            <div className="font-mono font-bold">{assignment.pavu?.pavu_code ?? '—'}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-cloud">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4 space-y-4">
          <div>
            <label className="label">Quality being woven</label>
            <select value={costingId} onChange={e => setCostingId(e.target.value)} className="input">
              <option value="">— Not set —</option>
              {qualities.map(q => (
                <option key={q.id} value={q.id}>{q.quality_code} — {q.quality_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Mounted date</label>
            <input
              type="date"
              value={mountedDate}
              onChange={e => setMountedDate(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label">Count metres from</label>
            <input
              type="date"
              value={metresStartDate}
              onChange={e => setMetresStartDate(e.target.value)}
              className="input"
            />
            <p className="text-xs text-ink-mute mt-1">
              Shift log entries from this date onward count toward this beam's finished metres.
            </p>
          </div>

          {err && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
