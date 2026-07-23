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
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { ArrowLeft, Wrench, X, Loader2, Plus, RotateCw, CheckCircle2, Pencil, Trash2, History } from 'lucide-react';

interface Loom {
  id: number;
  loom_code: string;
  loom_type: string;
  width_in: number | null;
  status: string;
  shed_no: number | null;
  fabric_quality_id: number | null;
  /** Date the loom became non-running (locks shift-log entries from that
   *  date). NULL while status = 'running'. Kept in sync on status change. */
  idle_since: string | null;
}

/** Fabric quality's expected total ends, read from its calc_snapshot JSON —
 *  same field the jobwork beam-entry form uses to auto-fill Ends. Used here
 *  to decide which in-stock pavu are a match for a loom's assigned quality. */
interface QualityEndsInfo {
  name: string;
  expectedEnds: number | null;
  /** yarn_count id of the quality's warp count (calc_snapshot.warpCountId),
   *  or null if not configured — used to narrow stock by yarn count too. */
  warpCountId: number | null;
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
    production_mode: 'in_house' | 'outsource' | 'jobwork';
    jobwork_vendor?: { name: string } | null;
    /** Free-text sizing set no, populated for jobwork-mode pavu rows only. */
    sizing_set_no?: string | null;
  } | null;
  costing: { id: number; quality_code: string; quality_name: string } | null;
}

interface PavuInStock {
  id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  meters: number;
  sizing_job?: { set_no?: string | null; warp_count_id?: number | null; warp_count?: { code: string } | null } | null;
  production_mode: 'in_house' | 'outsource' | 'jobwork';
  jobwork_vendor?: { name: string } | null;
  /** Free-text sizing set no, populated for jobwork-mode pavu rows only. */
  sizing_set_no?: string | null;
}

interface Quality {
  id: number;
  quality_code: string;
  quality_name: string;
}

const STATUS_STYLE: Record<string, string> = {
  running:    'bg-emerald-50 text-emerald-700',
  // All non-running statuses read red — a stopped loom must stand out.
  idle:       'bg-rose-100 text-rose-700',
  maintenance:'bg-rose-100 text-rose-700',
  breakdown:  'bg-rose-100 text-rose-700',
};

/** Same list as Settings → Looms. The card pill is a live dropdown so the
 *  operator can flip a loom's status right here without opening Settings. */
const LOOM_STATUSES = ['running', 'idle', 'maintenance', 'breakdown'] as const;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Cumulative metres woven on this beam: the live assignment's metres_produced
 *  plus anything woven under a PRIOR ended assignment of the same beam (it
 *  was mounted, partly woven, taken off, then remounted). */
function cumulativeMetres(a: ActiveAssignment, priorMetresByPavuId: Map<number, number>): number {
  const prior = a.pavu ? (priorMetresByPavuId.get(a.pavu.id) ?? 0) : 0;
  return prior + Number(a.metres_produced ?? 0);
}

/** Beam progress: % of the beam's nominal metres already woven (cumulative
 *  across mount cycles), or null if the pavu has no usable nominal metres.
 *  Not capped — >100% means the beam overran its nominal length. */
function beamPct(a: ActiveAssignment, priorMetresByPavuId: Map<number, number>): number | null {
  const nominal = Number(a.pavu?.meters ?? 0);
  if (!(nominal > 0)) return null;
  return Math.round((cumulativeMetres(a, priorMetresByPavuId) / nominal) * 100);
}

/** Adds one day to a yyyy-mm-dd date string, returning the same format. */
function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function PavuAssignPage() {
  const supabase = createClient();
  // The generated Database type's pavu_production_mode enum hasn't been
  // regenerated since migration 230 added 'jobwork', so the typed client
  // rejects it as a literal. Same workaround as /app/pavu/page.tsx.
  const sb = supabase as any;
  const [looms, setLooms]             = useState<Loom[]>([]);
  const [active, setActive]           = useState<ActiveAssignment[]>([]);
  const [stock, setStock]             = useState<PavuInStock[]>([]);
  const [qualities, setQualities]     = useState<Quality[]>([]);
  const [fabricQualityById, setFabricQualityById] = useState<Map<number, QualityEndsInfo>>(new Map());
  // pavu id → yarn_count id of its warp. In-house pavus carry this via
  // sizing_job; jobwork pavus get it from their linked jobwork_warp_beam.
  const [pavuWarpById, setPavuWarpById] = useState<Map<number, number>>(new Map());
  // pavu id → intended fabric_quality_id, from the jobwork_warp_beam row it
  // was received under. Only jobwork pavus carry this (in-house pavus' quality
  // isn't fixed until "Quality being woven" is picked at assignment) — used to
  // keep the Assign modal's beam list scoped to the loom's assigned quality,
  // not just ends + yarn count (two different qualities, e.g. white vs black,
  // can share the same ends and yarn count).
  const [pavuQualityById, setPavuQualityById] = useState<Map<number, number>>(new Map());
  const [yarnNameById, setYarnNameById] = useState<Map<number, string>>(new Map());
  // pavu id → its position within its sizing set (1, 2, 3… by beam no)
  // and the set's TOTAL beam count. Computed over ALL pavus of the set
  // (any status), so mounting/finishing a beam doesn't shift the others.
  const [setPosById, setSetPosById] = useState<Map<number, { pos: number; total: number }>>(new Map());
  // pavu id → metres already woven under a PREVIOUS assignment of the same
  // physical beam (status 'removed' or 'completed'). A beam can be taken off
  // a loom and remounted later to finish weaving its shortfall — the current
  // pavu_assign row's metres_produced only tracks the live mount, so this map
  // carries forward the earlier progress for the "X / Y m" display.
  const [priorMetresByPavuId, setPriorMetresByPavuId] = useState<Map<number, number>>(new Map());
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Modal state — which loom is being assigned right now, or which active
  // assignment is being edited (quality / mounted date) or removed.
  const [assignFor, setAssignFor] = useState<Loom | null>(null);
  const [editFor, setEditFor] = useState<ActiveAssignment | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<Loom | null>(null);
  // Loom whose status dropdown is mid-save.
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);

  /** Fetch all datasets in parallel. Wrapped so we can call again on save. */
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    const [l, a, p, q, fq, jwb, yc, allp] = await Promise.all([
      supabase.from('loom')
        .select('id, loom_code, loom_type, width_in, status, shed_no, fabric_quality_id, idle_since')
        .order('loom_code'),
      supabase.from('pavu_assign')
        .select(`
          id, loom_id, status, metres_produced, start_date, metres_start_date,
          pavu:pavu_id (
            id, pavu_code, beam_no, ends, meters, production_mode, sizing_set_no,
            sizing_job:sizing_job_id ( warp_count:warp_count_id ( code ) ),
            jobwork_vendor:jobwork_ledger_id ( name )
          ),
          costing:costing_id ( id, quality_code, quality_name )
        `)
        .in('status', ['queued', 'mounted', 'running']),
      sb.from('pavu')
        .select(`
          id, pavu_code, beam_no, ends, meters, production_mode, sizing_set_no,
          sizing_job:sizing_job_id ( set_no, warp_count_id, warp_count:warp_count_id ( code ) ),
          jobwork_vendor:jobwork_ledger_id ( name )
        `)
        .eq('status', 'in_stock')
        .in('production_mode', ['in_house', 'jobwork'])
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('costing_master')
        .select('id, quality_code, quality_name')
        .eq('status', 'active')
        .order('quality_code'),
      // Fabric quality's calc_snapshot carries its expected total-ends value
      // (same source the jobwork beam form uses to auto-fill Ends). We use
      // it here to match in-stock pavu against a loom's assigned quality.
      sb.from('fabric_quality')
        .select('id, name, calc_snapshot')
        .eq('active', true),
      // Jobwork pavus have no sizing_job, so their warp count comes from
      // the linked warp-beam-given row instead.
      sb.from('jobwork_warp_beam')
        .select('pavu_id, pavu_ids, warp_count_id, fabric_quality_id'),
      sb.from('yarn_count').select('id, display_name'),
      // ALL recent pavus regardless of status — needed to compute each
      // beam's true position within its set (a beam already on loom or
      // finished still occupies its slot in the set).
      sb.from('pavu')
        .select('id, beam_no, production_mode, sizing_set_no, sizing_job:sizing_job_id ( set_no )')
        .in('production_mode', ['in_house', 'jobwork'])
        .order('created_at', { ascending: false })
        .limit(500),
    ]);
    if (l.error || a.error || p.error || q.error || fq.error) {
      setError(l.error?.message ?? a.error?.message ?? p.error?.message ?? q.error?.message ?? fq.error?.message ?? 'Load failed');
    }
    setLooms(l.data ?? []);
    setActive((a.data as any) ?? []);
    setStock((p.data as any) ?? []);
    setQualities(q.data ?? []);

    // Carry-forward metres: a beam currently on a loom may have been mounted,
    // partly woven, taken off, and remounted (e.g. wrongly marked complete
    // then reverted). Sum up any PRIOR ended assignments (removed/completed)
    // for the same pavu ids so the progress widget shows cumulative metres
    // instead of resetting to 0 on remount.
    {
      const activePavuIds: number[] = Array.from(new Set<number>(
        ((a.data as any) ?? [])
          .map((row: { pavu: { id: number } | null }) => row.pavu?.id)
          .filter((id: number | undefined): id is number => id != null),
      ));
      if (activePavuIds.length > 0) {
        const { data: priorRows } = await supabase
          .from('pavu_assign')
          .select('pavu_id, metres_produced, status')
          .in('pavu_id', activePavuIds)
          .in('status', ['removed', 'completed']);
        const priorMap = new Map<number, number>();
        for (const row of (priorRows as { pavu_id: number; metres_produced: number | null }[] | null) ?? []) {
          priorMap.set(row.pavu_id, (priorMap.get(row.pavu_id) ?? 0) + Number(row.metres_produced ?? 0));
        }
        setPriorMetresByPavuId(priorMap);
      } else {
        setPriorMetresByPavuId(new Map());
      }
    }

    const qMap = new Map<number, QualityEndsInfo>();
    for (const row of (fq.data as { id: number; name: string; calc_snapshot: Record<string, unknown> | null }[] | null) ?? []) {
      const snap = row.calc_snapshot ?? {};
      const raw = snap['totalEnds'];
      const n = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      const rawWarp = snap['warpCountId'];
      const w = rawWarp === null || rawWarp === undefined || rawWarp === '' ? null : Number(rawWarp);
      qMap.set(row.id, {
        name: row.name,
        expectedEnds: n !== null && Number.isFinite(n) ? n : null,
        warpCountId: w !== null && Number.isFinite(w) ? w : null,
      });
    }
    setFabricQualityById(qMap);

    // pavu id → warp yarn_count id for jobwork pavus (via their linked
    // warp-beam-given row — either the single pavu_id fk or the pavu_ids list).
    const wMap = new Map<number, number>();
    // pavu id → intended fabric_quality_id, same source row.
    const qualByPavuMap = new Map<number, number>();
    for (const row of (jwb.data as {
      pavu_id: number | null; pavu_ids: number[] | null;
      warp_count_id: number | null; fabric_quality_id: number | null;
    }[] | null) ?? []) {
      const ids = [row.pavu_id, ...(row.pavu_ids ?? [])].filter((id): id is number => id != null);
      for (const id of ids) {
        if (row.warp_count_id != null) wMap.set(id, Number(row.warp_count_id));
        if (row.fabric_quality_id != null) qualByPavuMap.set(id, Number(row.fabric_quality_id));
      }
    }
    setPavuQualityById(qualByPavuMap);
    setPavuWarpById(wMap);
    setYarnNameById(new Map(
      (((yc.data as { id: number; display_name: string }[] | null) ?? [])).map(r => [Number(r.id), r.display_name]),
    ));

    // Position of each beam within its sizing set (1, 2, 3… by beam no),
    // over the FULL set — beams already mounted or finished still count.
    type PosRow = {
      id: number; beam_no: string | null;
      production_mode: string; sizing_set_no: string | null;
      sizing_job: { set_no: string | null } | null;
    };
    const posGroups = new Map<string, PosRow[]>();
    for (const s of ((allp.data as PosRow[] | null) ?? [])) {
      const key = `${s.production_mode}|${s.sizing_set_no ?? s.sizing_job?.set_no ?? '—'}`;
      const list = posGroups.get(key);
      if (list) list.push(s); else posGroups.set(key, [s]);
    }
    const posMap = new Map<number, { pos: number; total: number }>();
    for (const list of posGroups.values()) {
      list.sort((x, y) => {
        const nx = Number(x.beam_no); const ny = Number(y.beam_no);
        if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
        return String(x.beam_no).localeCompare(String(y.beam_no));
      });
      list.forEach((s, i) => posMap.set(s.id, { pos: i + 1, total: list.length }));
    }
    setSetPosById(posMap);

    setLoading(false);
  }, [supabase]);

  useEffect(() => { reload(); }, [reload]);

  // Deep-link support — /app/pavu/assign#loom-<id> (used by the dashboard
  // Looms tab) scrolls to that loom's card once the cards have rendered,
  // with a brief highlight ring so the eye lands on the right loom.
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#loom-')) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo', 'ring-offset-2');
    const t = setTimeout(() => el.classList.remove('ring-2', 'ring-indigo', 'ring-offset-2'), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  /** Unmount the pavu from a loom — marks the assignment "removed"; a
   *  trigger flips the pavu back to available stock ("finished"). Asks the
   *  operator to confirm the ACTUAL metres woven off the beam, so shortfall
   *  or excess vs the nominal beam metres is recorded on the finished row. */
  /** Change a loom's status straight from the card (no Settings trip).
   *  Mirrors Settings → Looms: flipping running → non-running stamps
   *  idle_since = today (locks newer shift-log entries); back to running
   *  clears it. Every change is appended to loom_status_log so there is a
   *  dated history of when each loom stopped / restarted. */
  async function changeLoomStatus(l: Loom, newStatus: string): Promise<void> {
    if (newStatus === l.status) return;
    setError(null);
    setStatusBusyId(l.id);

    const wasRunning = l.status === 'running';
    const nowRunning = newStatus === 'running';
    const patch: { status: string; idle_since?: string | null } = { status: newStatus };
    if (wasRunning && !nowRunning) patch.idle_since = todayISO();
    else if (!wasRunning && nowRunning) patch.idle_since = null;

    const { error: upErr } = await sb.from('loom').update(patch).eq('id', l.id);
    if (upErr) {
      setStatusBusyId(null);
      setError(upErr.message);
      return;
    }
    // Log row is best-effort on purpose: the status change itself already
    // succeeded, so a log failure should not roll the operator back.
    await sb.from('loom_status_log').insert({
      loom_id: l.id,
      old_status: l.status,
      new_status: newStatus,
    });
    setLooms((prev) =>
      prev.map((x) => (x.id === l.id ? { ...x, ...patch, status: newStatus } : x)),
    );
    setStatusBusyId(null);
  }

  async function removeAssignment(a: ActiveAssignment): Promise<void> {
    const nominal = Number(a.pavu?.meters ?? 0);
    const answer = window.prompt(
      `Remove ${a.pavu?.pavu_code ?? 'this pavu'} from this loom?\n\n` +
      `Beam nominal: ${nominal.toFixed(0)} m.\n` +
      `Enter the ACTUAL metres woven off this beam (correct if needed):`,
      Number(a.metres_produced ?? 0).toFixed(0),
    );
    if (answer === null) return; // cancelled
    const actual = Number(answer);
    if (!Number.isFinite(actual) || actual < 0) {
      setError('Invalid metres value — removal cancelled.');
      return;
    }
    // Finished (no yarn left) beams must not keep counting as "in stock" —
    // only 'completed' assignments read as status 'finished' in the Beam
    // Stock Report; 'removed' means the beam still has usable yarn and
    // goes back to the in-stock pool to be mounted again.
    const isFinished = window.confirm(
      `Is ${a.pavu?.pavu_code ?? 'this beam'} FULLY finished — no yarn left, won't be reassigned?\n\n` +
      `OK = Finished (removed from stock counts)\n` +
      `Cancel = Just removed early, still has yarn (stays in stock for reuse)`,
    );
    setRemoving(a.id);
    const { error: rmErr } = await sb
      .from('pavu_assign')
      .update({
        status: isFinished ? 'completed' : 'removed',
        end_date: new Date().toISOString().slice(0, 10),
        actual_metres: actual,
        metre_variance: nominal > 0 ? actual - nominal : null,
      })
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

  /** Looms whose beam is due for change (≥95%) or nearing the end (85–94%),
   *  by loom code — powers the alert strip at the top of the page. */
  const beamAlerts = useMemo(() => {
    const codeById = new Map(looms.map(l => [l.id, l.loom_code]));
    const due: string[] = [];
    const near: string[] = [];
    for (const a of active) {
      const p = beamPct(a, priorMetresByPavuId);
      if (p == null) continue;
      const code = codeById.get(a.loom_id) ?? `Loom ${a.loom_id}`;
      if (p >= 95) due.push(code);
      else if (p >= 85) near.push(code);
    }
    due.sort(); near.sort();
    return { due, near };
  }, [active, looms, priorMetresByPavuId]);

  /** Looms grouped by shed_no, each shed's looms sorted by loom_code.
   *  Looms with no shed assigned (shouldn't normally happen) are grouped
   *  last under "Unassigned" so nothing silently disappears from the view. */
  const shedGroups = useMemo(() => {
    const groups = new Map<number | null, Loom[]>();
    for (const l of looms) {
      const key = l.shed_no ?? null;
      const list = groups.get(key);
      if (list) list.push(l); else groups.set(key, [l]);
    }
    return Array.from(groups.entries())
      .sort((a, b) => {
        if (a[0] === null) return 1;
        if (b[0] === null) return -1;
        return a[0] - b[0];
      })
      .map(([shedNo, shedLooms]) => ({
        shedNo,
        looms: shedLooms.slice().sort((a, b) => a.loom_code.localeCompare(b.loom_code)),
      }));
  }, [looms]);

  return (
    <div>
      <PageHeader
        title="Pavu Assignment"
        subtitle="What's currently mounted on each loom. Tap a loom to assign or change the pavu."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/app/pavu" className="btn-ghost">
              <ArrowLeft className="w-4 h-4" /> Pavu Master
            </Link>
            <button onClick={reload} className="btn-ghost" disabled={loading}>
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">Could not load: {error}</div>
      )}

      {(beamAlerts.due.length > 0 || beamAlerts.near.length > 0) && (
        <div className="flex flex-col gap-2 mb-4">
          {beamAlerts.due.length > 0 && (
            <div className="card p-3 text-sm bg-rose-50/60 border-rose-200 text-rose-700">
              <span className="font-bold">
                {beamAlerts.due.length} loom{beamAlerts.due.length > 1 ? 's' : ''} due for beam change:
              </span>{' '}
              <span className="font-mono font-semibold">{beamAlerts.due.join(', ')}</span>
            </div>
          )}
          {beamAlerts.near.length > 0 && (
            <div className="card p-3 text-sm bg-amber-50/60 border-amber-200 text-amber-700">
              <span className="font-bold">
                {beamAlerts.near.length} beam{beamAlerts.near.length > 1 ? 's' : ''} nearing the end (85%+):
              </span>{' '}
              <span className="font-mono font-semibold">{beamAlerts.near.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {loading && !looms.length ? (
        <div className="card p-10 text-center text-ink-soft text-sm">
          <Loader2 className="w-5 h-5 inline animate-spin mr-2" /> Loading looms…
        </div>
      ) : (
        <div className="space-y-6">
          {shedGroups.map(({ shedNo, looms: shedLooms }) => (
            <div key={shedNo ?? 'unassigned'}>
              <h2 className="text-xs font-semibold text-ink-mute uppercase tracking-wide mb-2">
                {shedNo !== null ? `Shed ${shedNo}` : 'Unassigned'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {shedLooms.map(l => {
            const cur = activeByLoom.get(l.id);
            return (
              <div
                key={l.id}
                id={`loom-${l.id}`}
                // Non-running looms glow red so a stopped loom is obvious
                // at a glance when scanning the shed. scroll-mt keeps the
                // card clear of the sticky header on #loom-<id> deep links.
                className={`card p-4 flex flex-col gap-3 scroll-mt-24 transition-shadow ${
                  l.status !== 'running' ? 'border-rose-300 bg-rose-50/60' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    title="View loom history"
                    className="flex items-center gap-2 rounded hover:bg-haze px-1 -mx-1"
                    onClick={() => setHistoryFor(l)}
                  >
                    <Wrench className="w-4 h-4 text-ink-mute" />
                    <span className={`font-mono font-bold underline decoration-dotted decoration-line underline-offset-2 ${l.status !== 'running' ? 'text-rose-700' : 'text-ink'}`}>{l.loom_code}</span>
                    <span className="text-xs text-ink-mute">{l.loom_type}</span>
                    <History className="w-3 h-3 text-ink-mute" />
                  </button>
                  {/* Live status dropdown styled as the old pill — changing
                      it saves immediately and logs the change with date. */}
                  <select
                    aria-label={`Status of loom ${l.loom_code}`}
                    value={l.status}
                    disabled={statusBusyId === l.id}
                    onChange={(e) => void changeLoomStatus(l, e.target.value)}
                    className={`pill cursor-pointer border-0 disabled:opacity-50 ${STATUS_STYLE[l.status] ?? 'bg-slate-100 text-slate-600'}`}
                  >
                    {LOOM_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
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
                    {cur.pavu.production_mode === 'jobwork' && (
                      <div className="text-xs text-indigo-700 mt-1">
                        Jobwork beam — supplied by {cur.pavu.jobwork_vendor?.name ?? 'Unknown party'}
                        {cur.pavu.sizing_set_no ? ` (Set ${cur.pavu.sizing_set_no})` : ''}
                      </div>
                    )}
                    {l.fabric_quality_id && fabricQualityById.get(l.fabric_quality_id) && (
                      <div className="text-xs text-ink-soft">
                        Quality: <span className="font-semibold">{fabricQualityById.get(l.fabric_quality_id)!.name}</span>
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
                    {(() => {
                      const pct = beamPct(cur, priorMetresByPavuId);
                      const shown = cumulativeMetres(cur, priorMetresByPavuId);
                      const barColor = pct != null && pct >= 95 ? 'bg-rose-500'
                        : pct != null && pct >= 85 ? 'bg-amber-500'
                        : 'bg-indigo';
                      return (
                        <div className="pt-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-wide text-ink-mute">{cur.status}</span>
                            <span className="text-xs num">
                              {shown.toFixed(0)} / {Number(cur.pavu.meters).toFixed(0)} m
                              {pct != null ? ` · ${pct}%` : ''}
                            </span>
                          </div>
                          {pct != null && (
                            <div className="h-1.5 rounded-full bg-haze overflow-hidden">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          )}
                          {pct != null && pct >= 95 && (
                            <span className="inline-block rounded-md bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                              Change beam
                            </span>
                          )}
                          {pct != null && pct >= 85 && pct < 95 && (
                            <span className="inline-block rounded-md bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                              Beam ending soon
                            </span>
                          )}
                        </div>
                      );
                    })()}
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
            </div>
          ))}
        </div>
      )}

      {looms.length > 0 && stock.length === 0 && (
        <div className="card p-4 mt-4 text-sm text-amber-700 bg-amber-50/40">
          No pavu in stock. Create a{' '}
          <a href="/app/sizing/new" className="underline font-semibold">new sizing job</a>{' '}
          with in-house beams, or record a{' '}
          <a href="/app/jobwork" className="underline font-semibold">warp beam given</a>{' '}
          by a jobwork party first.
        </div>
      )}

      {assignFor && (
        <AssignModal
          loom={assignFor}
          stock={stock}
          qualities={qualities}
          loomQuality={assignFor.fabric_quality_id ? fabricQualityById.get(assignFor.fabric_quality_id) ?? null : null}
          pavuWarpById={pavuWarpById}
          pavuQualityById={pavuQualityById}
          yarnNameById={yarnNameById}
          setPosById={setPosById}
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

      {historyFor && (
        <LoomHistoryModal loom={historyFor} onClose={() => setHistoryFor(null)} />
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
  loom, stock, qualities, loomQuality, pavuWarpById, pavuQualityById, yarnNameById, setPosById, currentAssignment, onClose, onDone,
}: {
  loom: Loom;
  stock: PavuInStock[];
  qualities: Quality[];
  /** The fabric quality assigned to this loom in Loom Setting, with its
   *  expected total-ends value — null if the loom has no quality assigned
   *  at all. Used to narrow the pavu list to matching beams only. */
  loomQuality: QualityEndsInfo | null;
  /** pavu id → warp yarn_count id (from jobwork_warp_beam, for jobwork pavus). */
  pavuWarpById: Map<number, number>;
  /** pavu id → intended fabric_quality_id (from jobwork_warp_beam, for jobwork
   *  pavus) — lets the beam list be narrowed to the loom's exact quality, not
   *  just its ends + yarn count (two qualities can share both, e.g. white
   *  2190 vs black 2190, both 20s cotton). */
  pavuQualityById: Map<number, number>;
  /** yarn_count id → display name, for showing warp count in option labels. */
  yarnNameById: Map<number, string>;
  /** pavu id → position within its full sizing set (all statuses). */
  setPosById: Map<number, { pos: number; total: number }>;
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
  // Actual metres woven off the beam being replaced — pre-filled from shift
  // logs, operator-correctable so shortfall/excess vs nominal is recorded.
  const [actualMetres, setActualMetres] = useState(() =>
    currentAssignment ? Number(currentAssignment.metres_produced ?? 0).toFixed(0) : '');
  // Whether the beam being swapped off is fully done (no yarn left) — if so
  // it's marked 'completed' so the Beam Stock Report shows it as "finished"
  // instead of counting it toward "in stock". Left unchecked, it's marked
  // 'removed' and goes back to the in-stock pool for reassignment.
  const [oldBeamFinished, setOldBeamFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lock background scroll while this modal is open — without this the
  // page behind can scroll-chain with the modal's own internal scroll on
  // mobile, which felt like "the screen scrolls wrong" and made the
  // Assign/Cancel footer unreachable on long forms (e.g. a loom that
  // already has an active assignment, which adds the removal/actual-metres
  // block above and pushes the form well past one screen).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Keep the metres-count start date defaulted to mounted date + 1 day,
  // unless the user has manually edited it — shift logs are sometimes
  // entered late, so this should stay independently editable.
  function onMountedDateChange(value: string): void {
    setMountedDate(value);
    if (!metresStartTouched) setMetresStartDate(addOneDay(value));
  }

  /** Intended fabric_quality_id for a pavu, from its linked warp-beam-given
   *  row — jobwork rows only. In-house rows have no entry (their quality
   *  isn't fixed until "Quality being woven" is picked below), so this
   *  returns null for them and they're not filtered on this basis. */
  function pavuQualityId(s: PavuInStock): number | null {
    return pavuQualityById.get(s.id) ?? null;
  }

  /** Warp yarn_count id for a pavu: in-house rows carry it via sizing_job,
   *  jobwork rows via their linked warp-beam-given row. */
  function pavuWarpId(s: PavuInStock): number | null {
    return s.sizing_job?.warp_count_id ?? pavuWarpById.get(s.id) ?? null;
  }

  // Only pavu whose ends count, warp yarn count, AND (for jobwork beams)
  // intended fabric quality match this loom's assigned fabric quality are
  // eligible — a loom set up for one quality shouldn't be offered beams
  // meant for another. Two different qualities can share the same ends and
  // yarn count (e.g. white 2190 vs black 2190, both 20s cotton), so ends
  // alone isn't enough to tell them apart — the quality check catches that.
  // Beams whose warp count or quality is unknown (in-house beams, whose
  // quality isn't fixed until "Quality being woven" is picked below) are not
  // hidden on that basis, only on ends. If the loom has no quality assigned,
  // or the quality has no expected-ends value configured, matchedStock is
  // empty and the UI below explains what to fix instead of silently showing
  // everything.
  const matchedStock = loomQuality?.expectedEnds != null
    ? stock.filter(s => {
        if (s.ends !== loomQuality.expectedEnds) return false;
        const w = pavuWarpId(s);
        if (loomQuality.warpCountId != null && w != null && w !== loomQuality.warpCountId) return false;
        const q = pavuQualityId(s);
        if (loom.fabric_quality_id != null && q != null && q !== loom.fabric_quality_id) return false;
        return true;
      })
    : [];

  // Distinct SET NO values present in the matched in-stock pavu list, so the
  // operator can narrow the (potentially long) pavu dropdown down to one
  // vendor set before picking the exact beam.
  const setNos = useMemo(
    () => Array.from(new Set(
      matchedStock.map(s => s.sizing_job?.set_no).filter((v): v is string => !!v),
    )).sort((a, b) => {
      const na = Number(a); const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    }),
    [matchedStock],
  );
  // Dropdown always reads set-by-set, beam-by-beam: sort by set no
  // first, then numeric beam no — so #1/#2/#3 of a set appear in order.
  const filteredStock = (setNoFilter
    ? matchedStock.filter(s => s.sizing_job?.set_no === setNoFilter)
    : matchedStock
  ).slice().sort((a, b) => {
    const sa = a.sizing_job?.set_no ?? a.sizing_set_no ?? '';
    const sb = b.sizing_job?.set_no ?? b.sizing_set_no ?? '';
    if (sa !== sb) {
      const na = Number(sa); const nb = Number(sb);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return sa.localeCompare(sb);
    }
    const ba = Number(a.beam_no); const bb = Number(b.beam_no);
    if (Number.isFinite(ba) && Number.isFinite(bb)) return ba - bb;
    return String(a.beam_no).localeCompare(String(b.beam_no));
  });

  // filteredStock is already sorted set-by-set, so a single pass grouping
  // consecutive same-set rows is enough — no separate sort/bucket step
  // needed. Rows with no set no at all (rare) fall into their own "No set"
  // group rather than silently joining the group above/below them.
  const groupedStock = useMemo(() => {
    const groups: { setNo: string | null; items: typeof filteredStock }[] = [];
    for (const s of filteredStock) {
      const key = s.sizing_job?.set_no ?? s.sizing_set_no ?? null;
      const last = groups[groups.length - 1];
      if (last && last.setNo === key) {
        last.items.push(s);
      } else {
        groups.push({ setNo: key, items: [s] });
      }
    }
    return groups;
  }, [filteredStock]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);

    // Free up the loom first if something else is on it, recording the
    // actual metres woven and the shortfall/excess vs nominal beam metres.
    if (currentAssignment) {
      const actual = Number(actualMetres);
      if (!Number.isFinite(actual) || actual < 0) {
        setErr('Enter valid actual metres for the beam being removed.');
        setBusy(false); return;
      }
      const nominal = Number(currentAssignment.pavu?.meters ?? 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paTable = supabase.from('pavu_assign') as any;
      const { error: rmErr } = await paTable
        .update({
          status: oldBeamFinished ? 'completed' : 'removed',
          end_date: new Date().toISOString().slice(0, 10),
          actual_metres: actual,
          metre_variance: nominal > 0 ? actual - nominal : null,
        })
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

  // Portal straight to <body>: the app shell's mobile push-menu wrapper sets
  // will-change-transform on the page surface, which makes it the containing
  // block for any `fixed` descendant (per spec, will-change: transform acts
  // like a real transform for this purpose). Left un-portaled, this modal
  // would render centered inside that (now much taller, shed-grouped) page
  // surface instead of the actual viewport — i.e. scrolled out of view.
  // Same fix already used by delivery-challan/cancel-dc-button.tsx.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden bg-paper rounded-t-2xl sm:rounded-2xl shadow-xl border border-line/60">
        <div className="flex shrink-0 items-center justify-between p-4 border-b border-line/60">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-mute">Assign to</div>
            <div className="font-mono font-bold">{loom.loom_code}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-cloud">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-1 min-h-0 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-4 space-y-4">
          {currentAssignment?.pavu && (
            <div className="space-y-2">
              <div className="text-xs p-3 rounded-lg bg-amber-50 text-amber-800">
                Loom currently has <span className="font-mono font-semibold">{currentAssignment.pavu.pavu_code}</span>.
                Saving will {oldBeamFinished ? 'mark it finished' : 'remove it back to stock'}.
              </div>
              <div>
                <label className="label">
                  Actual metres woven off {currentAssignment.pavu.pavu_code} *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={actualMetres}
                  onChange={e => setActualMetres(e.target.value)}
                  className="input"
                />
                {(() => {
                  const nominal = Number(currentAssignment.pavu?.meters ?? 0);
                  const actual = Number(actualMetres);
                  if (!(nominal > 0) || actualMetres === '' || !Number.isFinite(actual)) {
                    return (
                      <p className="text-xs text-ink-mute mt-1">
                        Pre-filled from shift logs — correct it if the beam ran short or long.
                      </p>
                    );
                  }
                  const diff = actual - nominal;
                  return (
                    <p className={`text-xs mt-1 ${diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-emerald-600' : 'text-ink-mute'}`}>
                      Beam nominal {nominal.toFixed(0)} m →{' '}
                      {diff === 0 ? 'exact' : diff > 0 ? `excess +${diff.toFixed(0)} m` : `shortfall ${diff.toFixed(0)} m`}
                    </p>
                  );
                })()}
              </div>
              <label className="flex items-start gap-2 text-xs p-2 rounded-lg bg-cloud/60">
                <input
                  type="checkbox"
                  checked={oldBeamFinished}
                  onChange={e => setOldBeamFinished(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  This beam is fully finished — no yarn left, won't be reassigned.
                  {' '}Leave unchecked if it still has usable yarn (it'll stay in stock for reuse).
                </span>
              </label>
            </div>
          )}

          {!loom.fabric_quality_id ? (
            <div className="text-xs p-3 rounded-lg bg-amber-50 text-amber-800">
              This loom has no fabric quality assigned yet. Set one in{' '}
              <a href="/app/settings/looms" className="underline font-semibold">Loom Setting</a>{' '}
              before assigning pavu.
            </div>
          ) : loomQuality?.expectedEnds == null ? (
            <div className="text-xs p-3 rounded-lg bg-amber-50 text-amber-800">
              This loom's fabric quality ({loomQuality?.name ?? 'assigned quality'}) has no ends
              spec configured. Set its expected ends in{' '}
              <a href="/app/settings/fabric-qualities" className="underline font-semibold">Fabric Quality</a>{' '}
              before assigning pavu.
            </div>
          ) : (
            <>
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
                  {/* Grouped by Set No via <optgroup> — the browser renders a
                      labeled header + visual break between groups, so beams
                      from different sizing/jobwork sets are never mistaken
                      for one continuous run. */}
                  {groupedStock.map((g, gi) => (
                    <optgroup key={g.setNo ?? `no-set-${gi}`} label={g.setNo ? `SET ${g.setNo}` : 'No set'}>
                      {g.items.map(s => {
                        const w = pavuWarpId(s);
                        const warpName = s.sizing_job?.warp_count?.code
                          ?? (w != null ? yarnNameById.get(w) : null);
                        const pos = setPosById.get(s.id);
                        return (
                          <option key={s.id} value={s.id}>
                            {s.pavu_code} — Beam {s.beam_no}
                            {pos ? ` (#${pos.pos}/${pos.total})` : ''}
                            {warpName ? ` · ${warpName}` : ''} · {s.ends} ends · {Number(s.meters).toFixed(0)} m
                            {s.production_mode === 'jobwork' ? ` · Jobwork (${s.jobwork_vendor?.name ?? 'Unknown party'})` : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
                {filteredStock.length === 0 && (
                  <p className="text-xs text-ink-mute mt-1">
                    No in-stock pavu matching this loom's fabric quality ({loomQuality.name}
                    {loomQuality.expectedEnds != null ? `, ${loomQuality.expectedEnds} ends` : ''}).
                  </p>
                )}
              </div>
            </>
          )}

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
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-line/60 p-4">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy || !pavuId} className="btn-primary">
              {busy ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
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

  // See AssignModal above for why this locks background scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

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

  // See AssignModal above for why this is portaled to <body>.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden bg-paper rounded-t-2xl sm:rounded-2xl shadow-xl border border-line/60">
        <div className="flex shrink-0 items-center justify-between p-4 border-b border-line/60">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-mute">Edit assignment</div>
            <div className="font-mono font-bold">{assignment.pavu?.pavu_code ?? '—'}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-cloud">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-1 min-h-0 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-4 space-y-4">
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
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-line/60 p-4">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Loom history modal — full beam (pavu) history and recent production shift
// logs for one loom. Opened by tapping the loom code on a card.
// ───────────────────────────────────────────────────────────────────────────
interface BeamHistoryRow {
  id: number;
  status: string;
  assigned_date: string | null;
  start_date: string | null;
  end_date: string | null;
  metres_produced: number | null;
  actual_metres: number | null;
  metre_variance: number | null;
  costing_id: number | null;
  pavu: { id: number; pavu_code: string; beam_no: string | null; meters: number | null } | null;
  costing: { quality_code: string } | null;
  // Resolved client-side after fetch — see the effect below. Tier 1: the
  // real costing_master quality_code (unchanged). Tier 2: for jobwork
  // mounts where costing is the shared 'JOBWORK-EXEMPT' placeholder (or
  // missing), the individual fabric_quality row via
  // jobwork_warp_beam.fabric_quality_id, matching the same fallback used
  // in fn_pavu_stock_report and the Pavu Mount History report — never the
  // generic exempt label.
  quality_label: string | null;
}

interface ProdLogRow {
  id: number;
  log_date: string;
  shift: string;
  rate_per_m: number | null;
  is_towel: boolean;
  towel_meter_per_pc: number | null;
  quality: { code: string } | null;
  weavers: { metres_woven: number | null; employee: { full_name: string } | null }[] | null;
}

interface StatusLogRow {
  id: number;
  old_status: string | null;
  new_status: string;
  changed_on: string;
  created_at: string;
}

function LoomHistoryModal({ loom, onClose }: { loom: Loom; onClose: () => void }) {
  const supabase = createClient();
  const [tab, setTab] = useState<'beams' | 'production' | 'status'>('beams');
  const [beams, setBeams] = useState<BeamHistoryRow[]>([]);
  const [logs, setLogs] = useState<ProdLogRow[]>([]);
  const [statusLogs, setStatusLogs] = useState<StatusLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Generated types lag behind the new actual_metres/metre_variance
      // columns — cast through any like the rest of this page.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [b, p, s] = await Promise.all([
        sb.from('pavu_assign')
          .select('id, status, assigned_date, start_date, end_date, metres_produced, actual_metres, metre_variance, costing_id, pavu:pavu_id ( id, pavu_code, beam_no, meters ), costing:costing_id ( quality_code )')
          .eq('loom_id', loom.id)
          .order('id', { ascending: false })
          .limit(50),
        sb.from('production_shift_log')
          .select('id, log_date, shift, rate_per_m, is_towel, towel_meter_per_pc, quality:fabric_quality_id ( code ), weavers:production_shift_log_weaver ( metres_woven, employee:employee_id ( full_name ) )')
          .eq('loom_id', loom.id)
          .order('log_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(60),
        sb.from('loom_status_log')
          .select('id, old_status, new_status, changed_on, created_at')
          .eq('loom_id', loom.id)
          .order('id', { ascending: false })
          .limit(60),
      ]);
      if (cancelled) return;
      if (b.error) setErr(b.error.message);
      else if (p.error) setErr(p.error.message);
      else if (s.error) setErr(s.error.message);

      const rawBeams = (b.data as BeamHistoryRow[] | null) ?? [];

      // Resolve individual jobwork qualities the same way
      // fn_pavu_stock_report and the Pavu Mount History report do: fetch
      // every jobwork_warp_beam row ascending by id and keep the
      // highest-id (most recent) fabric_quality_id per pavu via plain
      // Map.set last-write-wins.
      const pavuIds = rawBeams.map((r) => r.pavu?.id).filter((v): v is number => v != null);
      let fqIdByPavu = new Map<number, number>();
      if (pavuIds.length > 0) {
        const { data: jwbData } = await sb
          .from('jobwork_warp_beam')
          .select('id, pavu_id, pavu_ids, fabric_quality_id')
          .order('id', { ascending: true });
        for (const row of (jwbData ?? []) as Array<{
          id: number; pavu_id: number | null; pavu_ids: number[] | null; fabric_quality_id: number | null;
        }>) {
          if (row.fabric_quality_id == null) continue;
          const ids = [row.pavu_id, ...(row.pavu_ids ?? [])].filter((id): id is number => id != null);
          for (const id of ids) fqIdByPavu.set(id, row.fabric_quality_id);
        }
      }
      const jwbFqIds = Array.from(new Set(fqIdByPavu.values()));
      let fqById = new Map<number, { code: string | null; name: string | null }>();
      if (jwbFqIds.length > 0) {
        const { data } = await sb.from('fabric_quality').select('id, code, name').in('id', jwbFqIds);
        fqById = new Map(
          ((data ?? []) as Array<{ id: number; code: string | null; name: string | null }>)
            .map((f) => [f.id, { code: f.code, name: f.name }]),
        );
      }

      const enrichedBeams: BeamHistoryRow[] = rawBeams.map((r) => {
        const tier1Applies = r.costing_id != null && r.costing?.quality_code !== 'JOBWORK-EXEMPT';
        let quality_label: string | null;
        if (tier1Applies) {
          quality_label = r.costing?.quality_code ?? null;
        } else {
          const jwbFqId = r.pavu?.id != null ? fqIdByPavu.get(r.pavu.id) : undefined;
          const jwbFq = jwbFqId != null ? fqById.get(jwbFqId) : undefined;
          quality_label = jwbFq ? jwbFq.name ?? jwbFq.code ?? null : r.costing?.quality_code ?? null;
        }
        return { ...r, quality_label };
      });

      setBeams(enrichedBeams);
      setLogs((p.data as ProdLogRow[] | null) ?? []);
      setStatusLogs((s.data as StatusLogRow[] | null) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loom.id]);

  // See AssignModal above for why this is portaled to <body>.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-paper rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg border border-line/60 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-4 border-b border-line/60">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-mute">Loom history</div>
            <div className="font-mono font-bold">{loom.loom_code}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-cloud">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {([['beams', 'Beam history'], ['production', 'Production'], ['status', 'Status log']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                tab === key ? 'bg-indigo text-white' : 'bg-haze text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-sm text-ink-soft">
              <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> Loading…
            </div>
          ) : err ? (
            <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{err}</div>
          ) : tab === 'beams' ? (
            beams.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-mute">No beams have been assigned to this loom yet.</div>
            ) : (
              <div className="space-y-2">
                {beams.map(b => {
                  const nominal = Number(b.pavu?.meters ?? 0);
                  const v = b.metre_variance == null ? null : Number(b.metre_variance);
                  return (
                    <div key={b.id} className="rounded-lg border border-line/60 p-3 text-sm space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-indigo">{b.pavu?.pavu_code ?? '—'}</span>
                        <span className={`pill ${b.status === 'removed' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                          {b.status}
                        </span>
                      </div>
                      <div className="text-xs text-ink-soft">
                        Beam {b.pavu?.beam_no ?? '—'}
                        {b.quality_label ? ` · ${b.quality_label}` : ''}
                        {nominal > 0 ? ` · ${nominal.toFixed(0)} m nominal` : ''}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {b.start_date ?? b.assigned_date ?? '—'} → {b.end_date ?? 'on loom'}
                        {' · '}
                        <span className="num">{Number(b.metres_produced ?? 0).toFixed(0)} m made</span>
                        {b.actual_metres != null && ` · actual ${Number(b.actual_metres).toFixed(0)} m`}
                      </div>
                      {v != null && v !== 0 && (
                        <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${
                          v < 0 ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                        }`}>
                          {v < 0 ? `Shortfall ${v.toFixed(0)} m` : `Excess +${v.toFixed(0)} m`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === 'status' ? (
            statusLogs.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-mute">
                No status changes recorded for this loom yet. Changes made from
                the card&apos;s status dropdown (or Settings → Looms) appear here.
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs text-ink-mute mb-2">Newest first.</p>
                {statusLogs.map((s) => (
                  <div key={s.id} className="rounded-lg border border-line/60 p-3 text-sm flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {s.old_status && (
                        <>
                          <span className={`pill ${STATUS_STYLE[s.old_status] ?? 'bg-slate-100 text-slate-600'}`}>{s.old_status}</span>
                          <span className="text-ink-mute">→</span>
                        </>
                      )}
                      <span className={`pill ${STATUS_STYLE[s.new_status] ?? 'bg-slate-100 text-slate-600'}`}>{s.new_status}</span>
                    </div>
                    <span className="text-xs text-ink-soft num">{s.changed_on}</span>
                  </div>
                ))}
              </div>
            )
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-mute">No production shift logs for this loom yet.</div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-ink-mute mb-2">Last {logs.length} shift log{logs.length > 1 ? 's' : ''}, newest first.</p>
              {logs.map((l, idx) => {
                const weavers = l.weavers ?? [];
                const total = weavers.reduce((s, w) => s + Number(w.metres_woven ?? 0), 0);
                // Compare with the next row in the list = the previous
                // (older) shift log, to flag rate / towel-length changes.
                const prev = logs[idx + 1];
                const rateChanged =
                  prev != null && l.rate_per_m != null && prev.rate_per_m != null &&
                  Number(l.rate_per_m) !== Number(prev.rate_per_m);
                // Only flag towel-length changes between two towel logs —
                // switching to/from a non-towel quality is already covered
                // by the quality-changed flag.
                const towelChanged =
                  prev != null &&
                  Number(l.towel_meter_per_pc ?? 0) > 0 &&
                  Number(prev.towel_meter_per_pc ?? 0) > 0 &&
                  Number(l.towel_meter_per_pc) !== Number(prev.towel_meter_per_pc);
                const qualityChanged =
                  prev != null && (l.quality?.code ?? '') !== (prev.quality?.code ?? '');
                return (
                  <div key={l.id} className="flex items-start justify-between gap-2 rounded-lg border border-line/60 px-3 py-2 text-xs">
                    <div>
                      <span className="font-semibold">{l.log_date}</span>{' '}
                      <span className="uppercase text-ink-mute">{l.shift === 'morning' ? 'M' : l.shift === 'night' ? 'N' : l.shift}</span>
                      <div className="text-ink-soft mt-0.5">
                        <span className="font-mono text-indigo">{l.quality?.code ?? '—'}</span>
                        {l.rate_per_m != null && <> · ₹{Number(l.rate_per_m).toFixed(2)}/m</>}
                        {(l.is_towel || Number(l.towel_meter_per_pc ?? 0) > 0) && (
                          <> · towel {Number(l.towel_meter_per_pc ?? 0).toFixed(2)} m/pc</>
                        )}
                      </div>
                      {(rateChanged || towelChanged || qualityChanged) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {qualityChanged && (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border bg-indigo-50 text-indigo border-indigo-200">
                              Quality changed
                            </span>
                          )}
                          {rateChanged && (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border bg-amber-50 text-amber-700 border-amber-200">
                              Rate changed{prev?.rate_per_m != null ? ` (was ₹${Number(prev.rate_per_m).toFixed(2)})` : ''}
                            </span>
                          )}
                          {towelChanged && (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border bg-amber-50 text-amber-700 border-amber-200">
                              Towel length changed{prev != null ? ` (was ${Number(prev.towel_meter_per_pc ?? 0).toFixed(2)} m/pc)` : ''}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-ink-soft mt-0.5">
                        {weavers.length === 0
                          ? '—'
                          : weavers.map((w, i) => (
                              <span key={i}>
                                {i > 0 && ', '}
                                {w.employee?.full_name ?? '—'} ({Number(w.metres_woven ?? 0).toFixed(0)} m)
                              </span>
                            ))}
                      </div>
                    </div>
                    <span className="num font-semibold whitespace-nowrap">{total.toFixed(0)} m</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
