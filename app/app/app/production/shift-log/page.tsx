'use client';
/**
 * Shift Production Log — record per-loom output for a date + shift.
 *
 * Flow:
 *   1. Pick a date (default today) and a shift (day / night).
 *   2. The looms are split across 4 shed tabs. Each shed has a row of
 *      "global" weaver slots at the top — pick weaver 1, weaver 2, ... once
 *      and that picks the weaver for every loom in the shed at that slot.
 *      Press "+ Add weaver" on a shed to add more global slots.
 *   3. Each loom row below shows a metres input per global slot, plus an
 *      Adjustment column for free-form +/- corrections (cut metres, manual
 *      fix, etc.). Loom Total = sum(weavers) + adjustment.
 *   4. One Save writes every loom row across all sheds for that date + shift.
 *
 * Validation:
 *   - If a metres value is entered for a slot but no weaver is picked for
 *     that slot in the shed, save is blocked with a clear message.
 *   - Blank metres on a (weaver, loom) pair are silently skipped — we only
 *     persist actual woven entries.
 *   - A loom with only an adjustment (no weavers) still saves.
 *
 * Schema (after migrations 041 + 042):
 *   production_shift_log         — one row per (date, shift, loom), holds
 *                                  adjustment_metres
 *   production_shift_log_weaver  — one row per weaver on that loom-shift,
 *                                  carrying that weaver's metres_woven.
 *
 * The Night shift is only offered when the `shift_log_night_enabled` setting
 * is on (Settings -> Shift settings).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  /** Migration 079: date the loom went non-running. Shift log entries on
   *  or after this date lock the loom; entries before stay editable. */
  idle_since: string | null;
}

interface WeaverOption {
  id: number;
  code: string;
  full_name: string;
}

/** Shed-level state: one weaver per slot (employee_id), plus per-loom metres. */
interface ShedState {
  shed_no: number;
  /** Global weaver picks, indexed by slot. Empty string = not picked. */
  weavers: string[];
  /** Per-loom metres + adjustment input. */
  loomRows: LoomRow[];
}

interface LoomRow {
  loom_id: number;
  loom_code: string;
  loom_type: string;
  /** Loom status from Mill Setup (running / idle / maintenance / breakdown). */
  status: string;
  /** Date the loom went non-running. NULL when currently running. */
  idle_since: string | null;
  /** Aligned with the shed's weavers array. metres[i] = metres for slot i. */
  metres: string[];
  /** Free-form +/- correction. Empty string = 0. */
  adjustment: string;
}

/**
 * Whether a loom is editable on a given log date. A loom is editable when:
 *   - status is 'running' (always editable), OR
 *   - it's non-running but its idle_since is AFTER the log date (so on the
 *     log date the loom was still running historically).
 *
 * `idle_since` is the cutover - on/after that date the loom is locked.
 */
function isLoomEditableOn(
  row: { status: string; idle_since: string | null },
  logDate: string,
): boolean {
  if (row.status === 'running') return true;
  if (!row.idle_since) return false;
  // logDate < idle_since => the loom was still running on that date.
  return logDate < row.idle_since;
}

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'running':
      return { label: 'running', cls: 'bg-emerald-50 text-emerald-700' };
    case 'idle':
      return { label: 'idle', cls: 'bg-slate-100 text-slate-600' };
    case 'maintenance':
      return { label: 'maintenance', cls: 'bg-amber-50 text-amber-700' };
    case 'breakdown':
      return { label: 'breakdown', cls: 'bg-rose-50 text-rose-700' };
    default:
      return { label: status || '—', cls: 'bg-slate-100 text-slate-600' };
  }
}

const SHEDS = [1, 2, 3, 4] as const;
const DEFAULT_WEAVER_SLOTS = 2;

/** Enter moves focus to the NEXT metres/adjustment input in the shed
 *  table (DOM order: across the row, then down) instead of submitting
 *  the form — fast keyboard-only data entry. On the last input Enter
 *  does nothing, so a stray key press never triggers a save. */
function focusNextOnEnter(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const current = e.currentTarget;
  const scope: ParentNode = current.closest('table') ?? document;
  const inputs = Array.from(
    scope.querySelectorAll<HTMLInputElement>('input[type="number"]'),
  ).filter((el) => !el.disabled);
  const idx = inputs.indexOf(current);
  const next = idx >= 0 ? inputs[idx + 1] : undefined;
  if (next) {
    next.focus();
    next.select();
  }
}

const today = (): string => new Date().toISOString().slice(0, 10);

function emptyShed(shedNo: number, looms: Loom[]): ShedState {
  return {
    shed_no: shedNo,
    weavers: Array.from({ length: DEFAULT_WEAVER_SLOTS }, () => ''),
    loomRows: looms.map((l) => ({
      loom_id: l.id,
      loom_code: l.loom_code,
      loom_type: l.loom_type,
      status: l.status,
      idle_since: l.idle_since,
      metres: Array.from({ length: DEFAULT_WEAVER_SLOTS }, () => ''),
      adjustment: '',
    })),
  };
}

/** Parse a non-negative metres value; blank or invalid = 0. */
function parseMetres(v: string): number {
  const t = v.trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Parse a signed adjustment; blank = 0. Returns NaN if non-numeric. */
function parseAdjustment(v: string): number {
  const t = v.trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function loomTotal(row: LoomRow): number {
  const weavers = row.metres.reduce((s, m) => s + parseMetres(m), 0);
  const adj = parseAdjustment(row.adjustment);
  return weavers + (Number.isFinite(adj) ? adj : 0);
}

function shedTotal(s: ShedState): number {
  return s.loomRows.reduce((sum, r) => sum + loomTotal(r), 0);
}

export default function ShiftLogPage(): React.ReactElement {
  const supabase = createClient();

  const [logDate, setLogDate] = useState<string>(today());
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [nightEnabled, setNightEnabled] = useState<boolean>(false);
  const [activeShed, setActiveShed] = useState<number>(1);
  // Adjustment column is optional and per-shed — hidden by default, the
  // operator opts in for a given shed when a manual +/- correction is
  // needed (cut metres, fix, etc.). Stored as the set of shed numbers
  // that currently show the column.
  const [adjustmentSheds, setAdjustmentSheds] = useState<Set<number>>(new Set());
  const showAdjustment = adjustmentSheds.has(activeShed);

  const [looms, setLooms] = useState<Loom[]>([]);
  const [weaverOptions, setWeaverOptions] = useState<WeaverOption[]>([]);
  const [sheds, setSheds] = useState<ShedState[]>([]);

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
          // idle_since added in migration 079 - generated Supabase types lag,
          // cast through any so tsc accepts the select.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from('loom')
            .select('id, loom_code, loom_type, status, shed_no, idle_since')
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
      setLooms((loomData ?? []) as unknown as Loom[]);
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

  // Group looms by shed once they load.
  const loomsByShed = useMemo(() => {
    const map = new Map<number, Loom[]>();
    for (const s of SHEDS) map.set(s, []);
    for (const l of looms) {
      const n = l.shed_no ?? 0;
      if (!map.has(n)) continue;
      map.get(n)!.push(l);
    }
    return map;
  }, [looms]);

  // Load existing entries whenever date / shift / loom list changes.
  const loadEntries = useCallback(async () => {
    if (looms.length === 0) return;
    setLoading(true);
    setError(null);
    setSavedMsg(null);

    const { data: parents, error: parentErr } = await supabase
      .from('production_shift_log')
      .select('id, loom_id, adjustment_metres')
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
    const adjByLoom = new Map<number, number>();
    for (const p of parents ?? []) {
      loomByParent.set(p.id, p.loom_id);
      adjByLoom.set(p.loom_id, Number(p.adjustment_metres ?? 0));
    }

    // Per loom: map of position -> { employee_id, metres }
    const perLoom = new Map<number, Map<number, { employee_id: number; metres: number }>>();
    for (const k of kids) {
      const loomId = loomByParent.get(k.shift_log_id);
      if (loomId == null) continue;
      const lm = perLoom.get(loomId) ?? new Map();
      lm.set(k.position, { employee_id: k.employee_id, metres: Number(k.metres_woven ?? 0) });
      perLoom.set(loomId, lm);
    }

    // For each shed, find the global weaver slots by taking the union of
    // (position, employee_id) pairs across that shed's looms. We pick the
    // most common employee at each position; ties broken by lowest id.
    const next: ShedState[] = SHEDS.map((shedNo) => {
      const shedLooms = loomsByShed.get(shedNo) ?? [];
      // position -> Map<employee_id, count>
      const tally = new Map<number, Map<number, number>>();
      for (const l of shedLooms) {
        const lm = perLoom.get(l.id);
        if (!lm) continue;
        for (const [pos, v] of lm.entries()) {
          const t = tally.get(pos) ?? new Map<number, number>();
          t.set(v.employee_id, (t.get(v.employee_id) ?? 0) + 1);
          tally.set(pos, t);
        }
      }

      // Build the global slot list in position order (1, 2, 3, ...).
      const positions = [...tally.keys()].sort((a, b) => a - b);
      const weavers: string[] = [];
      for (const pos of positions) {
        const t = tally.get(pos)!;
        let bestId = 0;
        let bestCount = -1;
        for (const [empId, count] of t.entries()) {
          if (count > bestCount || (count === bestCount && empId < bestId)) {
            bestId = empId;
            bestCount = count;
          }
        }
        weavers.push(bestId > 0 ? String(bestId) : '');
      }
      while (weavers.length < DEFAULT_WEAVER_SLOTS) weavers.push('');

      // Build per-loom metres + adjustment.
      const slotCount = weavers.length;
      const loomRows: LoomRow[] = shedLooms.map((l) => {
        const metres = Array.from({ length: slotCount }, () => '');
        const lm = perLoom.get(l.id);
        if (lm) {
          positions.forEach((pos, slotIdx) => {
            const v = lm.get(pos);
            if (v && v.metres > 0) metres[slotIdx] = String(v.metres);
          });
        }
        const adj = adjByLoom.get(l.id) ?? 0;
        return {
          loom_id: l.id,
          loom_code: l.loom_code,
          loom_type: l.loom_type,
          status: l.status,
          idle_since: l.idle_since,
          metres,
          adjustment: adj !== 0 ? String(adj) : '',
        };
      });

      return { shed_no: shedNo, weavers, loomRows };
    });

    setSheds(next);

    // Reflect saved adjustments in the per-shed toggle: a shed that has
    // any non-zero saved adjustment opens its column automatically so the
    // operator sees it; sheds without one start collapsed.
    const shedsWithAdj = new Set<number>();
    for (const s of next) {
      if (s.loomRows.some((r) => r.adjustment.trim() !== '')) {
        shedsWithAdj.add(s.shed_no);
      }
    }
    setAdjustmentSheds(shedsWithAdj);

    setLoading(false);
  }, [supabase, looms, logDate, shift, loomsByShed]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  function updateShedWeaver(shedNo: number, slotIdx: number, employee_id: string): void {
    setSheds((prev) =>
      prev.map((s) => {
        if (s.shed_no !== shedNo) return s;
        const weavers = s.weavers.map((w, i) => (i === slotIdx ? employee_id : w));
        return { ...s, weavers };
      }),
    );
    setSavedMsg(null);
  }

  function updateLoomMetres(
    shedNo: number,
    loomId: number,
    slotIdx: number,
    value: string,
  ): void {
    setSheds((prev) =>
      prev.map((s) => {
        if (s.shed_no !== shedNo) return s;
        const loomRows = s.loomRows.map((r) => {
          if (r.loom_id !== loomId) return r;
          const metres = r.metres.map((m, i) => (i === slotIdx ? value : m));
          return { ...r, metres };
        });
        return { ...s, loomRows };
      }),
    );
    setSavedMsg(null);
  }

  function updateLoomAdjustment(shedNo: number, loomId: number, value: string): void {
    setSheds((prev) =>
      prev.map((s) => {
        if (s.shed_no !== shedNo) return s;
        const loomRows = s.loomRows.map((r) =>
          r.loom_id === loomId ? { ...r, adjustment: value } : r,
        );
        return { ...s, loomRows };
      }),
    );
    setSavedMsg(null);
  }

  function addShedSlot(shedNo: number): void {
    setSheds((prev) =>
      prev.map((s) => {
        if (s.shed_no !== shedNo) return s;
        return {
          ...s,
          weavers: [...s.weavers, ''],
          loomRows: s.loomRows.map((r) => ({ ...r, metres: [...r.metres, ''] })),
        };
      }),
    );
    setSavedMsg(null);
  }

  function removeShedSlot(shedNo: number, slotIdx: number): void {
    setSheds((prev) =>
      prev.map((s) => {
        if (s.shed_no !== shedNo) return s;
        // Never drop below 1 slot.
        if (s.weavers.length <= 1) {
          return {
            ...s,
            weavers: s.weavers.map((w, i) => (i === slotIdx ? '' : w)),
            loomRows: s.loomRows.map((r) => ({
              ...r,
              metres: r.metres.map((m, i) => (i === slotIdx ? '' : m)),
            })),
          };
        }
        return {
          ...s,
          weavers: s.weavers.filter((_, i) => i !== slotIdx),
          loomRows: s.loomRows.map((r) => ({
            ...r,
            metres: r.metres.filter((_, i) => i !== slotIdx),
          })),
        };
      }),
    );
    setSavedMsg(null);
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setSavedMsg(null);

    // Build the save payload: parent rows + child weaver rows.
    interface PendingParent {
      log_date: string;
      shift: 'day' | 'night';
      loom_id: number;
      adjustment_metres: number;
    }
    const parentsToSave: PendingParent[] = [];
    const childrenByLoom = new Map<number, ShiftLogWeaverInsert[]>();

    for (const s of sheds) {
      // Reject duplicate weavers in the same shed (UNIQUE constraint would
      // otherwise hit it at insert time).
      const picked = s.weavers.filter((w) => w !== '');
      if (new Set(picked).size !== picked.length) {
        setError(`Shed ${s.shed_no}: the same weaver is picked in two slots.`);
        return;
      }

      // Validate: any column with metres > 0 must have a weaver picked.
      for (let slotIdx = 0; slotIdx < s.weavers.length; slotIdx++) {
        const empId = s.weavers[slotIdx];
        const hasMetres = s.loomRows.some((r) => parseMetres(r.metres[slotIdx] ?? '') > 0);
        if (hasMetres && (empId == null || empId === '')) {
          setError(
            `Shed ${s.shed_no} weaver ${slotIdx + 1}: pick a name or clear the metres in that column.`,
          );
          return;
        }
      }

      // Build child rows + adjustments for this shed.
      for (const r of s.loomRows) {
        // Non-running looms are read-only on this date — skip them
        // entirely (don't save, don't delete any historical rows for
        // them either). idle_since acts as the cut-over: dates BEFORE
        // idle_since are still editable for that loom.
        if (!isLoomEditableOn(r, logDate)) continue;

        // Validate adjustment is numeric (signed) or blank.
        const adj = parseAdjustment(r.adjustment);
        if (Number.isNaN(adj)) {
          setError(`Loom ${r.loom_code}: adjustment must be a number (use a minus sign for cuts).`);
          return;
        }

        const children: ShiftLogWeaverInsert[] = [];
        for (let slotIdx = 0; slotIdx < s.weavers.length; slotIdx++) {
          const empId = s.weavers[slotIdx];
          if (empId == null || empId === '') continue;
          const m = parseMetres(r.metres[slotIdx] ?? '');
          if (m <= 0) continue;
          children.push({
            shift_log_id: 0,
            employee_id: Number(empId),
            position: slotIdx + 1,
            metres_woven: m,
          });
        }

        // Save the parent if there are weaver entries OR a non-zero adjustment.
        if (children.length > 0 || adj !== 0) {
          parentsToSave.push({
            log_date: logDate,
            shift,
            loom_id: r.loom_id,
            adjustment_metres: adj,
          });
          if (children.length > 0) childrenByLoom.set(r.loom_id, children);
        }
      }
    }

    if (parentsToSave.length === 0) {
      setError('Nothing to save - enter metres or an adjustment on at least one loom.');
      return;
    }

    setSaving(true);

    // Pre-fetch existing parent ids for the (date, shift) so we can delete
    // looms that the user emptied since the last save.
    const { data: existing, error: existErr } = await supabase
      .from('production_shift_log')
      .select('id, loom_id')
      .eq('log_date', logDate)
      .eq('shift', shift);

    if (existErr) {
      setSaving(false);
      setError(existErr.message);
      return;
    }

    const keepLoomIds = new Set(parentsToSave.map((p) => p.loom_id));
    // Non-running looms (on this log_date) are skipped on save; any
    // historical rows for them must NOT be deleted by this save round.
    const runningLoomIds = new Set<number>();
    for (const s of sheds) {
      for (const r of s.loomRows) {
        if (isLoomEditableOn(r, logDate)) runningLoomIds.add(r.loom_id);
      }
    }
    const toDeleteParentIds = (existing ?? [])
      .filter((p) => runningLoomIds.has(p.loom_id) && !keepLoomIds.has(p.loom_id))
      .map((p) => p.id);

    if (toDeleteParentIds.length > 0) {
      const { error: delParentErr } = await supabase
        .from('production_shift_log')
        .delete()
        .in('id', toDeleteParentIds);
      if (delParentErr) {
        setSaving(false);
        setError(delParentErr.message);
        return;
      }
    }

    const upsertPayload: ShiftLogInsert[] = parentsToSave.map((p) => ({
      log_date: p.log_date,
      shift: p.shift,
      loom_id: p.loom_id,
      adjustment_metres: p.adjustment_metres,
    }));

    const { data: upserted, error: upErr } = await supabase
      .from('production_shift_log')
      .upsert(upsertPayload, { onConflict: 'log_date,shift,loom_id' })
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
        `with ${childRows.length} weaver entr${childRows.length === 1 ? 'y' : 'ies'}.`,
    );
  }

  const activeShedState = sheds.find((s) => s.shed_no === activeShed) ?? null;

  return (
    <div>
      <PageHeader
        title="Shift Production Log"
        subtitle="Pick weavers once per shed; fill metres only on the looms each wove."
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
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={showAdjustment}
              onChange={(e) =>
                setAdjustmentSheds((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(activeShed);
                  else next.delete(activeShed);
                  return next;
                })
              }
            />
            Include adjustment column (Shed {activeShed})
          </label>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-line/60">
          {SHEDS.map((s) => {
            const st = sheds.find((sh) => sh.shed_no === s);
            const count = st ? st.loomRows.length : 0;
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
        ) : !activeShedState || activeShedState.loomRows.length === 0 ? (
          <p className="py-8 text-center text-ink-soft">No looms in Shed {activeShed}.</p>
        ) : (
          <ShedCard
            shed={activeShedState}
            weaverOptions={weaverOptions}
            logDate={logDate}
            showAdjustment={showAdjustment}
            onWeaverChange={(slot, v) => updateShedWeaver(activeShed, slot, v)}
            onMetresChange={(loomId, slot, v) =>
              updateLoomMetres(activeShed, loomId, slot, v)
            }
            onAdjustmentChange={(loomId, v) =>
              updateLoomAdjustment(activeShed, loomId, v)
            }
            onAddSlot={() => addShedSlot(activeShed)}
            onRemoveSlot={(slot) => removeShedSlot(activeShed, slot)}
          />
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
          {showAdjustment && (
            <span className="text-xs text-ink-mute">
              Adjustment = +/- correction. Loom Total = sum(weavers) + adjustment.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface ShedCardProps {
  shed: ShedState;
  weaverOptions: WeaverOption[];
  /** Current shift log date (YYYY-MM-DD); used to decide if each loom row
   *  is editable given its idle_since cutover. */
  logDate: string;
  /** Whether the optional Adjustment column is shown. */
  showAdjustment: boolean;
  onWeaverChange: (slotIdx: number, employee_id: string) => void;
  onMetresChange: (loomId: number, slotIdx: number, value: string) => void;
  onAdjustmentChange: (loomId: number, value: string) => void;
  onAddSlot: () => void;
  onRemoveSlot: (slotIdx: number) => void;
}

function ShedCard({
  shed,
  weaverOptions,
  logDate,
  showAdjustment,
  onWeaverChange,
  onMetresChange,
  onAdjustmentChange,
  onAddSlot,
  onRemoveSlot,
}: ShedCardProps): React.ReactElement {
  const total = shedTotal(shed);
  const slotTotals = shed.weavers.map((_, slotIdx) =>
    shed.loomRows.reduce((s, r) => s + parseMetres(r.metres[slotIdx] ?? ''), 0),
  );
  const adjTotal = shed.loomRows.reduce((s, r) => {
    const a = parseAdjustment(r.adjustment);
    return s + (Number.isFinite(a) ? a : 0);
  }, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-line/60 bg-cloud/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Shed {shed.shed_no} weavers
          </span>
          <button
            type="button"
            onClick={onAddSlot}
            className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add weaver
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {shed.weavers.map((empId, slotIdx) => (
            <div key={slotIdx} className="flex items-center gap-1.5">
              <span className="text-xs text-ink-mute w-16">Weaver {slotIdx + 1}</span>
              <select
                className="input w-48"
                value={empId}
                onChange={(e) => onWeaverChange(slotIdx, e.target.value)}
              >
                <option value="">- pick weaver -</option>
                {weaverOptions.map((opt) => (
                  <option key={opt.id} value={String(opt.id)}>
                    {opt.full_name}
                    {opt.code ? ` (${opt.code})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Remove weaver slot"
                className="text-ink-mute hover:text-rose-600 p-1"
                onClick={() => onRemoveSlot(slotIdx)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line/60 text-left text-ink-mute">
              <th className="py-2 pr-3">Loom</th>
              {shed.weavers.map((empId, slotIdx) => {
                const name =
                  empId === ''
                    ? `Weaver ${slotIdx + 1}`
                    : weaverOptions.find((o) => String(o.id) === empId)?.full_name ??
                      `Weaver ${slotIdx + 1}`;
                return (
                  <th key={slotIdx} className="py-2 pr-3 text-right">
                    {name}
                  </th>
                );
              })}
              {showAdjustment && <th className="py-2 pr-3 text-right">Adjustment</th>}
              <th className="py-2 pr-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {shed.loomRows.map((r) => {
              // Editable when status='running' OR the log date is before
              // the loom's idle_since cutover.
              const running = isLoomEditableOn(r, logDate);
              const total = running ? loomTotal(r) : 0;
              const pill = statusPill(r.status);
              const lockedColspan = shed.weavers.length + (showAdjustment ? 1 : 0); // weaver slots + optional adjustment
              return (
                <tr key={r.loom_id} className="border-b border-line/60 align-middle">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.loom_code}</div>
                    <div className="text-xs text-ink-mute">{r.loom_type}</div>
                  </td>
                  {running ? (
                    <>
                      {shed.weavers.map((_, slotIdx) => (
                        <td key={slotIdx} className="py-2 pr-3 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="input num w-24 text-right"
                            placeholder="-"
                            value={r.metres[slotIdx] ?? ''}
                            onChange={(e) =>
                              onMetresChange(r.loom_id, slotIdx, e.target.value)
                            }
                            onKeyDown={focusNextOnEnter}
                          />
                        </td>
                      ))}
                      {showAdjustment && (
                        <td className="py-2 pr-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            className="input num w-24 text-right"
                            placeholder="0"
                            value={r.adjustment}
                            onChange={(e) => onAdjustmentChange(r.loom_id, e.target.value)}
                            onKeyDown={focusNextOnEnter}
                          />
                        </td>
                      )}
                    </>
                  ) : (
                    <td
                      colSpan={lockedColspan}
                      className="py-2 pr-3 text-center"
                    >
                      <span
                        className={`pill ${pill.cls} text-xs uppercase tracking-wide`}
                        title={
                          r.idle_since
                            ? `Locked from ${r.idle_since}. Pick an earlier date or set status back to running in Settings → Looms.`
                            : 'Set the loom status back to running in Settings → Looms to log production.'
                        }
                      >
                        {pill.label}
                        {r.idle_since && (
                          <span className="ml-1 text-[10px] opacity-70">since {r.idle_since}</span>
                        )}
                      </span>
                    </td>
                  )}
                  <td className="py-2 pr-3 text-right num font-semibold">
                    {running ? (total !== 0 ? `${total.toLocaleString('en-IN')} m` : '-') : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="text-ink-soft">
              <td className="py-2 pr-3 font-medium">Shed {shed.shed_no} total</td>
              {slotTotals.map((t, slotIdx) => (
                <td key={slotIdx} className="py-2 pr-3 text-right font-medium">
                  {t > 0 ? `${t.toLocaleString('en-IN')} m` : '-'}
                </td>
              ))}
              {showAdjustment && (
                <td className="py-2 pr-3 text-right font-medium">
                  {adjTotal !== 0 ? `${adjTotal.toLocaleString('en-IN')} m` : '-'}
                </td>
              )}
              <td className="py-2 pr-3 text-right font-medium">
                {total.toLocaleString('en-IN')} m
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
