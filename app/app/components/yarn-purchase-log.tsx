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
 * Agent commission (migration 202): an optional commission PAYABLE to an
 * agent / broker PARTY, recorded against the yarn lot in agent_commission
 * (yarn_lot_id). Two bases for yarn purchases:
 *   - 'bag'     -> commission = bag_count * rate
 *   - 'percent' -> commission = total_amount * rate / 100
 * The commission then surfaces on the dashboard, in the agent's Ledger
 * View (as an inflow) and is settled on the Payments screen, exactly like
 * the sales-side commission. Bag count is kept as real inventory.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2, Pencil, X, Save } from 'lucide-react';

type YarnKind = 'yarn' | 'porvai';
type Delivery = 'in_house' | 'sizing';
type CommType = 'bag' | 'percent';

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
  bag_count: number;
}

/** Commission row tied to one yarn lot (agent_commission.yarn_lot_id). */
interface CommissionRow {
  id: number;
  yarn_lot_id: number;
  agent_party_id: number;
  commission_type: CommType;
  commission_rate: number;
  amount: number;
  amount_paid: number;
}

interface CountOption    { id: number; code: string; display_name: string; }
// Yarn suppliers come from the unified party table.
interface SupplierOption { id: number; code: string; name: string; }
// Agents / brokers are PARTIES (party_type ilike '%broker%' or '%agent%'),
// the same dropdown source as the sales invoice's agent commission.
interface AgentOption    { id: number; name: string; }

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
  bag_count: string;
  // Agent commission (optional).
  agent_party_id: string;
  commission_type: CommType;
  commission_rate: string;
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
  bag_count: '',
  agent_party_id: '',
  commission_type: 'bag',
  commission_rate: '',
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
  const [agents, setAgents] = useState<AgentOption[]>([]);
  // yarn_lot_id -> commission row, so the table + edit form can show it.
  const [commByLot, setCommByLot] = useState<Map<number, CommissionRow>>(new Map());
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

    const [lotRes, countRes, suppRes, agentTypeRes, partyRes, commRes] = await Promise.all([
      sb.from('yarn_lot')
        .select('id, lot_code, yarn_count_id, supplier_party_id, received_date, due_date, received_kg, cost_per_kg, gst_pct, total_amount, invoice_no, notes, delivery_destination, bag_count')
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
      // Agent / broker PARTY types (same source as the sales invoice).
      sb.from('party_type_master').select('id, name').or('name.ilike.%broker%,name.ilike.%agent%'),
      sb.from('party').select('id, name, party_type_ids').eq('status', 'active').order('name'),
      // All active yarn-purchase commissions, so the table + edit form
      // can show the agent + payable amount per lot.
      sb.from('agent_commission')
        .select('id, yarn_lot_id, agent_party_id, commission_type, commission_rate, amount, amount_paid')
        .eq('status', 'active')
        .not('yarn_lot_id', 'is', null),
    ]);
    if (lotRes.error)        setError(lotRes.error.message);
    else if (countRes.error) setError(countRes.error.message);
    else if (suppRes.error)  setError(suppRes.error.message);
    else if (agentTypeRes.error) setError(agentTypeRes.error.message);
    else if (partyRes.error) setError(partyRes.error.message);
    else if (commRes.error)  setError(commRes.error.message);
    else {
      const brokerIds = ((agentTypeRes.data ?? []) as Array<{ id: number }>).map((t) => Number(t.id));
      const agentList = ((partyRes.data ?? []) as Array<{ id: number; name: string; party_type_ids: number[] | null }>)
        .filter((p) => Array.isArray(p.party_type_ids) && p.party_type_ids.some((id) => brokerIds.includes(Number(id))))
        .map((p) => ({ id: p.id, name: p.name }));
      const commMap = new Map<number, CommissionRow>();
      for (const c of ((commRes.data ?? []) as CommissionRow[])) {
        if (c.yarn_lot_id != null) commMap.set(c.yarn_lot_id, c);
      }
      setRows((lotRes.data ?? []) as unknown as Lot[]);
      setCounts((countRes.data ?? []) as unknown as CountOption[]);
      setSuppliers((suppRes.data ?? []) as unknown as SupplierOption[]);
      setAgents(agentList);
      setCommByLot(commMap);
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

  // Commission preview: per bag = bags * rate; percent = total * rate / 100.
  const commissionPreview = useMemo<number>(() => {
    const rate = toNumOrNull(form.commission_rate) ?? 0;
    if (form.agent_party_id === '' || rate <= 0) return 0;
    if (form.commission_type === 'bag') {
      const bags = toNumOrNull(form.bag_count) ?? 0;
      return Math.round(bags * rate * 100) / 100;
    }
    return Math.round(totalPreview * rate / 100 * 100) / 100;
  }, [form.agent_party_id, form.commission_type, form.commission_rate, form.bag_count, totalPreview]);

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
    const comm = commByLot.get(l.id);
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
      bag_count:            String(l.bag_count),
      agent_party_id:       comm ? String(comm.agent_party_id) : '',
      commission_type:      comm ? comm.commission_type : 'bag',
      commission_rate:      comm ? String(comm.commission_rate) : '',
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

  async function handleSave() {
    setError(null);
    setSavedMsg(null);

    const yarnCountId = form.yarn_count_id === '' ? null : Number(form.yarn_count_id);
    const supplierId  = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);
    const receivedKg  = toNumOrNull(form.received_kg);
    const costPerKg   = toNumOrNull(form.cost_per_kg);
    const gst         = toNumOrNull(form.gst_pct) ?? 0;
    const bagCount    = Math.trunc(toNumOrNull(form.bag_count) ?? 0);

    if (yarnCountId === null) { setError('Yarn count is required.'); return; }
    if (supplierId === null)  { setError('Supplier is required.'); return; }
    if (form.received_date.trim() === '') { setError('Purchase date is required.'); return; }
    if (receivedKg === null || receivedKg <= 0) { setError('Quantity (kg) is required.'); return; }
    if (costPerKg === null || costPerKg < 0)    { setError('Rate per kg is required.'); return; }
    if (form.invoice_no.trim() === '')          { setError('Invoice number is required.'); return; }

    // Agent commission inputs.
    const agentId   = form.agent_party_id === '' ? null : Number(form.agent_party_id);
    const commRate  = toNumOrNull(form.commission_rate) ?? 0;
    const commAmt   = commissionPreview;
    const hasComm   = agentId !== null && commAmt > 0;

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
      bag_count: bagCount,
      ...(editingId === null ? { current_kg: receivedKg } : {}),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    setBusy(true);

    let lotId: number;
    if (editingId === null) {
      const { data: ins, error: err } = await sb.from('yarn_lot').insert(payload).select('id').single();
      if (err) { setBusy(false); setError(err.message); return; }
      lotId = Number(ins.id);
    } else {
      lotId = editingId;
      const { error: err } = await sb.from('yarn_lot').update(payload).eq('id', editingId);
      if (err) { setBusy(false); setError(err.message); return; }
    }

    // ── Agent commission upsert (payable to the agent party) ──
    const existing = commByLot.get(lotId) ?? null;
    if (existing != null) {
      if (!hasComm) {
        // Removing the commission is only safe if nothing's been paid yet.
        if (Number(existing.amount_paid) > 0.005) {
          setBusy(false);
          setError('This commission is already part/fully paid — reverse the agent payment before removing it.');
          return;
        }
        const { error: delErr } = await sb.from('agent_commission').delete().eq('id', existing.id);
        if (delErr) { setBusy(false); setError(delErr.message); return; }
      } else {
        if (commAmt < Number(existing.amount_paid) - 0.005) {
          setBusy(false);
          setError(`Commission ₹${commAmt.toFixed(2)} is less than the ₹${Number(existing.amount_paid).toFixed(2)} already paid to the agent. Raise the rate or reverse the payment first.`);
          return;
        }
        const { error: upErr } = await sb.from('agent_commission').update({
          agent_party_id:  agentId,
          commission_type: form.commission_type,
          commission_rate: commRate,
          amount:          commAmt,
        }).eq('id', existing.id);
        if (upErr) { setBusy(false); setError(upErr.message); return; }
      }
    } else if (hasComm) {
      const { error: insErr } = await sb.from('agent_commission').insert({
        yarn_lot_id:     lotId,
        agent_party_id:  agentId,
        commission_type: form.commission_type,
        commission_rate: commRate,
        amount:          commAmt,
      });
      if (insErr) { setBusy(false); setError(insErr.message); return; }
    }

    setBusy(false);
    setSavedMsg(editingId === null ? 'Added purchase.' : 'Updated.');
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
  function agentLabel(id: number): string {
    const a = agents.find((x) => x.id === id);
    return a ? a.name : '#' + String(id);
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
              <label className="label" htmlFor="y-bags">Bag count</label>
              <input id="y-bags" type="number" min={0} step="1" className="input num w-full"
                value={form.bag_count}
                onChange={(e) => setForm((f) => ({ ...f, bag_count: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="y-inv">Invoice no *</label>
              <input id="y-inv" type="text" required className="input w-full" placeholder="INV-12345"
                value={form.invoice_no}
                onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))} />
            </div>
          </div>

          {/* ───── Agent commission (optional · payable to the agent) ───── */}
          <div className="rounded-lg border border-line/60 bg-haze/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs uppercase tracking-wide text-ink-soft">Agent commission</h3>
              <span className="text-[10px] text-ink-mute">optional · payable to the agent, not part of the supplier bill</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="label" htmlFor="y-agent">Agent / broker</label>
                <select id="y-agent" className="input w-full"
                  value={form.agent_party_id}
                  onChange={(e) => setForm((f) => ({ ...f, agent_party_id: e.target.value }))}>
                  <option value="">--- none ---</option>
                  {agents.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="y-comm-type">Commission basis</label>
                <select id="y-comm-type" className="input w-full"
                  value={form.commission_type}
                  disabled={form.agent_party_id === ''}
                  onChange={(e) => setForm((f) => ({ ...f, commission_type: e.target.value as CommType }))}>
                  <option value="bag">Per bag</option>
                  <option value="percent">% of value</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="y-comm-rate">
                  {form.commission_type === 'bag' ? 'Rate (Rs/bag)' : 'Rate (%)'}
                </label>
                <input id="y-comm-rate" type="number" min={0} step="0.01" className="input num w-full"
                  value={form.commission_rate}
                  disabled={form.agent_party_id === ''}
                  onChange={(e) => setForm((f) => ({ ...f, commission_rate: e.target.value }))} />
              </div>
              <div>
                <label className="label">Commission (auto)</label>
                <div className="input num bg-amber-50 text-amber-800 font-semibold select-none">
                  {fmtMoney(commissionPreview)}
                </div>
              </div>
            </div>
            {form.agent_party_id !== '' && (
              <p className="text-[11px] text-ink-mute">
                {form.commission_type === 'bag'
                  ? 'Commission = bag count × rate per bag.'
                  : 'Commission = total value × rate %.'}
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="y-notes">Notes</label>
            <input id="y-notes" type="text" className="input w-full" placeholder="(optional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
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
                <th className="text-left px-3 py-3 hidden md:table-cell">Agent</th>
                <th className="text-right px-3 py-3">Bags</th>
                <th className="text-right px-3 py-3">Commission Rs</th>
                <th className="text-left px-3 py-3">Due Date</th>
                <th className="text-right px-3 py-3 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const comm = commByLot.get(l.id);
                return (
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
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{comm ? agentLabel(comm.agent_party_id) : '-'}</td>
                  <td className="px-3 py-3 text-right num">{l.bag_count}</td>
                  <td className="px-3 py-3 text-right num text-amber-700">{comm ? fmtMoney(comm.amount) : '-'}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
