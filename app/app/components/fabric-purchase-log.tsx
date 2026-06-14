/**
 * FabricPurchaseLog - purchase log of every fabric batch the mill has
 * bought. Two source modes:
 *
 *   - 'supplier' (default): fabric was bought from a Mill / Yarn
 *      Supplier as a regular purchase. Creates a payable in the
 *      mill's books.
 *   - 'customer': a customer handed over fabric in lieu of paying
 *      their unpaid bills. The fabric_purchase row records the
 *      inventory side; a synthetic payment row (mode =
 *      'fabric_adjustment') records the money side and clears
 *      whichever bills the operator ticks via UnpaidBillsPicker.
 *
 * Mandatory: quality, party, quantity, rate, invoice_no.
 *
 * The form is hidden by default; "Add Purchase" reveals it, "Edit"
 * loads an existing row into it.
 */
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
import { UnpaidBillsPicker, splitAllocationsByKind, type BillAllocation } from '@/app/components/unpaid-bills-picker';
import { Loader2, Plus, CheckCircle2, Trash2, Pencil, X, Save } from 'lucide-react';

type RateUnit = 'm' | 'pcs';
type Delivery = 'in_house' | 'sizing';
type SourceMode = 'supplier' | 'customer';

interface FabricRow {
  id: number;
  code: string;
  fabric_quality_id: number | null;
  /** Free-form quality name — set by supplier-purchase mode when the
   *  fabric isn't one of the in-house production qualities. */
  quality_text: string | null;
  supplier_party_id: number | null;
  received_date: string;
  // Either metres or pieces is populated depending on rate_unit;
  // both can be null (legacy rows or per-piece purchases).
  received_metres: number | null;
  received_pieces: number | null;
  rate_unit: RateUnit;
  rate: number;
  gst_pct: number;
  total_amount: number;
  invoice_no: string | null;
  notes: string | null;
  delivery_destination: Delivery;
}

interface QualityOption { id: number; code: string | null; name: string; }
interface PartyOption { id: number; code: string; name: string; }

interface FormState {
  /** Whether this row came from a supplier purchase or a customer
   *  fabric-in-lieu-of-payment adjustment. */
  source:               SourceMode;
  /** Used in customer-adjustment mode — points to the in-house
   *  fabric_quality master row. Empty in supplier-purchase mode. */
  fabric_quality_id:    string;
  /** Used in supplier-purchase mode — free-form quality name the
   *  operator types in. Empty in customer-adjustment mode. */
  quality_text:         string;
  /** Party FK. Holds either a supplier id (source='supplier') or a
   *  customer id (source='customer'). Stored under the existing
   *  supplier_party_id column either way — that column is just an
   *  FK to party, not type-restricted. */
  supplier_party_id:    string;
  received_date:        string;
  // Single quantity field. Interpreted as metres when rate_unit='m'
  // and as pieces when rate_unit='pcs'. On save we route it into the
  // matching DB column (received_metres or received_pieces) so the
  // table never carries a fake 0 for the unused unit.
  quantity:             string;
  rate_unit:            RateUnit;
  rate:                 string;
  gst_pct:              string;
  invoice_no:           string;
  notes:                string;
  delivery_destination: Delivery;
}

const EMPTY: FormState = {
  source:               'supplier',
  fabric_quality_id:    '',
  quality_text:         '',
  supplier_party_id:    '',
  received_date:        '',
  quantity:             '',
  rate_unit:            'm',
  rate:                 '',
  gst_pct:              '5',
  invoice_no:           '',
  notes:                '',
  delivery_destination: 'in_house',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

function fmtDate(s: string | null): string {
  if (s === null || s === '') return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear());
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function deliveryLabel(d: Delivery): string {
  return d === 'in_house' ? 'In-house warehouse' : 'Sizing warehouse';
}

export function FabricPurchaseLog(): React.ReactElement {
  const supabase = createClient();

  const [rows, setRows] = useState<FabricRow[]>([]);
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [formOpen,  setFormOpen]  = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form,      setForm]      = useState<FormState>(EMPTY);
  const [busy,      setBusy]      = useState(false);
  // Customer-mode allocation state — emitted from UnpaidBillsPicker.
  const [customerAllocs, setCustomerAllocs] = useState<BillAllocation[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Resolve the party_type ids we care about so we can filter the
    // party picker dropdowns correctly in each source mode.
    const ptRes = await sb.from('party_type_master')
      .select('id, name')
      .in('name', ['Mill / Yarn Supplier', 'Customer']);
    const ptByName: Record<string, number> = {};
    for (const p of (ptRes.data ?? []) as Array<{ id: number; name: string }>) {
      ptByName[p.name] = p.id;
    }
    const supplierTypeId = ptByName['Mill / Yarn Supplier'];
    const customerTypeId = ptByName['Customer'];

    const [rowsRes, qRes, sRes, cRes] = await Promise.all([
      sb.from('fabric_purchase')
        .select('id, code, fabric_quality_id, quality_text, supplier_party_id, received_date, received_metres, received_pieces, rate_unit, rate, gst_pct, total_amount, invoice_no, notes, delivery_destination')
        .eq('status', 'active')
        .order('received_date', { ascending: false })
        .order('id', { ascending: false }),
      sb.from('fabric_quality')
        .select('id, code, name')
        .eq('active', true)
        .order('name'),
      supplierTypeId !== undefined
        ? sb.from('party')
            .select('id, code, name')
            .contains('party_type_ids', [supplierTypeId])
            .eq('status', 'active')
            .order('name')
        : Promise.resolve({ data: [] as PartyOption[], error: null }),
      customerTypeId !== undefined
        ? sb.from('party')
            .select('id, code, name')
            .contains('party_type_ids', [customerTypeId])
            .eq('status', 'active')
            .order('name')
        : Promise.resolve({ data: [] as PartyOption[], error: null }),
    ]);
    if (rowsRes.error)    setError(rowsRes.error.message);
    else if (qRes.error)  setError(qRes.error.message);
    else if (sRes.error)  setError(sRes.error.message);
    else if (cRes.error)  setError(cRes.error.message);
    else {
      setRows((rowsRes.data ?? []) as unknown as FabricRow[]);
      setQualities((qRes.data ?? []) as unknown as QualityOption[]);
      setSuppliers((sRes.data ?? []) as unknown as PartyOption[]);
      setCustomers((cRes.data ?? []) as unknown as PartyOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // Total preview matches the DB GENERATED column:
  //   qty × rate × (1 + gst/100), where qty is whatever the operator
  //   entered in the single Quantity field.
  const totalPreview = useMemo<number>(() => {
    const rate = toNumOrNull(form.rate) ?? 0;
    const gst  = toNumOrNull(form.gst_pct) ?? 0;
    const qty  = toNumOrNull(form.quantity) ?? 0;
    return Math.round(qty * rate * (1 + gst / 100) * 100) / 100;
  }, [form.quantity, form.rate, form.gst_pct]);

  function openNewForm(): void {
    setEditingId(null);
    setForm({ ...EMPTY, received_date: todayISO() });
    setCustomerAllocs([]);
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function openEditForm(r: FabricRow): void {
    setEditingId(r.id);
    // Hydrate the single Quantity field from whichever DB column is
    // populated based on the saved rate_unit. Edit always opens in
    // supplier mode — customer-adjustment rows aren't re-allocated
    // from this form (operator deletes + re-adds, or edits the
    // synthetic payment from /app/payments).
    const qty = r.rate_unit === 'm'
      ? (r.received_metres ?? 0)
      : (r.received_pieces ?? 0);
    setForm({
      source:               'supplier',
      fabric_quality_id:    r.fabric_quality_id === null ? '' : String(r.fabric_quality_id),
      quality_text:         r.quality_text ?? '',
      supplier_party_id:    r.supplier_party_id === null ? '' : String(r.supplier_party_id),
      received_date:        r.received_date,
      quantity:             String(qty),
      rate_unit:            r.rate_unit,
      rate:                 String(r.rate),
      gst_pct:              String(r.gst_pct),
      invoice_no:           r.invoice_no ?? '',
      notes:                r.notes ?? '',
      delivery_destination: r.delivery_destination,
    });
    setCustomerAllocs([]);
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function closeForm(): void {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
    setCustomerAllocs([]);
  }

  /** Picker options depend on the source mode. */
  const partyOptions = useMemo<SearchSelectOption[]>(() => {
    const src = form.source === 'customer' ? customers : suppliers;
    return src.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` }));
  }, [form.source, suppliers, customers]);

  /** Numeric party id, null if not picked yet. */
  const pickedPartyId: number | null = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);

  async function handleSave(): Promise<void> {
    setError(null);
    setSavedMsg(null);

    const qualityId   = form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id);
    const qualityText = form.quality_text.trim();
    const partyId     = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);
    const quantity    = toNumOrNull(form.quantity);
    const rate        = toNumOrNull(form.rate);
    const gst         = toNumOrNull(form.gst_pct) ?? 0;
    const isCustomer  = form.source === 'customer';
    const partyLabel  = isCustomer ? 'Customer' : 'Supplier';

    // Quality validation by mode:
    //   - Supplier purchase: must type a quality name (free text)
    //   - Customer adjustment: must pick a quality from the master
    if (isCustomer) {
      if (qualityId === null) { setError('Fabric quality is required.'); return; }
    } else {
      if (qualityText === '') { setError('Fabric quality (type the name) is required.'); return; }
    }
    if (partyId === null)                    { setError(`${partyLabel} is required.`); return; }
    if (form.received_date.trim() === '')    { setError('Purchase date is required.'); return; }
    if (quantity === null || quantity <= 0)  { setError('Quantity must be greater than zero.'); return; }
    if (rate === null || rate < 0)           { setError('Rate is required.'); return; }
    if (form.invoice_no.trim() === '')       { setError('Invoice number is required.'); return; }

    // Route the single Quantity field into the matching DB column.
    // The other column stays NULL so reports never double-count.
    const isMetres = form.rate_unit === 'm';
    const payload = {
      // Quality lives in one of two columns by source mode:
      //   supplier purchase  -> quality_text (free form)
      //   customer adjustment -> fabric_quality_id (FK to master)
      fabric_quality_id:    isCustomer ? qualityId : null,
      quality_text:         isCustomer ? null      : qualityText,
      supplier_party_id:    partyId,
      received_date:        form.received_date,
      received_metres:      isMetres ? quantity : null,
      received_pieces:      isMetres ? null     : Math.round(quantity),
      rate_unit:            form.rate_unit,
      rate,
      gst_pct:              gst,
      invoice_no:           form.invoice_no.trim(),
      notes:                form.notes.trim() === '' ? null : form.notes.trim(),
      delivery_destination: form.delivery_destination,
      // current_metres is meaningful only for metres-bought rows.
      ...(editingId === null && isMetres ? { current_metres: quantity } : {}),
    };

    // Pre-compute the fabric value so we can use it as the synthetic
    // payment amount in customer mode. Matches the generated total_amount
    // formula: qty * rate * (1 + gst/100).
    const fabricTotal = Math.round(quantity * rate * (1 + gst / 100) * 100) / 100;

    // Customer mode save-guard: if any bills are ticked, the
    // allocations must add up to ≤ the fabric total. Leftover goes to
    // advance credit, which is OK — but over-adjusting isn't.
    if (isCustomer) {
      const allocSum = customerAllocs.reduce((s, a) => s + a.amount, 0);
      if (allocSum > fabricTotal + 0.005) {
        setError(`Adjusted ₹${allocSum.toFixed(2)} is more than the fabric value ₹${fabricTotal.toFixed(2)}. Reduce the bill adjustments.`);
        return;
      }
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    if (editingId === null) {
      const { data: inserted, error: err } = await sb
        .from('fabric_purchase')
        .insert(payload)
        .select('id, total_amount')
        .single();
      if (err) { setBusy(false); setError(err.message); return; }

      // Customer mode: create the synthetic payment row + allocations.
      if (isCustomer && inserted?.id) {
        const fabricPurchaseId = inserted.id as number;
        const amount = Number(inserted.total_amount ?? fabricTotal);
        const stamp = Date.now().toString().slice(-6);
        const paymentNo = 'FAB-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + stamp;
        const { data: pmt, error: pErr } = await sb
          .from('payment')
          .insert({
            payment_no:         paymentNo,
            direction:          'in',
            party_id:           partyId,
            payment_date:       form.received_date,
            amount,
            mode:               'fabric_adjustment',
            reference:          form.invoice_no.trim() || null,
            notes:              `Fabric adjustment for purchase ${inserted.id} (${form.invoice_no.trim()})`,
            fabric_purchase_id: fabricPurchaseId,
          })
          .select('id, payment_no')
          .single();
        if (pErr) {
          setBusy(false);
          setError(`Fabric saved, but the money side failed to record: ${pErr.message}`);
          await load();
          return;
        }
        if (customerAllocs.length > 0 && pmt?.id) {
          const buckets = splitAllocationsByKind(customerAllocs);
          const pid = pmt.id as number;
          if (buckets.invoices.length) {
            const { error: e } = await sb.from('payment_allocation')
              .insert(buckets.invoices.map((a) => ({ ...a, payment_id: pid })));
            if (e) { setBusy(false); setError(`Fabric saved, invoice allocations failed: ${e.message}`); await load(); return; }
          }
          if (buckets.openings.length) {
            const { error: e } = await sb.from('payment_opening_allocation')
              .insert(buckets.openings.map((a) => ({ ...a, payment_id: pid })));
            if (e) { setBusy(false); setError(`Fabric saved, opening allocations failed: ${e.message}`); await load(); return; }
          }
          if (buckets.sizings.length) {
            const { error: e } = await sb.from('payment_sizing_allocation')
              .insert(buckets.sizings.map((a) => ({ ...a, payment_id: pid })));
            if (e) { setBusy(false); setError(`Fabric saved, sizing allocations failed: ${e.message}`); await load(); return; }
          }
          if (buckets.bobbins.length) {
            const { error: e } = await sb.from('payment_bobbin_allocation')
              .insert(buckets.bobbins.map((a) => ({ ...a, payment_id: pid })));
            if (e) { setBusy(false); setError(`Fabric saved, bobbin allocations failed: ${e.message}`); await load(); return; }
          }
          if (buckets.yarns.length) {
            const { error: e } = await sb.from('payment_yarn_allocation')
              .insert(buckets.yarns.map((a) => ({ ...a, payment_id: pid })));
            if (e) { setBusy(false); setError(`Fabric saved, yarn allocations failed: ${e.message}`); await load(); return; }
          }
        }
        const allocSum = customerAllocs.reduce((s, a) => s + a.amount, 0);
        setSavedMsg(
          customerAllocs.length > 0
            ? `Added customer-adjustment purchase. ₹${allocSum.toFixed(2)} adjusted against ${customerAllocs.length} bill${customerAllocs.length === 1 ? '' : 's'}.`
            : 'Added customer-adjustment purchase. Fabric value sits as advance credit on their ledger.',
        );
      } else {
        setSavedMsg('Added purchase.');
      }
      setBusy(false);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await sb.from('fabric_purchase').update(payload).eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Updated.');
    }
    closeForm();
    await load();
  }

  async function deleteRow(id: number, code: string): Promise<void> {
    const ok = window.confirm('Delete fabric purchase ' + code + '?\n\nIf any downstream record references this batch, the database will block the delete.');
    if (ok === false) return;
    setError(null);
    setSavedMsg(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('fabric_purchase').delete().eq('id', id);
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + code + '.');
  }

  function qualityLabel(r: FabricRow): string {
    if (r.fabric_quality_id !== null) {
      const q = qualities.find((x) => x.id === r.fabric_quality_id);
      return q ? `${q.code ?? '#' + r.fabric_quality_id} - ${q.name}` : '#' + String(r.fabric_quality_id);
    }
    if (r.quality_text !== null && r.quality_text.trim() !== '') {
      return r.quality_text;
    }
    return '-';
  }
  function supplierLabel(id: number | null): string {
    if (id === null) return '-';
    // Look across BOTH party type lists — customer-adjustment rows
    // store a customer id in supplier_party_id, so a supplier-only
    // lookup would mislabel them.
    const s = suppliers.find((x) => x.id === id) ?? customers.find((x) => x.id === id);
    return s ? s.code + ' - ' + s.name : '#' + String(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fabric Stock"
        subtitle="Purchase log of every fabric batch bought from a supplier. Code, total and reports update automatically."
        actions={
          formOpen ? (
            <button type="button" className="btn-ghost" onClick={closeForm}>
              <X className="w-4 h-4" /> Close form
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={openNewForm}>
              <Plus className="w-4 h-4" /> Add Purchase
            </button>
          )
        }
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> {savedMsg}
        </p>
      )}

      {formOpen && (
        <div className="card p-5 space-y-3">
          <h2 className="font-display font-bold text-base">
            {editingId === null ? 'New purchase' : 'Edit purchase'}
          </h2>

          {/* Source mode toggle — only on a fresh entry. Existing rows
              are always treated as supplier-mode for editing. */}
          {editingId === null && (
            <div className="rounded-md border border-indigo-100 bg-indigo-50/30 p-3">
              <label className="label">Source</label>
              <div className="flex flex-wrap gap-3 mt-1">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="fp-source"
                    className="accent-indigo-600"
                    checked={form.source === 'supplier'}
                    onChange={() => {
                      setForm((f) => ({ ...f, source: 'supplier', supplier_party_id: '' }));
                      setCustomerAllocs([]);
                    }}
                  />
                  <span className="font-semibold">Supplier purchase</span>
                  <span className="text-[11px] text-ink-mute">— regular fabric buy from a mill / supplier (creates a payable)</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="fp-source"
                    className="accent-indigo-600"
                    checked={form.source === 'customer'}
                    onChange={() => {
                      setForm((f) => ({ ...f, source: 'customer', supplier_party_id: '' }));
                      setCustomerAllocs([]);
                    }}
                  />
                  <span className="font-semibold">Customer adjustment</span>
                  <span className="text-[11px] text-ink-mute">— customer gave fabric in lieu of payment (settles their unpaid bills)</span>
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Fabric code (auto)</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">Auto (FP/26-27/NNNN)</div>
            </div>
            <div>
              <label className="label" htmlFor="fp-quality">Fabric quality *</label>
              {form.source === 'customer' ? (
                // Customer-adjustment mode: pick from the in-house
                // production qualities (fabric returned by customers
                // is always one of the qualities we make).
                <select id="fp-quality" className="input w-full"
                  value={form.fabric_quality_id}
                  onChange={(e) => setForm((f) => ({ ...f, fabric_quality_id: e.target.value }))}>
                  <option value="">--- pick ---</option>
                  {qualities.map((q) => (
                    <option key={q.id} value={String(q.id)}>
                      {q.code ?? '#' + q.id} - {q.name}
                    </option>
                  ))}
                </select>
              ) : (
                // Supplier purchase mode: just type the quality name.
                // Resale fabric isn't usually one of our in-house
                // production qualities, so a free-text field lets
                // the operator move quickly.
                <input
                  id="fp-quality"
                  type="text"
                  className="input w-full"
                  placeholder="e.g. SAREE 80*80 / Viscose Dobby"
                  value={form.quality_text}
                  onChange={(e) => setForm((f) => ({ ...f, quality_text: e.target.value.toUpperCase() }))}
                />
              )}
            </div>
            <div>
              <label className="label">
                {form.source === 'customer' ? 'Customer *' : 'Supplier *'}
              </label>
              <SearchSelect
                options={partyOptions}
                value={form.supplier_party_id}
                onChange={(v) => setForm((f) => ({ ...f, supplier_party_id: v }))}
                placeholder={
                  form.source === 'customer'
                    ? 'Type customer name…'
                    : 'Type supplier name…'
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="fp-date">Purchase date *</label>
              <input id="fp-date" type="date" required className="input w-full"
                value={form.received_date}
                onChange={(e) => setForm((f) => ({ ...f, received_date: e.target.value }))} />
            </div>

            <div>
              <label className="label" htmlFor="fp-unit">Unit *</label>
              <select id="fp-unit" className="input w-full"
                value={form.rate_unit}
                onChange={(e) => setForm((f) => ({ ...f, rate_unit: e.target.value as RateUnit }))}>
                <option value="m">Metres</option>
                <option value="pcs">Pieces</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fp-qty">
                Quantity ({form.rate_unit === 'm' ? 'metres' : 'pcs'}) *
              </label>
              <input id="fp-qty" type="number" min={0} step={form.rate_unit === 'm' ? '0.01' : '1'}
                className="input num w-full"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="fp-rate">
                Rate (Rs / {form.rate_unit === 'm' ? 'metre' : 'piece'}) *
              </label>
              <input id="fp-rate" type="number" min={0} step="0.01" className="input num w-full"
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="fp-gst">GST %</label>
              <input id="fp-gst" type="number" min={0} step="0.01" className="input num w-full"
                value={form.gst_pct}
                onChange={(e) => setForm((f) => ({ ...f, gst_pct: e.target.value }))} />
            </div>

            <div>
              <label className="label">Total (auto)</label>
              <div className="input num bg-emerald-50 text-emerald-800 font-semibold select-none">
                {fmtMoney(totalPreview)}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fp-dest">Delivery destination *</label>
              <select id="fp-dest" className="input w-full"
                value={form.delivery_destination}
                onChange={(e) => setForm((f) => ({ ...f, delivery_destination: e.target.value as Delivery }))}>
                <option value="in_house">In-house warehouse</option>
                <option value="sizing">Sizing warehouse</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fp-inv">Invoice no *</label>
              <input id="fp-inv" type="text" required className="input w-full" placeholder="INV-12345"
                value={form.invoice_no}
                onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))} />
            </div>

            <div className="md:col-span-4">
              <label className="label" htmlFor="fp-notes">Notes</label>
              <input id="fp-notes" type="text" className="input w-full" placeholder="(optional)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          {/* Customer-adjustment: pick which unpaid bills this fabric
              value should settle. Hidden in supplier mode. */}
          {editingId === null && form.source === 'customer' && pickedPartyId !== null && (
            <div className="pt-2">
              <UnpaidBillsPicker
                partyId={pickedPartyId}
                totalAmount={totalPreview}
                direction="in"
                heading="Customer's unpaid bills"
                onAllocationsChange={setCustomerAllocs}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={closeForm} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId === null ? 'Save Purchase' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading purchases...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No fabric purchases recorded yet. Click <strong>Add Purchase</strong> to log the first one.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Code</th>
                <th className="text-left  px-3 py-3">Fabric quality</th>
                <th className="text-left  px-3 py-3 hidden md:table-cell">Supplier</th>
                <th className="text-right px-3 py-3">Quantity</th>
                <th className="text-left  px-3 py-3">Unit</th>
                <th className="text-right px-3 py-3">Rate (Rs)</th>
                <th className="text-right px-3 py-3">GST %</th>
                <th className="text-right px-3 py-3">Total Rs</th>
                <th className="text-left  px-3 py-3">Delivery</th>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3 hidden lg:table-cell">Invoice</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-3 font-semibold">{qualityLabel(r)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{supplierLabel(r.supplier_party_id)}</td>
                  <td className="px-3 py-3 text-right num">
                    {r.rate_unit === 'm'
                      ? (r.received_metres != null ? fmtMoney(Number(r.received_metres)) : '-')
                      : (r.received_pieces ?? '-')}
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{r.rate_unit === 'm' ? 'metres' : 'pieces'}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(Number(r.rate))}</td>
                  <td className="px-3 py-3 text-right num">{Number(r.gst_pct)}</td>
                  <td className="px-3 py-3 text-right num font-semibold text-emerald-700">{fmtMoney(Number(r.total_amount))}</td>
                  <td className="px-3 py-3 text-ink-soft">{deliveryLabel(r.delivery_destination)}</td>
                  <td className="px-3 py-3 text-ink-soft">{fmtDate(r.received_date)}</td>
                  <td className="px-3 py-3 hidden lg:table-cell text-ink-soft font-mono text-xs">{r.invoice_no ?? '-'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" className="p-1 rounded hover:bg-indigo-50 text-indigo-600"
                        title="Edit" onClick={() => openEditForm(r)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" className="p-1 rounded hover:bg-rose-50 text-rose-600"
                        title="Delete" onClick={() => deleteRow(r.id, r.code)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
