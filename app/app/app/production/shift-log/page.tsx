'use client';
/**
 * Shift Production Log — record per-loom output for a date + shift.
 *
 * Flow:
 *   1. Pick a date (default today) and a shift (day / night).
 *   2. Looms are split across 4 shed tabs. For each loom enter:
 *        • metres woven (good metres only)
 *        • downtime minutes (0-720) + a reason if downtime > 0
 *        • weaver name (optional)
 *   3. One Save writes every non-blank row across all sheds for that
 *      date + shift.
 *
 * Rows left completely blank (no metres, no downtime, no weaver) are skipped.
 * Existing rows for the selected date + shift are loaded so edits overwrite
 * them via the (log_date, shift, loom_id) unique constraint.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Save, CheckCircle2 } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type ShiftLogInsert = Database['public']['Tables']['production_shift_log']['Insert'];

const DOWNTIME_REASONS = [
  { value: 'warp_break', label: 'Warp break' },
  { value: 'no_weft', label: 'No weft' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'power_cut', label: 'Power cut' },
  { value: 'other', label: 'Other' },
] as const;

interface Loom {
  id: number;
  loom_code: string;
  loom_type: string;
  status: string;
  shed_no: number | null;
}

interface RowState {
  loom_id: number;
  loom_code: string;
  loom_type: string;
  shed_no: number | null;
  metres_woven: string;
  downtime_minutes: string;
  downtime_reason: string;
  weaver_name: string;
}

const SHEDS = [1, 2, 3, 4] as const;

const today = (): string => new Date().toISOString().slice(0, 10);

function blankRow(loom: Loom): RowState {
  return {
    loom_id: loom.id,
    loom_code: loom.loom_code,
    loom_type: loom.loom_type,
    shed_no: loom.shed_no,
    metres_woven: '',
    downtime_minutes: '',
    downtime_reason: '',
    weaver_name: '',
  };
}

function isBlank(r: RowState): boolean {
  return (
    r.metres_woven.trim() === '' &&
    r.downtime_minutes.trim() === '' &&
    r.downtime_reason === '' &&
    r.weaver_name.trim() === ''
  );
}

export default function ShiftLogPage() {
  const supabase = createClient();

  const [logDate, setLogDate] = useState<string>(today());
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [activeShed, setActiveShed] = useState<number>(1);

  const [looms, setLooms] = useState<Loom[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Load the loom list once.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('loom')
        .select('id, loom_code, loom_type, status, shed_no')
        .order('loom_code');
      if (!active) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setLooms((data ?? []) as Loom[]);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // Load existing entries whenever date / shift / loom list changes.
  const loadEntries = useCallback(async () => {
    if (looms.length === 0) return;
    setLoading(true);
    setError(null);
    setSavedMsg(null);

    const { data, error: err } = await supabase
      .from('production_shift_log')
      .select('loom_id, metres_woven, downtime_minutes, downtime_reason, weaver_name')
      .eq('log_date', logDate)
      .eq('shift', shift);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const byLoom = new Map<number, (typeof data)[number]>();
    for (const e of data ?? []) byLoom.set(e.loom_id, e);

    setRows(
      looms.map((loom) => {
        const e = byLoom.get(loom.id);
        if (!e) return blankRow(loom);
        return {
          loom_id: loom.id,
          loom_code: loom.loom_code,
          loom_type: loom.loom_type,
          shed_no: loom.shed_no,
          metres_woven: e.metres_woven ? String(e.metres_woven) : '',
          downtime_minutes: e.downtime_minutes ? String(e.downtime_minutes) : '',
          downtime_reason: e.downtime_reason ?? '',
          weaver_name: e.weaver_name ?? '',
        };
      }),
    );
    setLoading(false);
  }, [supabase, looms, logDate, shift]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  function updateRow(loomId: number, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) => (r.loom_id === loomId ? { ...r, ...patch } : r)),
    );
    setSavedMsg(null);
  }

  async function handleSave() {
    setError(null);
    setSavedMsg(null);

    const toSave: ShiftLogInsert[] = [];

    for (const r of rows) {
      if (isBlank(r)) continue;

      const metres = r.metres_woven.trim() === '' ? 0 : Number(r.metres_woven);
      const downtime =
        r.downtime_minutes.trim() === '' ? 0 : Number(r.downtime_minutes);

      if (Number.isNaN(metres) || metres < 0) {
        setError(`Loom ${r.loom_code}: metres woven must be 0 or more.`);
        return;
      }
      if (Number.isNaN(downtime) || downtime < 0 || downtime > 720) {
        setError(
          `Loom ${r.loom_code}: downtime must be between 0 and 720 minutes.`,
        );
        return;
      }
      if (downtime > 0 && r.downtime_reason === '') {
        setError(`Loom ${r.loom_code}: pick a downtime reason.`);
        return;
      }
      if (downtime === 0 && r.downtime_reason !== '') {
        setError(
          `Loom ${r.loom_code}: clear the reason when downtime is 0, or enter downtime minutes.`,
        );
        return;
      }

      toSave.push({
        log_date: logDate,
        shift,
        loom_id: r.loom_id,
        metres_woven: metres,
        downtime_minutes: downtime,
        downtime_reason: downtime > 0 ? r.downtime_reason : null,
        weaver_name: r.weaver_name.trim() === '' ? null : r.weaver_name.trim(),
      });
    }

    if (toSave.length === 0) {
      setError('Nothing to save — enter at least one loom row.');
      return;
    }

    setSaving(true);
    const { error: err } = await supabase
      .from('production_shift_log')
      .upsert(toSave, { onConflict: 'log_date,shift,loom_id' });
    setSaving(false);

    if (err) {
      setError(err.message);
      return;
    }
    setSavedMsg(`Saved ${toSave.length} loom row${toSave.length === 1 ? '' : 's'}.`);
  }

  const visibleRows = rows.filter((r) => (r.shed_no ?? 0) === activeShed);

  const totalMetres = visibleRows.reduce((sum, r) => {
    const n = Number(r.metres_woven);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div>
      <PageHeader
        title="Shift Production Log"
        subtitle="Record per-loom metres and downtime for each shift."
        crumbs={[
          { label: 'Production', href: '/app/production' },
          { label: 'Shift Log' },
        ]}
      />

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label" htmlFor="log-date">
              Date
            </label>
            <input
              id="log-date"
              type="date"
              className="input"
              value={logDate}
              max={today()}
              onChange={(e) => setLogDate(e.target.value)}
            />
          </div>
          <div>
            <span className="label">Shift</span>
            <div className="flex gap-2">
              {(['day', 'night'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShift(s)}
                  className={
                    shift === s ? 'btn-primary capitalize' : 'btn-ghost capitalize'
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Shed tabs */}
        <div className="flex flex-wrap gap-1 border-b border-line/60">
          {SHEDS.map((s) => {
            const count = rows.filter((r) => (r.shed_no ?? 0) === s).length;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setActiveShed(s)}
                className={
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ' +
                  (activeShed === s
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-ink-mute hover:text-ink')
                }
              >
                Shed {s}
                <span className="ml-1.5 text-xs text-ink-mute">({count})</span>
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm text-err">{error}</p>}
        {savedMsg && (
          <p className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            {savedMsg}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-ink-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading looms…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Loom</th>
                  <th className="py-2 pr-3">Metres woven</th>
                  <th className="py-2 pr-3">Downtime (min)</th>
                  <th className="py-2 pr-3">Downtime reason</th>
                  <th className="py-2 pr-3">Weaver</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink-soft">
                      No looms in Shed {activeShed}.
                    </td>
                  </tr>
                )}
                {visibleRows.map((r) => (
                  <tr key={r.loom_id} className="border-b border-line/60">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.loom_code}</div>
                      <div className="text-xs text-ink-mute">{r.loom_type}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-28"
                        value={r.metres_woven}
                        onChange={(e) =>
                          updateRow(r.loom_id, { metres_woven: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        max={720}
                        step="1"
                        className="input num w-24"
                        value={r.downtime_minutes}
                        onChange={(e) =>
                          updateRow(r.loom_id, {
                            downtime_minutes: e.target.value,
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="input w-40"
                        value={r.downtime_reason}
                        onChange={(e) =>
                          updateRow(r.loom_id, {
                            downtime_reason: e.target.value,
                          })
                        }
                      >
                        <option value="">—</option>
                        {DOWNTIME_REASONS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-40"
                        value={r.weaver_name}
                        onChange={(e) =>
                          updateRow(r.loom_id, { weaver_name: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-ink-soft">
                  <td className="py-2 pr-3 font-medium">Shed {activeShed} total</td>
                  <td className="py-2 pr-3 font-medium">
                    {totalMetres.toLocaleString('en-IN')} m
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save shift log
          </button>
          <span className="text-xs text-ink-mute">
            Blank loom rows are skipped.
          </span>
        </div>
      </div>
    </div>
  );
}
