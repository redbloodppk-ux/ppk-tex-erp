'use client';
/**
 * /app/jobwork — Job Work command centre with five tabs.
 *
 * 1. Bobbin given    : read-only list of bobbin rows tagged jobwork; Restock
 *                      clones the row with fresh date/qty/supplier.
 * 2. Warp beam given : add + table with inline edit, delete, restock.
 * 3. Weft bag given  : add + table with inline edit, delete, restock.
 * 4. Warp yarn given : add + table with inline edit, delete, restock.
 * 5. Status          : pivot + per-party balance + per-quality split.
 */
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, Trash2, Pencil, Check, X, RefreshCw } from 'lucide-react';

import { JobworkDcTab } from './dc-tab';
import { JobworkPaymentTab } from './payment-tab';

type Tab = 'dc' | 'bobbin' | 'warp_beam' | 'weft_bag' | 'status' | 'payment';

interface PartyOpt { id: number; code: string; name: string; }
interface QualityOpt { id: number; code: string | null; name: string; }
interface CountOpt { id: number; code: string; display_name: string; }
// (EndsOpt interface removed - was only used by the Warp Yarn tab.)
interface FabricDefaults { warp_count_id: number | null; ends_id: number | null; total_ends: number | null; }

interface BobbinRow {
  id: number; code: string; description: string;
  ends_per_bobbin: number; bobbin_metre: number; quantity: number; gst_pct: number;
  bobbin_price: number; jobwork_party_id: number | null; vendor_id: number | null;
  purchase_date: string | null; invoice_no: string | null; is_lurex: boolean;
  notes: string | null;
  /** Original purchase quantity, preserved by migration 090. Used in
   *  the read-only "history" display so reductions by fabric receipts
   *  don't shrink the issued quantity shown on this page. */
  original_quantity: number | null;
}
interface WarpBeamRow {
  id: number; jobwork_party_id: number;
  fabric_quality_id: number | null; warp_count_id: number | null;
  given_date: string; total_ends: number | null;
  tape_length_m: number | null; beam_count: number;
  total_metres: number | null; reference_no: string | null; notes: string | null;
  supplier_party_id: number | null;
  /** Original issued metres preserved from migration 090. Used on the
   *  history list so reductions don't shrink the display. */
  original_metres: number | null;
}
interface WeftBagRow {
  id: number; jobwork_party_id: number;
  yarn_count_id: number | null; given_date: string;
  bag_count: number | null; total_kg: number | null;
  reference_no: string | null; notes: string | null;
  supplier_party_id: number | null;
  /** Original issued kg preserved from migration 090. Used on the
   *  history list so reductions don't shrink the display. */
  original_kg: number | null;
}
// (WarpYarnRow interface removed - Warp Yarn tab is no longer in this page.
//  The jobwork_warp_yarn DB table still exists but is no longer surfaced.)

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

export default function JobworkPage(): React.ReactElement {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('dc');
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [allParties, setAllParties] = useState<PartyOpt[]>([]);
  const [bobbinSuppliers, setBobbinSuppliers] = useState<PartyOpt[]>([]);
  const [sizingParties, setSizingParties] = useState<PartyOpt[]>([]);
  const [fabricDefaults, setFabricDefaults] = useState<Map<number, FabricDefaults>>(new Map());
  const [qualities, setQualities] = useState<QualityOpt[]>([]);
  const [counts, setCounts] = useState<CountOpt[]>([]);
  const [bobbins, setBobbins] = useState<BobbinRow[]>([]);
  const [warpBeams, setWarpBeams] = useState<WarpBeamRow[]>([]);
  const [weftBags, setWeftBags] = useState<WeftBagRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Resolve party_type ids for the typed dropdowns (Bobbin Supplier for
    // bobbin restock, Sizing Party for the warp-beam supplier). If a type
    // row doesn't exist yet, the corresponding list falls back to empty -
    // user can create it in Settings -> Party Types.
    const ptRes = await sb
      .from('party_type_master')
      .select('id, name')
      .in('name', ['Bobbin Supplier', 'Sizing Party']);
    const ptList: Array<{ id: number; name: string }> = (ptRes.data ?? []) as Array<{ id: number; name: string }>;
    const bobbinSupplierTypeId = ptList.find((t) => t.name === 'Bobbin Supplier')?.id ?? null;
    const sizingPartyTypeId    = ptList.find((t) => t.name === 'Sizing Party')?.id ?? null;

    const [p, ap, bs, sp, q, c, b, w, wb] = await Promise.all([
      sb.from('jobwork_party').select('id, code, name').eq('status', 'active').order('name'),
      sb.from('party').select('id, code, name').eq('status', 'active').order('name'),
      bobbinSupplierTypeId === null
        ? Promise.resolve({ data: [], error: null })
        : sb.from('party').select('id, code, name').eq('status', 'active').contains('party_type_ids', [bobbinSupplierTypeId]).order('name'),
      sizingPartyTypeId === null
        ? Promise.resolve({ data: [], error: null })
        : sb.from('party').select('id, code, name').eq('status', 'active').contains('party_type_ids', [sizingPartyTypeId]).order('name'),
      // calc_snapshot carries the warp_count_id, ends_id, total_ends entered
      // on the Fabric Quality form - we use it to auto-fill the warp beam
      // form when a fabric is picked.
      sb.from('fabric_quality').select('id, code, name, calc_snapshot').eq('active', true).order('name'),
      sb.from('yarn_count').select('id, code, display_name').neq('status', 'archived').order('code'),
      sb.from('bobbin').select('id, code, description, ends_per_bobbin, bobbin_metre, quantity, original_quantity, gst_pct, bobbin_price, jobwork_party_id, vendor_id, supplier_party_id, purchase_date, invoice_no, is_lurex, notes').eq('production_mode', 'jobwork').neq('status', 'archived').order('purchase_date', { ascending: false, nullsFirst: false }),
      sb.from('jobwork_warp_beam').select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, tape_length_m, beam_count, total_metres, original_metres, reference_no, notes, supplier_party_id').eq('status', 'active').order('given_date', { ascending: false }),
      sb.from('jobwork_weft_bag').select('id, jobwork_party_id, yarn_count_id, given_date, bag_count, total_kg, original_kg, reference_no, notes, supplier_party_id').eq('status', 'active').order('given_date', { ascending: false }),
    ]);
    const errObj = [p, ap, bs, sp, q, c, b, w, wb].find((r) => r.error);
    if (errObj) {
      setError(errObj.error.message);
    } else {
      // Build map: fabric_quality_id -> {warp_count_id, ends_id, total_ends}
      // from each fabric's calc_snapshot. Snapshot fields are stored as
      // strings (form state), so coerce to number.
      type QualityRow = { id: number; code: string | null; name: string; calc_snapshot: Record<string, unknown> | null };
      const qRows = (q.data ?? []) as QualityRow[];
      const defaults = new Map<number, FabricDefaults>();
      const toNumOrNull = (v: unknown): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      };
      for (const row of qRows) {
        const snap = row.calc_snapshot ?? {};
        const endsId      = toNumOrNull(snap['endsId']);
        const warpCountId = toNumOrNull(snap['warpCountId']);
        const totalEnds   = toNumOrNull(snap['totalEnds']);
        if (endsId !== null || warpCountId !== null || totalEnds !== null) {
          defaults.set(row.id, { warp_count_id: warpCountId, ends_id: endsId, total_ends: totalEnds });
        }
      }

      setParties((p.data ?? []) as PartyOpt[]);
      setAllParties((ap.data ?? []) as PartyOpt[]);
      setBobbinSuppliers((bs.data ?? []) as PartyOpt[]);
      setSizingParties((sp.data ?? []) as PartyOpt[]);
      setQualities(qRows.map((r) => ({ id: r.id, code: r.code, name: r.name })));
      setCounts((c.data ?? []) as CountOpt[]);
      setFabricDefaults(defaults);
      setBobbins((b.data ?? []) as BobbinRow[]);
      setWarpBeams((w.data ?? []) as WarpBeamRow[]);
      setWeftBags((wb.data ?? []) as WeftBagRow[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const allPartyById = useMemo(() => new Map(allParties.map((p) => [p.id, p])), [allParties]);
  const qualityById = useMemo(() => new Map(qualities.map((q) => [q.id, q])), [qualities]);
  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts]);

  return (
    <div>
      <PageHeader
        title="Job Work"
        subtitle="Track bobbin / warp beam / weft bag issued to each jobwork party. Inline edit, delete, restock supported."
        actions={
          <Link href="/app/parties?type=3" className="btn-ghost">
            Manage Jobwork Parties
          </Link>
        }
      />

      <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
        <TabButton active={tab === 'dc'}        onClick={() => setTab('dc')}>DC</TabButton>
        <TabButton active={tab === 'bobbin'}    onClick={() => setTab('bobbin')}>Bobbin given</TabButton>
        <TabButton active={tab === 'warp_beam'} onClick={() => setTab('warp_beam')}>Warp beam given</TabButton>
        <TabButton active={tab === 'weft_bag'}  onClick={() => setTab('weft_bag')}>Weft bag given</TabButton>
        <TabButton active={tab === 'status'}    onClick={() => setTab('status')}>Status</TabButton>
        <TabButton active={tab === 'payment'}   onClick={() => setTab('payment')}>Payment</TabButton>
      </div>

      {error && <div className="card p-3 mb-3 text-err text-sm">{error}</div>}
      {loading ? (
        <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : tab === 'dc' ? (
        <JobworkDcTab parties={parties} qualities={qualities} />
      ) : tab === 'bobbin' ? (
        <BobbinTab rows={bobbins} partyById={partyById} bobbinSuppliers={bobbinSuppliers} onChanged={load} />
      ) : tab === 'warp_beam' ? (
        <WarpBeamTab
          rows={warpBeams} parties={parties} qualities={qualities} counts={counts}
          sizingParties={sizingParties} fabricDefaults={fabricDefaults}
          partyById={partyById} qualityById={qualityById} countById={countById}
          onChanged={load}
        />
      ) : tab === 'weft_bag' ? (
        <WeftBagTab
          rows={weftBags} parties={parties} counts={counts} allParties={allParties}
          partyById={partyById} countById={countById} allPartyById={allPartyById}
          onChanged={load}
        />
      ) : tab === 'payment' ? (
        <JobworkPaymentTab parties={parties} />
      ) : (
        <StatusTab
          parties={parties} qualities={qualities}
          bobbins={bobbins} warpBeams={warpBeams} weftBags={weftBags}
          partyById={partyById}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={'px-4 py-2 text-sm font-semibold border-b-2 -mb-px ' +
        (active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-ink-soft hover:text-ink')}>
      {children}
    </button>
  );
}

/* ===== Restock mini-form (popover under a row) ===== */
function RestockForm({ onCancel, onSave, parties, qtyFields }: {
  onCancel: () => void;
  onSave: (data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) => Promise<void>;
  parties: PartyOpt[];
  qtyFields: { key: string; label: string; step?: number }[];
}) {
  const [date, setDate] = useState(todayISO());
  const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <div className="p-3 bg-indigo-50/40 border-y border-indigo-200 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
      <div className="min-w-0">
        <label className="label text-[10px]">Received date *</label>
        <input type="date" className="input h-8 text-sm w-full" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {qtyFields.map((f) => (
        <div key={f.key} className="min-w-0">
          <label className="label text-[10px]">{f.label}</label>
          <input type="number" step={f.step ?? 1} className="input num h-8 text-sm w-full"
            value={qty[f.key] ?? ''} onChange={(e) => setQty({ ...qty, [f.key]: e.target.value })} />
        </div>
      ))}
      {/* Supplier party spans 2 grid cols so long names like "ABC SIZING
          TEXTILES PRIVATE LIMITED" stay readable. */}
      <div className="min-w-0 md:col-span-2">
        <label className="label text-[10px]">Supplier party</label>
        <select className="input h-8 text-sm w-full" value={supplier} onChange={(e) => setSupplier(e.target.value)} title={parties.find((p) => String(p.id) === supplier)?.name}>
          <option value="">--- none ---</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id} title={p.name}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-1.5 justify-end min-w-0 md:col-span-2">
        <button type="button" onClick={onCancel} className="btn-ghost h-8 text-xs">Cancel</button>
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          await onSave({ given_date: date, supplier_party_id: supplier, qty });
          setBusy(false);
        }} className="btn-primary h-8 text-xs whitespace-nowrap">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Restock
        </button>
      </div>
    </div>
  );
}

/* ===== Bobbin tab ===== */
function BobbinTab({ rows, partyById, bobbinSuppliers, onChanged }: {
  rows: BobbinRow[]; partyById: Map<number, PartyOpt>; bobbinSuppliers: PartyOpt[]; onChanged: () => void;
}) {
  const supabase = createClient();
  const [restockId, setRestockId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<BobbinRow | null>(null);
  // Add-new form state. The form panel only renders when showAdd=true so
  // the table isn't pushed down by an empty form on first load.
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [addBusy, setAddBusy] = useState<boolean>(false);
  const [addForm, setAddForm] = useState<{
    jobwork_party_id: string;
    description: string;
    ends_per_bobbin: string;
    bobbin_metre: string;
    quantity: string;
    bobbin_price: string;
    gst_pct: string;
    purchase_date: string;
    supplier_party_id: string;
    is_lurex: boolean;
    notes: string;
  }>({
    jobwork_party_id: '',
    description: '',
    ends_per_bobbin: '',
    bobbin_metre: '',
    quantity: '',
    bobbin_price: '',
    gst_pct: '0',
    purchase_date: todayISO(),
    supplier_party_id: '',
    is_lurex: false,
    notes: '',
  });

  function resetAddForm(): void {
    setAddForm({
      jobwork_party_id: '',
      description: '',
      ends_per_bobbin: '',
      bobbin_metre: '',
      quantity: '',
      bobbin_price: '',
      gst_pct: '0',
      purchase_date: todayISO(),
      supplier_party_id: '',
      is_lurex: false,
      notes: '',
    });
  }

  async function addBobbin(): Promise<void> {
    const partyId = addForm.jobwork_party_id === '' ? null : Number(addForm.jobwork_party_id);
    if (partyId === null) { window.alert('Select a jobwork party.'); return; }
    const ends = Number(addForm.ends_per_bobbin || 0);
    const perPc = Number(addForm.bobbin_metre || 0);
    const qty = Number(addForm.quantity || 0);
    if (qty <= 0) { window.alert('Quantity must be greater than zero.'); return; }
    setAddBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      description: addForm.description || `${ends} ends × ${perPc} m`,
      ends_per_bobbin: ends,
      bobbin_metre: perPc,
      bobbin_price: Number(addForm.bobbin_price || 0),
      gst_pct: Number(addForm.gst_pct || 0),
      quantity: Math.trunc(qty),
      jobwork_party_id: partyId,
      supplier_party_id: addForm.supplier_party_id === '' ? null : Number(addForm.supplier_party_id),
      production_mode: 'jobwork',
      purchase_date: addForm.purchase_date,
      is_lurex: addForm.is_lurex,
      notes: addForm.notes || null,
      status: 'active',
    };
    const { error } = await sb.from('bobbin').insert(payload);
    setAddBusy(false);
    if (error) { window.alert('Add failed: ' + error.message); return; }
    resetAddForm();
    setShowAdd(false);
    onChanged();
  }

  async function restock(parent: BobbinRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const qty = Number(data.qty.qty ?? 0);
    if (qty <= 0) { window.alert('Quantity required'); return; }
    const supplierPartyId = data.supplier_party_id === '' ? null : Number(data.supplier_party_id);
    const payload = {
      description: parent.description,
      ends_per_bobbin: parent.ends_per_bobbin,
      bobbin_metre: parent.bobbin_metre,
      bobbin_price: parent.bobbin_price,
      gst_pct: parent.gst_pct,
      quantity: Math.trunc(qty),
      // New unified-party FK; legacy mill vendor_id stays null on restocks.
      supplier_party_id: supplierPartyId,
      jobwork_party_id: parent.jobwork_party_id,
      production_mode: 'jobwork',
      purchase_date: data.given_date,
      invoice_no: `RESTOCK-${parent.code}`,
      is_lurex: parent.is_lurex,
      notes: 'Restock of ' + parent.code + (supplierPartyId !== null ? ' from party #' + supplierPartyId : ''),
      status: 'active',
    };
    const { error } = await sb.from('bobbin').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  async function saveEdit(): Promise<void> {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Editing the issued qty resets BOTH original_quantity (the
    // history value) and quantity (the live balance) so the corrected
    // value reflects everywhere. Any past stock-reduction math against
    // this row should be reviewed by the operator separately.
    const editedQty = Number(editForm.original_quantity ?? editForm.quantity ?? 0);
    const payload = {
      description: editForm.description,
      ends_per_bobbin: editForm.ends_per_bobbin,
      bobbin_metre: editForm.bobbin_metre,
      original_quantity: editedQty,
      quantity: editedQty,
      jobwork_party_id: editForm.jobwork_party_id,
      purchase_date: editForm.purchase_date,
      bobbin_price: editForm.bobbin_price,
    };
    const { error } = await sb.from('bobbin').update(payload).eq('id', editForm.id);
    if (error) { window.alert('Save failed: ' + error.message); return; }
    setEditingId(null);
    setEditForm(null);
    onChanged();
  }

  async function del(id: number): Promise<void> {
    if (!window.confirm('Delete this bobbin entry? This cannot be undone.')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Soft-delete by status flip - matches what the page already filters
    // out via .neq('status', 'archived').
    const { error } = await sb.from('bobbin').update({ status: 'archived' }).eq('id', id);
    if (error) { window.alert('Delete failed: ' + error.message); return; }
    onChanged();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">Bobbin issued to jobwork parties. Use Add to log a new bobbin spec; Restock to log a fresh batch of an existing spec.</p>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add bobbin given'}
        </button>
      </div>

      {/* Inline add form. Mirrors the WarpBeam/WeftBag tabs' inline
          create pattern. Inserts directly into the bobbin table with
          production_mode='jobwork'. */}
      {showAdd && (
        <div className="card p-3 mb-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label text-xs">Jobwork Party *</label>
            <select
              className="input h-9 text-sm"
              value={addForm.jobwork_party_id}
              onChange={(e) => setAddForm({ ...addForm, jobwork_party_id: e.target.value })}
            >
              <option value="">--- select ---</option>
              {Array.from(partyById.values()).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label text-xs">Description</label>
            <input
              className="input h-9 text-sm"
              placeholder="e.g. 30 ends 100 m"
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">Ends per bobbin *</label>
            <input
              type="number"
              className="input num h-9 text-sm"
              value={addForm.ends_per_bobbin}
              onChange={(e) => setAddForm({ ...addForm, ends_per_bobbin: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">Metres per piece *</label>
            <input
              type="number"
              step={0.01}
              className="input num h-9 text-sm"
              value={addForm.bobbin_metre}
              onChange={(e) => setAddForm({ ...addForm, bobbin_metre: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">Quantity (pcs) *</label>
            <input
              type="number"
              className="input num h-9 text-sm"
              value={addForm.quantity}
              onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">Bobbin price (Rs)</label>
            <input
              type="number"
              step={0.01}
              className="input num h-9 text-sm"
              value={addForm.bobbin_price}
              onChange={(e) => setAddForm({ ...addForm, bobbin_price: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">Purchase date *</label>
            <input
              type="date"
              className="input h-9 text-sm"
              value={addForm.purchase_date}
              onChange={(e) => setAddForm({ ...addForm, purchase_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">Supplier (optional)</label>
            <select
              className="input h-9 text-sm"
              value={addForm.supplier_party_id}
              onChange={(e) => setAddForm({ ...addForm, supplier_party_id: e.target.value })}
            >
              <option value="">---</option>
              {bobbinSuppliers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4 flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setShowAdd(false); resetAddForm(); }} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              type="button"
              onClick={addBobbin}
              disabled={addBusy}
              className="btn-primary text-xs"
            >
              {addBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save bobbin given
            </button>
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Code</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Description</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3" title="Metres per piece">M/pc</th>
              <th className="text-right px-3 py-3">Qty (pcs)</th>
              <th className="text-right px-3 py-3" title="Qty × M/pc">Total m</th>
              <th className="text-left px-3 py-3">Purchased</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ink-soft">No jobwork bobbin entries yet.</td></tr>
            ) : rows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = isEditing && editForm ? editForm : r;
              const partyOptions = Array.from(partyById.values());
              const qtyForRow = Number((r.original_quantity ?? r.quantity) ?? 0);
              const perPcForRow = Number(r.bobbin_metre ?? 0);
              const totalMRow = perPcForRow > 0 ? qtyForRow * perPcForRow : 0;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-3 py-2 font-mono text-xs text-ink-mute">{r.code}</td>
                        <td className="px-2 py-2">
                          <select
                            className="input h-8 text-xs"
                            value={ef.jobwork_party_id ?? ''}
                            onChange={(e) => setEditForm({ ...ef, jobwork_party_id: e.target.value === '' ? null : Number(e.target.value) })}
                          >
                            <option value="">---</option>
                            {partyOptions.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="input h-8 text-xs"
                            value={ef.description ?? ''}
                            onChange={(e) => setEditForm({ ...ef, description: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            className="input num h-8 text-xs w-16"
                            value={ef.ends_per_bobbin ?? ''}
                            onChange={(e) => setEditForm({ ...ef, ends_per_bobbin: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            step={0.01}
                            className="input num h-8 text-xs w-20"
                            value={ef.bobbin_metre ?? ''}
                            onChange={(e) => setEditForm({ ...ef, bobbin_metre: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            className="input num h-8 text-xs w-20"
                            value={ef.original_quantity ?? ef.quantity ?? ''}
                            onChange={(e) => setEditForm({ ...ef, original_quantity: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right num text-xs text-ink-mute">
                          {/* Total m is derived; not editable. Shows the
                              live computed value as the operator edits. */}
                          {(() => {
                            const q = Number(ef.original_quantity ?? ef.quantity ?? 0);
                            const p = Number(ef.bobbin_metre ?? 0);
                            const t = p > 0 ? q * p : 0;
                            return t > 0 ? t.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' m' : '-';
                          })()}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            className="input h-8 text-xs"
                            value={ef.purchase_date ?? ''}
                            onChange={(e) => setEditForm({ ...ef, purchase_date: e.target.value || null })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                        <td className="px-3 py-2">{r.jobwork_party_id ? (partyById.get(r.jobwork_party_id)?.name ?? '-') : '-'}</td>
                        <td className="px-3 py-2 text-ink-soft">{r.description}</td>
                        <td className="px-3 py-2 text-right num">{r.ends_per_bobbin}</td>
                        <td className="px-3 py-2 text-right num">{r.bobbin_metre}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{qtyForRow}</td>
                        <td className="px-3 py-2 text-right num text-indigo-700 font-semibold">
                          {totalMRow > 0
                            ? totalMRow.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' m'
                            : <span className="text-ink-mute">-</span>}
                        </td>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.purchase_date)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={9} className="p-0">
                      <RestockForm parties={bobbinSuppliers}
                        qtyFields={[{ key: 'qty', label: 'Qty', step: 1 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                <td colSpan={5} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                <td className="px-3 py-3 text-right num font-bold">
                  {rows.reduce((s, r) => s + Number((r.original_quantity ?? r.quantity) ?? 0), 0).toLocaleString('en-IN')} pcs
                </td>
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {rows.reduce((s, r) => s + Number((r.original_quantity ?? r.quantity) ?? 0) * Number(r.bobbin_metre ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} m
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ===== Warp Beam tab ===== */
function WarpBeamTab({ rows, parties, qualities, counts, sizingParties, fabricDefaults, partyById, qualityById, countById, onChanged }: {
  rows: WarpBeamRow[]; parties: PartyOpt[]; qualities: QualityOpt[]; counts: CountOpt[];
  sizingParties: PartyOpt[]; fabricDefaults: Map<number, FabricDefaults>;
  partyById: Map<number, PartyOpt>; qualityById: Map<number, QualityOpt>; countById: Map<number, CountOpt>;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
    total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WarpBeamRow | null>(null);
  const [restockId, setRestockId] = useState<number | null>(null);
  // Table filters (empty string = "All ...").
  const [filterQualityId, setFilterQualityId] = useState<string>('');
  const [filterPartyId, setFilterPartyId] = useState<string>('');

  // Rows after applying the on-screen filters. We keep `rows` (the full
  // list) for the table body filter check and the footer's totals so the
  // totals always reflect what's currently visible.
  const filteredRows = rows.filter((r) => {
    if (filterQualityId !== '' && String(r.fabric_quality_id ?? '') !== filterQualityId) return false;
    if (filterPartyId   !== '' && String(r.jobwork_party_id)         !== filterPartyId)   return false;
    return true;
  });

  // When the user picks a Fabric Quality, auto-fill warp count + total ends
  // from the fabric_quality_warp_count / fabric_quality_ends child tables
  // (we keep only the primary sno=1 entry per fabric in fabricDefaults).
  // The operator can still override either value before saving.
  function onFabricChange(idStr: string): void {
    if (idStr === '') {
      setForm((f) => ({ ...f, fabric_quality_id: '' }));
      return;
    }
    const fid = Number(idStr);
    const defaults = fabricDefaults.get(fid);
    setForm((f) => ({
      ...f,
      fabric_quality_id: idStr,
      warp_count_id: defaults && defaults.warp_count_id !== null
        ? String(defaults.warp_count_id)
        : f.warp_count_id,
      total_ends: defaults && defaults.total_ends !== null
        ? String(defaults.total_ends)
        : f.total_ends,
    }));
  }

  async function add() {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr('Pick a jobwork party.'); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
      warp_count_id: form.warp_count_id === '' ? null : Number(form.warp_count_id),
      given_date: form.given_date,
      total_ends: form.total_ends === '' ? null : Number(form.total_ends),
      beam_count: form.beam_count === '' ? 1 : Number(form.beam_count),
      total_metres: form.total_metres === '' ? null : Number(form.total_metres),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_warp_beam').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({
      given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
      total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
    });
    onChanged();
  }

  async function del(id: number) {
    if (!window.confirm('Delete this warp beam entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_warp_beam').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }

  async function saveEdit() {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Sync original_metres = total_metres so the history display (which
    // reads original_metres ?? total_metres) reflects the edit. Without
    // this the user types a new value but the row keeps showing the
    // old original until they re-load.
    const editedMetres = editForm.total_metres;
    const { error } = await sb.from('jobwork_warp_beam').update({
      jobwork_party_id: editForm.jobwork_party_id,
      fabric_quality_id: editForm.fabric_quality_id,
      warp_count_id: editForm.warp_count_id,
      given_date: editForm.given_date,
      total_ends: editForm.total_ends,
      beam_count: editForm.beam_count,
      total_metres: editedMetres,
      original_metres: editedMetres,
      reference_no: editForm.reference_no,
      notes: editForm.notes,
      supplier_party_id: editForm.supplier_party_id,
    }).eq('id', editForm.id);
    if (error) { setErr(error.message); return; }
    setEditingId(null); setEditForm(null);
    onChanged();
  }

  async function restock(parent: WarpBeamRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: parent.jobwork_party_id,
      fabric_quality_id: parent.fabric_quality_id,
      warp_count_id: parent.warp_count_id,
      given_date: data.given_date,
      total_ends: parent.total_ends,
      beam_count: Number(data.qty.beam_count ?? parent.beam_count) || 1,
      total_metres: data.qty.total_metres === '' ? null : Number(data.qty.total_metres),
      reference_no: `RESTOCK-${parent.id}`,
      notes: null,
      supplier_party_id: data.supplier_party_id === '' ? null : Number(data.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_warp_beam').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  return (
    <div>
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add warp beam</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><label className="label text-xs">Date *</label>
            <input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">Party *</label>
            <select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}>
              <option value="">--- pick ---</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select></div>
          <div><label className="label text-xs">Fabric quality</label>
            <select className="input" value={form.fabric_quality_id} onChange={(e) => onFabricChange(e.target.value)}>
              <option value="">---</option>{qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select></div>
          <div><label className="label text-xs">Warp count <span className="text-ink-mute">(auto)</span></label>
            <select className="input" value={form.warp_count_id} onChange={(e) => setForm({ ...form, warp_count_id: e.target.value })}>
              <option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}
            </select></div>
          <div><label className="label text-xs">No. of beams</label>
            <input type="number" min={1} className="input num" value={form.beam_count} onChange={(e) => setForm({ ...form, beam_count: e.target.value })} /></div>
          <div><label className="label text-xs">Total ends <span className="text-ink-mute">(auto)</span></label>
            <input type="number" className="input num" value={form.total_ends} onChange={(e) => setForm({ ...form, total_ends: e.target.value })} /></div>
          <div><label className="label text-xs">Total metres</label>
            <input type="number" step={0.01} className="input num" value={form.total_metres} onChange={(e) => setForm({ ...form, total_metres: e.target.value })} /></div>
          <div><label className="label text-xs">Sizing party</label>
            <select className="input" value={form.supplier_party_id} onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}>
              <option value="">---</option>{sizingParties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select>
            {sizingParties.length === 0 && (
              <p className="text-[10px] text-ink-mute mt-0.5">
                No active <span className="font-semibold">Sizing Party</span> set up yet.
              </p>
            )}
          </div>
          <div><label className="label text-xs">Reference / DC no</label>
            <input className="input" value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label text-xs">Notes</label>
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        {err && <div className="mt-3 text-sm text-err">{err}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add warp beam
          </button>
        </div>
      </div>

      {/* Filter bar — narrows the table + footer totals down to a single
          fabric quality and / or jobwork party. Empty selection = All. */}
      <div className="card p-3 mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-[10px]">Filter by quality</label>
          <select
            className="input h-9 w-56"
            value={filterQualityId}
            onChange={(e) => setFilterQualityId(e.target.value)}
          >
            <option value="">All qualities</option>
            {qualities.map((q) => (
              <option key={q.id} value={String(q.id)}>{q.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-[10px]">Filter by party</label>
          <select
            className="input h-9 w-56"
            value={filterPartyId}
            onChange={(e) => setFilterPartyId(e.target.value)}
          >
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.code} - {p.name}</option>
            ))}
          </select>
        </div>
        {(filterQualityId !== '' || filterPartyId !== '') && (
          <button
            type="button"
            onClick={() => { setFilterQualityId(''); setFilterPartyId(''); }}
            className="text-xs text-ink-mute underline hover:text-ink h-9"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-xs text-ink-soft">
          Showing <span className="font-semibold text-ink">{filteredRows.length}</span> of {rows.length} rows
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Quality</th>
              <th className="text-left px-3 py-3">Warp count</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3">Beams</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-left px-3 py-3">Sizing party</th>
              <th className="text-left px-3 py-3">DC #</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-soft">
                {rows.length === 0 ? 'No warp beams issued yet.' : 'No warp beams match the current filters.'}
              </td></tr>
            ) : filteredRows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = editForm ?? r;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2"><input type="date" className="input h-8 text-xs" value={ef.given_date} onChange={(e) => setEditForm({ ...ef, given_date: e.target.value })} /></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.jobwork_party_id} onChange={(e) => setEditForm({ ...ef, jobwork_party_id: Number(e.target.value) })}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.fabric_quality_id ?? ''} onChange={(e) => setEditForm({ ...ef, fabric_quality_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></td>
                        {/* Auto-populated from fabric quality — read-only in edit. */}
                        <td className="px-3 py-2 text-ink-mute italic">{ef.warp_count_id ? countById.get(ef.warp_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num text-ink-mute italic">{ef.total_ends ?? '-'}</td>
                        <td className="px-2 py-2"><input type="number" min={1} className="input num h-8 text-xs w-16" value={ef.beam_count} onChange={(e) => setEditForm({ ...ef, beam_count: Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.01} className="input num h-8 text-xs w-20" value={ef.total_metres ?? ''} onChange={(e) => setEditForm({ ...ef, total_metres: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2">
                          <select className="input h-8 text-xs" value={ef.supplier_party_id ?? ''} onChange={(e) => setEditForm({ ...ef, supplier_party_id: e.target.value === '' ? null : Number(e.target.value) })}>
                            <option value="">---</option>
                            {sizingParties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2"><input className="input h-8 text-xs w-24" value={ef.reference_no ?? ''} onChange={(e) => setEditForm({ ...ef, reference_no: e.target.value || null })} /></td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                        <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                        <td className="px-3 py-2">{r.fabric_quality_id ? qualityById.get(r.fabric_quality_id)?.name ?? '-' : '-'}</td>
                        <td className="px-3 py-2">{r.warp_count_id ? countById.get(r.warp_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.total_ends ?? '-'}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{r.beam_count}</td>
                        <td className="px-3 py-2 text-right num">{(r.original_metres ?? r.total_metres) ?? '-'}</td>
                        <td className="px-3 py-2 text-ink-soft">{r.supplier_party_id ? sizingParties.find((p) => p.id === r.supplier_party_id)?.name ?? '#' + r.supplier_party_id : '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.reference_no ?? '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={10} className="p-0">
                      <RestockForm parties={sizingParties}
                        qtyFields={[{ key: 'beam_count', label: 'No. of beams', step: 1 }, { key: 'total_metres', label: 'Total metres', step: 0.01 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {filteredRows.length > 0 && (
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                {/* Totals reflect the CURRENT filter, not the full table. */}
                <td colSpan={5} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                <td className="px-3 py-3 text-right num font-bold">
                  {filteredRows.reduce((s, r) => s + Number(r.beam_count ?? 0), 0).toLocaleString('en-IN')} beams
                </td>
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {filteredRows.reduce((s, r) => s + Number((r.original_metres ?? r.total_metres) ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} m
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ===== Weft Bag tab ===== */
function WeftBagTab({ rows, parties, counts, allParties, partyById, countById, allPartyById, onChanged }: {
  rows: WeftBagRow[]; parties: PartyOpt[]; counts: CountOpt[]; allParties: PartyOpt[];
  partyById: Map<number, PartyOpt>; countById: Map<number, CountOpt>; allPartyById: Map<number, PartyOpt>; onChanged: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', yarn_count_id: '',
    bag_count: '', total_kg: '', reference_no: '', notes: '', supplier_party_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WeftBagRow | null>(null);
  const [restockId, setRestockId] = useState<number | null>(null);
  void allPartyById;

  async function add() {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr('Pick a jobwork party.'); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      yarn_count_id: form.yarn_count_id === '' ? null : Number(form.yarn_count_id),
      given_date: form.given_date,
      bag_count: form.bag_count === '' ? null : Number(form.bag_count),
      total_kg: form.total_kg === '' ? null : Number(form.total_kg),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_weft_bag').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({ given_date: todayISO(), jobwork_party_id: '', yarn_count_id: '', bag_count: '', total_kg: '', reference_no: '', notes: '', supplier_party_id: '' });
    onChanged();
  }
  async function del(id: number) {
    if (!window.confirm('Delete this weft bag entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_weft_bag').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }
  async function saveEdit() {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Sync original_kg = total_kg so the history display (which reads
    // original_kg ?? total_kg) reflects the edit.
    const editedKg = editForm.total_kg;
    const { error } = await sb.from('jobwork_weft_bag').update({
      jobwork_party_id: editForm.jobwork_party_id,
      yarn_count_id: editForm.yarn_count_id,
      given_date: editForm.given_date,
      bag_count: editForm.bag_count,
      total_kg: editedKg,
      original_kg: editedKg,
      reference_no: editForm.reference_no,
      notes: editForm.notes,
    }).eq('id', editForm.id);
    if (error) { setErr(error.message); return; }
    setEditingId(null); setEditForm(null);
    onChanged();
  }
  async function restock(parent: WeftBagRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: parent.jobwork_party_id,
      yarn_count_id: parent.yarn_count_id,
      given_date: data.given_date,
      bag_count: data.qty.bag_count === '' ? null : Number(data.qty.bag_count),
      total_kg: data.qty.total_kg === '' ? null : Number(data.qty.total_kg),
      reference_no: `RESTOCK-${parent.id}`,
      notes: null,
      supplier_party_id: data.supplier_party_id === '' ? null : Number(data.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_weft_bag').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  return (
    <div>
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add weft bag</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label text-xs">Date *</label><input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">Party *</label><select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}><option value="">--- pick ---</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></div>
          <div><label className="label text-xs">Yarn count</label><select className="input" value={form.yarn_count_id} onChange={(e) => setForm({ ...form, yarn_count_id: e.target.value })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}</select></div>
          <div><label className="label text-xs">Bag count</label><input type="number" className="input num" value={form.bag_count} onChange={(e) => setForm({ ...form, bag_count: e.target.value })} /></div>
          <div><label className="label text-xs">Total kg</label><input type="number" step={0.001} className="input num" value={form.total_kg} onChange={(e) => setForm({ ...form, total_kg: e.target.value })} /></div>
          <div><label className="label text-xs">Supplier party</label><select className="input" value={form.supplier_party_id} onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}><option value="">---</option>{allParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="label text-xs">Reference / DC no</label><input className="input" value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
          <div><label className="label text-xs">Notes</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        {err && <div className="mt-3 text-sm text-err">{err}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add weft bag</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Yarn count</th>
              <th className="text-right px-3 py-3">Bags</th>
              <th className="text-right px-3 py-3">Total kg</th>
              <th className="text-left px-3 py-3">DC #</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-soft">No weft bags issued yet.</td></tr>
            ) : rows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = editForm ?? r;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2"><input type="date" className="input h-8 text-xs" value={ef.given_date} onChange={(e) => setEditForm({ ...ef, given_date: e.target.value })} /></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.jobwork_party_id} onChange={(e) => setEditForm({ ...ef, jobwork_party_id: Number(e.target.value) })}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.yarn_count_id ?? ''} onChange={(e) => setEditForm({ ...ef, yarn_count_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></td>
                        <td className="px-2 py-2"><input type="number" className="input num h-8 text-xs w-20" value={ef.bag_count ?? ''} onChange={(e) => setEditForm({ ...ef, bag_count: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.001} className="input num h-8 text-xs w-24" value={ef.total_kg ?? ''} onChange={(e) => setEditForm({ ...ef, total_kg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input className="input h-8 text-xs w-24" value={ef.reference_no ?? ''} onChange={(e) => setEditForm({ ...ef, reference_no: e.target.value || null })} /></td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                        <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                        <td className="px-3 py-2">{r.yarn_count_id ? countById.get(r.yarn_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.bag_count ?? '-'}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{(r.original_kg ?? r.total_kg) ?? '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.reference_no ?? '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={7} className="p-0">
                      <RestockForm parties={allParties}
                        qtyFields={[{ key: 'bag_count', label: 'Bag count', step: 1 }, { key: 'total_kg', label: 'Total kg', step: 0.001 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                <td colSpan={3} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                <td className="px-3 py-3 text-right num font-bold">
                  {rows.reduce((s, r) => s + Number(r.bag_count ?? 0), 0).toLocaleString('en-IN')} bags
                </td>
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {rows.reduce((s, r) => s + Number((r.original_kg ?? r.total_kg) ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ===== Warp Yarn tab — REMOVED =====
 * Original implementation of the Warp Yarn (sizing) section, kept below as
 * a commented reference only. The jobwork_warp_yarn DB table still exists
 * with its data intact; this UI just no longer surfaces it.
 */
/*
function WarpYarnTab(_props: unknown) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', ends_id: '', warp_count_id: '',
    total_kg: '', sizing_rate_per_kg: '', total_cost: '', reference_no: '', notes: '', supplier_party_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WarpYarnRow | null>(null);
  const [restockId, setRestockId] = useState<number | null>(null);
  void allPartyById;

  async function add() {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr('Pick a jobwork party.'); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
      ends_id: form.ends_id === '' ? null : Number(form.ends_id),
      warp_count_id: form.warp_count_id === '' ? null : Number(form.warp_count_id),
      given_date: form.given_date,
      total_kg: form.total_kg === '' ? null : Number(form.total_kg),
      sizing_rate_per_kg: form.sizing_rate_per_kg === '' ? null : Number(form.sizing_rate_per_kg),
      total_cost: form.total_cost === '' ? null : Number(form.total_cost),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_warp_yarn').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({ given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', ends_id: '', warp_count_id: '', total_kg: '', sizing_rate_per_kg: '', total_cost: '', reference_no: '', notes: '', supplier_party_id: '' });
    onChanged();
  }
  async function del(id: number) {
    if (!window.confirm('Delete this warp yarn entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_warp_yarn').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }
  async function saveEdit() {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_warp_yarn').update({
      jobwork_party_id: editForm.jobwork_party_id,
      fabric_quality_id: editForm.fabric_quality_id,
      ends_id: editForm.ends_id,
      warp_count_id: editForm.warp_count_id,
      given_date: editForm.given_date,
      total_kg: editForm.total_kg,
      sizing_rate_per_kg: editForm.sizing_rate_per_kg,
      total_cost: editForm.total_cost,
      reference_no: editForm.reference_no,
      notes: editForm.notes,
    }).eq('id', editForm.id);
    if (error) { setErr(error.message); return; }
    setEditingId(null); setEditForm(null);
    onChanged();
  }
  async function restock(parent: WarpYarnRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const kg = data.qty.total_kg === '' ? null : Number(data.qty.total_kg);
    const payload = {
      jobwork_party_id: parent.jobwork_party_id,
      fabric_quality_id: parent.fabric_quality_id,
      ends_id: parent.ends_id,
      warp_count_id: parent.warp_count_id,
      given_date: data.given_date,
      total_kg: kg,
      sizing_rate_per_kg: parent.sizing_rate_per_kg,
      total_cost: kg !== null && parent.sizing_rate_per_kg !== null ? kg * Number(parent.sizing_rate_per_kg) : null,
      reference_no: `RESTOCK-${parent.id}`,
      notes: null,
      supplier_party_id: data.supplier_party_id === '' ? null : Number(data.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_warp_yarn').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  return (
    <div>
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add warp yarn</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><label className="label text-xs">Date *</label><input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">Party *</label><select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}><option value="">--- pick ---</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></div>
          <div><label className="label text-xs">Fabric quality</label><select className="input" value={form.fabric_quality_id} onChange={(e) => setForm({ ...form, fabric_quality_id: e.target.value })}><option value="">---</option>{qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></div>
          <div><label className="label text-xs">Ends spec</label><select className="input" value={form.ends_id} onChange={(e) => setForm({ ...form, ends_id: e.target.value })}><option value="">---</option>{endsOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
          <div><label className="label text-xs">Warp count</label><select className="input" value={form.warp_count_id} onChange={(e) => setForm({ ...form, warp_count_id: e.target.value })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}</select></div>
          <div><label className="label text-xs">Total kg</label><input type="number" step={0.001} className="input num" value={form.total_kg} onChange={(e) => setForm({ ...form, total_kg: e.target.value })} /></div>
          <div><label className="label text-xs">Sizing rate Rs/kg</label><input type="number" step={0.5} className="input num" value={form.sizing_rate_per_kg} onChange={(e) => setForm({ ...form, sizing_rate_per_kg: e.target.value })} /></div>
          <div><label className="label text-xs">Total cost</label><input type="number" step={0.01} className="input num" value={form.total_cost} onChange={(e) => setForm({ ...form, total_cost: e.target.value })} /></div>
          <div><label className="label text-xs">Supplier party</label><select className="input" value={form.supplier_party_id} onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}><option value="">---</option>{allParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="label text-xs">Reference / DC no</label><input className="input" value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label text-xs">Notes</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        {err && <div className="mt-3 text-sm text-err">{err}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add warp yarn</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Quality</th>
              <th className="text-left px-3 py-3">Ends</th>
              <th className="text-left px-3 py-3">Count</th>
              <th className="text-right px-3 py-3">Kg</th>
              <th className="text-right px-3 py-3">Rate</th>
              <th className="text-right px-3 py-3">Cost</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ink-soft">No warp yarn issued yet.</td></tr>
            ) : rows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = editForm ?? r;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2"><input type="date" className="input h-8 text-xs" value={ef.given_date} onChange={(e) => setEditForm({ ...ef, given_date: e.target.value })} /></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.jobwork_party_id} onChange={(e) => setEditForm({ ...ef, jobwork_party_id: Number(e.target.value) })}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.fabric_quality_id ?? ''} onChange={(e) => setEditForm({ ...ef, fabric_quality_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.ends_id ?? ''} onChange={(e) => setEditForm({ ...ef, ends_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{endsOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.warp_count_id ?? ''} onChange={(e) => setEditForm({ ...ef, warp_count_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></td>
                        <td className="px-2 py-2"><input type="number" step={0.001} className="input num h-8 text-xs w-20" value={ef.total_kg ?? ''} onChange={(e) => setEditForm({ ...ef, total_kg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.5} className="input num h-8 text-xs w-16" value={ef.sizing_rate_per_kg ?? ''} onChange={(e) => setEditForm({ ...ef, sizing_rate_per_kg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.01} className="input num h-8 text-xs w-20" value={ef.total_cost ?? ''} onChange={(e) => setEditForm({ ...ef, total_cost: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                        <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                        <td className="px-3 py-2">{r.fabric_quality_id ? qualityById.get(r.fabric_quality_id)?.name ?? '-' : '-'}</td>
                        <td className="px-3 py-2">{r.ends_id ? endsById.get(r.ends_id)?.name ?? '-' : '-'}</td>
                        <td className="px-3 py-2">{r.warp_count_id ? countById.get(r.warp_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{r.total_kg ?? '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.sizing_rate_per_kg ?? '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.total_cost ?? '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={9} className="p-0">
                      <RestockForm parties={allParties}
                        qtyFields={[{ key: 'total_kg', label: 'Total kg', step: 0.001 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
*/

/* ===== Status tab ===== */
function StatusTab({ parties, qualities, bobbins, warpBeams, weftBags, partyById }: {
  parties: PartyOpt[]; qualities: QualityOpt[];
  bobbins: BobbinRow[]; warpBeams: WarpBeamRow[]; weftBags: WeftBagRow[];
  partyById: Map<number, PartyOpt>;
}) {
  const pivot = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const w of warpBeams) {
      if (w.fabric_quality_id == null) continue;
      const row = m.get(w.jobwork_party_id) ?? new Map<number, number>();
      row.set(w.fabric_quality_id, (row.get(w.fabric_quality_id) ?? 0) + Number(w.total_metres ?? 0));
      m.set(w.jobwork_party_id, row);
    }
    return m;
  }, [warpBeams]);

  const balanceByParty = useMemo(() => {
    const out = new Map<number, { bobbinQty: number; warpBeams: number; warpMetres: number; weftBags: number; weftKg: number }>();
    for (const p of parties) out.set(p.id, { bobbinQty: 0, warpBeams: 0, warpMetres: 0, weftBags: 0, weftKg: 0 });
    for (const b of bobbins) { if (b.jobwork_party_id == null) continue; const r = out.get(b.jobwork_party_id); if (r) r.bobbinQty += Number(b.quantity ?? 0); }
    for (const w of warpBeams) { const r = out.get(w.jobwork_party_id); if (r) { r.warpBeams += Number(w.beam_count ?? 0); r.warpMetres += Number(w.total_metres ?? 0); } }
    for (const wb of weftBags) { const r = out.get(wb.jobwork_party_id); if (r) { r.weftBags += Number(wb.bag_count ?? 0); r.weftKg += Number(wb.total_kg ?? 0); } }
    return out;
  }, [parties, bobbins, warpBeams, weftBags]);

  const byQuality = useMemo(() => {
    const m = new Map<number, { total: number; byParty: Map<number, number> }>();
    for (const w of warpBeams) {
      if (w.fabric_quality_id == null) continue;
      const q = m.get(w.fabric_quality_id) ?? { total: 0, byParty: new Map<number, number>() };
      const m2 = Number(w.total_metres ?? 0);
      q.total += m2;
      q.byParty.set(w.jobwork_party_id, (q.byParty.get(w.jobwork_party_id) ?? 0) + m2);
      m.set(w.fabric_quality_id, q);
    }
    return m;
  }, [warpBeams]);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-display font-bold text-base mb-2">Warp metres by Party x Quality</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">Party</th>
                {qualities.map((q) => <th key={q.id} className="text-right px-3 py-3">{q.name}</th>)}
                <th className="text-right px-3 py-3 bg-indigo-50">Total</th>
              </tr>
            </thead>
            <tbody>
              {parties.length === 0 ? (
                <tr><td colSpan={qualities.length + 2} className="px-3 py-8 text-center text-ink-soft">No parties yet.</td></tr>
              ) : parties.map((p) => {
                const row = pivot.get(p.id);
                const partyTotal = row ? Array.from(row.values()).reduce((a, b) => a + b, 0) : 0;
                return (
                  <tr key={p.id} className="border-t border-line/40">
                    <td className="px-3 py-2 font-semibold">{p.name}</td>
                    {qualities.map((q) => {
                      const v = row?.get(q.id) ?? 0;
                      return <td key={q.id} className="px-3 py-2 text-right num">{v > 0 ? v.toFixed(0) : '-'}</td>;
                    })}
                    <td className="px-3 py-2 text-right num font-bold bg-indigo-50/40">{partyTotal > 0 ? partyTotal.toFixed(0) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-display font-bold text-base mb-2">Per-party balance</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">Party</th>
                <th className="text-right px-3 py-3">Bobbin qty</th>
                <th className="text-right px-3 py-3">Warp beams</th>
                <th className="text-right px-3 py-3">Warp metres</th>
                <th className="text-right px-3 py-3">Weft bags</th>
                <th className="text-right px-3 py-3">Weft kg</th>
              </tr>
            </thead>
            <tbody>
              {parties.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-soft">No parties yet.</td></tr>
              ) : parties.map((p) => {
                const b = balanceByParty.get(p.id);
                return (
                  <tr key={p.id} className="border-t border-line/40">
                    <td className="px-3 py-2 font-semibold">{p.name}</td>
                    <td className="px-3 py-2 text-right num">{b?.bobbinQty ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{b?.warpBeams ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{(b?.warpMetres ?? 0).toFixed(0)}</td>
                    <td className="px-3 py-2 text-right num">{b?.weftBags ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{(b?.weftKg ?? 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-display font-bold text-base mb-2">Per-quality warp metres split by party</h3>
        <div className="space-y-2">
          {qualities.length === 0 ? (
            <div className="card p-6 text-center text-sm text-ink-soft">No fabric qualities defined.</div>
          ) : qualities.map((q) => {
            const data = byQuality.get(q.id);
            if (!data || data.total === 0) return null;
            return (
              <div key={q.id} className="card p-4">
                <div className="flex justify-between items-baseline mb-2">
                  <h4 className="font-semibold">{q.name}</h4>
                  <div className="text-sm"><span className="text-ink-mute">Total: </span><span className="num font-bold text-indigo-700">{data.total.toFixed(0)} m</span></div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {Array.from(data.byParty.entries()).map(([partyId, metres]) => {
                    const p = partyById.get(partyId);
                    return <span key={partyId} className="pill bg-indigo-50 text-indigo-700">{p?.name ?? '?'}: <span className="num font-bold">{metres.toFixed(0)} m</span></span>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

