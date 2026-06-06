'use client';
/**
 * Pavu list — editable per-row Mode + Weaver.
 *
 * The Pavu Master page renders this component twice (once per tab) so
 * the operator sees only In-house or only Outsource pavu rows at a
 * time. Each row carries inline controls to flip its Mode and pick an
 * Outsource Weaver. Saving the row UPDATEs the pavu and runs the
 * warp-beam-given sync helper, so the corresponding entry on
 * /app/outsource → Warp Beam Given is created / updated / deleted to
 * match.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, Lock } from 'lucide-react';
import { syncWarpBeamFromPavu } from './sync-warp-beam';

type ProdMode = 'in_house' | 'outsource';

export interface PavuRow {
  id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  meters: number;
  status: string;
  production_mode: ProdMode;
  outsource_ledger_id: number | null;
  sizing_job_code: string | null;
  warp_count_code: string | null;
  outsource_vendor_name: string | null;
}

export interface WeavingVendor {
  id: number;
  name: string;
}

interface Props {
  rows:    ReadonlyArray<PavuRow>;
  vendors: ReadonlyArray<WeavingVendor>;
  /** Which tab this list belongs to — drives the empty-state text
   *  and the row-mode header pill. */
  scope:   'inhouse' | 'outsource';
}

interface RowState {
  mode:     ProdMode;
  vendorId: string;
  saving:   boolean;
  error:    string | null;
  saved:    boolean;
  dirty:    boolean;
}

const STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  on_loom:  'bg-indigo-50 text-indigo-700',
  finished: 'bg-slate-100 text-slate-600',
  damaged:  'bg-rose-50 text-rose-700',
  scrapped: 'bg-rose-50 text-rose-700',
};

// Lifted to module scope so it's defined before the component's
// useState initializer runs, regardless of hoisting subtleties.
function defaultStateFor(r: PavuRow): RowState {
  return {
    mode:     r.production_mode,
    vendorId: r.outsource_ledger_id != null ? String(r.outsource_ledger_id) : '',
    saving:   false,
    error:    null,
    saved:    false,
    dirty:    false,
  };
}

export function PavuListEditor({ rows, vendors, scope }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [state, setState] = useState<Record<number, RowState>>(() => {
    const init: Record<number, RowState> = {};
    for (const r of rows) {
      init[r.id] = defaultStateFor(r);
    }
    return init;
  });

  function patch(rowId: number, patch: Partial<RowState>) {
    setState((prev) => {
      const base = prev[rowId] ?? defaultStateFor(rows.find((x) => x.id === rowId) ?? {
        id: rowId, pavu_code: '', beam_no: '', ends: 0, meters: 0, status: '',
        production_mode: 'in_house', outsource_ledger_id: null,
        sizing_job_code: null, warp_count_code: null, outsource_vendor_name: null,
      });
      return { ...prev, [rowId]: { ...base, ...patch } };
    });
  }

  async function handleSave(row: PavuRow): Promise<void> {
    const s = state[row.id];
    if (!s) return;
    if (s.mode === 'outsource' && !s.vendorId) {
      patch(row.id, { error: 'Pick an outsource weaver (or switch to In-house).' });
      return;
    }

    patch(row.id, { saving: true, error: null, saved: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // 1. Update the pavu row first.
    // Setting a routing on either side flips status to 'assigned' —
    // the operator has now committed to in-house or outsource. The
    // sync helper below also sets it for outsource, but for in-house
    // we need to handle it here because the helper deletes the
    // mirror row and returns without touching pavu.status.
    const payload = s.mode === 'in_house'
      ? { production_mode: 'in_house',  outsource_ledger_id: null,            status: 'assigned' }
      : { production_mode: 'outsource', outsource_ledger_id: Number(s.vendorId), status: 'assigned' };
    const { error: updErr } = await sb.from('pavu').update(payload).eq('id', row.id);
    if (updErr) { patch(row.id, { saving: false, error: updErr.message }); return; }

    // 2. Sync the warp-beam-given mirror row. The helper handles the
    //    insert / update / delete decision based on the new state of
    //    the pavu row.
    const sync = await syncWarpBeamFromPavu(sb, row.id);
    if (!sync.ok) {
      patch(row.id, { saving: false, error: 'Pavu saved, warp-given sync failed: ' + (sync.error ?? '') });
      return;
    }

    patch(row.id, { saving: false, saved: true, dirty: false });
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center text-ink-soft text-sm">
        No {scope === 'inhouse' ? 'in-house' : 'outsource'} pavu rows yet.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left  px-4 py-3">Pavu Code</th>
            <th className="text-left  px-4 py-3">Beam No</th>
            <th className="text-left  px-4 py-3 hidden md:table-cell">From Job</th>
            <th className="text-left  px-4 py-3 hidden lg:table-cell">Count</th>
            <th className="text-right px-4 py-3">Ends</th>
            <th className="text-right px-4 py-3">Metres</th>
            <th className="text-left  px-4 py-3">Mode</th>
            {scope === 'outsource' && <th className="text-left px-4 py-3">Weaver</th>}
            <th className="text-left  px-4 py-3">Status</th>
            <th className="text-right px-4 py-3 w-24"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = state[r.id] ?? defaultStateFor(r);
            // Outsource-assigned pavus are locked: the routing
            // decision has already gone out to the weaver and
            // reversing it has to happen through a release on the
            // Outsource → Warp Beam Given page so the audit trail
            // (and the warp-given table) stay consistent.
            const isLocked = r.production_mode === 'outsource' && r.status === 'assigned';
            return (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60 align-middle">
                <td className="px-4 py-2 font-mono text-xs font-semibold text-ink">{r.pavu_code}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.beam_no}</td>
                <td className="px-4 py-2 hidden md:table-cell font-mono text-xs text-ink-soft">{r.sizing_job_code ?? '—'}</td>
                <td className="px-4 py-2 hidden lg:table-cell text-ink-soft">{r.warp_count_code ?? '—'}</td>
                <td className="px-4 py-2 text-right num">{r.ends}</td>
                <td className="px-4 py-2 text-right num">{Number(r.meters).toFixed(0)}</td>
                <td className="px-4 py-2">
                  {isLocked ? (
                    <div className="input py-1 text-xs min-w-[110px] bg-cloud/40 text-ink-mute select-none flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Outsource
                    </div>
                  ) : (
                    <select
                      value={s.mode}
                      onChange={(e) => patch(r.id, {
                        mode: e.target.value as ProdMode,
                        vendorId: e.target.value === 'outsource' ? s.vendorId : '',
                        saved: false,
                        dirty: true,
                      })}
                      className="input py-1 text-xs min-w-[110px]"
                    >
                      <option value="in_house">In-house</option>
                      <option value="outsource">Outsource</option>
                    </select>
                  )}
                </td>
                {scope === 'outsource' && (
                  <td className="px-4 py-2">
                    {isLocked ? (
                      <div className="input py-1 text-xs min-w-[160px] bg-cloud/40 text-ink-mute select-none">
                        {r.outsource_vendor_name ?? '—'}
                      </div>
                    ) : s.mode === 'outsource' ? (
                      <select
                        value={s.vendorId}
                        onChange={(e) => patch(r.id, { vendorId: e.target.value, saved: false, dirty: true })}
                        className="input py-1 text-xs min-w-[160px]"
                      >
                        <option value="">Select weaver…</option>
                        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-ink-mute text-xs">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-2">
                  <span className={`pill ${STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {isLocked ? (
                    <span
                      className="text-[10px] text-ink-mute inline-flex items-center gap-1"
                      title="Release this beam from /app/outsource → Warp Beam Given before editing"
                    >
                      <Lock className="w-3 h-3" /> Locked
                    </span>
                  ) : (
                    <>
                      {s.error && (
                        <div className="text-rose-700 text-[10px] mb-1" title={s.error}>{s.error}</div>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleSave(r)}
                        disabled={s.saving || !s.dirty}
                        className="btn-primary text-xs py-1 px-3 inline-flex items-center gap-1 disabled:opacity-40"
                      >
                        {s.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        {s.saved ? 'Saved' : 'Save'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
