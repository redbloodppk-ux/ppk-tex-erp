'use client';
/**
 * Pavu list — editable per-row Mode + Weaver/Jobwork Party.
 *
 * The Pavu Master page renders this component three times (once per
 * tab) so the operator sees only In-house, only Outsource, or only
 * Jobwork pavu rows at a time. Each row carries inline controls to
 * flip its Mode and pick an Outsource Weaver or Jobwork Party. Saving
 * the row UPDATEs the pavu and runs the warp-beam-given sync helper,
 * so the corresponding entry on /app/outsource or /app/jobwork →
 * Warp Beam Given is created / updated / deleted to match.
 */
import { Fragment, useState } from 'react';
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
  // Wider than `ProdMode`: this reflects the actual DB column, which
  // may still hold a legacy 'jobwork' value from before this editor's
  // manual jobwork-routing mechanism was removed. `ProdMode` (used for
  // the row's editable Mode selection) intentionally excludes it.
  production_mode: 'in_house' | 'outsource' | 'jobwork';
  outsource_ledger_id: number | null;
  jobwork_ledger_id: number | null;
  sizing_job_code: string | null;
  /** Vendor SET NO from the sizing job — grouping label. */
  sizing_set_no: string | null;
  /** ISO date used to group rows (sizing date_sent, else created day). */
  group_date: string | null;
  warp_count_code: string | null;
  outsource_vendor_name: string | null;
  jobwork_vendor_name: string | null;
  /** Loom code this pavu is actively assigned to — shown next to the
   *  on-loom status pill. Null when not mounted. */
  loom_code: string | null;
}

export interface WeavingVendor {
  id: number;
  name: string;
}

interface Props {
  rows:           ReadonlyArray<PavuRow>;
  vendors:        ReadonlyArray<WeavingVendor>;
  /** Which tab this list belongs to — drives the empty-state text
   *  and the row-mode header pill. */
  scope:   'inhouse' | 'outsource' | 'jobwork';
}

interface RowState {
  mode:          ProdMode;
  vendorId:      string;
  saving:   boolean;
  error:    string | null;
  saved:    boolean;
  dirty:    boolean;
  /** True while a status change (in stock ⇄ finished) is in flight. */
  finishing: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  assigned: 'bg-amber-50 text-amber-700',
  on_loom:  'bg-indigo-50 text-indigo-700',
  finished: 'bg-slate-100 text-slate-600',
  damaged:  'bg-rose-50 text-rose-700',
  scrapped: 'bg-orange-50 text-orange-700',
};

/** Colours for the editable status <select> — same palette as the
 *  read-only pills so a beam's status is recognisable at a glance. */
const STATUS_SELECT_STYLE: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  assigned: 'bg-amber-50 text-amber-800 border-amber-300',
  finished: 'bg-slate-100 text-slate-600 border-slate-300',
  damaged:  'bg-rose-50 text-rose-700 border-rose-300',
  scrapped: 'bg-orange-50 text-orange-700 border-orange-300',
};

// Statuses the operator can set directly from this table. `on_loom`
// is deliberately absent — mounting/unmounting happens on Loom View
// so the loom assignment records stay consistent.
const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'finished', label: 'Finished' },
  { value: 'damaged',  label: 'Damaged' },
  { value: 'scrapped', label: 'Scrapped' },
];

// Lifted to module scope so it's defined before the component's
// useState initializer runs, regardless of hoisting subtleties.
function defaultStateFor(r: PavuRow): RowState {
  return {
    mode:           r.production_mode === 'jobwork' ? 'in_house' : r.production_mode,
    vendorId:       r.outsource_ledger_id != null ? String(r.outsource_ledger_id) : '',
    saving:   false,
    error:    null,
    saved:    false,
    dirty:    false,
    finishing: false,
  };
}

/** dd-mm-yyyy from an ISO date string, for the group headers. */
function fmtGroupDate(d: string | null): string {
  if (!d) return 'No date';
  const parts = d.slice(0, 10).split('-');
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

interface PavuGroup {
  key:      string;
  date:     string | null;
  set_no:   string | null;
  job_code: string | null;
  rows:     PavuRow[];
}

/** Group rows by sizing bill date + set no (falling back to job code),
 *  then order groups newest-bill-date first (undated groups last). */
function groupRows(rows: ReadonlyArray<PavuRow>): PavuGroup[] {
  const groups: PavuGroup[] = [];
  const byKey = new Map<string, PavuGroup>();
  for (const r of rows) {
    const key = `${r.group_date ?? ''}|${r.sizing_set_no ?? r.sizing_job_code ?? 'none'}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, date: r.group_date, set_no: r.sizing_set_no, job_code: r.sizing_job_code, rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  groups.sort((a, b) => {
    // ISO yyyy-mm-dd strings compare correctly as text.
    const da = a.date ?? '';
    const db = b.date ?? '';
    if (da !== db) return db.localeCompare(da);
    // Same date: keep higher set no on top.
    return Number(b.set_no ?? 0) - Number(a.set_no ?? 0);
  });
  return groups;
}

export function PavuListEditor({ rows, vendors, scope }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  // Optimistic status per row: shown the instant the operator picks a
  // new status, before the server round-trip / router.refresh lands.
  const [statusOverride, setStatusOverride] = useState<Record<number, string>>({});

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
        production_mode: 'in_house', outsource_ledger_id: null, jobwork_ledger_id: null,
        sizing_job_code: null, sizing_set_no: null, group_date: null,
        warp_count_code: null, outsource_vendor_name: null, jobwork_vendor_name: null,
        loom_code: null,
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
    // Setting a routing on any side flips status to 'assigned' — the
    // operator has now committed to in-house, outsource, or jobwork.
    // The sync helper below also sets it for outsource/jobwork, but
    // for in-house we need to handle it here because the helper
    // deletes the mirror row and returns without touching pavu.status.
    const payload = s.mode === 'in_house'
      ? { production_mode: 'in_house',  outsource_ledger_id: null,              jobwork_ledger_id: null, status: 'assigned' }
      : { production_mode: 'outsource', outsource_ledger_id: Number(s.vendorId), jobwork_ledger_id: null, status: 'assigned' };
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

  /** Change a beam's status from the Status dropdown. Optimistic: the
   *  UI flips immediately via `statusOverride`, then the DB update
   *  runs; on failure the previous value is restored and the error is
   *  shown in the row. Plain status change — no routing / warp-given
   *  sync involved. */
  async function handleSetStatus(row: PavuRow, status: string): Promise<void> {
    const prevStatus = statusOverride[row.id] ?? row.status;
    setStatusOverride((m) => ({ ...m, [row.id]: status }));
    patch(row.id, { finishing: true, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('pavu').update({ status }).eq('id', row.id);
    if (error) {
      setStatusOverride((m) => ({ ...m, [row.id]: prevStatus }));
      patch(row.id, { finishing: false, error: error.message });
      return;
    }
    patch(row.id, { finishing: false });
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center text-ink-soft text-sm">
        No {scope === 'inhouse' ? 'in-house' : scope === 'outsource' ? 'outsource' : 'jobwork'} pavu rows yet.
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
          {groupRows(rows).map((g) => (
            <Fragment key={g.key}>
              {/* Group header — one per sizing date / set no */}
              <tr className="bg-cloud/50 border-t border-line/60">
                <td colSpan={scope === 'outsource' ? 10 : 9} className="px-4 py-1.5 text-[11px] font-semibold text-ink-soft">
                  <span className="text-ink">{fmtGroupDate(g.date)}</span>
                  <span className="mx-1.5 text-ink-mute">·</span>
                  Set No <span className="font-mono text-ink">{g.set_no ?? '—'}</span>
                  {g.job_code && (
                    <>
                      <span className="mx-1.5 text-ink-mute">·</span>
                      <span className="font-mono text-ink-mute">{g.job_code}</span>
                    </>
                  )}
                  <span className="mx-1.5 text-ink-mute">·</span>
                  {g.rows.length} beam{g.rows.length === 1 ? '' : 's'}
                  <span className="mx-1.5 text-ink-mute">·</span>
                  {g.rows.reduce((s, r) => s + Number(r.meters ?? 0), 0).toFixed(0)} m
                </td>
              </tr>
              {(() => {
                // Beam position within the set (#3/14): rank rows of this
                // group by numeric beam no, matching the Assign modal.
                const order = [...g.rows].sort((a, b) => {
                  const na = Number(a.beam_no); const nb = Number(b.beam_no);
                  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
                  return a.beam_no.localeCompare(b.beam_no);
                });
                const posById = new Map(order.map((r, i) => [r.id, i + 1]));
                // Rows are always listed in beam-no order so the set reads
                // top-to-bottom as #1/#2/#3...
                return order.map((r) => {
            const s = state[r.id] ?? defaultStateFor(r);
            const displayStatus = statusOverride[r.id] ?? r.status;
            // Outsource/Jobwork-assigned pavus are locked: the routing
            // decision has already gone out to the weaver/party and
            // reversing it has to happen through a release on the
            // matching Warp Beam Given page so the audit trail (and
            // the warp-given table) stay consistent.
            const isLocked =
              (r.production_mode === 'outsource' || r.production_mode === 'jobwork') && r.status === 'assigned';
            return (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60 align-middle">
                <td className="px-4 py-2 font-mono text-xs font-semibold text-ink">{r.pavu_code}</td>
                <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                  {r.beam_no}
                  <span className="ml-1.5 text-ink-mute">#{posById.get(r.id)}/{g.rows.length}</span>
                </td>
                <td className="px-4 py-2 hidden md:table-cell font-mono text-xs text-ink-soft">{r.sizing_job_code ?? '—'}</td>
                <td className="px-4 py-2 hidden lg:table-cell text-ink-soft">{r.warp_count_code ?? '—'}</td>
                <td className="px-4 py-2 text-right num">{r.ends}</td>
                <td className="px-4 py-2 text-right num">{Number(r.meters).toFixed(0)}</td>
                <td className="px-4 py-2">
                  {isLocked ? (
                    <div className="input py-1 text-xs min-w-[110px] bg-cloud/40 text-ink-mute select-none flex items-center gap-1">
                      <Lock className="w-3 h-3" /> {r.production_mode === 'outsource' ? 'Outsource' : 'Jobwork'}
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
                  {/* Editable status — dropdown saves on change with an
                      instant optimistic flip. Routing-locked rows and
                      mounted (on-loom) beams stay read-only: locked
                      rows are released via Warp Beam Given, mounted
                      beams via Loom View. */}
                  {isLocked || displayStatus === 'on_loom' ? (
                    <span className={`pill ${STATUS_STYLE[displayStatus] ?? 'bg-slate-100 text-slate-600'}`}>
                      {displayStatus.replace('_', ' ')}
                      {displayStatus === 'on_loom' && r.loom_code ? ` · ${r.loom_code}` : ''}
                    </span>
                  ) : (
                    <div>
                      <select
                        value={displayStatus}
                        onChange={(e) => void handleSetStatus(r, e.target.value)}
                        disabled={s.finishing}
                        className={`input py-1 text-xs min-w-[110px] font-medium disabled:opacity-60 ${STATUS_SELECT_STYLE[displayStatus] ?? ''}`}
                        title="Change beam status — saves immediately"
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                        {!STATUS_OPTIONS.some((o) => o.value === displayStatus) && (
                          <option value={displayStatus}>{displayStatus.replace('_', ' ')}</option>
                        )}
                      </select>
                      {s.finishing && (
                        <span className="block mt-0.5 text-[10px] text-ink-mute">Saving…</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {isLocked ? (
                    <span
                      className="text-[10px] text-ink-mute inline-flex items-center gap-1"
                      title={`Release this beam from /app/${r.production_mode === 'outsource' ? 'outsource' : 'jobwork'} → Warp Beam Given before editing`}
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
          });
              })()}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
