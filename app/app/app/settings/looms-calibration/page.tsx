'use client';
/**
 * LOOMS Calibration — Build Guide T-B12 (CORR Group 2).
 *
 * The five LOOMS overhead components (₹/m of in-house fabric) feed the
 * True Cost calculation for any fabric we weave on our own looms:
 *
 *   total_per_m  =  power + labour + maintenance + depreciation + insurance
 *
 * Stored as a single JSONB row in `system_config` under the key
 * `looms_overhead_breakdown`. The view `v_looms_overhead` reads from this
 * row and `v_costing_two_cost` mixes the total into True Cost when
 * `production_mode = 'inhouse'`.
 *
 * Owner-only screen (controlled at navigation + at the Save button by RLS
 * on system_config). Every save is appended to `audit_log` by the table
 * trigger so we have a full history of the overhead the business was
 * running on.
 */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';

const CONFIG_KEY = 'looms_overhead_breakdown';

type Breakdown = {
  power: string;
  labour: string;
  maintenance: string;
  depreciation: string;
  insurance: string;
};

const EMPTY: Breakdown = {
  power: '', labour: '', maintenance: '', depreciation: '', insurance: '',
};

const FIELDS: { id: keyof Breakdown; label: string; hint: string }[] = [
  { id: 'power',        label: 'Power (EB)',     hint: 'TANGEDCO bill ÷ metres woven for the month' },
  { id: 'labour',       label: 'Labour & wages', hint: 'Weaver + helper + supervisor cost ÷ metres woven' },
  { id: 'maintenance',  label: 'Maintenance',    hint: 'Loom spares, oil, mistry visits ÷ metres woven' },
  { id: 'depreciation', label: 'Depreciation',   hint: 'Loom + shed amortised over expected life ÷ monthly metres' },
  { id: 'insurance',    label: 'Insurance & misc', hint: 'Factory insurance, govt fees, audit ÷ metres woven' },
];

const dec = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export default function LoomsCalibrationPage() {
  const supabase = createClient();
  const [values, setValues] = useState<Breakdown>(EMPTY);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [savedAt, setSavedAt]   = useState<Date | null>(null);

  // ── load current breakdown ───────────────────────────────────────────────
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
          power:        String(v.power        ?? ''),
          labour:       String(v.labour       ?? ''),
          maintenance:  String(v.maintenance  ?? ''),
          depreciation: String(v.depreciation ?? ''),
          insurance:    String(v.insurance    ?? ''),
        });
        setUpdatedAt(row.updated_at);
        // resolve the updater's name (best-effort)
        if (row.updated_by) {
          const { data: u } = await supabase
            .from('app_user').select('full_name').eq('id', row.updated_by).maybeSingle();
          if (u) setUpdatedBy((u as { full_name: string }).full_name);
        }
      }
      setLoading(false);
    })();
  }, [supabase]);

  // ── live total ────────────────────────────────────────────────────────────
  const total = useMemo(() =>
    dec(values.power) + dec(values.labour) + dec(values.maintenance)
    + dec(values.depreciation) + dec(values.insurance),
    [values]
  );

  // ── validation ────────────────────────────────────────────────────────────
  const errors = useMemo(() => {
    const out: Partial<Record<keyof Breakdown, string>> = {};
    for (const f of FIELDS) {
      const raw = values[f.id].trim();
      if (raw === '') { out[f.id] = 'Required'; continue; }
      const n = parseFloat(raw);
      if (!Number.isFinite(n))       out[f.id] = 'Must be a number';
      else if (n < 0)                out[f.id] = 'Cannot be negative';
      else if (n > 100)              out[f.id] = 'Looks too high — check ₹/m';
    }
    return out;
  }, [values]);
  const hasErrors = Object.keys(errors).length > 0;

  // ── save ─────────────────────────────────────────────────────────────────
  async function onSave() {
    setError(null);
    if (hasErrors) {
      setError('Fix highlighted fields before saving.');
      return;
    }
    setSaving(true);

    const payload = {
      power:        dec(values.power),
      labour:       dec(values.labour),
      maintenance:  dec(values.maintenance),
      depreciation: dec(values.depreciation),
      insurance:    dec(values.insurance),
    };

    // who am I?
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

  // ── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          title="LOOMS Calibration"
          crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'LOOMS Calibration' }]}
        />
        <div className="card p-6 text-sm text-ink-soft">Loading current overhead breakdown…</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="LOOMS Calibration"
        subtitle="The per-metre overhead used in True Cost for in-house fabric. Re-do this whenever EB rates, wages or loom hours change."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'LOOMS Calibration' }]}
      />

      {/* Live total preview */}
      <div className="card p-5 bg-gradient-to-r from-indigo-50 to-emerald-50 border border-indigo-100">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-indigo-700 font-bold">Total LOOMS overhead</div>
            <div className="text-3xl font-display font-extrabold text-indigo-900 num">
              {formatRupee(total)} <span className="text-sm font-normal text-indigo-700">/ metre</span>
            </div>
          </div>
          <div className="text-xs text-ink-soft text-right">
            <div>Used as <span className="font-semibold">True Cost overhead</span></div>
            <div>for every fabric you weave in-house.</div>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="card p-5 space-y-4">
        <h2 className="font-display font-bold text-base">Breakdown (₹ per metre)</h2>

        <div className="grid sm:grid-cols-2 gap-4">
          {FIELDS.map(f => (
            <div key={f.id}>
              <label className="text-xs font-semibold text-ink-soft uppercase tracking-wide">{f.label}</label>
              <div className="relative mt-1">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-ink-mute pointer-events-none">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={values[f.id]}
                  onChange={(e) => setValues(v => ({ ...v, [f.id]: e.target.value }))}
                  className={`input pl-7 ${errors[f.id] ? 'border-red-400 focus:ring-red-300' : ''}`}
                  placeholder="0.00"
                />
              </div>
              <p className="text-[11px] text-ink-mute mt-1">{f.hint}</p>
              {errors[f.id] && (
                <p className="text-[11px] text-red-600 mt-1 font-semibold">{errors[f.id]}</p>
              )}
            </div>
          ))}
        </div>

        {/* Summary table */}
        <div className="border-t border-line pt-4">
          <table className="w-full text-sm">
            <tbody>
              {FIELDS.map(f => (
                <tr key={f.id} className="border-b border-line/40 last:border-0">
                  <td className="py-1.5 text-ink-soft">{f.label}</td>
                  <td className="py-1.5 text-right num font-semibold">{formatRupee(dec(values[f.id]))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink/20">
                <td className="py-2 font-display font-bold">Total</td>
                <td className="py-2 text-right num font-display font-extrabold text-indigo-700">
                  {formatRupee(total)}
                </td>
              </tr>
            </tbody>
          </table>
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
                  {new Date(updatedAt).toLocaleString('en-IN', {
                    dateStyle: 'medium', timeStyle: 'short',
                  })}
                </span>
                {updatedBy && <> by <span className="font-semibold">{updatedBy}</span></>}
              </>
            )}
            {savedAt && (
              <span className="ml-2 text-emerald-700 font-semibold">✓ Saved</span>
            )}
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || hasErrors}
            className="btn-primary"
          >
            {saving ? 'Saving…' : 'Save calibration'}
          </button>
        </div>
      </div>

      {/* Caveat */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        <p className="font-semibold uppercase tracking-wide text-amber-900 mb-1">How this is used</p>
        <p>
          The total here is plugged into every in-house fabric&apos;s True Cost as the
          per-metre overhead. Quoted Cost (what you tell the customer) does NOT
          use this — it uses the market pick rate on the costing card. Only True
          Cost (what you actually pay to weave) uses LOOMS overhead, so keep this
          accurate to know your real margin.
        </p>
      </div>
    </div>
  );
}
