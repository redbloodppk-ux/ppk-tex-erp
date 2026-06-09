'use client';
/**
 * Bobbin Master — one row per (ends-spec, production mode).
 *
 * Each row represents a distinct bobbin identity. BB-IH-30 (in-house
 * 30 ends), BB-JW-30 (jobwork 30 ends), BB-OS-30 (outsource 30 ends)
 * coexist as separate stock balances; the picker on each Add Bobbin
 * Stock form filters by the relevant mode.
 *
 * Code is auto-generated server-side as BB-<MODE_PREFIX>-<ends> where
 * MODE_PREFIX is IH / JW / OS. The user only picks the ends row + mode
 * + optional metadata (bobbin_metre, is_lurex).
 *
 * RLS: read for any auth user; write for owner / mill_manager.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2, RotateCcw } from 'lucide-react';

type ProductionMode = 'inhouse' | 'jobwork' | 'outsource';

interface BobbinRow {
  id: number;
  code: string;
  bobbin_ends_master_id: number | null;
  ends_per_bobbin: number;
  bobbin_metre: number | null;
  is_lurex: boolean;
  production_mode: ProductionMode;
  status: string;
}

interface EndsOpt {
  id: number;
  ends_count: number;
  label: string;
}

interface NewBobbin {
  bobbin_ends_master_id: string;
  production_mode: ProductionMode;
  bobbin_metre: string;
  is_lurex: boolean;
}

const EMPTY_NEW: NewBobbin = {
  bobbin_ends_master_id: '',
  production_mode: 'inhouse',
  bobbin_metre: '',
  is_lurex: false,
};

const MODE_LABEL: Record<ProductionMode, string> = {
  inhouse:   'In-house',
  jobwork:   'Job Work',
  outsource: 'Outsource',
};

const MODE_PREFIX: Record<ProductionMode, string> = {
  inhouse:   'IH',
  jobwork:   'JW',
  outsource: 'OS',
};

function generateCode(mode: ProductionMode, endsCount: number): string {
  return `BB-${MODE_PREFIX[mode]}-${endsCount}`;
}

export default function BobbinMasterPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<BobbinRow[]>([]);
  const [ends, setEnds] = useState<EndsOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewBobbin>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, eRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // Include archived rows so the operator can SEE what they have
      // archived and restore it instead of being blocked by the
      // UNIQUE(ends, mode) constraint with no way to recover.
      (supabase as any)
        .from('bobbin')
        .select('id, code, bobbin_ends_master_id, ends_per_bobbin, bobbin_metre, is_lurex, production_mode, status')
        .order('production_mode')
        .order('ends_per_bobbin'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('bobbin_ends_master')
        .select('id, ends_count, label')
        .eq('active', true)
        .order('ends_count'),
    ]);
    if (bRes.error) {
      setError(bRes.error.message);
    } else if (eRes.error) {
      setError(eRes.error.message);
    } else {
      setRows((bRes.data ?? []) as unknown as BobbinRow[]);
      setEnds((eRes.data ?? []) as unknown as EndsOpt[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const endsById = useMemo<Map<number, EndsOpt>>(() => {
    const m = new Map<number, EndsOpt>();
    ends.forEach((e) => m.set(e.id, e));
    return m;
  }, [ends]);

  const previewCode = useMemo<string>(() => {
    if (neu.bobbin_ends_master_id === '') return '';
    const e = endsById.get(Number(neu.bobbin_ends_master_id));
    if (!e) return '';
    return generateCode(neu.production_mode, e.ends_count);
  }, [neu.bobbin_ends_master_id, neu.production_mode, endsById]);

  async function handleAdd() {
    setError(null);
    setSavedMsg(null);
    if (neu.bobbin_ends_master_id === '') {
      setError('Pick an ends spec first.');
      return;
    }
    const e = endsById.get(Number(neu.bobbin_ends_master_id));
    if (!e) {
      setError('Selected ends spec was not found.');
      return;
    }
    const metre = neu.bobbin_metre.trim() === '' ? null : Number(neu.bobbin_metre);
    if (metre !== null && (!Number.isFinite(metre) || metre <= 0)) {
      setError('Enter a positive metre-per-piece value, or leave blank.');
      return;
    }
    setAdding(true);
    // description is NOT NULL on the bobbin table — auto-generate a
    // sensible one from the picked ends + mode + optional lurex flag.
    // The operator can edit it inline in the table below after save.
    const desc = `${e.ends_count} ends · ${MODE_LABEL[neu.production_mode]}`
      + (neu.is_lurex ? ' · lurex' : '')
      + (metre != null ? ` · ${metre} m/pc` : '');
    // bobbin_metre and bobbin_price are NOT NULL on the bobbin table
    // with no defaults — default both to 0 when the user leaves them
    // blank. Pricing now lives on bobbin_purchase events, so a master
    // row with price=0 is the expected resting state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('bobbin').insert({
      code: generateCode(neu.production_mode, e.ends_count),
      description: desc,
      bobbin_ends_master_id: e.id,
      ends_per_bobbin: e.ends_count,
      bobbin_metre: metre ?? 0,
      bobbin_price: 0,
      is_lurex: neu.is_lurex,
      production_mode: neu.production_mode,
      status: 'active',
    });
    setAdding(false);
    if (err) {
      // Surface the most common collision plainly: same (ends, mode)
      // already exists. Either UNIQUE(bobbin_ends_master_id,
      // production_mode) OR UNIQUE(code) trips — both mean the same
      // thing because the code is derived from (mode, ends).
      const dupe =
        err.message.includes('bobbin_unique_ends_mode') ||
        err.message.includes('bobbin_code_key');
      // "An In-house / An Outsource" reads better than "A In-house";
      // pick the article from the first letter of the mode label.
      const article = /^[aeiouAEIOU]/.test(MODE_LABEL[neu.production_mode]) ? 'An' : 'A';
      const msg = dupe
        ? `${article} ${MODE_LABEL[neu.production_mode]} bobbin for ${e.ends_count} ends already exists (${generateCode(neu.production_mode, e.ends_count)}).`
        : err.message;
      setError(msg);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg(`Added ${generateCode(neu.production_mode, e.ends_count)}.`);
    await load();
  }

  async function updateRow(id: number, patch: Partial<BobbinRow>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);
    const current = rows.find((r) => r.id === id);
    if (!current) {
      setBusyId(null);
      return;
    }
    const merged: BobbinRow = { ...current, ...patch };
    setRows((prev) => prev.map((r) => (r.id === id ? merged : r)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('bobbin')
      .update(patch)
      .eq('id', id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      await load();
      return;
    }
    setSavedMsg('Saved.');
  }

  async function toggleArchive(id: number, code: string, currentStatus: string): Promise<void> {
    const archiving = currentStatus !== 'archived';
    const verb = archiving ? 'Archive' : 'Restore';
    const explain = archiving
      ? `Archive bobbin ${code}?\n\nIt will be hidden from add-bobbin-stock dropdowns but stays in the database. You can restore it from this page later.`
      : `Restore bobbin ${code} to active?\n\nIt will appear again in add-bobbin-stock dropdowns.`;
    if (!window.confirm(explain)) return;
    setError(null);
    setSavedMsg(null);
    setBusyId(id);
    const nextStatus = archiving ? 'archived' : 'active';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('bobbin')
      .update({ status: nextStatus })
      .eq('id', id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    // Update the row in place so archived rows stay visible (greyed out)
    // instead of disappearing. The earlier behaviour silently hid them.
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
    setSavedMsg(`${verb}d ${code}.`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bobbin Master"
        subtitle="Each row is one bobbin identity = ends-spec + production mode. Codes auto-generate as BB-IH-<ends>, BB-JW-<ends>, BB-OS-<ends>."
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Bobbin Master' },
        ]}
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a bobbin</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label text-xs">Ends spec *</label>
            <select
              className="input h-9 text-sm w-48"
              value={neu.bobbin_ends_master_id}
              onChange={(e) => setNeu((n) => ({ ...n, bobbin_ends_master_id: e.target.value }))}
            >
              <option value="">--- pick ---</option>
              {ends.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-ink-mute mt-1">
              From <strong>Bobbin Ends Master</strong>.
            </p>
          </div>
          <div>
            <label className="label text-xs">Mode *</label>
            <select
              className="input h-9 text-sm w-36"
              value={neu.production_mode}
              onChange={(e) => setNeu((n) => ({ ...n, production_mode: e.target.value as ProductionMode }))}
            >
              <option value="inhouse">In-house</option>
              <option value="jobwork">Job Work</option>
              <option value="outsource">Outsource</option>
            </select>
          </div>
          <div>
            <label className="label text-xs">M/pc</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="input num h-9 text-sm w-24"
              placeholder="2000"
              value={neu.bobbin_metre}
              onChange={(e) => setNeu((n) => ({ ...n, bobbin_metre: e.target.value }))}
            />
          </div>
          <div>
            <label className="label text-xs">Lurex</label>
            <label className="input h-9 text-sm w-20 inline-flex items-center justify-center gap-1.5">
              <input
                type="checkbox"
                checked={neu.is_lurex}
                onChange={(e) => setNeu((n) => ({ ...n, is_lurex: e.target.checked }))}
              />
              <span className="text-xs">{neu.is_lurex ? 'Yes' : 'No'}</span>
            </label>
          </div>
          <div>
            <label className="label text-xs">Code (auto)</label>
            <div className="input h-9 text-sm w-32 bg-cloud/40 text-ink-soft select-none flex items-center">
              {previewCode || '—'}
            </div>
          </div>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={handleAdd}
            disabled={adding}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add bobbin
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading bobbins...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No bobbin masters yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Ends</th>
                  <th className="py-2 pr-3">Mode</th>
                  <th className="py-2 pr-3">M/pc</th>
                  <th className="py-2 pr-3">Lurex</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isArchived = r.status === 'archived';
                  return (
                  <tr
                    key={r.id}
                    className={
                      'border-b border-line/60 ' +
                      (isArchived ? 'opacity-50 bg-cloud/30' : '')
                    }
                  >
                    <td className="py-2 pr-3 font-mono text-xs font-semibold">
                      {r.code}
                      {isArchived && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-mute">archived</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 num">{r.ends_per_bobbin}</td>
                    <td className="py-2 pr-3">
                      <span className={
                        'inline-block px-2 py-0.5 rounded text-[11px] ' +
                        (r.production_mode === 'inhouse'   ? 'bg-emerald-50 text-emerald-700' :
                         r.production_mode === 'jobwork'   ? 'bg-amber-50 text-amber-700' :
                                                            'bg-indigo-50 text-indigo-700')
                      }>
                        {MODE_LABEL[r.production_mode]}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="input num w-24 text-xs h-8"
                        value={r.bobbin_metre ?? ''}
                        disabled={isArchived}
                        onChange={(e) =>
                          updateRow(r.id, {
                            bobbin_metre: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={r.is_lurex}
                          disabled={isArchived}
                          onChange={(e) => updateRow(r.id, { is_lurex: e.target.checked })}
                        />
                        <span className="text-xs text-ink-soft">{r.is_lurex ? 'Yes' : 'No'}</span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {busyId === r.id && (
                          <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
                        )}
                        <button
                          type="button"
                          className={
                            'p-1 rounded ' +
                            (isArchived
                              ? 'hover:bg-emerald-50 text-emerald-600'
                              : 'hover:bg-red-50 text-red-600')
                          }
                          title={isArchived ? 'Restore this bobbin' : 'Archive this bobbin'}
                          onClick={() => toggleArchive(r.id, r.code, r.status)}
                          disabled={busyId === r.id}
                        >
                          {isArchived ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
