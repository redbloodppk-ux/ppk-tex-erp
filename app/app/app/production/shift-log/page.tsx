'use client';
/**
 * Shift Production Log — record per-loom output for a date + shift.
 *
 * Flow:
 *   1. Pick a date (default today) and a shift (day / night).
 *   2. Looms are split across 4 shed tabs. For each loom you can list one or
 *      more weavers, each with the metres THEY personally wove on that loom
 *      this shift. The "Total" cell sums the weaver metres for that loom.
 *   3. Default is 2 weaver slots per loom; press "+ Add weaver" on a row to
 *      add more (no fixed cap).
 *   4. One Save writes every loom row across all sheds for that date + shift.
 *
 * Rows where no weaver was picked are skipped on save. Existing rows for the
 * chosen date + shift are loaded so edits overwrite them.
 *
 * Schema (after migration 041):
 *   production_shift_log         — one row per (date, shift, loom)
 *   production_shift_log_weaver  — one row per weaver on that loom-shift,
 *                                  carrying that weaver's metres_woven.
 *
 * The Night shift is only offered when the `shift_log_night_enabled` setting
 * is on (Settings -> Shift settings).
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Save, CheckCircle2, Plus, X } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type ShiftLogInsert = Database['public']['Tables']['production_shift_log']['Insert'];
type ShiftLogWeaverInsert =
  Database['public']['Tables']['production_shift_log_weaver']['Insert'];

interface Loom {
  id: number;
  loom_code: string;
  loom_type: string;
  status: string;
  shed_no: number | null;
}

interface WeaverOption {
  id: number;
  code: string;
  full_name: string;
}

interface WeaverEntry {
  employee_id: string;
  metres: string;
}

interface RowState {
  loom_id: number;
  loom_code: string;
  loom_type: string;
  shed_no: number | null;
  weavers: WeaverEntry[];
}

const SHEDS = [1, 2, 3, 4] as const;
const DEFAULT_WEAVER_SLOTS = 2;

const today = (): string => new Date().toISOString().slice(0, 10);

function blankWeaver(): WeaverEntry {
  return { employee_id: '', metres: '' };
}

function blankRow(loom: Loom): RowState {
  return {
    loom_id: loom.id,
    loom_code: loom.loom_code,
    loom_type: loom.loom_type,
    shed_no: loom.shed_no,
    weavers: Array.from({ length: DEFAULT_WEAVER_SLOTS }, blankWeaver),
  };
}

function rowTotal(r: RowState): number {
  return r.weavers.reduce((sum, w) => {
    const n = Number(w.metres);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

function isRowBlank(r: RowState): boolean {
  return r.weavers.every(
    (w) => w.employee_id === '' && w.metres.trim() === '',
  );
}

export default function ShiftLogPage(): React.ReactElement {
  const supabase = createClient();

  const [logDate, setLogDate] = useState<string>(today());
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [nightEnabled, setNightEnabled] = useState<boolean>(false);
  const [activeShed, setActiveShed] = useState<number>(1);

  const [looms, setLooms] = useState<Loom[]>([]);
  const [weaverOptions, setWeaverOptions] = useState<WeaverOption[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Load loom list, weaver list and the night-shift setting once.
  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: loomData, error: loomErr }, { data: empData }, { data: cfgData }] =
        await Promise.all([
          supabase
            .from('loom')
            .select('id, loom_code, loom_type, status, shed_no')
            .order('loom_code'),
          // role + status casts via any because employee role/status types lag.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from('employee')
            .select('id, code, full_name')
            .eq('role', 'weaver')
            .eq('status', 'active')
            .order('full_name'),
          supabase
            .from('system_config')
            .select('value')
            .eq('key', 'shift_log_night_enabled')
            .maybeSingle(),
        ]);
      if (!active) return;
      if (loomErr) {
        setError(loomErr.message);
        setLoading(false);
        return;
      }
      setLooms((loomData ?? []) as Loom[]);
      setWeaverOptions((empData ?? []) as WeaverOption[]);

      const v = (cfgData as { value: { enabled?: boolean } | null } | null)?.value;
      const on = Boolean(v?.enabled);
      setNightEnabled(on);
      if (!on) setShift('day');
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

    const { data: parents, error: parentErr } = await supabase
      .from('production_shift_log')
      .select('id, loom_id')
      .eq('log_date', logDate)
      .eq('shift', shift);

    if (parentErr) {
      setError(parentErr.message);
      setLoading(false);
      return;
    }

    const parentIds = (parents ?? []).map((p) => p.id);
    let kids: Array<{
      shift_log_id: number;
      employee_id: number;
      position: number;
      metres_woven: number;
    }> = [];

    if (parentIds.length > 0) {
      const { data: kidData, error: kidErr } = await supabase
        .from('production_shift_log_weaver')
        .select('shift_log_id, employee_id, position, metres_woven')
        .in('shift_log_id', parentIds)
        .order('position');
      if (kidErr) {
        setError(kidErr.message);
        setLoading(false);
        return;
      }
      kids = (kidData ?? []) as typeof kids;
    }

    const loomByParent = new Map<number, number>();
    for (const p of parents ?? []) loomByParent.set(p.id, p.loom_id);

    const weaversByLoom = new Map<number, WeaverEntry[]>();
    for (const k of kids) {
      const loomId = loomByParent.get(k.shift_log_id);
      if (loomId == null) continue;
      const arr = weaversByLoom.get(loomId) ?? [];
      arr.push({
        employee_id: String(k.employee_id),
        metres: String(k.metres_woven ?? ''),
      });
      weaversByLoom.set(loomId, arr);
    }

    setRows(
      looms.map((loom) => {
        const existing = weaversByLoom.get(loom.id);
        if (!existing || existing.length === 0) return blankRow(loom);
        const slots: WeaverEntry[] = [...existing];
        while (slots.length < DEFAULT_WEAVER_SLOTS) slots.push(blankWeaver());
        return {
          loom_id: loom.id,
          loom_code: loom.loom_code,
          loom_type: loom.loom_type,
          shed_no: loom.shed_no,
          weavers: slots,
        };
      }),
    );
    setLoading(false);
  }, [supabase, looms, logDate, shift]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  function updateWeaver(
    loomId: number,
    idx: number,
    patch: Partial<WeaverEntry>,
  ): void {
    setRows((prev) =>
      prev.map((r) => {
        if (r.loom_id !== loomId) return r;
        const next = r.weavers.map((w, i) => (i === idx ? { ...w, ...patch } : w));
        return { ...r, weavers: next };
      }),
    );
    setSavedMsg(null);
  }

  function addWeaverSlot(loomId: number): void {
    setRows((prev) =>
      prev.map((r) =>
        r.loom_id === loomId ? { ...r, weavers: [...r.weavers, blankWeaver()] } : r,
      ),
    );
    setSavedMsg(null);
  }

  function removeWeaverSlot(loomId: number, idx: number): void {
    setRows((prev) =>
      prev.map((r) => {
        if (r.loom_id !== loomId) return r;
        if (r.weavers.length <= DEFAULT_WEAVER_SLOTS) {
          const next = r.weavers.map((w, i) => (i === idx ? blankWeaver() : w));
          return { ...r, weavers: next };
        }
        return { ...r, weavers: r.weavers.filter((_, i) => i !== idx) };
      }),
    );
    setSavedMsg(null);
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setSavedMsg(null);

    const parentsToSave: ShiftLogInsert[] = [];
    const childrenByLoom = new Map<number, ShiftLogWeaverInsert[]>();

    for (const r of rows) {
      if (isRowBlank(r)) continue;

      const picked = r.weavers
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => w.employee_id !== '');

      if (picked.length === 0) {
        setError(`Loom ${r.loom_code}: pick at least one weaver, or clear the row.`);
        return;
      }

      const ids = picked.map(({ w }) => w.employee_id);
      if (new Set(ids).size !== ids.length) {
        setError(`Loom ${r.loom_code}: the same weaver is listed twice.`);
        return;
      }

      const children: ShiftLogWeaverInsert[] = [];
      for (let pos = 0; pos < picked.length; pos++) {
        const cur = picked[pos];
        if (!cur) continue;
        const { w } = cur;
        const m = w.metres.trim() === '' ? 0 : Number(w.metres);
        if (!Number.isFinite(m) || m < 0) {
          setError(`Loom ${r.loom_code}: metres must be 0 or more for every weaver.`);
          return;
        }
        children.push({
          shift_log_id: 0,
          employee_id: Number(w.employee_id),
          position: pos + 1,
          metres_woven: m,
        });
      }

      parentsToSave.push({
        log_date: logDate,
        shift,
        loom_id: r.loom_id,
      });
      childrenByLoom.set(r.loom_id, children);
    }

    if (parentsToSave.length === 0) {
      setError('Nothing to save - pick at least one weaver on any loom.');
      return;
    }

    setSaving(true);

    const { data: upserted, error: upErr } = await supabase
      .from('production_shift_log')
      .upsert(parentsToSave, { onConflict: 'log_date,shift,loom_id' })
      .select('id, loom_id');

    if (upErr) {
      setSaving(false);
      setError(upErr.message);
      return;
    }

    const idByLoom = new Map<number, number>();
    for (const p of upserted ?? []) idByLoom.set(p.loom_id, p.id);

    const parentIds = Array.from(idByLoom.values());
    if (parentIds.length > 0) {
      const { error: delErr } = await supabase
        .from('production_shift_log_weaver')
        .delete()
        .in('shift_log_id', parentIds);
      if (delErr) {
        setSaving(false);
        setError(delErr.message);
        return;
      }
    }

    const childRows: ShiftLogWeaverInsert[] = [];
    for (const [loomId, kids] of childrenByLoom.entries()) {
      const parentId = idByLoom.get(loomId);
      if (parentId == null) continue;
      for (const k of kids) childRows.push({ ...k, shift_log_id: parentId });
    }

    if (childRows.length > 0) {
      const { error: insErr } = await supabase
        .from('production_shift_log_weaver')
        .insert(childRows);
      if (insErr) {
        setSaving(false);
        setError(insErr.message);
        return;
      }
    }

    setSaving(false);
    setSavedMsg(
      `Saved ${parentsToSave.length} loom row${parentsToSave.length === 1 ? '' : 's'} ` +
        `with ${childRows.length} weaver assignment${childRows.length === 1 ? '' : 's'}.`,
    );
  }

  const visibleRows = rows.filter((r) => (r.shed_no ?? 0) === activeShed);

  const shedTotal = visibleRows.reduce((sum, r) => sum + rowTotal(r), 0);

  return (
    <div>
      <PageHeader
        title="Shift Production Log"
        subtitle="Record per-weaver metres for each loom and shift."
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
          {nightEnabled && (
            <div>
              <span className="label">Shift</span>
              <div className="flex gap-2">
                {(['day', 'night'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setShift(s)}
                    className={
                      shift === s
                        ? 'btn-primary capitalize'
                        : 'btn-ghost capitalize'
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

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
            Loading looms...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Loom</th>
                  <th className="py-2 pr-3">Weavers (name + metres)</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-ink-soft">
                      No looms in Shed {activeShed}.
                    </td>
                  </tr>
                )}
                {visibleRows.map((r) => {
                  const total = rowTotal(r);
                  return (
                    <tr
                      key={r.loom_id}
                      className="border-b border-line/60 align-top"
                    >
                      <td className="py-2 pr-3">
                        <div className="font-medium">{r.loom_code}</div>
                        <div className="text-xs text-ink-mute">{r.loom_type}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="space-y-1.5">
                          {r.weavers.map((w, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-1.5"
                            >
                              <span className="w-5 text-xs text-ink-mute text-right">
                                {idx + 1}.
                              </span>
                              <select
                                className="input w-44"
                                value={w.employee_id}
                                onChange={(e) =>
                                  updateWeaver(r.loom_id, idx, {
                                    employee_id: e.target.value,
                                  })
                                }
                              >
                                <option value="">- pick weaver -</option>
                                {weaverOptions.map((opt) => (
                                  <option key={opt.id} value={String(opt.id)}>
                                    {opt.full_name}
                                    {opt.code ? ` (${opt.code})` : ''}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="input num w-24"
                                placeholder="metres"
                                value={w.metres}
                                onChange={(e) =>
                                  updateWeaver(r.loom_id, idx, {
                                    metres: e.target.value,
                                  })
                                }
                              />
                              <button
                                type="button"
                                aria-label="Remove weaver"
                                className="text-ink-mute hover:text-rose-600 p-1"
                                onClick={() => removeWeaverSlot(r.loom_id, idx)}
                                disabled={
                                  r.weavers.length <= DEFAULT_WEAVER_SLOTS &&
                                  w.employee_id === '' &&
                                  w.metres.trim() === ''
                                }
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addWeaverSlot(r.loom_id)}
                            className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add weaver
                          </button>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right num font-semibold">
                        {total > 0 ? `${total.toLocaleString('en-IN')} m` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-ink-soft">
                  <td className="py-2 pr-3 font-medium" colSpan={2}>
                    Shed {activeShed} total
                  </td>
                  <td className="py-2 pr-3 text-right font-medium">
                    {shedTotal.toLocaleString('en-IN')} m
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={() => void handleSave()}
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
