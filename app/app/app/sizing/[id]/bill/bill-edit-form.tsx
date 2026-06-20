'use client';
/**
 * Sizing Bill edit form.
 *
 * Bills are tab-2 records on /app/sizing — they actually live as
 * columns on the parent sizing_job row (bill_no, bill_date, rate,
 * GST, charges_amount, total_amount). This focused form only
 * touches those bill-section fields, leaving the job's yarn-lot
 * stock movement, beams, and status untouched. Operators who need
 * to edit the full job go through /app/sizing/[id] instead.
 *
 * Delete is intentionally NOT here — bills can only be removed by
 * deleting the parent job. The form makes that explicit with a
 * passive note at the bottom.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, RotateCcw } from 'lucide-react';

export interface BillEditSeed {
  id: number;
  job_code: string;
  sizing_vendor_name: string;
  yarn_used_kg: number;
  bill_no: string;
  bill_date: string;        // YYYY-MM-DD
  sizing_rate_per_kg: number;
  gst_pct: number;
  round_off?: number;
}

interface Props {
  seed: BillEditSeed;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BillEditForm({ seed }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [billNo,   setBillNo]   = useState<string>(seed.bill_no ?? '');
  const [billDate, setBillDate] = useState<string>(seed.bill_date ?? todayISO());
  const [rate,     setRate]     = useState<string>(String(seed.sizing_rate_per_kg ?? 0));
  const [gstPct,   setGstPct]   = useState<string>(String(seed.gst_pct ?? 0));

  // Round Off: auto-fills to the nearest rupee but stays editable.
  const [roundOff, setRoundOff] = useState<string>(seed.round_off != null ? String(seed.round_off) : '');
  const [roundOffTouched, setRoundOffTouched] = useState<boolean>(seed.round_off != null && Number(seed.round_off) !== 0);

  const [busy,  setBusy]  = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Charges = Yarn Used (kg) × Rate (rounded to whole rupee). The base total
  // keeps 2 decimals; Round Off (auto = nearest rupee, editable) is added on
  // top to produce the Grand Total that is stored and reconciled.
  const billing = useMemo(() => {
    const kg = seed.yarn_used_kg;
    const r  = Number(rate)   || 0;
    const g  = Number(gstPct) || 0;
    const charges = Math.round(kg * r);
    const base    = Math.round(charges * (1 + g / 100) * 100) / 100;
    const autoRoundOff = Math.round((Math.round(base) - base) * 100) / 100;
    return { charges, base, autoRoundOff };
  }, [seed.yarn_used_kg, rate, gstPct]);

  const effectiveRoundOff = roundOffTouched ? (Number(roundOff) || 0) : billing.autoRoundOff;
  const grandTotal = Math.round((billing.base + effectiveRoundOff) * 100) / 100;

  async function handleSave(): Promise<void> {
    setError(null);
    if (!billNo.trim()) { setError('Bill / invoice number is required.'); return; }
    if (!billDate)       { setError('Bill / invoice date is required.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: updErr } = await sb
      .from('sizing_job')
      .update({
        bill_no:            billNo.trim(),
        bill_date:          billDate,
        sizing_rate_per_kg: Number(rate)   || 0,
        gst_pct:            Number(gstPct) || 0,
        charges_amount:     billing.charges,
        round_off:          effectiveRoundOff,
        total_amount:       grandTotal,
      })
      .eq('id', seed.id);
    if (updErr) {
      setBusy(false);
      setError(updErr.message);
      return;
    }
    router.push('/app/sizing?tab=bills');
    router.refresh();
  }

  return (
    <form className="space-y-4 max-w-3xl" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* Read-only job summary so the operator knows which bill they're
          editing without leaving the screen. */}
      <div className="card p-4 grid sm:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="label">Job</div>
          <div className="font-mono">{seed.job_code}</div>
        </div>
        <div>
          <div className="label">Sizing Mill</div>
          <div>{seed.sizing_vendor_name}</div>
        </div>
        <div>
          <div className="label">Yarn Used (kg)</div>
          <div className="num font-semibold">{seed.yarn_used_kg.toFixed(2)}</div>
          <div className="text-[11px] text-ink-mute mt-0.5">
            Edit Yarn Used from the full job edit page.
          </div>
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="font-display font-bold text-sm">Sizing Bill</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Bill / Invoice No *</label>
            <input
              type="text" required value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              className="input"
              placeholder="e.g. SZ/26-27/0012"
            />
          </div>
          <div>
            <label className="label">Bill / Invoice Date *</label>
            <input
              type="date" required value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="input"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-4">
          <div>
            <label className="label">Rate (₹/kg)</label>
            <input
              type="number" step="0.0001" min={0}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="input num"
            />
          </div>
          <div>
            <label className="label">GST %</label>
            <input
              type="number" step="0.01" min={0} max={28}
              value={gstPct}
              onChange={(e) => setGstPct(e.target.value)}
              className="input num"
            />
          </div>
          <div>
            <label className="label">Charges (₹)</label>
            <div className="input num bg-cloud/60 text-ink-soft flex items-center">
              ₹ {billing.charges.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div>
            <label className="label flex items-center justify-between">
              <span>Round Off (₹)</span>
              {roundOffTouched && (
                <button type="button"
                  onClick={() => { setRoundOffTouched(false); setRoundOff(''); }}
                  className="text-[11px] text-indigo inline-flex items-center gap-0.5"
                  title="Reset to the auto nearest-rupee value">
                  <RotateCcw className="w-3 h-3" /> auto
                </button>
              )}
            </label>
            <input type="number" step="0.01"
              value={roundOffTouched ? roundOff : (billing.autoRoundOff !== 0 ? String(billing.autoRoundOff) : '0.00')}
              onChange={(e) => { setRoundOffTouched(true); setRoundOff(e.target.value); }}
              className="input num" />
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-4">
          <div className="sm:col-start-4">
            <label className="label">Grand Total (₹)</label>
            <div className="input num bg-indigo/5 text-indigo font-bold flex items-center">
              ₹ {grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-ink-mute">
          Charges = Yarn Used (kg) × Rate. Grand Total = Charges + GST + Round Off (auto-set to the nearest rupee, editable).
        </p>
      </div>

      <div className="card p-3 text-xs text-ink-mute bg-amber-50/40 border-amber-200">
        Bills can&rsquo;t be deleted on their own. To remove this bill, delete the
        parent sizing job from the Jobs tab — that drops the bill record along
        with the job.
      </div>

      {error && (
        <div className="card p-3 text-sm text-err bg-rose-50">{error}</div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/app/sizing?tab=bills')}
          className="btn-ghost"
        >
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save bill
        </button>
      </div>
    </form>
  );
}
