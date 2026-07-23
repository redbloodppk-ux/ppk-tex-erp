'use client';
/**
 * Loom Rate Target — target loom efficiency & cost/metre assumptions.
 *
 * Feeds the "Loom Efficiency & Cost" report (Reports → Loom Efficiency &
 * Cost): the report compares real shift-log production against a
 * theoretical benchmark computed from these four numbers, and compares
 * real cost/metre (wages + factory expenses) against `target_cost_per_m`.
 *
 * Theoretical metres for one loom on one day:
 *   (picks_per_min * 60 * shift_hours * efficiency_pct) / inches_per_metre / quality.pick_per_inch
 *
 * Stored as a single JSONB row in `system_config` under the key
 * `loom_rate_target`. Every save is appended to `audit_log` by the table
 * trigger, same as LOOMS Calibration.
 */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';

const CONFIG_KEY = 'loom_rate_target';
const INCHES_PER_METRE = 39.37;

type Target = {
  picks_per_min: string;
  shift_hours: string;
  efficiency_pct: string; // stored as 0-1, edited as 0-100
  target_cost_per_m: string;
};

const EMPTY: Target = {
  picks_per_min: '', shift_hours: '', efficiency_pct: '', target_cost_per_m: '',
};

const dec = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export default function LoomRateTargetPage() {
  const supabase = createClient();
  const [values, setValues]   = useState<Target>(EMPTY);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from('system_config')
        .select('value, updated_at, updated_by')
        .eq('key', CONFIG_KEY)
        .maybeSingle();
      if (e) {
        setError(e.message);
      } else if (data) {
        const row = data as { value: Record<string, unknown>; updated_at: string; updated_by: string | null };
        const v = row.value ?? {};
        setValues({
          picks_per_min:      String(v.picks_per_min ?? ''),
          shift_hours:        String(v.shift_hours ?? ''),
          efficiency_pct:     v.efficiency_pct != null ? String(Number(v.efficiency_pct) * 100) : '',
          target_cost_per_m:  String(v.target_cost_per_m ?? ''),
        });
        setUpdatedAt(row.updated_at);
        if (row.updated_by) {
          const { data: u } = await supabase
            .from('app_user').select('full_name').eq('id', row.updated_by).maybeSingle();
          if (u) setUpdatedBy((u as { full_name: string }).full_name);
        }
      }
      setLoading(false);
    })();
  }, [supabase]);

  // ── validation ──────────────────────────────────────────────────────────
  const errors = useMemo(() => {
    const out: Partial<Record<keyof Target, string>> = {};
    const check = (id: keyof Target, min: number, max: number) => {
      const raw = values[id].trim();
      if (raw === '') { out[id] = 'Required'; return; }
      const n = parseFloat(raw);
      if (!Number.isFinite(n))    out[id] = 'Must be a number';
      else if (n < min)           out[id] = `Must be at least ${min}`;
      else if (n > max)           out[id] = `Looks too high (max ${max})`;
    };
    check('picks_per_min', 1, 500);
    check('shift_hours', 1, 24);
    check('efficiency_pct', 1, 100);
    check('target_cost_per_m', 0, 1000);
    return out;
  }, [values]);
  const hasErrors = Object.keys(errors).length > 0;

  // ── live preview: theoretical metres/loom/shift at a representative
  //    quality density (40 picks/inch — mid-range across the mill's
  //    active qualities). Purely illustrative; the report itself uses
  //    each loom's real fabric_quality.pick_per_inch. ──────────────────
  const exampleMetres = useMemo(() => {
    const picks = dec(values.picks_per_min);
    const hours = dec(values.shift_hours);
    const eff   = dec(values.efficiency_pct) / 100;
    const examplePickPerInch = 40;
    return (picks * 60 * hours * eff) / INCHES_PER_METRE / examplePickPerInch;
  }, [values]);

  // ── save ────────────────────────────────────────────────────────────────
  async function onSave() {
    setError(null);
    if (hasErrors) {
      setError('Fix highlighted fields before saving.');
      return;
    }
    setSaving(true);

    const payload = {
      picks_per_min:     dec(values.picks_per_min),
      shift_hours:        dec(values.shift_hours),
      efficiency_pct:     dec(values.efficiency_pct) / 100,
      target_cost_per_m:  dec(values.target_cost_per_m),
      inches_per_metre:   INCHES_PER_METRE,
    };

    const { data: { user } } = await supabase.auth.getUser();

    const { error: upErr } = await supabase
      .from('system_config')
      .update({ value: payload, updated_by: user?.id ?? null, updated_at: new Date().toISOString() })
      .eq('key', CONFIG_KEY);

    setSaving(false);
    if (upErr) { setError(upErr.message); return; }

    setSavedAt(new Date());
    setUpdatedAt(new Date().toISOString());
    if (user) {
      const { data: u } = await supabase
        .from('app_user').select('full_name').eq('id', user.id).maybeSingle();
      if (u) setUpdatedBy((u as { full_name: string }).full_name);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          title="Loom Rate Target"
          crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Loom Rate Target' }]}
        />
        <div className="card p-6 text-sm text-ink-soft">Loading current target…</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Loom Rate Target"
        subtitle="The benchmark efficiency and cost/metre used on the Loom Efficiency & Cost report. Re-do this whenever loom speed, shift length or your cost target changes."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Loom Rate Target' }]}
      />

      {/* Live preview */}
      <div className="card p-5 bg-gradient-to-r from-indigo-50 to-emerald-50 border border-indigo-100">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-indigo-700 font-bold">Target cost</div>
            <div className="text-3xl font-display font-extrabold text-indigo-900 num">
              {formatRupee(dec(values.target_cost_per_m))} <span className="text-sm font-normal text-indigo-700">/ metre</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-indigo-700 font-bold">Target efficiency</div>
            <div className="text-3xl font-display font-extrabold text-indigo-900 num">
              {dec(values.efficiency_pct).toFixed(0)}<span className="text-sm font-normal text-indigo-700">%</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-ink-soft mt-3 pt-3 border-t border-indigo-100">
          Example: at 40 picks/inch, one loom running at this efficiency would weave{' '}
          <strong className="num">{exampleMetres.toFixed(1)} m</strong> per {dec(values.shift_hours) || '—'}-hour shift.
          The report uses each loom&apos;s actual fabric quality density, not this example.
        </p>
      </div>

      {/* Editor */}
      <div className="card p-5 space-y-4">
        <h2 className="font-display font-bold text-base">Assumptions</h2>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Picks per minute (loom speed)</label>
            <input
              type="number" step="1" min="0"
              value={values.picks_per_min}
              onChange={(e) => setValues(v => ({ ...v, picks_per_min: e.target.value }))}
              className={`input mt-1 ${errors.picks_per_min ? 'border-red-400 focus:ring-red-300' : ''}`}
              placeholder="110"
            />
            <p className="text-[11px] text-ink-mute mt-1">How fast a loom inserts picks — a loom spec, same for every quality.</p>
            {errors.picks_per_min && <p className="text-[11px] text-red-600 mt-1 font-semibold">{errors.picks_per_min}</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Shift hours</label>
            <input
              type="number" step="0.5" min="0"
              value={values.shift_hours}
              onChange={(e) => setValues(v => ({ ...v, shift_hours: e.target.value }))}
              className={`input mt-1 ${errors.shift_hours ? 'border-red-400 focus:ring-red-300' : ''}`}
              placeholder="12"
            />
            <p className="text-[11px] text-ink-mute mt-1">Hours counted for one shift-log entry (one loom, one day).</p>
            {errors.shift_hours && <p className="text-[11px] text-red-600 mt-1 font-semibold">{errors.shift_hours}</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Target efficiency %</label>
            <div className="relative mt-1">
              <input
                type="number" step="1" min="0" max="100"
                value={values.efficiency_pct}
                onChange={(e) => setValues(v => ({ ...v, efficiency_pct: e.target.value }))}
                className={`input pr-8 ${errors.efficiency_pct ? 'border-red-400 focus:ring-red-300' : ''}`}
                placeholder="85"
              />
              <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-ink-mute pointer-events-none">%</span>
            </div>
            <p className="text-[11px] text-ink-mute mt-1">Realistic running efficiency vs. non-stop loom speed.</p>
            {errors.efficiency_pct && <p className="text-[11px] text-red-600 mt-1 font-semibold">{errors.efficiency_pct}</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Target cost per metre</label>
            <div className="relative mt-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-ink-mute pointer-events-none">₹</span>
              <input
                type="number" step="0.01" min="0"
                value={values.target_cost_per_m}
                onChange={(e) => setValues(v => ({ ...v, target_cost_per_m: e.target.value }))}
                className={`input pl-7 ${errors.target_cost_per_m ? 'border-red-400 focus:ring-red-300' : ''}`}
                placeholder="3.05"
              />
            </div>
            <p className="text-[11px] text-ink-mute mt-1">Your benchmark wages + overhead cost per metre woven.</p>
            {errors.target_cost_per_m && <p className="text-[11px] text-red-600 mt-1 font-semibold">{errors.target_cost_per_m}</p>}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
          <div className="text-xs text-ink-mute">
            {updatedAt && (
              <>
                Last updated{' '}
                <span className="font-semibold">
                  {new Date(updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {updatedBy && <> by <span className="font-semibold">{updatedBy}</span></>}
              </>
            )}
            {savedAt && <span className="ml-2 text-emerald-700 font-semibold">✓ Saved</span>}
          </div>
          <button type="button" onClick={onSave} disabled={saving || hasErrors} className="btn-primary">
            {saving ? 'Saving…' : 'Save target'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        <p className="font-semibold uppercase tracking-wide text-amber-900 mb-1">How this is used</p>
        <p>
          The Loom Efficiency &amp; Cost report compares your real shift-log production and real
          wages/expenses against this target for every week, month and year. Changing these numbers
          moves the target line for past periods too, since it&apos;s a benchmark, not a locked fact —
          keep it accurate for the comparison to be meaningful.
        </p>
      </div>
    </div>
  );
}
