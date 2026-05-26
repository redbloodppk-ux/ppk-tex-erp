'use client';
/**
 * CostingDefaults — Settings → Costing defaults  (CORR-T1)
 *
 * Owner-only widget for the two mill-wide costing defaults that prefill the
 * New Costing form. These are still per-costing editable; the values here
 * just decide what a fresh row starts with.
 *
 *   system_config keys:
 *     default_yarn_wastage_pct   → numeric fraction (e.g. 0.02 for 2%)
 *     default_porvai_wastage_pct → numeric fraction (e.g. 0.02 for 2%)
 *
 * Validates 0–20% to catch obvious typos.
 */
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Percent, CheckCircle2, Loader2 } from 'lucide-react';

const YARN_KEY = 'default_yarn_wastage_pct';
const PORVAI_KEY = 'default_porvai_wastage_pct';

interface CostingDefaultsProps {
  initialYarnPct: number;   // 0.02 = 2%
  initialPorvaiPct: number;
  canEdit: boolean;
}

export function CostingDefaults({
  initialYarnPct,
  initialPorvaiPct,
  canEdit,
}: CostingDefaultsProps): React.ReactElement {
  const supabase = createClient();
  // store as the user-facing percent string ("2", "2.5")
  const [yarn, setYarn] = useState<string>((initialYarnPct * 100).toString());
  const [porvai, setPorvai] = useState<string>((initialPorvaiPct * 100).toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function validate(): { yarnFrac: number; porvaiFrac: number } | string {
    const y = Number(yarn);
    const p = Number(porvai);
    if (!Number.isFinite(y) || !Number.isFinite(p)) return 'Enter numbers only.';
    if (y < 0 || y > 20) return 'Yarn wastage must be 0–20%.';
    if (p < 0 || p > 20) return 'Porvai wastage must be 0–20%.';
    return { yarnFrac: y / 100, porvaiFrac: p / 100 };
  }

  async function save(): Promise<void> {
    if (!canEdit || saving) return;
    setError(null);
    setSavedMsg(null);

    const v = validate();
    if (typeof v === 'string') {
      setError(v);
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const stamp = {
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    };

    const [yRes, pRes] = await Promise.all([
      supabase.from('system_config')
        .update({ value: v.yarnFrac, ...stamp })
        .eq('key', YARN_KEY),
      supabase.from('system_config')
        .update({ value: v.porvaiFrac, ...stamp })
        .eq('key', PORVAI_KEY),
    ]);

    setSaving(false);

    if (yRes.error || pRes.error) {
      setError(yRes.error?.message ?? pRes.error?.message ?? 'Save failed.');
      return;
    }
    setSavedMsg('Defaults saved. New costings will use these values.');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-line p-3">
        <div className="w-9 h-9 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          <Percent className="w-5 h-5" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <div className="font-semibold">Default wastage for new costings</div>
            <div className="text-xs text-ink-soft">
              Mill-wide defaults. Each costing can still override them on the
              Warp / Porvai tabs. Past costings are never changed.
            </div>
            {!canEdit && (
              <div className="text-[11px] text-ink-mute mt-1">
                Only the owner can change these.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-ink-mute">
                Yarn wastage %
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="20"
                value={yarn}
                onChange={(e) => setYarn(e.target.value)}
                disabled={!canEdit || saving}
                className="num w-full mt-1 rounded-md border border-line px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-ink-soft"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-ink-mute">
                Porvai wastage %
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="20"
                value={porvai}
                onChange={(e) => setPorvai(e.target.value)}
                disabled={!canEdit || saving}
                className="num w-full mt-1 rounded-md border border-line px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-ink-soft"
              />
            </label>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save defaults'}
            </button>
          )}
        </div>
      </div>

      {saving && (
        <p className="flex items-center gap-1.5 text-xs text-ink-mute">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving…
        </p>
      )}
      {savedMsg && !saving && (
        <p className="flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {savedMsg}
        </p>
      )}
      {error && <p className="text-xs text-err">{error}</p>}
    </div>
  );
}
