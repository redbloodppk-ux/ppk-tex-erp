'use client';
/**
 * Sizing Job edit form.
 *
 * Loaded from the Jobs tab on /app/sizing via the Edit pencil. The
 * yarn-lot draw + beam structure is set in stone at job creation
 * (the lot's current_kg was decremented and child pavu rows were
 * inserted), so this form deliberately leaves them read-only — the
 * safe-to-edit fields are: yarn used / set no / status / notes plus
 * the bill section (number, date, rate, GST).
 *
 * Operators who need to change yarn lot or beams should delete the
 * job and re-create it (the Delete button on the Jobs tab restores
 * the source lot's stock).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save } from 'lucide-react';

export interface JobEditSeed {
  id: number;
  job_code: string;
  sizing_vendor_name: string;
  yarn_supplier_name: string;
  warp_count_code: string;
  yarn_sent_kg: number;
  yarn_used_kg: number;
  no_of_paavu: number;
  set_no: string;
  status: string;
  notes: string;
  bill_no: string;
  bill_date: string;
  sizing_rate_per_kg: number;
  gst_pct: number;
}

interface Props {
  seed: JobEditSeed;
}

const STATUS_OPTIONS = ['received', 'in_process', 'assigned', 'done', 'cancelled'] as const;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function JobEditForm({ seed }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [setNo,     setSetNo]     = useState<string>(seed.set_no ?? '');
  const [yarnUsedKg, setYarnUsedKg] = useState<string>(String(seed.yarn_used_kg ?? 0));
  const [status,    setStatus]    = useState<string>(seed.status ?? 'received');
  const [notes,     setNotes]     = useState<string>(seed.notes ?? '');

  const [billNo,    setBillNo]    = useState<string>(seed.bill_no ?? '');
  const [billDate,  setBillDate]  = useState<string>(seed.bill_date ?? todayISO());
  const [rate,      setRate]      = useState<string>(String(seed.sizing_rate_per_kg ?? 0));
  const [gstPct,    setGstPct]    = useState<string>(String(seed.gst_pct ?? 0));

  const [busy,  setBusy]  = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const billing = useMemo(() => {
    const kg = Number(yarnUsedKg) || 0;
    const r  = Number(rate)       || 0;
    const g  = Number(gstPct)     || 0;
    const chargesRaw = kg * r;
    const totalRaw   = chargesRaw * (1 + g / 100);
    return {
      charges: Math.round(chargesRaw),
      total:   Math.round(totalRaw),
    };
  }, [yarnUsedKg, rate, gstPct]);

  const balance = useMemo(() => seed.yarn_sent_kg - (Number(yarnUsedKg) || 0), [seed.yarn_sent_kg, yarnUsedKg]);

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
        set_no:             setNo.trim() || null,
        yarn_used_kg:       Number(yarnUsedKg) || 0,
        status,
        notes:              notes.trim() || null,
        bill_no:            billNo.trim(),
        bill_date:          billDate,
        sizing_rate_per_kg: Number(rate)   || 0,
        gst_pct:            Number(gstPct) || 0,
        charges_amount:     billing.charges,
        total_amount:       billing.total,
      })
      .eq('id', seed.id);
    if (updErr) {
      setBusy(false);
      setError(updErr.message);
      return;
    }
    router.push('/app/sizing?tab=jobs');
    router.refresh();
  }

  return (
    <form className="space-y-4 max-w-4xl" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* Read-only context — fields that can't be edited safely. */}
      <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="label">Job</div>
          <div className="font-mono">{seed.job_code}</div>
        </div>
        <div>
          <div className="label">Sizing Mill</div>
          <div>{seed.sizing_vendor_name}</div>
        </div>
        <div>
          <div className="label">Yarn Supplier</div>
          <div>{seed.yarn_supplier_name}</div>
        </div>
        <div>
          <div className="label">Warp Count</div>
          <div className="font-mono">{seed.warp_count_code}</div>
        </div>
        <div>
          <div className="label">Yarn Sent (kg)</div>
          <div className="num">{seed.yarn_sent_kg.toFixed(2)}</div>
          <div className="text-[10px] text-ink-mute mt-0.5">Fixed at creation</div>
        </div>
        <div>
          <div className="label">Beams</div>
          <div className="num">{seed.no_of_paavu}</div>
        </div>
        <div>
          <div className="label">Balance (kg)</div>
          <div className={'num font-bold ' + (balance < 0 ? 'text-rose-700' : 'text-emerald-700')}>
            {balance.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Editable job-level fields. */}
      <div className="card p-4 space-y-4">
        <h2 className="font-display font-bold text-sm">Job details</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Vendor SET NO</label>
            <input
              type="text" value={setNo}
              onChange={(e) => setSetNo(e.target.value)}
              className="input num" placeholder="e.g. 994"
            />
          </div>
          <div>
            <label className="label">Yarn Used (kg)</label>
            <input
              type="number" step="0.001" min={0} value={yarnUsedKg}
              onChange={(e) => setYarnUsedKg(e.target.value)}
              className="input num"
            />
            <p className="text-[11px] text-ink-mute mt-1">Cumulative consumption — drives bill charges.</p>
          </div>
          <div>
            <label className="label">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="input"
            placeholder="Optional remarks"
          />
        </div>
      </div>

      {/* Bill section. */}
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
              type="number" step="0.0001" min={0} value={rate}
              onChange={(e) => setRate(e.target.value)} className="input num"
            />
          </div>
          <div>
            <label className="label">GST %</label>
            <input
              type="number" step="0.01" min={0} max={28} value={gstPct}
              onChange={(e) => setGstPct(e.target.value)} className="input num"
            />
          </div>
          <div>
            <label className="label">Charges (₹)</label>
            <div className="input num bg-cloud/60 text-ink-soft flex items-center">
              ₹ {billing.charges.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div>
            <label className="label">Total with GST (₹)</label>
            <div className="input num bg-indigo/5 text-indigo font-bold flex items-center">
              ₹ {billing.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-ink-mute">
          Charges = Yarn Used (kg) × Rate. Bill totals are rounded to whole rupees.
        </p>
      </div>

      {error && (
        <div className="card p-3 text-sm text-err bg-rose-50">{error}</div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/app/sizing?tab=jobs')}
          className="btn-ghost"
        >
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save job
        </button>
      </div>
    </form>
  );
}
