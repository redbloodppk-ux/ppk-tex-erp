'use client';
/**
 * Pavu Master — Bulk Routing form.
 *
 * Shows one row per sizing job with its set no, beam count and total
 * warp metres. For each job the operator picks:
 *
 *   1. Production mode: in-house / outsource
 *   2. (only when outsource) Scope: whole job / beam-wise
 *      - whole     → one outsource weaver across every beam
 *      - beam-wise → each beam in the set gets its own weaver
 *
 * Clicking Save flushes the chosen routing to every pavu row that
 * belongs to the job. In beam-wise mode each row goes through a
 * separate update so per-beam vendors stick.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, ChevronDown, ChevronRight } from 'lucide-react';
import { syncWarpBeamFromPavus } from './sync-warp-beam';

type ProdMode = 'in_house' | 'outsource';
type Scope    = 'whole' | 'beam_wise';

export interface BulkBeam {
  id: number;
  beam_no: string;
  ends: number;
  meters: number;
  production_mode: ProdMode | null;
  outsource_ledger_id: number | null;
  outsource_vendor_name: string | null;
}

export interface BulkJobRow {
  id: number;
  job_code: string;
  set_no: string | null;
  beam_count: number;
  total_warp_metres: number;
  current_mode: ProdMode | 'mixed' | null;
  current_vendor_id: number | null;
  current_vendor_name: string | null;
  beams: BulkBeam[];
}

export interface WeavingVendor {
  id: number;
  name: string;
}

interface RowState {
  mode:           ProdMode;
  scope:          Scope;
  vendorId:       string;                 // used when scope='whole'
  beamVendorIds:  Record<number, string>; // beam id → vendor (ledger) id
  expanded:       boolean;                // beam-wise drawer open?
  saving:         boolean;
  error:          string | null;
  saved:          boolean;
}

interface Props {
  jobs:    ReadonlyArray<BulkJobRow>;
  vendors: ReadonlyArray<WeavingVendor>;
}

function fmtMetres(v: number): string {
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Initial scope for a job — beam-wise iff the existing pavu rows
 *  are routed to two or more different outsource vendors. */
function deriveInitialScope(job: BulkJobRow): Scope {
  const vendors = new Set<number | null>();
  const beams = Array.isArray(job.beams) ? job.beams : [];
  for (const b of beams) {
    if (b.production_mode === 'outsource') vendors.add(b.outsource_ledger_id ?? null);
  }
  return vendors.size > 1 ? 'beam_wise' : 'whole';
}

// Initial RowState derivation lifted to module scope so the function
// is guaranteed to exist before the useState initializer runs.
function deriveInitialState(j: BulkJobRow): RowState {
  const scope = deriveInitialScope(j);
  const beamVendorIds: Record<number, string> = {};
  const beams = Array.isArray(j.beams) ? j.beams : [];
  for (const b of beams) {
    if (b.outsource_ledger_id != null) {
      beamVendorIds[b.id] = String(b.outsource_ledger_id);
    }
  }
  return {
    mode:           j.current_mode === 'outsource' ? 'outsource' : 'in_house',
    scope,
    vendorId:       j.current_vendor_id != null ? String(j.current_vendor_id) : '',
    beamVendorIds,
    expanded:       scope === 'beam_wise',
    saving:         false,
    error:          null,
    saved:          false,
  };
}

export function BulkRoutingForm({ jobs, vendors }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [state, setState] = useState<Record<number, RowState>>(() => {
    const init: Record<number, RowState> = {};
    for (const j of jobs) {
      init[j.id] = deriveInitialState(j);
    }
    return init;
  });

  function patch(jobId: number, patch: Partial<RowState>) {
    setState((prev) => {
      const job = jobs.find((j) => j.id === jobId);
      const base = prev[jobId] ?? (job ? deriveInitialState(job) : undefined);
      if (!base) return prev;
      return { ...prev, [jobId]: { ...base, ...patch } };
    });
  }

  function setBeamVendor(jobId: number, beamId: number, vendorId: string) {
    setState((prev) => {
      const job = jobs.find((j) => j.id === jobId);
      const cur = prev[jobId] ?? (job ? deriveInitialState(job) : undefined);
      if (!cur) return prev;
      return {
        ...prev,
        [jobId]: {
          ...cur,
          beamVendorIds: { ...cur.beamVendorIds, [beamId]: vendorId },
          saved: false,
        },
      };
    });
  }

  async function handleSave(job: BulkJobRow): Promise<void> {
    const s = state[job.id];
    if (!s) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // ── In-house ──
    if (s.mode === 'in_house') {
      patch(job.id, { saving: true, error: null, saved: false });
      const { error: updErr } = await sb
        .from('pavu')
        .update({ production_mode: 'in_house', outsource_ledger_id: null, status: 'assigned' })
        .eq('sizing_job_id', job.id);
      if (updErr) { patch(job.id, { saving: false, error: updErr.message }); return; }
      // Sync — any mirrored warp-beam-given rows get cleaned up.
      const sync = await syncWarpBeamFromPavus(sb, job.beams.map((b) => b.id));
      if (!sync.ok) { patch(job.id, { saving: false, error: 'Pavu saved, warp-given sync failed: ' + (sync.error ?? '') }); return; }
      patch(job.id, { saving: false, saved: true });
      router.refresh();
      return;
    }

    // ── Outsource, whole job ──
    if (s.scope === 'whole') {
      if (!s.vendorId) {
        patch(job.id, { error: 'Pick an outsource weaver.' });
        return;
      }
      patch(job.id, { saving: true, error: null, saved: false });
      const { error: updErr } = await sb
        .from('pavu')
        .update({
          production_mode:     'outsource',
          outsource_ledger_id: Number(s.vendorId),
          status:              'assigned',
        })
        .eq('sizing_job_id', job.id);
      if (updErr) { patch(job.id, { saving: false, error: updErr.message }); return; }
      // Sync — each beam's mirror row is upserted with the new weaver.
      const sync = await syncWarpBeamFromPavus(sb, job.beams.map((b) => b.id));
      if (!sync.ok) { patch(job.id, { saving: false, error: 'Pavu saved, warp-given sync failed: ' + (sync.error ?? '') }); return; }
      patch(job.id, { saving: false, saved: true });
      router.refresh();
      return;
    }

    // ── Outsource, beam-wise ──
    // A blank weaver on a beam means "keep this beam in-house" —
    // the operator can split a set across an outsource weaver and
    // their own loom without having to flip the parent row's mode.
    patch(job.id, { saving: true, error: null, saved: false });
    for (const b of job.beams) {
      const raw      = s.beamVendorIds[b.id] ?? '';
      const vendorId = raw === '' ? null : Number(raw);
      const payload  = vendorId === null
        ? { production_mode: 'in_house',  outsource_ledger_id: null,     status: 'assigned' }
        : { production_mode: 'outsource', outsource_ledger_id: vendorId, status: 'assigned' };
      const { error: updErr } = await sb.from('pavu').update(payload).eq('id', b.id);
      if (updErr) {
        patch(job.id, { saving: false, error: `Beam ${b.beam_no}: ${updErr.message}` });
        return;
      }
    }
    // Sync each beam — outsource beams get their mirror row upserted
    // (with per-beam weaver), in-house beams get theirs removed.
    const sync = await syncWarpBeamFromPavus(sb, job.beams.map((b) => b.id));
    if (!sync.ok) { patch(job.id, { saving: false, error: 'Pavu saved, warp-given sync failed: ' + (sync.error ?? '') }); return; }
    patch(job.id, { saving: false, saved: true });
    router.refresh();
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left  px-4 py-3">Job</th>
            <th className="text-left  px-4 py-3 hidden md:table-cell">Set No</th>
            <th className="text-right px-4 py-3">Beams</th>
            <th className="text-right px-4 py-3">Total Warp (m)</th>
            <th className="text-left  px-4 py-3">Current</th>
            <th className="text-left  px-4 py-3">Mode &amp; weaver</th>
            <th className="text-right px-4 py-3 w-24"></th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-soft">
                No sizing jobs with beams yet.
              </td>
            </tr>
          ) : jobs.map((j) => {
            // Fall back to a fresh derived state for any job whose
            // entry is missing — covers prop changes after the
            // initial mount (e.g. router.refresh()).
            const s = state[j.id] ?? deriveInitialState(j);
            const showOutsourceControls = s.mode === 'outsource';
            const showBeamRows = showOutsourceControls && s.scope === 'beam_wise' && s.expanded;
            return (
              <tr key={j.id} className="border-t border-line/40 align-top">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{j.job_code}</td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs text-ink-soft">{j.set_no ?? '—'}</td>
                <td className="px-4 py-3 text-right num">{j.beam_count}</td>
                <td className="px-4 py-3 text-right num">{fmtMetres(j.total_warp_metres)}</td>
                <td className="px-4 py-3 text-xs">
                  {j.current_mode == null ? (
                    <span className="text-ink-mute">—</span>
                  ) : j.current_mode === 'mixed' ? (
                    <span className="pill bg-amber-50 text-amber-700">Mixed</span>
                  ) : j.current_mode === 'in_house' ? (
                    <span className="pill bg-indigo-50 text-indigo-700">All in-house</span>
                  ) : (
                    <span className="pill bg-amber-50 text-amber-700">
                      All outsource{j.current_vendor_name ? ' · ' + j.current_vendor_name : ''}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 space-y-2">
                  {/* Mode + scope picker row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={s.mode}
                      onChange={(e) => {
                        const nextMode = e.target.value as ProdMode;
                        patch(j.id, {
                          mode: nextMode,
                          // Reset vendor selections when flipping away
                          // from outsource so the form doesn't ship
                          // stale values back to the server.
                          vendorId: nextMode === 'outsource' ? s.vendorId : '',
                          saved: false,
                        });
                      }}
                      className="input py-1 text-xs min-w-[120px]"
                    >
                      <option value="in_house">In-house</option>
                      <option value="outsource">Outsource</option>
                    </select>

                    {showOutsourceControls && (
                      <select
                        value={s.scope}
                        onChange={(e) => {
                          const nextScope = e.target.value as Scope;
                          patch(j.id, {
                            scope: nextScope,
                            expanded: nextScope === 'beam_wise',
                            saved: false,
                          });
                        }}
                        className="input py-1 text-xs min-w-[140px]"
                      >
                        <option value="whole">Whole job</option>
                        <option value="beam_wise">Beam-wise</option>
                      </select>
                    )}

                    {showOutsourceControls && s.scope === 'whole' && (
                      <select
                        value={s.vendorId}
                        onChange={(e) => patch(j.id, { vendorId: e.target.value, saved: false })}
                        className="input py-1 text-xs min-w-[180px]"
                      >
                        <option value="">Select weaver…</option>
                        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    )}

                    {showOutsourceControls && s.scope === 'beam_wise' && (
                      <button
                        type="button"
                        onClick={() => patch(j.id, { expanded: !s.expanded })}
                        className="btn-ghost text-xs inline-flex items-center gap-1"
                      >
                        {s.expanded
                          ? <><ChevronDown className="w-3 h-3" /> Hide beams</>
                          : <><ChevronRight className="w-3 h-3" /> Show beams</>}
                      </button>
                    )}
                  </div>

                  {/* Per-beam grid — only shown in beam-wise mode */}
                  {showBeamRows && (
                    <div className="rounded-md border border-line/60 bg-cloud/30 p-2 mt-2">
                      <div className="text-[10px] uppercase tracking-wide text-ink-mute mb-1">
                        Set {j.set_no ?? j.job_code} · {j.beams.length} beam{j.beams.length === 1 ? '' : 's'}
                      </div>
                      <div className="space-y-1">
                        {j.beams.map((b) => (
                          <div key={b.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono w-16 inline-block">#{b.beam_no}</span>
                            <span className="text-ink-mute w-24 inline-block">
                              {b.ends} ends · {b.meters.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m
                            </span>
                            <select
                              value={s.beamVendorIds[b.id] ?? ''}
                              onChange={(e) => setBeamVendor(j.id, b.id, e.target.value)}
                              className="input py-1 text-xs flex-1 min-w-[180px]"
                            >
                              <option value="">Keep in-house</option>
                              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {s.error && (
                    <div className="text-rose-700 text-[10px]" title={s.error}>{s.error}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => void handleSave(j)}
                    disabled={s.saving}
                    className="btn-primary text-xs py-1 px-3 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {s.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {s.saved ? 'Saved' : 'Save'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
