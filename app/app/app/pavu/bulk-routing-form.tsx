'use client';
/**
 * Pavu Master — Bulk Routing form.
 *
 * Shows one row per sizing job with its set no, beam count and total
 * warp metres. The operator picks a production mode (in-house /
 * outsource) and — when outsource is chosen — an outsource weaving
 * vendor. Clicking Save on a row updates the production_mode and
 * outsource_ledger_id on every pavu row belonging to that job, so
 * the routing decision applies to every beam at once.
 *
 * "Current" pill on each row reflects how the existing pavu rows
 * are routed:
 *   - "All in-house"          if every beam is in_house
 *   - "All outsource · Name"  if every beam is outsource to a single vendor
 *   - "Mixed"                 if the rows aren't unanimous
 *
 * Saving overwrites whatever was there. Loom-mounted beams keep
 * their loom assignment — only the production_mode and the
 * outsource vendor change.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save } from 'lucide-react';

type ProdMode = 'in_house' | 'outsource';

export interface BulkJobRow {
  id: number;
  job_code: string;
  set_no: string | null;
  beam_count: number;
  total_warp_metres: number;
  /** What every pavu row in the job currently uses. Null when the
   *  job has no beams yet or when rows are mixed. */
  current_mode: ProdMode | 'mixed' | null;
  /** Vendor id when current_mode = 'outsource' and unanimous. */
  current_vendor_id: number | null;
  current_vendor_name: string | null;
}

export interface WeavingVendor {
  id: number;
  name: string;
}

interface RowState {
  mode:      ProdMode;
  vendorId:  string;
  saving:    boolean;
  error:     string | null;
  saved:     boolean;
}

interface Props {
  jobs:    ReadonlyArray<BulkJobRow>;
  vendors: ReadonlyArray<WeavingVendor>;
}

function fmtMetres(v: number): string {
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function BulkRoutingForm({ jobs, vendors }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [state, setState] = useState<Record<number, RowState>>(() => {
    const init: Record<number, RowState> = {};
    for (const j of jobs) {
      init[j.id] = {
        mode:     j.current_mode === 'outsource' ? 'outsource' : 'in_house',
        vendorId: j.current_vendor_id != null ? String(j.current_vendor_id) : '',
        saving:   false,
        error:    null,
        saved:    false,
      };
    }
    return init;
  });

  function patch(jobId: number, patch: Partial<RowState>) {
    setState((prev) => ({ ...prev, [jobId]: { ...prev[jobId]!, ...patch } }));
  }

  async function handleSave(job: BulkJobRow): Promise<void> {
    const s = state[job.id];
    if (!s) return;
    if (s.mode === 'outsource' && !s.vendorId) {
      patch(job.id, { error: 'Pick an outsource weaver.' });
      return;
    }

    patch(job.id, { saving: true, error: null, saved: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: updErr } = await sb
      .from('pavu')
      .update({
        production_mode:     s.mode,
        outsource_ledger_id: s.mode === 'outsource' ? Number(s.vendorId) : null,
      })
      .eq('sizing_job_id', job.id);
    if (updErr) {
      patch(job.id, { saving: false, error: updErr.message });
      return;
    }
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
            <th className="text-left  px-4 py-3">Production mode</th>
            <th className="text-left  px-4 py-3">Outsource weaver</th>
            <th className="text-right px-4 py-3 w-24"></th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-soft">
                No sizing jobs with beams yet.
              </td>
            </tr>
          ) : jobs.map((j) => {
            const s = state[j.id]!;
            return (
              <tr key={j.id} className="border-t border-line/40 align-middle">
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
                <td className="px-4 py-3">
                  <select
                    value={s.mode}
                    onChange={(e) => patch(j.id, {
                      mode: e.target.value as ProdMode,
                      vendorId: e.target.value === 'outsource' ? s.vendorId : '',
                      saved: false,
                    })}
                    className="input py-1 text-xs"
                  >
                    <option value="in_house">In-house</option>
                    <option value="outsource">Outsource</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  {s.mode === 'outsource' ? (
                    <select
                      value={s.vendorId}
                      onChange={(e) => patch(j.id, { vendorId: e.target.value, saved: false })}
                      className="input py-1 text-xs min-w-[160px]"
                    >
                      <option value="">Select weaver…</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-ink-mute text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {s.error && (
                    <div className="text-rose-700 text-[10px] mb-1" title={s.error}>{s.error}</div>
                  )}
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
