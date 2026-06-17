'use client';
/**
 * Sales Order capture form (used by /app/orders/new).
 *
 * Captures one SO per save:
 *   - Customer + dates (order / delivery / expected payment)
 *   - 1..N lines: fabric quality + UoM (m or pcs) + qty + rate -> amount
 *   - Computed subtotal (no GST on quoted price — GST is added at
 *     invoice time, when the bill-to state is known). For the SO we
 *     store subtotal == total and gst_amount = 0.
 *
 * Once saved the SO is INSERTed with status 'approved' (the closest enum
 * value to the operator's mental "confirmed"). Number is minted via the
 * existing fn_next_doc_no('so') routine.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';

interface CustomerOpt {
  id: number;
  code: string | null;
  name: string;
}

interface QualityOpt {
  id: number;
  code: string | null;
  name: string;
  hsn: string | null;
  rate_per_m: number | null;
  meter_per_pc: number | null;
  fabric_type: string | null;
}

type Uom = 'm' | 'pcs';

interface SoLine {
  fabric_quality_id: string;
  uom: Uom;
  quantity: string;   // raw input — interpretation depends on uom
  pieces: string;     // only used when uom='pcs' or quality is towel-like
  rate: string;       // Rs per uom unit
}

interface SoFormValues {
  customer_id: string;
  order_date: string;
  delivery_date: string;
  payment_date: string;
  notes: string;
  lines: SoLine[];
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function num(s: string): number {
  const t = (s ?? '').toString().trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function emptyLine(): SoLine {
  return {
    fabric_quality_id: '',
    uom: 'm',
    quantity: '',
    pieces: '',
    rate: '',
  };
}

const EMPTY_FORM: SoFormValues = {
  customer_id: '',
  order_date: todayISO(),
  delivery_date: '',
  payment_date: '',
  notes: '',
  lines: [emptyLine()],
};

export function SalesOrderForm(): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState<SoFormValues>(EMPTY_FORM);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [qualities, setQualities] = useState<QualityOpt[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [custRes, fqRes] = await Promise.all([
        sb.from('customer')
          .select('id, code, name')
          .eq('status', 'active')
          .order('name'),
        sb.from('fabric_quality')
          .select('id, code, name, hsn, rate_per_m, meter_per_pc, fabric_type')
          .eq('active', true)
          .order('name'),
      ]);
      setCustomers((custRes.data ?? []) as CustomerOpt[]);
      setQualities((fqRes.data ?? []) as QualityOpt[]);
    })();
  }, [supabase]);

  const customerOptions = useMemo<SearchSelectOption[]>(
    () => customers.map((c) => ({
      value: String(c.id),
      label: c.code ? `${c.code} - ${c.name}` : c.name,
    })),
    [customers],
  );

  const qualityById = useMemo(
    () => new Map(qualities.map((q) => [q.id, q])),
    [qualities],
  );

  function setLine(idx: number, patch: Partial<SoLine>): void {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  }

  function pickQuality(idx: number, fqIdStr: string): void {
    const fq = qualityById.get(Number(fqIdStr));
    setLine(idx, {
      fabric_quality_id: fqIdStr,
      // Pre-fill rate from the master so the operator only has to
      // override when the customer negotiates a different number.
      rate: fq?.rate_per_m != null ? String(fq.rate_per_m) : '',
    });
  }

  function addLine(): void {
    setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  }

  function removeLine(idx: number): void {
    setForm((f) => ({
      ...f,
      lines: f.lines.length === 1
        ? f.lines
        : f.lines.filter((_, i) => i !== idx),
    }));
  }

  // Compute per-line totals (metres / pieces / amount). The quantity
  // input is interpreted by UoM:
  //   uom = 'm'   -> quantity is metres; if the quality has a
  //                  meter_per_pc we also report equivalent pieces for
  //                  the operator's reference (towels mostly).
  //   uom = 'pcs' -> quantity is piece count; metres are derived from
  //                  pieces * meter_per_pc when known (else null).
  function lineTotals(l: SoLine): { metres: number; pieces: number; amount: number } {
    const fq = l.fabric_quality_id === '' ? null : qualityById.get(Number(l.fabric_quality_id)) ?? null;
    const mPerPc = fq?.meter_per_pc != null ? Number(fq.meter_per_pc) : 0;
    const qty = num(l.quantity);
    const rate = num(l.rate);
    let metres = 0;
    let pieces = 0;
    if (l.uom === 'pcs') {
      pieces = qty;
      metres = mPerPc > 0 ? qty * mPerPc : 0;
    } else {
      metres = qty;
      pieces = mPerPc > 0 ? qty / mPerPc : num(l.pieces);
    }
    const amount = qty * rate;
    return { metres, pieces, amount };
  }

  const totals = useMemo(() => {
    let metres = 0, pieces = 0, subtotal = 0;
    for (const l of form.lines) {
      const t = lineTotals(l);
      metres += t.metres;
      pieces += t.pieces;
      subtotal += t.amount;
    }
    return { metres, pieces, subtotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.lines, qualities]);

  async function handleSave(): Promise<void> {
    setError(null);
    if (form.customer_id === '') { setError('Pick a customer.'); return; }
    if (form.delivery_date === '') { setError('Pick a delivery date.'); return; }
    if (form.lines.length === 0) { setError('Add at least one line.'); return; }
    for (let i = 0; i < form.lines.length; i++) {
      const l = form.lines[i]!;
      if (l.fabric_quality_id === '') { setError(`Line ${i + 1}: pick a fabric quality.`); return; }
      if (num(l.quantity) <= 0) { setError(`Line ${i + 1}: quantity must be > 0.`); return; }
      if (num(l.rate) <= 0) { setError(`Line ${i + 1}: rate must be > 0.`); return; }
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Mint the SO number via the shared helper. Falls back to a stub
    // if the RPC isn't accessible (shouldn't happen — fn_next_doc_no is
    // SECURITY DEFINER) so the save never silently uses a duplicate.
    let soNumber: string;
    const { data: rpcData, error: rpcErr } = await sb.rpc('fn_next_doc_no', { p_doc_type: 'so' });
    if (rpcErr || typeof rpcData !== 'string' || rpcData === '') {
      setBusy(false);
      setError(rpcErr?.message ?? 'Could not mint SO number.');
      return;
    }
    soNumber = rpcData;

    const subtotal = totals.subtotal;
    const headerPayload = {
      so_number: soNumber,
      customer_id: Number(form.customer_id),
      business_model: 'inhouse',
      order_date: form.order_date,
      delivery_date: form.delivery_date,
      payment_date: form.payment_date === '' ? null : form.payment_date,
      status: 'approved',
      subtotal,
      gst_amount: 0,
      total: subtotal,
      notes: form.notes || null,
    };

    const { data: soRow, error: soErr } = await sb
      .from('sales_order')
      .insert(headerPayload)
      .select('id')
      .single();
    if (soErr || !soRow?.id) {
      setBusy(false);
      setError(soErr?.message ?? 'Could not save SO.');
      return;
    }
    const soId = soRow.id as number;

    const linesPayload = form.lines.map((l) => {
      const t = lineTotals(l);
      const qty = num(l.quantity);
      const rate = num(l.rate);
      return {
        so_id: soId,
        fabric_quality_id: Number(l.fabric_quality_id),
        // Keep quantity_m as the canonical metres figure so downstream
        // dispatch tracking (delivered_m vs quantity_m) keeps working
        // regardless of how the line was quoted.
        quantity_m: t.metres > 0 ? t.metres : qty,
        rate_per_m: rate,
        amount: t.amount,
        uom: l.uom,
        pieces: l.uom === 'pcs' ? qty : (t.pieces > 0 ? t.pieces : null),
        delivered_m: 0,
        notes: null,
      };
    });

    const { error: linesErr } = await sb.from('sales_order_line').insert(linesPayload);
    if (linesErr) {
      setBusy(false);
      setError(linesErr.message);
      return;
    }

    setBusy(false);
    router.push('/app/orders');
    router.refresh();
  }

  return (
    <form
      className="card p-5 space-y-5 max-w-5xl"
      onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
    >
      {/* Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-3">
          <label className="label">Customer *</label>
          <SearchSelect
            options={customerOptions}
            value={form.customer_id}
            onChange={(v) => setForm({ ...form, customer_id: v })}
            required
            placeholder="Type to search customer name…"
          />
        </div>
        <div>
          <label className="label">Order Date *</label>
          <input
            type="date"
            className="input"
            required
            value={form.order_date}
            onChange={(e) => setForm({ ...form, order_date: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Delivery Date *</label>
          <input
            type="date"
            className="input"
            required
            value={form.delivery_date}
            onChange={(e) => setForm({ ...form, delivery_date: e.target.value })}
          />
        </div>
        <div>
          <label className="label">
            Expected Payment Date
            <span className="text-[10px] text-ink-mute font-normal ml-2">(optional)</span>
          </label>
          <input
            type="date"
            className="input"
            value={form.payment_date}
            onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
          />
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-line bg-paper">
        <div className="flex items-center justify-between p-3 border-b border-line/60">
          <h3 className="font-display font-bold text-sm">Lines</h3>
          <button type="button" className="btn-ghost text-xs" onClick={addLine}>
            <Plus className="w-3.5 h-3.5" /> Add line
          </button>
        </div>
        <div className="p-3 space-y-3">
          {form.lines.map((l, idx) => {
            const t = lineTotals(l);
            const fq = l.fabric_quality_id === '' ? null : qualityById.get(Number(l.fabric_quality_id)) ?? null;
            const mPerPc = fq?.meter_per_pc != null ? Number(fq.meter_per_pc) : 0;
            const rateLabel = l.uom === 'pcs' ? 'Rate (Rs/pc)' : 'Rate (Rs/m)';
            const qtyLabel = l.uom === 'pcs' ? 'Quantity (pcs)' : 'Quantity (m)';
            return (
              <div key={idx} className="rounded-lg border border-line bg-cloud/10 p-3 space-y-3">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-5">
                    <label className="label text-[10px]">Fabric Quality *</label>
                    <select
                      className="input h-9 text-sm w-full"
                      value={l.fabric_quality_id}
                      onChange={(e) => pickQuality(idx, e.target.value)}
                      required
                    >
                      <option value="">--- pick ---</option>
                      {qualities.map((q) => (
                        <option key={q.id} value={q.id}>{q.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <label className="label text-[10px]">UoM *</label>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => setLine(idx, { uom: 'm' })}
                        className={'px-2 py-2 rounded-lg text-xs font-semibold border ' +
                          (l.uom === 'm'
                            ? 'border-transparent bg-indigo-600 text-white'
                            : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
                        Metres
                      </button>
                      <button
                        type="button"
                        onClick={() => setLine(idx, { uom: 'pcs' })}
                        className={'px-2 py-2 rounded-lg text-xs font-semibold border ' +
                          (l.uom === 'pcs'
                            ? 'border-transparent bg-indigo-600 text-white'
                            : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
                        Pieces
                      </button>
                    </div>
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <label className="label text-[10px]">{qtyLabel} *</label>
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      className="input h-9 text-sm num text-right"
                      value={l.quantity}
                      onChange={(e) => setLine(idx, { quantity: e.target.value })}
                      required
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <label className="label text-[10px]">{rateLabel} *</label>
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      className="input h-9 text-sm num text-right"
                      value={l.rate}
                      onChange={(e) => setLine(idx, { rate: e.target.value })}
                      required
                    />
                  </div>
                  <div className="col-span-6 md:col-span-1 flex justify-end pt-5">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={form.lines.length === 1}
                      className="p-1.5 rounded hover:bg-rose-50 text-rose-600 disabled:opacity-40"
                      title={form.lines.length === 1 ? 'At least one line is required' : 'Remove line'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Per-line snapshot row */}
                <div className="flex flex-wrap justify-end gap-4 border-t border-line/40 pt-2 text-xs">
                  {mPerPc > 0 && (
                    <div className="text-ink-mute">
                      {mPerPc.toFixed(2)} m / pc
                    </div>
                  )}
                  <div>
                    Metres: <span className="num font-bold text-indigo-700">{t.metres.toFixed(2)}</span>
                  </div>
                  <div>
                    Pieces: <span className="num font-bold">{t.pieces > 0 ? t.pieces.toFixed(2) : '-'}</span>
                  </div>
                  <div>
                    Amount: <span className="num font-bold text-emerald-700">Rs {t.amount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Totals */}
        <div className="border-t-2 border-line bg-cloud/40 px-3 py-3 flex flex-wrap justify-end gap-6 text-sm font-semibold">
          <div>SO Metres: <span className="num text-indigo-700">{totals.metres.toFixed(2)} m</span></div>
          <div>SO Pieces: <span className="num">{totals.pieces > 0 ? totals.pieces.toFixed(2) : '-'}</span></div>
          <div>Subtotal: <span className="num text-emerald-700">Rs {totals.subtotal.toFixed(2)}</span></div>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea
          className="input min-h-[60px]"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      {error !== null && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-2">{error}</div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Create Sales Order
        </button>
      </div>
    </form>
  );
}
