'use client';
/**
 * Listing of every beam given to jobwork parties (mirrors /app/jobwork
 * → Warp beam given), shown on Pavu Master's Jobwork tab. Rows are
 * grouped by given date + sizing set no, and rows linked to a pavu get
 * an editable Status dropdown (updates the linked pavu row(s), same as
 * the In-house/Outsource tabs). Manual entries with no linked pavu
 * stay display-only; add/edit/split/delete still happens on
 * /app/jobwork.
 */
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface JobworkBeamRow {
  id: number;
  given_date: string;
  party_name: string;
  quality_name: string | null;
  warp_count_display: string | null;
  total_ends: number | null;
  beam_count: number;
  /** Beam no(s) of the linked pavu row(s) — empty for manual entries
   *  with no linked pavu. Shown in place of the beam count. */
  beam_nos: string[];
  metres: number;
  /** Pavu code(s) this beam is linked to, if any — empty for manual
   *  entries (jobwork entries don't always pick from Pavu). */
  pavu_codes: string[];
  /** Linked pavu row id(s) — status changes update these. */
  pavu_ids: number[];
  /** Current status of the linked pavu row ('in_stock' | 'on_loom' | 'finished' | 'damaged' | 'scrapped' | 'assigned'), or null if no pavu is linked (legacy manual entries). */
  pavu_status: string | null;
  /** Loom code(s) the linked pavu row(s) are actively assigned to —
   *  shown next to the on-loom status pill. Empty when not mounted. */
  loom_codes: string[];
  /** Free-text sizing set no supplied by the jobwork party, or null for legacy rows saved before this field existed. */
  sizing_set_no: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  on_loom:  'bg-indigo-50 text-indigo-700',
  finished: 'bg-slate-100 text-slate-600',
  damaged:  'bg-rose-50 text-rose-700',
  scrapped: 'bg-rose-50 text-rose-700',
};

// Statuses the operator can set directly from this table. `on_loom`
// is deliberately absent — mounting/unmounting happens on Loom View.
const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'finished', label: 'Finished' },
  { value: 'damaged',  label: 'Damaged' },
  { value: 'scrapped', label: 'Scrapped' },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface BeamGroup {
  key:    string;
  date:   string;
  set_no: string | null;
  rows:   JobworkBeamRow[];
}

/** Numeric beam no for sorting; rows without one sort last. */
function beamNoSortKey(r: JobworkBeamRow): number {
  const n = r.beam_nos.length > 0 ? Number(r.beam_nos[0]) : NaN;
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Group rows by given date + sizing set no. Within each group, rows
 *  are sorted by beam no ascending so the serial no (1, 2, 3…) runs in
 *  beam order. */
function groupRows(rows: ReadonlyArray<JobworkBeamRow>): BeamGroup[] {
  const groups: BeamGroup[] = [];
  const byKey = new Map<string, BeamGroup>();
  for (const r of rows) {
    const key = `${r.given_date}|${r.sizing_set_no ?? 'none'}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, date: r.given_date, set_no: r.sizing_set_no, rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  for (const g of groups) g.rows.sort((a, b) => beamNoSortKey(a) - beamNoSortKey(b));
  return groups;
}

interface RowUiState {
  saving: boolean;
  error:  string | null;
}

export function JobworkBeamsTable({ rows }: { rows: ReadonlyArray<JobworkBeamRow> }): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  // Optimistic status per WBG row: shown the instant the operator
  // picks a new status, before the server round-trip lands.
  const [statusOverride, setStatusOverride] = useState<Record<number, string>>({});
  const [ui, setUi] = useState<Record<number, RowUiState>>({});

  function patchUi(id: number, p: Partial<RowUiState>): void {
    setUi((prev) => ({ ...prev, [id]: { saving: false, error: null, ...prev[id], ...p } }));
  }

  /** Change the linked pavu row(s)' status from the Status dropdown.
   *  Optimistic; on failure the previous value is restored. */
  async function handleSetStatus(row: JobworkBeamRow, status: string): Promise<void> {
    if (row.pavu_ids.length === 0) return;
    const prevStatus = statusOverride[row.id] ?? row.pavu_status ?? 'in_stock';
    setStatusOverride((m) => ({ ...m, [row.id]: status }));
    patchUi(row.id, { saving: true, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('pavu').update({ status }).in('id', row.pavu_ids);
    if (error) {
      setStatusOverride((m) => ({ ...m, [row.id]: prevStatus }));
      patchUi(row.id, { saving: false, error: error.message });
      return;
    }
    patchUi(row.id, { saving: false });
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center text-ink-soft text-sm">
        No beams given to jobwork parties yet. Add one from{' '}
        <Link href="/app/jobwork" className="text-indigo underline">Job Work → Warp beam given</Link>.
      </div>
    );
  }

  const totalBeams = rows.reduce((s, r) => s + Number(r.beam_count ?? 0), 0);
  const totalMetres = rows.reduce((s, r) => s + Number(r.metres ?? 0), 0);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-right px-4 py-3">S.No</th>
            <th className="text-left  px-4 py-3">ID</th>
            <th className="text-left  px-4 py-3">Date</th>
            <th className="text-left  px-4 py-3">Jobwork Party</th>
            <th className="text-left  px-4 py-3 hidden md:table-cell">Quality</th>
            <th className="text-left  px-4 py-3 hidden lg:table-cell">Warp count</th>
            <th className="text-right px-4 py-3">Ends</th>
            <th className="text-right px-4 py-3">Beam No</th>
            <th className="text-right px-4 py-3">Metres</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left  px-4 py-3">Pavu Code</th>
          </tr>
        </thead>
        <tbody>
          {groupRows(rows).map((g) => (
            <Fragment key={g.key}>
              {/* Group header — one per given date / set no */}
              <tr className="bg-cloud/50 border-t border-line/60">
                <td colSpan={11} className="px-4 py-1.5 text-[11px] font-semibold text-ink-soft">
                  <span className="text-ink">{fmtDate(g.date)}</span>
                  <span className="mx-1.5 text-ink-mute">·</span>
                  Set No <span className="font-mono text-ink">{g.set_no ?? '—'}</span>
                  <span className="mx-1.5 text-ink-mute">·</span>
                  {g.rows.reduce((s, r) => s + Number(r.beam_count ?? 0), 0)} beam{g.rows.reduce((s, r) => s + Number(r.beam_count ?? 0), 0) === 1 ? '' : 's'}
                  <span className="mx-1.5 text-ink-mute">·</span>
                  {g.rows.reduce((s, r) => s + Number(r.metres ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} m
                </td>
              </tr>
              {g.rows.map((r, idx) => {
                const displayStatus = statusOverride[r.id] ?? r.pavu_status;
                const u = ui[r.id] ?? { saving: false, error: null };
                const canEdit = r.pavu_ids.length > 0 && displayStatus !== 'on_loom';
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60 align-middle">
                    {/* Serial within the date/set group, in beam-no order. */}
                    <td className="px-4 py-2 text-right num text-ink-mute">{idx + 1}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-mute">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
                    <td className="px-4 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                    <td className="px-4 py-2">{r.party_name}</td>
                    <td className="px-4 py-2 hidden md:table-cell text-ink-soft">{r.quality_name ?? '—'}</td>
                    <td className="px-4 py-2 hidden lg:table-cell text-ink-soft">{r.warp_count_display ?? '—'}</td>
                    <td className="px-4 py-2 text-right num">{r.total_ends ?? '—'}</td>
                    {/* Beam no of the linked pavu; manual entries with
                        no pavu fall back to the beam count. */}
                    <td className="px-4 py-2 text-right num font-semibold">
                      {r.beam_nos.length > 0 ? r.beam_nos.join(', ') : r.beam_count}
                    </td>
                    <td className="px-4 py-2 text-right num text-indigo-700 font-semibold">{r.metres.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2">
                      {/* Editable status when a pavu is linked — the
                          dropdown updates the linked pavu row(s), same
                          as the In-house/Outsource tabs. Mounted
                          (on-loom) beams stay read-only; manual
                          entries with no pavu have no status. */}
                      {canEdit ? (
                        <div>
                          <select
                            value={displayStatus ?? 'in_stock'}
                            onChange={(e) => void handleSetStatus(r, e.target.value)}
                            disabled={u.saving}
                            className="input py-1 text-xs min-w-[110px] disabled:opacity-60"
                            title="Change beam status — saves immediately"
                          >
                            {STATUS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                            {displayStatus != null && !STATUS_OPTIONS.some((o) => o.value === displayStatus) && (
                              <option value={displayStatus}>{displayStatus.replace('_', ' ')}</option>
                            )}
                          </select>
                          {u.saving && (
                            <span className="block mt-0.5 text-[10px] text-ink-mute">Saving…</span>
                          )}
                          {u.error && (
                            <span className="block mt-0.5 text-[10px] text-rose-700" title={u.error}>{u.error}</span>
                          )}
                        </div>
                      ) : displayStatus ? (
                        <span className={`pill ${STATUS_STYLE[displayStatus] ?? 'bg-slate-100 text-slate-600'}`}>
                          {displayStatus.replace('_', ' ')}
                          {displayStatus === 'on_loom' && r.loom_codes.length > 0
                            ? ` · ${r.loom_codes.join(', ')}`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.pavu_codes.length === 0 ? <span className="text-ink-mute">—</span> : r.pavu_codes.join(', ')}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
        <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
          <tr>
            <td colSpan={7} className="px-4 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
            <td className="px-4 py-3 text-right num font-bold">{totalBeams.toLocaleString('en-IN')} beams</td>
            <td className="px-4 py-3 text-right num font-bold text-indigo-700">{totalMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
