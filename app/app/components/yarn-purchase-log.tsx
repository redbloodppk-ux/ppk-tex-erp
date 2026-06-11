'use client';
/**
 * Shared "yarn purchase log" component. Used by /yarn-stock and
 * /porvai-yarn-stock - the only difference between the two screens is
 * the yarn_kind discriminator passed in via props.
 *
 * UX matches Bobbin Stock: list view by default with an "Add Purchase"
 * button revealing the form. lot_code is auto-generated server-side via
 * the 'lot' doc_sequence (LOT-NNNN).
 *
 * Mandatory: yarn_count, mill, received_date, received_kg, invoice_no.
 *
 * Extras (migration 051):
 *   - Delivery destination dropdown ('in_house' default, or 'sizing')
 *   - Broker dropdown (vendors where vendor_type='broker')
 *   - Bag count + brokerage_per_bag (auto-filled from picked broker)
 *   - Brokerage amount preview = bags * rate
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2, Pencil, X, Save } from 'lucide-react';

type YarnKind = 'yarn' | 'porvai';
type Delivery = 'in_house' | 'sizing';

interface Lot {
  id: number;
  lot_code: string;
  yarn_count_id: number;
  // After migration 098 the FK lives on supplier_party_id (referencing
  // party.id, party_type = 'Mill / Yarn Supplier'). The old mill_id /
  // mill table are gone.
  supplier_party_id: number | null;
  received_date: string;
  /** Payment due date, computed as received_date + N days at save time
   *  (migration 112). NULL when the lot doesn't have payment terms yet. */
  due_date: string | null;
  received_kg: number;
  cost_per_kg: number;
  gst_pct: number;
  total_amount: number;
  invoice_no: string | null;
  notes: string | null;
  delivery_destination: Delivery;
  broker_ledger_id: number | null;
  bag_count: number;
  brokerage_per_bag: number;
  brokerage_amount: number;
}

interface CountOption    { id: number; code: string; display_name: string; }
// Yarn suppliers come from the unified party table.
interface SupplierOption { id: number; code: string; name: string; }
interface BrokerOption   { id: number; code: string; name: string; brokerage_per_bag: number | null; }

interface FormState {
  yarn_count_id: string;
  supplier_party_id: string;
  received_date: string;
  /** Number of days from received_date until payment is due. Empty =
   *  no due date saved. The actual due_date column is computed at
   *  save time so reports can sort / filter on it. */
  due_days: string;
  received_kg: string;
  cost_per_kg: string;
  gst_pct: string;
  invoice_no: string;
  notes: string;
  delivery_destination: Delivery;
  broker_ledger_id: string;
  bag_count: string;
  brokerage_per_bag: string;
}

const EMPTY: FormState = {
  yarn_count_id: '',
  supplier_party_id: '',
  received_date: '',
  due_days: '30',
  received_kg: '',
  cost_per_kg: '',
  gst_pct: '5',
  invoice_no: '',
  notes: '',
  delivery_destination: 'in_house',
  broker_ledger_id: '',
  bag_count: '',
  brokerage_per_bag: '',
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

export interface YarnPurchaseLogProps {
  yarnKind: YarnKind;
  title: string;
  subtitle: string;
}

export function YarnPurchaseLog({ yarnKind, title, subtitle }: YarnPurchaseLogProps) {
  const supabase = createClient();

  const [rows, setRows] = useState<Lot[]>([]);
  const [counts, setCounts] = useState<CountOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Resolve the "Mill / Yarn Supplier" party_type id so we can filter
    // the party table down to yarn-supplying parties (this used to be
    // the mill table — see migration 098).
    const ptRes = await sb.from('party_type_master')
      .select('id').eq('name', 'Mill / Yarn Supplier').maybeSingle();
    const supplierTypeId = ptRes.data?.id as number | undefined;

    const [lotRes, countRes, suppRes, brokerRes] = await Promise.all([
      sb.from('yarn_lot')
        .select('id, lot_code, yarn_count_id, supplier_party_id, received_date, due_date, received_kg, cost_per_kg, gst_pct, total_amount, invoice_no, notes, delivery_destination, broker_ledger_id, bag_count, brokerage_per_bag, brokerage_amount')
        .eq('yarn_kind', yarnKind)
        .order('received_date', { ascending: false })
        .order('id', { ascending: false }),
      // Yarn counts are tagged with default_yarn_kind ('yarn' | 'porvai')
      // so the Porvai Yarn Stock page only surfaces porvai counts and
      // the regular Yarn Stock page only surfaces non-porvai counts.
      sb.from('yarn_count')
        .select('id, code, display_name')
        .neq('status', 'archived')
        .eq('default_yarn_kind', yarnKind)
        .order('code'),
      // Suppliers = parties tagged "Mill / Yarn Supplier".
      supplierTypeId
        ? sb.from('party')
            .select('id, code, name')
            .contains('party_type_ids', [supplierTypeId])
            .eq('status', 'active')
            .order('name')
        : Promise.resolve({ data: [] as SupplierOption[], error: null }),
      // Brokers are AGENT-type ledgers since migration 053. Query the ledger
      // master joined with ledger_type so the broker dropdown stays in sync
      // with the Ledgers screen.
      sb.from('ledger')
        .select('id, code, name, brokerage_per_bag, ledger_type:type_id!inner(name)')
        .eq('active', true)
        .eq('ledger_type.name', 'AGENT')
        .order('name'),
    ]);
    if (lotRes.error)         setError(lotRes.error.message);
    else if (countRes.error)  setError(countRes.error.message);
    else if (suppRes.error)   setError(suppRes.error.message);
    else if (brokerRes.error) setError(brokerRes.error.message);
    else {
      setRows((lotRes.data ?? []) as unknown as Lot[]);
      setCounts((countRes.data ?? []) as unknown as CountOption[]);
      setSuppliers((suppRes.data ?? []) as unknown as SupplierOption[]);
      setBrokers((brokerRes.data ?? []) as unknown as BrokerOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase, yarnKind]);

  useEffect(() => { void load(); }, [load]);

  const totalPreview = useMemo<number>(() => {
    const qty = toNumOrNull(form.received_kg) ?? 0;
    const rate = toNumOrNull(form.cost_per_kg) ?? 0;
    const gst = toNumOrNull(form.gst_pct) ?? 0;
    return Math.round(qty * rate * (1 + gst / 100) * 100) / 100;
  }, [form.received_kg, form.cost_per_kg, form.gst_pct]);

  const brokeragePreview = useMemo<number>(() => {
    const bags = toNumOrNull(form.bag_count) ?? 0;
    const rate = toNumOrNull(form.brokerage_per_bag) ?? 0;
    return Math.round(bags * rate * 100) / 100;
  }, [form.bag_count, form.brokerage_per_bag]);

  function openNewForm() {
    setEditingId(null);
    setForm({ ...EMPTY, received_date: todayISO() });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function openEditForm(l: Lot) {
    setEditingId(l.id);
    // Recover the days-from-received from the stored due_date so the
    // operator sees the same N they typed originally. If the lot has
    // a due_date but no received_date (shouldn't happen), fall back
    // to blank.
    let dueDays = '';
    if (l.due_date && l.received_date) {
      const a = new Date(l.received_date + 'T00:00:00Z').getTime();
      const b = new Date(l.due_date      + 'T00:00:00Z').getTime();
      const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
      if (Number.isFinite(diff) && diff >= 0) dueDays = String(diff);
    }
    setForm({
      yarn_count_id:        String(l.yarn_count_id),
      supplier_party_id:    l.supplier_party_id === null ? '' : String(l.supplier_party_id),
      received_date:        l.received_date,
      due_days:             dueDays,
      received_kg:          String(l.received_kg),
      cost_per_kg:          String(l.cost_per_kg),
      gst_pct:              String(l.gst_pct),
      invoice_no:           l.invoice_no ?? '',
      notes:                l.notes ?? '',
      delivery_destination: l.delivery_destination,
      broker_ledger_id:     l.broker_ledger_id === null ? '' : String(l.broker_ledger_id),
      bag_count:            String(l.bag_count),
      brokerage_per_bag:    String(l.brokerage_per_bag),
    });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  }

  /** When the user picks a broker, auto-fill the per-bag rate from the
   *  broker's master record (only if the user hasn't typed one). */
  function onPickBroker(value: string) {
    if (value === '') {
      setForm((f) => ({ ...f, broker_ledger_id: '' }));
      return;
    }
    const id = Number(value);
    const b = brokers.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      broker_ledger_id: value,
      brokerage_per_bag:
        f.brokerage_per_bag.trim() === '' && b && b.brokerage_per_bag !== null
          ? String(b.brokerage_per_bag)
          : f.brokerage_per_bag,
    }));
  }

  async function handleSave() {
    setError(null);
    setSavedMsg(null);

    const yarnCountId = form.yarn_count_id === '' ? null : Number(form.yarn_count_id);
    const supplierId  = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);
    const receivedKg  = toNumOrNull(form.received_kg);
    const costPerKg   = toNumOrNull(form.cost_per_kg);
    const gst         = toNumOrNull(form.gst_pct) ?? 0;
    const brokerId    = form.broker_ledger_id === '' ? null : Number(form.broker_ledger_id);
    const bagCount    = Math.trunc(toNumOrNull(form.bag_count) ?? 0);
    const brokerRate  = toNumOrNull(form.brokerage_per_bag) ?? 0;

    if (yarnCountId === null) { setError('Yarn count is required.'); return; }
    if (supplierId === null)  { setError('Supplier is required.'); return; }
    if (form.received_date.trim() === '') { setError('Purchase date is required.'); return; }
    if (receivedKg === null || receivedKg <= 0) { setError('Quantity (kg) is required.'); return; }
    if (costPerKg === null || costPerKg < 0)    { setError('Rate per kg is required.'); return; }
    if (form.invoice_no.trim() === '')          { setError('Invoice number is required.'); return; }

    // due_date = received_date + N days. Empty days = no due date.
    const dueDate: string | null = (() => {
      const n = Number(form.due_days);
      if (!Number.isFinite(n) || n <= 0 || !form.received_date) return null;
      const d = new Date(form.received_date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    })();

    const payload = {
      yarn_kind: yarnKind,
      yarn_count_id: yarnCountId,
      supplier_party_id: supplierId,
      received_date: form.received_date,
      due_date: dueDate,
      received_kg: receivedKg,
      cost_per_kg: costPerKg,
      gst_pct: gst,
      invoice_no: form.invoice_no.trim(),
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
      delivery_destination: form.delivery_destination,
      broker_ledger_id: brokerId,
      bag_count: bagCount,
      brokerage_per_bag: brokerRate,
      ...(editingId === null ? { current_kg: receivedKg } : {}),
    };

    setBusy(true);
    if (editingId === null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('yarn_lot').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Added purchase.');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('yarn_lot').update(payload).eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Updated.');
    }
    closeForm();
    await load();
  }

  async function deleteRow(id: number, lotCode: string) {
    const ok = window.confirm('Delete yarn lot ' + lotCode + '?\n\nIf any downstream record references this lot, the database will block the delete.');
    if (ok === false) return;
    setError(null);
    setSavedMsg(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('yarn_lot').delete().eq('id', id);
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + lotCode + '.');
  }

  function countLabel(id: number): string {
    const c = counts.find((x) => x.id === id);
    return c ? c.code + ' - ' + c.display_name : '#' + String(id);
  }
  function supplierLabel(id: number | null): string {
    if (id === null) return '-';
    const s = suppliers.find((x) => x.id === id);
    return s ? s.code + ' - ' + s.name : '#' + String(id);
  }
  function brokerLabel(id: number | null): string {
    if (id === null) return '-';
    const b = brokers.find((x) => x.id === id);
    return b ? b.name : '#' + String(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
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
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" /> {savedMsg}
        </p>
      )}

      {formOpen && (
        <div className="card p-5 space-y-3">
          <h2 className="font-display font-bold text-base">
            {editingId === null ? 'New purchase' : 'Edit purchase'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Lot code (auto)</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">Auto (LOT-NNNN)</div>
            </div>
            <div>
              <label className="label" htmlFor="y-count">Yarn count *</label>
              <select id="y-count" className="input w-full"
                value={form.yarn_count_id}
                onChange={(e) => setForm((f) => ({ ...f, yarn_count_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {counts.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="y-supplier">Supplier *</label>
              <select id="y-supplier" className="input w-full"
                value={form.supplier_party_id}
                onChange={(e) => setForm((f) => ({ ...f, supplier_party_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.code} - {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="y-date">Purchase date *</label>
              <input id="y-date" type="date" required className="input w-full"
                value={form.received_date}
                onChange={(e) => setForm((f) => ({ ...f, received_date: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="y-due">Due in (days)</label>
              <input id="y-due" type="number" min="0" step="1" className="input num w-full"
                placeholder="e.g. 30"
                value={form.due_days}
                onChange={(e) => setForm((f) => ({ ...f, due_days: e.target.value }))} />
              <p className="text-[11px] text-ink-mute mt-1">
                {(() => {
                  const n = Number(form.due_days);
                  if (!Number.isFinite(n) || n <= 0 || !form.received_date) return 'No due date';
                  const d = new Date(form.received_date + 'T00:00:00Z');
                  d.setUTCDate(d.getUTCDate() + n);
                  return 'Due on ' + d.toISOString().slice(0, 10);
                })()}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="y-qty">Quantity (kg) *</label>
              <input id="y-qty" type="number" min={0} step="0.001" className="input num w-full"
                value={form.received_kg}
                onChange={(e) => setForm((f) => ({ ...f, received_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="y-rate">Rate (Rs/kg) *</label>
              <input id="y-rate" type="number" min={0} step="0.01" className="input num w-full"
                value={form.cost_per_kg}
                onChange={(e) => setForm((f) => ({ ...f, cost_per_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="y-gst">GST %</label>
              <input id="y-gst" type="number" min={0} step="0.01" className="input num w-full"
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
              <label className="label" htmlFor="y-delivery">Delivery destination *</label>
              <select id="y-delivery" className="input w-full"
                value={form.delivery_destination}
                onChange={(e) => setForm((f) => ({ ...f, delivery_destination: e.target.value as Delivery }))}>
                <option value="in_house">In-house warehouse</option>
                <option value="sizing">Sizing warehouse</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="y-broker">Broker</label>
              <select id="y-broker" className="input w-full"
                value={form.broker_ledger_id}
                onChange={(e) => onPickBroker(e.target.value)}>
                <option value="">--- none ---</option>
                {brokers.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}{b.brokerage_per_bag !== null ? ' (Rs ' + String(b.brokerage_per_bag) + '/bag)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="y-bags">Bag count</label>
              <input id="y-bags" type="number" min={0} step="1" className="input num w-full"
                value={form.bag_count}
                onChange={(e) => setForm((f) => ({ ...f, bag_count: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="y-brk-rate">Brokerage Rs/bag</label>
              <input id="y-brk-rate" type="number" min={0} step="0.01" className="input num w-full"
                placeholder="auto from broker"
                value={form.brokerage_per_bag}
                onChange={(e) => setForm((f) => ({ ...f, brokerage_per_bag: e.target.value }))} />
            </div>

            <div>
              <label className="label" htmlFor="y-inv">Invoice no *</label>
              <input id="y-inv" type="text" required className="input w-full" placeholder="INV-12345"
                value={form.invoice_no}
                onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))} />
            </div>
            <div>
              <label className="label">Brokerage total (auto)</label>
              <div className="input num bg-amber-50 text-amber-800 font-semibold select-none">
                {fmtMoney(brokeragePreview)}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="y-notes">Notes</label>
              <input id="y-notes" type="text" className="input w-full" placeholder="(optional)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

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
          No purchases recorded yet. Click <strong>Add Purchase</strong> to log the first one.
        </div>
      ) : (
        // The history table has 15 columns; `overflow-hidden` was
        // clipping the rightmost Actions cell so the Edit / Delete
        // buttons appeared half-cut on narrow viewports. Switching
        // to `overflow-x-auto` lets the user scroll horizontally
        // while still keeping the card's rounded corners.
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[1400px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">Date</th>
                <th className="text-left px-3 py-3">Invoice</th>
                <th className="text-left px-3 py-3">Lot</th>
                <th className="text-left px-3 py-3">Yarn count</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Supplier</th>
                <th className="text-right px-3 py-3">Qty (kg)</th>
                <th className="text-right px-3 py-3">Rate Rs/kg</th>
                <th className="text-right px-3 py-3">GST %</th>
                <th className="text-right px-3 py-3">Total Rs</th>
                <th className="text-left px-3 py-3">Delivery</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Broker</th>
                <th className="text-right px-3 py-3">Bags</th>
                <th className="text-right px-3 py-3">Brokerage Rs</th>
                <th className="text-left px-3 py-3">Due Date</th>
                <th className="text-right px-3 py-3 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3 text-ink-soft whitespace-nowrap">{fmtDate(l.received_date)}</td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {/* Clicking the invoice id reopens the form with every
                        field loaded for editing. */}
                    <button type="button"
                      onClick={() => openEditForm(l)}
                      title="Edit this purchase"
                      className="text-indigo-700 hover:underline">
                      {l.invoice_no ?? '(no invoice)'}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{l.lot_code}</td>
                  <td className="px-3 py-3 font-semibold">{countLabel(l.yarn_count_id)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{supplierLabel(l.supplier_party_id)}</td>
                  <td className="px-3 py-3 text-right num">{l.received_kg}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(l.cost_per_kg)}</td>
                  <td className="px-3 py-3 text-right num">{l.gst_pct}</td>
                  <td className="px-3 py-3 text-right num font-semibold text-emerald-700">{fmtMoney(l.total_amount)}</td>
                  <td className="px-3 py-3 text-ink-soft">{deliveryLabel(l.delivery_destination)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{brokerLabel(l.broker_ledger_id)}</td>
                  <td className="px-3 py-3 text-right num">{l.bag_count}</td>
                  <td className="px-3 py-3 text-right num text-amber-700">{fmtMoney(l.brokerage_amount)}</td>
                  <td className={
                    'px-3 py-3 ' + (
                      l.due_date && l.due_date < todayISO()
                        ? 'text-rose-700 font-semibold'   // overdue
                        : 'text-ink-soft'
                    )
                  }>
                    {fmtDate(l.due_date)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" className="p-1.5 rounded hover:bg-indigo-50 text-indigo-600"
                        title="Edit this purchase" onClick={() => openEditForm(l)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" className="p-1.5 rounded hover:bg-red-50 text-red-600"
                        title="Delete this purchase" onClick={() => deleteRow(l.id, l.lot_code)}>
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
