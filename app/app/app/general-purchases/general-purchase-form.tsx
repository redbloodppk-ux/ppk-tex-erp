'use client';
/**
 * General Purchase GST bill form — used by /new and /[id] (edit).
 *
 * A catch-all supplier purchase that isn't yarn, bobbin, sizing,
 * fabric, or outsource weaving (packing material, spares, consumables,
 * services, etc.). The operator records the supplier's invoice with a
 * single taxable amount + GST %, and it appears in the Purchase
 * Register keyed off the supplier's invoice date / number.
 *
 * Register-only: there is NO payment tracking here. The bill simply
 * lands in the Purchase Register for the right GST period.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, Trash2, RotateCcw } from 'lucide-react';

export interface PartyOpt {
  id: number;
  code: string | null;
  name: string;
}

export interface GeneralPurchaseInitial {
  id?: number;
  bill_no?: string;
  bill_date?: string;
  supplier_party_id?: number;
  description?: string;
  taxable?: number | string;
  gst_pct?: number | string;
  round_off?: number | string;
  status?: string;
}

interface Props {
  initial?: GeneralPurchaseInitial;
  parties: PartyOpt[];
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function GeneralPurchaseForm({ initial, parties }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof initial?.id === 'number';

  const [form, setForm] = useState({
    bill_no: initial?.bill_no ?? '',
    bill_date: initial?.bill_date ?? todayISO(),
    supplier_party_id: initial?.supplier_party_id != null ? String(initial.supplier_party_id) : '',
    description: initial?.description ?? '',
    taxable: initial?.taxable != null ? String(initial.taxable) : '',
    gst_pct: initial?.gst_pct != null ? String(initial.gst_pct) : '0',
  });
  // Round Off: auto-fills with the nearest-rupee adjustment but stays editable.
  // While untouched we show the auto value; the operator can override it.
  const [roundOff, setRoundOff] = useState<string>(initial?.round_off != null ? String(initial.round_off) : '');
  const [roundOffTouched, setRoundOffTouched] = useState<boolean>(initial?.round_off != null && Number(initial.round_off) !== 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Party type-ahead: a searchable combobox over the full party list.
  // partyQuery holds the visible text; the chosen id lives in form.supplier_party_id.
  const [partyQuery, setPartyQuery] = useState<string>(() => {
    if (initial?.supplier_party_id != null) {
      const p = parties.find((x) => x.id === initial.supplier_party_id);
      return p ? `${p.name}${p.code ? ` · ${p.code}` : ''}` : '';
    }
    return '';
  });
  const [partyOpen, setPartyOpen] = useState(false);

  const filteredParties = useMemo(() => {
    const q = partyQuery.trim().toLowerCase();
    const base = q
      ? parties.filter((p) => p.name.toLowerCase().includes(q) || (p.code ?? '').toLowerCase().includes(q))
      : parties;
    return base.slice(0, 50);
  }, [partyQuery, parties]);

  function pickParty(p: PartyOpt): void {
    setForm((f) => ({ ...f, supplier_party_id: String(p.id) }));
    setPartyQuery(`${p.name}${p.code ? ` · ${p.code}` : ''}`);
    setPartyOpen(false);
  }

  // Base = taxable * (1 + gst/100), to 2 decimals (matches the DB generated col).
  const base = useMemo(() => {
    const t = Number(form.taxable) || 0;
    const g = Number(form.gst_pct) || 0;
    return Math.round(t * (1 + g / 100) * 100) / 100;
  }, [form.taxable, form.gst_pct]);

  // Suggested round-off = adjustment to reach the nearest whole rupee.
  const autoRoundOff = useMemo(() => Math.round((Math.round(base) - base) * 100) / 100, [base]);

  // What we use: the operator's value once they've touched it, else the auto value.
  const effectiveRoundOff = roundOffTouched ? (Number(roundOff) || 0) : autoRoundOff;
  const grandTotal = Math.round((base + effectiveRoundOff) * 100) / 100;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    if (!form.bill_no.trim())          { setError('Bill / invoice number is required.'); return; }
    if (!form.bill_date)               { setError('Bill / invoice date is required.'); return; }
    if (form.supplier_party_id === '') { setError('Pick the party.'); return; }
    const taxable = Number(form.taxable);
    if (!Number.isFinite(taxable) || taxable < 0) { setError('Taxable amount must be zero or more.'); return; }
    const gst = Number(form.gst_pct);
    if (!Number.isFinite(gst) || gst < 0) { setError('GST % must be zero or more.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const payload = {
      bill_no: form.bill_no.trim(),
      bill_date: form.bill_date,
      supplier_party_id: Number(form.supplier_party_id),
      description: form.description.trim() || null,
      taxable,
      gst_pct: gst,
      round_off: effectiveRoundOff,
    };

    if (isEdit && initial?.id != null) {
      const { error: err } = await sb.from('general_purchase').update(payload).eq('id', initial.id);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setOkMsg('Saved.');
      router.push('/app/general-purchases');
      router.refresh();
    } else {
      const { error: err } = await sb.from('general_purchase').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      router.push('/app/general-purchases');
      router.refresh();
    }
  }

  async function onCancelBill(): Promise<void> {
    if (!isEdit || initial?.id == null) return;
    if (!window.confirm('Cancel this general purchase bill? Status flips to "cancelled" — the row stays for audit but drops out of the Purchase Register.')) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('general_purchase').update({ status: 'cancelled' }).eq('id', initial.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push('/app/general-purchases');
    router.refresh();
  }

  async function onDeleteBill(): Promise<void> {
    if (!isEdit || initial?.id == null) return;
    if (!window.confirm('Delete this general purchase bill permanently? This removes the row entirely and cannot be undone.')) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('general_purchase').delete().eq('id', initial.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push('/app/general-purchases');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-5 space-y-4 max-w-3xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Bill / Invoice No *</label>
          <input type="text" required value={form.bill_no}
            onChange={(e) => setForm({ ...form, bill_no: e.target.value })}
            className="input" placeholder="supplier's invoice no" />
        </div>
        <div>
          <label className="label">Bill / Invoice Date *</label>
          <input type="date" required value={form.bill_date}
            onChange={(e) => setForm({ ...form, bill_date: e.target.value })}
            className="input" />
        </div>
      </div>

      <div className="relative">
        <label className="label">Party *</label>
        <input type="text" autoComplete="off" value={partyQuery}
          onChange={(e) => { setPartyQuery(e.target.value); setPartyOpen(true); setForm((f) => ({ ...f, supplier_party_id: '' })); }}
          onFocus={() => setPartyOpen(true)}
          onBlur={() => setTimeout(() => setPartyOpen(false), 150)}
          className="input" placeholder="Type to search party…" />
        {partyOpen && filteredParties.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
            {filteredParties.map((p) => (
              <li key={p.id}>
                <button type="button"
                  onMouseDown={(e) => { e.preventDefault(); pickParty(p); }}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-indigo/5">
                  {p.name}{p.code ? <span className="text-ink-mute"> · {p.code}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {partyOpen && partyQuery.trim() !== '' && filteredParties.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-white shadow-lg px-3 py-2 text-sm text-ink-mute">
            No matching party.
          </div>
        )}
      </div>

      <div>
        <label className="label">Description</label>
        <input type="text" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="input" placeholder="e.g. packing material, machine spares, transport" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Taxable Amount (₹) *</label>
          <input type="number" required min={0} step={0.01}
            value={form.taxable}
            onChange={(e) => setForm({ ...form, taxable: e.target.value })}
            className="input num text-right" placeholder="0.00" />
        </div>
        <div>
          <label className="label">GST %</label>
          <input type="number" min={0} step={0.01}
            value={form.gst_pct}
            onChange={(e) => setForm({ ...form, gst_pct: e.target.value })}
            className="input num text-right" placeholder="0" />
        </div>
        <div>
          <label className="label">Subtotal (Taxable + GST)</label>
          <div className="input num text-right bg-line/30 flex items-center justify-end">
            ₹ {base.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-start-2">
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
          <input type="number" step={0.01}
            value={roundOffTouched ? roundOff : (autoRoundOff !== 0 ? String(autoRoundOff) : '0.00')}
            onChange={(e) => { setRoundOffTouched(true); setRoundOff(e.target.value); }}
            className="input num text-right" placeholder="0.00" />
        </div>
        <div>
          <label className="label">Grand Total (₹)</label>
          <div className="input num text-right bg-indigo/5 text-indigo font-bold flex items-center justify-end">
            ₹ {grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-ink-mute">
        Subtotal = Taxable × (1 + GST%). Grand Total = Subtotal + Round Off (auto-set to the nearest rupee, editable).
        This bill appears in the Purchase Register only — there is no payment tracking here.
      </p>

      {error && <div className="p-3 rounded-lg bg-rose-50 text-rose-800 text-sm">{error}</div>}
      {okMsg && <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm">{okMsg}</div>}

      <div className="flex justify-between gap-2 pt-2">
        <div className="flex gap-2">
          {isEdit && (
            <button type="button" onClick={onCancelBill} disabled={busy}
              className="btn-ghost text-rose-700 text-xs"
              title="Soft-cancel: status='cancelled'. The row stays for audit.">
              <Trash2 className="w-3.5 h-3.5" /> Cancel bill
            </button>
          )}
          {isEdit && (
            <button type="button" onClick={onDeleteBill} disabled={busy}
              className="btn-ghost text-rose-800 text-xs"
              title="Permanently delete this bill row.">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.push('/app/general-purchases')} className="btn-secondary">Back</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save changes' : 'Record bill'}
          </button>
        </div>
      </div>
    </form>
  );
}
