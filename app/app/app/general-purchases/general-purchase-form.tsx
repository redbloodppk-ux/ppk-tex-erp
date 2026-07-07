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
 * Items (optional): the operator can add line items (name, qty, unit,
 * rate, GST %). Each row's amount = qty x rate and carries its own GST,
 * so mixed rates on one bill work. While any item rows exist the
 * Taxable Amount auto-fills with the item total and the bill GST is the
 * sum of per-item taxes (both read-only). With no items, the taxable
 * amount and a single bill-level GST % are typed directly, as before.
 *
 * Register-only: there is NO payment tracking here. The bill simply
 * lands in the Purchase Register for the right GST period.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, Trash2, RotateCcw, Plus, X } from 'lucide-react';

export interface PartyOpt {
  id: number;
  code: string | null;
  name: string;
}

export interface GeneralPurchaseItemInitial {
  id?: number;
  item_name: string;
  qty: number | string;
  unit?: string | null;
  rate: number | string;
  gst_pct?: number | string | null;
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
  items?: GeneralPurchaseItemInitial[];
}

interface Props {
  initial?: GeneralPurchaseInitial;
  parties: PartyOpt[];
}

/** One editable item row: all fields as strings for the inputs. */
interface ItemRow {
  item_name: string;
  qty: string;
  unit: string;
  rate: string;
  gst: string;
}

function rowAmount(r: ItemRow): number {
  const q = Number(r.qty) || 0;
  const rt = Number(r.rate) || 0;
  return Math.round(q * rt * 100) / 100;
}

/** Per-row tax = amount * gst% (mirrors the DB generated gst_amount col). */
function rowGst(r: ItemRow): number {
  const g = Number(r.gst) || 0;
  return Math.round(rowAmount(r) * g) / 100;
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
  // Optional line items. While any rows exist, Taxable auto-fills with
  // the item total; with no rows the operator types taxable directly.
  const [items, setItems] = useState<ItemRow[]>(() =>
    (initial?.items ?? []).map((it) => ({
      item_name: it.item_name ?? '',
      qty: it.qty != null ? String(it.qty) : '',
      unit: it.unit ?? '',
      rate: it.rate != null ? String(it.rate) : '',
      gst: it.gst_pct != null ? String(it.gst_pct) : '0',
    })),
  );

  function addItem(): void {
    // New rows copy the previous row's GST % — most bills share one rate.
    setItems((rows) => [
      ...rows,
      { item_name: '', qty: '1', unit: '', rate: '', gst: rows.length > 0 ? rows[rows.length - 1]!.gst : '0' },
    ]);
  }
  function removeItem(idx: number): void {
    setItems((rows) => rows.filter((_, i) => i !== idx));
  }
  function setItem(idx: number, patch: Partial<ItemRow>): void {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const itemsTotal = useMemo(
    () => Math.round(items.reduce((s, r) => s + rowAmount(r), 0) * 100) / 100,
    [items],
  );
  // Sum of per-item taxes (each row rounded, like the DB column).
  const itemsGstTotal = useMemo(
    () => Math.round(items.reduce((s, r) => s + rowGst(r), 0) * 100) / 100,
    [items],
  );
  const hasItems = items.length > 0;

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

  // Effective taxable: the item total while item rows exist, else the typed value.
  const effectiveTaxable = hasItems ? itemsTotal : (Number(form.taxable) || 0);

  // Subtotal (taxable + GST). With items: taxable + sum of per-item taxes
  // (each row has its own GST %). Without: taxable * (1 + bill GST%).
  const base = useMemo(() => {
    if (hasItems) return Math.round((itemsTotal + itemsGstTotal) * 100) / 100;
    const g = Number(form.gst_pct) || 0;
    return Math.round(effectiveTaxable * (1 + g / 100) * 100) / 100;
  }, [hasItems, itemsTotal, itemsGstTotal, effectiveTaxable, form.gst_pct]);

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
    for (const [i, r] of items.entries()) {
      if (!r.item_name.trim()) { setError(`Item ${i + 1}: name is required.`); return; }
      const q = Number(r.qty);
      if (!Number.isFinite(q) || q < 0) { setError(`Item ${i + 1}: qty must be zero or more.`); return; }
      const rt = Number(r.rate);
      if (!Number.isFinite(rt) || rt < 0) { setError(`Item ${i + 1}: rate must be zero or more.`); return; }
      const rg = Number(r.gst);
      if (!Number.isFinite(rg) || rg < 0) { setError(`Item ${i + 1}: GST % must be zero or more.`); return; }
    }
    const taxable = effectiveTaxable;
    if (!Number.isFinite(taxable) || taxable < 0) { setError('Taxable amount must be zero or more.'); return; }
    // Bill-level gst_pct: with items it's the blended rate (informational —
    // the register's gst_amount comes from total - taxable, which is exact).
    const gst = hasItems
      ? (itemsTotal > 0 ? Math.round((itemsGstTotal / itemsTotal) * 10000) / 100 : 0)
      : Number(form.gst_pct);
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
      // Plain column since migration 237 (per-item GST made a single
      // generated expression impossible): taxable + GST, pre-round-off.
      total: base,
      round_off: effectiveRoundOff,
    };

    // Item rows to persist (amount & gst_amount are generated columns).
    const itemRows = (billId: number) =>
      items.map((r, i) => ({
        general_purchase_id: billId,
        item_name: r.item_name.trim(),
        qty: Number(r.qty) || 0,
        unit: r.unit.trim() || null,
        rate: Number(r.rate) || 0,
        gst_pct: Number(r.gst) || 0,
        position: i,
      }));

    if (isEdit && initial?.id != null) {
      const { error: err } = await sb.from('general_purchase').update(payload).eq('id', initial.id);
      if (err) { setBusy(false); setError(err.message); return; }
      // Simplest reliable sync: replace all item rows for this bill.
      const { error: delErr } = await sb.from('general_purchase_item').delete().eq('general_purchase_id', initial.id);
      if (delErr) { setBusy(false); setError(delErr.message); return; }
      if (items.length > 0) {
        const { error: insErr } = await sb.from('general_purchase_item').insert(itemRows(initial.id));
        if (insErr) { setBusy(false); setError(insErr.message); return; }
      }
      setBusy(false);
      setOkMsg('Saved.');
      router.push('/app/general-purchases');
      router.refresh();
    } else {
      const { data: created, error: err } = await sb.from('general_purchase').insert(payload).select('id').single();
      if (err) { setBusy(false); setError(err.message); return; }
      if (items.length > 0 && created?.id != null) {
        const { error: insErr } = await sb.from('general_purchase_item').insert(itemRows(created.id));
        if (insErr) { setBusy(false); setError(`Bill saved, but items failed: ${insErr.message}`); return; }
      }
      setBusy(false);
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

      {/* Optional line items — while rows exist, Taxable auto-fills with the item total. */}
      <div>
        <div className="flex items-center justify-between">
          <label className="label mb-0">Items</label>
          <button type="button" onClick={addItem}
            className="btn-ghost text-indigo text-xs">
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>
        {items.length > 0 && (
          <div className="mt-2 space-y-2">
            <div className="hidden md:grid md:grid-cols-[1fr_80px_70px_100px_75px_105px_32px] gap-2 text-[11px] text-ink-mute px-1">
              <span>Item</span><span className="text-right">Qty</span><span>Unit</span>
              <span className="text-right">Rate (₹)</span><span className="text-right">GST %</span>
              <span className="text-right">Amount (₹)</span><span />
            </div>
            {items.map((r, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_80px_70px_100px_75px_105px_32px] gap-2 items-center">
                <input type="text" value={r.item_name}
                  onChange={(e) => setItem(i, { item_name: e.target.value })}
                  className="input col-span-2 md:col-span-1" placeholder={`item ${i + 1} — e.g. packing box`} />
                <input type="number" min={0} step={0.001} value={r.qty}
                  onChange={(e) => setItem(i, { qty: e.target.value })}
                  className="input num text-right" placeholder="qty" />
                <input type="text" value={r.unit}
                  onChange={(e) => setItem(i, { unit: e.target.value })}
                  className="input" placeholder="pcs" />
                <input type="number" min={0} step={0.01} value={r.rate}
                  onChange={(e) => setItem(i, { rate: e.target.value })}
                  className="input num text-right" placeholder="rate" />
                <input type="number" min={0} step={0.01} value={r.gst}
                  onChange={(e) => setItem(i, { gst: e.target.value })}
                  className="input num text-right" placeholder="gst %"
                  title="GST % for this item only" />
                <div className="input num text-right bg-line/30 flex items-center justify-end"
                  title={`+ ₹${rowGst(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GST`}>
                  {rowAmount(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <button type="button" onClick={() => removeItem(i)}
                  className="text-rose-700 hover:text-rose-900 flex items-center justify-center"
                  title="Remove this item row">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="flex justify-end gap-4 text-sm font-medium pr-10">
              <span>Item total: ₹ {itemsTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span>GST: ₹ {itemsGstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Taxable Amount (₹) *</label>
          {hasItems ? (
            <div className="input num text-right bg-line/30 flex items-center justify-end"
              title="Auto-filled from the item rows above">
              ₹ {itemsTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          ) : (
            <input type="number" required min={0} step={0.01}
              value={form.taxable}
              onChange={(e) => setForm({ ...form, taxable: e.target.value })}
              className="input num text-right" placeholder="0.00" />
          )}
        </div>
        <div>
          {hasItems ? (
            <>
              <label className="label">GST (₹)</label>
              <div className="input num text-right bg-line/30 flex items-center justify-end"
                title="Sum of per-item GST — each item row carries its own GST %">
                ₹ {itemsGstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </>
          ) : (
            <>
              <label className="label">GST %</label>
              <input type="number" min={0} step={0.01}
                value={form.gst_pct}
                onChange={(e) => setForm({ ...form, gst_pct: e.target.value })}
                className="input num text-right" placeholder="0" />
            </>
          )}
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
        Items are optional — while item rows exist, each row has its own GST %: Taxable auto-fills with the item
        total (qty × rate per row) and GST is the sum of per-item taxes. Without items, Subtotal = Taxable × (1 + GST%).
        Grand Total = Subtotal + Round Off (auto-set to the nearest rupee, editable).
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
