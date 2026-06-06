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
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, Trash2, Pencil, Check, X, RefreshCw, ArrowLeft } from 'lucide-react';

// This page services TWO routes: /app/jobwork and /app/outsource. The
// only difference is which `jobwork_party.kind` rows it filters to —
// 'jobwork' for Job Work parties, 'outsource' for Outsource Weavers
// (migration 113 added the `kind` column + sync trigger). Page title,
// subtitle, and the "Manage" link all switch accordingly.
type PartyKind = 'jobwork' | 'outsource';
interface PageVariant {
  kind: PartyKind;
  title: string;
  subtitle: string;
  manageHref: string;
  manageLabel: string;
  /** Label used wherever the form / table needs to refer to the party
   *  this page targets — "Jobwork Party" on /app/jobwork,
   *  "Outsourcing party" on /app/outsource. */
  partyLabel: string;
  /** Used in invoice / DC text (e.g. "Weaving Bill" vs "Job Work Bill"). */
  billLabel: string;
  dcLabel: string;
}
const VARIANTS: Record<PartyKind, PageVariant> = {
  jobwork: {
    kind: 'jobwork',
    title: 'Job Work',
    subtitle: 'Track bobbin / warp beam / weft bag issued to each jobwork party. Inline edit, delete, restock supported.',
    manageHref: '/app/parties?type=3',
    manageLabel: 'Manage Jobwork Parties',
    partyLabel: 'Jobwork Party',
    billLabel: 'Job Work Bill',
    dcLabel: 'Job Work DC',
  },
  outsource: {
    kind: 'outsource',
    title: 'Outsource Weaving',
    subtitle: 'Track bobbin / warp beam / weft bag issued to each outsource weaver. Inline edit, delete, restock supported.',
    manageHref: '/app/parties?type=5',
    manageLabel: 'Manage Outsource Weavers',
    partyLabel: 'Outsourcing party',
    billLabel: 'Weaving Bill',
    dcLabel: 'Outsource Weaving DC',
  },
};

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
  /** Unified-party FK pointing at the bobbin supplier. Selected on
   *  load alongside vendor_id. Used as the default supplier when
   *  logging a bobbin-return back to the source. */
  supplier_party_id: number | null;
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

/** One bobbin-return event. Each row is an empty-bobbin shipment back
 *  to the supplier after weaving consumed the yarn. */
interface BobbinReturnRow {
  id: number;
  bobbin_id: number;
  supplier_party_id: number | null;
  jobwork_party_id: number | null;
  return_date: string;
  quantity_pcs: number;
  reference_no: string | null;
  notes: string | null;
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
  const pathname = usePathname();
  const variant: PageVariant = pathname.startsWith('/app/outsource') ? VARIANTS.outsource : VARIANTS.jobwork;
  const [tab, setTab] = useState<Tab>('dc');
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [allParties, setAllParties] = useState<PartyOpt[]>([]);
  const [bobbinSuppliers, setBobbinSuppliers] = useState<PartyOpt[]>([]);
  const [sizingParties, setSizingParties] = useState<PartyOpt[]>([]);
  const [fabricDefaults, setFabricDefaults] = useState<Map<number, FabricDefaults>>(new Map());
  const [qualities, setQualities] = useState<QualityOpt[]>([]);
  const [counts, setCounts] = useState<CountOpt[]>([]);
  const [bobbins, setBobbins] = useState<BobbinRow[]>([]);
  const [bobbinReturns, setBobbinReturns] = useState<BobbinReturnRow[]>([]);
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

    const [p, ap, bs, sp, q, c, b, w, wb, br] = await Promise.all([
      // Filter jobwork_party by kind so the same code services both
      // /app/jobwork (kind='jobwork') and /app/outsource (kind='outsource').
      sb.from('jobwork_party').select('id, code, name').eq('status', 'active').eq('kind', variant.kind).order('name'),
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
      // Bobbin returns - empty pieces sent back to the supplier after
      // weaving consumed the yarn. We aggregate these per bobbin in
      // BobbinTab to show "Returned" counts.
      sb.from('bobbin_return').select('id, bobbin_id, supplier_party_id, jobwork_party_id, return_date, quantity_pcs, reference_no, notes').eq('status', 'active').order('return_date', { ascending: false }),
    ]);
    // Don't propagate the bobbin_return error if migration 093 hasn't
    // been applied yet - we just treat it as empty.
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
      // bobbin_return table may not exist yet (migration 093). Tolerate
      // missing data without breaking the page.
      setBobbinReturns(((br?.data ?? []) as BobbinReturnRow[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, [supabase, variant.kind]);

  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const allPartyById = useMemo(() => new Map(allParties.map((p) => [p.id, p])), [allParties]);
  const qualityById = useMemo(() => new Map(qualities.map((q) => [q.id, q])), [qualities]);
  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts]);

  return (
    <div>
      <PageHeader
        title={variant.title}
        subtitle={variant.subtitle}
        actions={
          <Link href={variant.manageHref} className="btn-ghost">
            {variant.manageLabel}
          </Link>
        }
      />

      {/* Warp beam given is OUTSOURCE-ONLY now — jobwork parties no
          longer receive warp beams. The tab is suppressed when
          variant.kind === 'jobwork', and we redirect the active tab
          off it if the operator was already viewing it. */}
      <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
        <TabButton active={tab === 'dc'}        onClick={() => setTab('dc')}>DC</TabButton>
        <TabButton active={tab === 'bobbin'}    onClick={() => setTab('bobbin')}>Bobbin given</TabButton>
        {variant.kind === 'outsource' && (
          <TabButton active={tab === 'warp_beam'} onClick={() => setTab('warp_beam')}>Warp beam given</TabButton>
        )}
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
        <JobworkDcTab parties={parties} qualities={qualities} kind={variant.kind} />
      ) : tab === 'bobbin' ? (
        <BobbinTab
          rows={bobbins.filter((b) => b.jobwork_party_id != null && partyById.has(b.jobwork_party_id))}
          returns={bobbinReturns}
          partyById={partyById}
          bobbinSuppliers={bobbinSuppliers}
          allParties={allParties}
          partyLabel={variant.partyLabel}
          onChanged={load}
        />
      ) : tab === 'warp_beam' && variant.kind === 'outsource' ? (
        <WarpBeamTab
          rows={warpBeams.filter((w) => w.jobwork_party_id != null && partyById.has(w.jobwork_party_id))}
          parties={parties} qualities={qualities} counts={counts}
          sizingParties={sizingParties} fabricDefaults={fabricDefaults}
          partyById={partyById} qualityById={qualityById} countById={countById}
          partyLabel={variant.partyLabel}
          kind={variant.kind}
          onChanged={load}
        />
      ) : tab === 'weft_bag' ? (
        <WeftBagTab
          rows={weftBags.filter((w) => w.jobwork_party_id != null && partyById.has(w.jobwork_party_id))}
          parties={parties} counts={counts} allParties={allParties}
          partyById={partyById} countById={countById} allPartyById={allPartyById}
          partyLabel={variant.partyLabel}
          onChanged={load}
        />
      ) : tab === 'payment' ? (
        <JobworkPaymentTab parties={parties} kind={variant.kind} />
      ) : (
        <StatusTab
          parties={parties} qualities={qualities} counts={counts}
          bobbins={bobbins.filter((b) => b.jobwork_party_id != null && partyById.has(b.jobwork_party_id))}
          warpBeams={warpBeams.filter((w) => w.jobwork_party_id != null && partyById.has(w.jobwork_party_id))}
          weftBags={weftBags.filter((w) => w.jobwork_party_id != null && partyById.has(w.jobwork_party_id))}
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
function BobbinTab({ rows, returns, partyById, bobbinSuppliers, allParties, partyLabel, onChanged }: {
  rows: BobbinRow[]; returns: BobbinReturnRow[];
  partyById: Map<number, PartyOpt>; bobbinSuppliers: PartyOpt[]; allParties: PartyOpt[];
  /** Label for the dropdown that picks which party to give the bobbin
   *  to — "Jobwork Party" on /app/jobwork, "Outsourcing party" on
   *  /app/outsource. */
  partyLabel: string;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [restockId, setRestockId] = useState<number | null>(null);
  const [returnId, setReturnId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<BobbinRow | null>(null);
  // Total qty returned per bobbin_id - shown alongside the "given" qty
  // so the operator sees the outstanding balance with the supplier.
  const returnedByBobbinId = new Map<number, number>();
  for (const r of returns) {
    if (r.bobbin_id == null) continue;
    returnedByBobbinId.set(
      r.bobbin_id,
      (returnedByBobbinId.get(r.bobbin_id) ?? 0) + Number(r.quantity_pcs ?? 0),
    );
  }
  void allParties;
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

  /** Log a return of empty bobbin pieces back to the supplier. */
  async function logReturn(parent: BobbinRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const qty = Math.trunc(Number(data.qty.qty ?? 0));
    if (qty <= 0) { window.alert('Quantity must be greater than zero.'); return; }
    const payload = {
      bobbin_id: parent.id,
      supplier_party_id: data.supplier_party_id === '' ? (parent.supplier_party_id ?? null) : Number(data.supplier_party_id),
      jobwork_party_id: parent.jobwork_party_id,
      return_date: data.given_date,
      quantity_pcs: qty,
      reference_no: null,
      notes: null,
      status: 'active',
    };
    const { error } = await sb.from('bobbin_return').insert(payload);
    if (error) { window.alert('Return failed: ' + error.message); return; }
    setReturnId(null);
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
            <label className="label text-xs">{partyLabel} *</label>
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
              {/* Date is the leftmost column so each transaction's
                  given-date is immediately visible — matches the Warp
                  Beam / Weft Bag tabs. */}
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Code</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Description</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3" title="Metres per piece">M/pc</th>
              <th className="text-right px-3 py-3">Qty (pcs)</th>
              <th className="text-right px-3 py-3" title="Qty × M/pc">Total m</th>
              <th className="text-right px-3 py-3" title="Empty bobbin pcs returned to supplier">Returned</th>
              <th className="text-right px-3 py-3" title="Qty issued - returned">Balance</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-ink-soft">No jobwork bobbin entries yet.</td></tr>
            ) : rows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = isEditing && editForm ? editForm : r;
              const partyOptions = Array.from(partyById.values());
              const qtyForRow = Number((r.original_quantity ?? r.quantity) ?? 0);
              const perPcForRow = Number(r.bobbin_metre ?? 0);
              const totalMRow = perPcForRow > 0 ? qtyForRow * perPcForRow : 0;
              const returnedRow = returnedByBobbinId.get(r.id) ?? 0;
              const balanceRow = qtyForRow - returnedRow;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            className="input h-8 text-xs"
                            value={ef.purchase_date ?? ''}
                            onChange={(e) => setEditForm({ ...ef, purchase_date: e.target.value || null })}
                          />
                        </td>
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
                        {/* Returned + Balance are derived from
                            bobbin_return entries and aren't editable. */}
                        <td className="px-3 py-2 text-right num text-xs text-ink-mute">{returnedRow > 0 ? returnedRow : '-'}</td>
                        <td className="px-3 py-2 text-right num text-xs text-ink-mute">{balanceRow}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(r.purchase_date)}</td>
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
                        <td className="px-3 py-2 text-right num text-amber-700">{returnedRow > 0 ? returnedRow : '-'}</td>
                        <td className={`px-3 py-2 text-right num font-semibold ${balanceRow > 0 ? 'text-ink' : 'text-emerald-700'}`}>{balanceRow}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => setReturnId(returnId === r.id ? null : r.id)} className="text-amber-700 hover:text-amber-900 mr-2" title="Return to supplier"><ArrowLeft className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={11} className="p-0">
                      <RestockForm parties={bobbinSuppliers}
                        qtyFields={[{ key: 'qty', label: 'Qty', step: 1 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                  {returnId === r.id && !isEditing && (
                    <tr><td colSpan={11} className="p-0">
                      <RestockForm parties={bobbinSuppliers}
                        qtyFields={[{ key: 'qty', label: 'Returned pcs', step: 1 }]}
                        onCancel={() => setReturnId(null)}
                        onSave={(data) => logReturn(r, data)} />
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
                <td className="px-3 py-3 text-right num font-bold text-amber-700">
                  {rows.reduce((s, r) => s + (returnedByBobbinId.get(r.id) ?? 0), 0).toLocaleString('en-IN')}
                </td>
                <td className="px-3 py-3 text-right num font-bold">
                  {rows.reduce((s, r) => s + (Number((r.original_quantity ?? r.quantity) ?? 0) - (returnedByBobbinId.get(r.id) ?? 0)), 0).toLocaleString('en-IN')}
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
function WarpBeamTab({ rows, parties, qualities, counts, sizingParties, fabricDefaults, partyById, qualityById, countById, partyLabel, kind, onChanged }: {
  rows: WarpBeamRow[]; parties: PartyOpt[]; qualities: QualityOpt[]; counts: CountOpt[];
  sizingParties: PartyOpt[]; fabricDefaults: Map<number, FabricDefaults>;
  partyById: Map<number, PartyOpt>; qualityById: Map<number, QualityOpt>; countById: Map<number, CountOpt>;
  /** "Jobwork Party" or "Outsourcing party" depending on the route. */
  partyLabel: string;
  /** Tab is rendered inside /app/jobwork or /app/outsource. The
   *  outsource variant pulls in pavu rows assigned to outsource via
   *  Pavu Master and shows them as a read-only section above the
   *  jobwork_warp_beam entries. */
  kind: 'jobwork' | 'outsource';
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
    total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
    // New (outsource flow): the sizing job the operator is sourcing
    // beams from. When set we list its pavu rows below and the
    // operator ticks the ones to include.
    sizing_job_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WarpBeamRow | null>(null);
  const [restockId, setRestockId] = useState<number | null>(null);
  // Toggle for the inline add form. Mirrors the BobbinTab pattern so
  // the page loads with the form hidden and the table front-and-centre.
  const [showAdd, setShowAdd] = useState<boolean>(false);
  // Table filters (empty string = "All ...").
  const [filterQualityId, setFilterQualityId] = useState<string>('');
  const [filterPartyId, setFilterPartyId] = useState<string>('');

  // Pavu-driven Add form state. Sizing jobs are loaded once when the
  // Add form opens; the selected job's pavu rows are loaded
  // independently so the checkbox list narrows the moment the
  // operator picks a job.
  interface SizingJobOpt {
    id: number;
    job_code: string;
    set_no: string | null;
    warp_count_id: number | null;
  }
  interface PavuOpt {
    id: number;
    pavu_code: string;
    beam_no: string;
    ends: number;
    meters: number;
    production_mode: 'in_house' | 'outsource' | null;
    outsource_ledger_id: number | null;
  }
  const [sizingJobs,       setSizingJobs]       = useState<SizingJobOpt[]>([]);
  const [pavusForJob,      setPavusForJob]      = useState<PavuOpt[]>([]);
  const [selectedPavuIds,  setSelectedPavuIds]  = useState<Set<number>>(new Set());

  // Load sizing jobs once when the form opens. Only jobs that have
  // at least one pavu row already routed to outsource via Pavu
  // Master surface here — sourcing a beam for an outsource warp
  // entry doesn't make sense if none of the job's beams are
  // outsource in the first place.
  useEffect(() => {
    if (!showAdd || kind !== 'outsource') return;
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      // Two-step lookup: first find the distinct sizing_job_ids that
      // have outsource-routed pavu rows, then fetch those jobs. This
      // is simpler than a PostgREST inner-join + embedded filter and
      // works the same regardless of the row counts.
      const { data: pavuRows } = await sb
        .from('pavu')
        .select('sizing_job_id')
        .eq('production_mode', 'outsource')
        .not('sizing_job_id', 'is', null);
      const jobIds = Array.from(new Set(
        ((pavuRows ?? []) as Array<{ sizing_job_id: number | null }>)
          .map((r) => r.sizing_job_id)
          .filter((x): x is number => x != null),
      ));
      if (jobIds.length === 0) {
        if (!cancelled) setSizingJobs([]);
        return;
      }
      const { data } = await sb
        .from('sizing_job')
        .select('id, job_code, set_no, warp_count_id')
        .in('id', jobIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      setSizingJobs((data ?? []) as SizingJobOpt[]);
    })();
    return () => { cancelled = true; };
  }, [showAdd, kind, supabase]);

  // Load pavu rows when the sizing job picker changes.
  useEffect(() => {
    if (form.sizing_job_id === '') { setPavusForJob([]); setSelectedPavuIds(new Set()); return; }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('pavu')
        .select('id, pavu_code, beam_no, ends, meters, production_mode, outsource_ledger_id')
        .eq('sizing_job_id', Number(form.sizing_job_id))
        .order('beam_no');
      if (cancelled) return;
      setPavusForJob((data ?? []) as PavuOpt[]);
      setSelectedPavuIds(new Set());
    })();
    return () => { cancelled = true; };
  }, [form.sizing_job_id, supabase]);

  function toggleSelectedPavu(id: number) {
    setSelectedPavuIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Auto-totals derived from the selected pavu rows. These drive the
  // read-only "auto" fields on the form; the operator can't override
  // them — to change the figure they pick / unpick a beam.
  const selectedPavus = pavusForJob.filter((p) => selectedPavuIds.has(p.id));
  const autoBeamCount = selectedPavus.length;
  const autoTotalMetres = selectedPavus.reduce((s, p) => s + Number(p.meters ?? 0), 0);
  // Total ends = the ends value of the selected beams. We show the
  // distinct values when the selection spans multiple ends specs.
  const autoEndsValues = Array.from(new Set(selectedPavus.map((p) => Number(p.ends ?? 0))));
  const autoEndsDisplay = autoEndsValues.length === 1 ? String(autoEndsValues[0]) : autoEndsValues.join(', ');
  const autoWarpCountId = (() => {
    const job = sizingJobs.find((j) => j.id === Number(form.sizing_job_id));
    return job?.warp_count_id ?? null;
  })();
  const autoWarpCountLabel = autoWarpCountId != null ? countById.get(autoWarpCountId)?.display_name ?? `#${autoWarpCountId}` : '—';

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
    if (form.jobwork_party_id === '') { setErr('Pick an outsource party.'); return; }
    if (kind === 'outsource') {
      // Pavu-driven flow on the outsource page. Sizing job + selected
      // pavu beams are mandatory; the totals are auto-derived from
      // the picked beams, never typed.
      if (form.sizing_job_id === '') { setErr('Pick a sizing job.'); return; }
      if (selectedPavuIds.size === 0) { setErr('Select at least one pavu beam.'); return; }
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    if (kind === 'outsource') {
      // Resolve the selected outsource party's ledger_id so we can
      // update the pavu rows with the correct foreign key. The party
      // dropdown stores party.id; pavu.outsource_ledger_id stores
      // party.ledger_id.
      const { data: party } = await sb
        .from('party')
        .select('ledger_id')
        .eq('id', Number(form.jobwork_party_id))
        .maybeSingle();
      if (!party?.ledger_id) {
        setBusy(false);
        setErr('Selected party has no linked ledger. Set it up on the party form first.');
        return;
      }
      const newLedgerId = Number(party.ledger_id);

      // Auto totals are derived from the picked beams. We send the
      // numeric values into the table — the operator never touches
      // these fields, so there's no validation to do beyond > 0.
      const payload = {
        jobwork_party_id:  Number(form.jobwork_party_id),
        fabric_quality_id: null,
        warp_count_id:     autoWarpCountId,
        given_date:        form.given_date,
        total_ends:        autoEndsValues.length === 1 ? autoEndsValues[0] : null,
        beam_count:        autoBeamCount,
        total_metres:      autoTotalMetres > 0 ? autoTotalMetres : null,
        original_metres:   autoTotalMetres > 0 ? autoTotalMetres : null,
        reference_no:      form.reference_no.trim() || null,
        notes:             form.notes.trim() || null,
        supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
        // Aggregate row — no single pavu link. Per-pavu mirror rows
        // (created by Pavu Master inline edits) are wiped below
        // since this aggregate now represents them.
        pavu_id:           null,
      };
      const { error: insErr } = await sb.from('jobwork_warp_beam').insert(payload);
      if (insErr) { setBusy(false); setErr(insErr.message); return; }

      // Update each selected pavu to the outsource routing.
      const beamIds = Array.from(selectedPavuIds);
      const { error: pavuErr } = await sb
        .from('pavu')
        .update({ production_mode: 'outsource', outsource_ledger_id: newLedgerId })
        .in('id', beamIds);
      if (pavuErr) { setBusy(false); setErr(`Warp-given saved but pavu update failed: ${pavuErr.message}`); return; }

      // Drop any 1-to-1 mirror rows for the selected pavus — they're
      // represented by the aggregate row now.
      await sb.from('jobwork_warp_beam').delete().in('pavu_id', beamIds);

      setBusy(false);
      setForm({
        given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
        total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
        sizing_job_id: '',
      });
      setSelectedPavuIds(new Set());
      setPavusForJob([]);
      setShowAdd(false);
      onChanged();
      return;
    }

    // Legacy flat-form path (jobwork variant — kept for back-compat
    // even though that tab is no longer rendered by default).
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
      sizing_job_id: '',
    });
    setShowAdd(false);
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

  // Outsource-only blurb (this tab is no longer rendered on the
  // jobwork variant — warp beams aren't issued to jobwork parties).
  const tabBlurb = 'Warp beams sent to outsource weavers. Add captures each issue; the table reflects only what\u2019s been logged here.';

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">{tabBlurb}</p>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add warp beam given'}
        </button>
      </div>

{/* The "From Pavu Master" preview block was removed — the operator
          asked for the warp-given table to reflect only what's been
          logged via the Add warp beam given form. Pavu Master's
          routing assignments live on the pavu rows themselves and
          surface in the Pavu list, not here. */}

      {showAdd && (
      <div className="card p-4 mb-4 space-y-4">
        <h3 className="font-display font-bold text-sm">Add warp beam given</h3>

        {/* Step 1 — pick date, party, sizing job. The sizing-job picker
            drives the pavu list below; the totals downstream are then
            auto-derived from whichever pavu beams the operator ticks. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label text-xs">ID</label>
            <div className="input bg-cloud/40 text-ink-mute select-none">Auto (WBG-NNNN)</div>
          </div>
          <div><label className="label text-xs">Date *</label>
            <input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">{partyLabel} *</label>
            <select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}>
              <option value="">--- pick ---</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select></div>
          <div><label className="label text-xs">Sizing job *</label>
            <select className="input" value={form.sizing_job_id} onChange={(e) => setForm({ ...form, sizing_job_id: e.target.value })}>
              <option value="">--- pick ---</option>
              {sizingJobs.map((j) => (
                <option key={j.id} value={j.id}>{j.job_code}{j.set_no ? ' · Set ' + j.set_no : ''}</option>
              ))}
            </select></div>
        </div>

        {/* Step 2 — pavu beam checklist. Visible once a sizing job is
            picked. Each row tells the operator the beam no, ends and
            metres so they can confirm before ticking; the per-beam
            current routing pill is shown on the right. */}
        {form.sizing_job_id !== '' && (
          <div className="rounded-lg border border-line/60 bg-cloud/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Pavu beams in this set
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="text-indigo underline"
                  onClick={() => setSelectedPavuIds(new Set(pavusForJob.map((p) => p.id)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-ink-mute underline"
                  onClick={() => setSelectedPavuIds(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            {pavusForJob.length === 0 ? (
              <div className="text-xs text-ink-mute py-2">No pavu beams in this sizing job.</div>
            ) : (
              <ul className="space-y-1">
                {pavusForJob.map((p) => {
                  const checked = selectedPavuIds.has(p.id);
                  const isOutsource = p.production_mode === 'outsource';
                  return (
                    <li key={p.id} className="flex items-center gap-3 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedPavu(p.id)}
                        className="cursor-pointer"
                      />
                      <span className="font-mono w-24 inline-block">{p.pavu_code}</span>
                      <span className="font-mono w-16 inline-block">#{p.beam_no}</span>
                      <span className="text-ink-mute w-24 inline-block">{p.ends} ends</span>
                      <span className="text-ink-mute w-24 inline-block">{Number(p.meters).toFixed(0)} m</span>
                      <span className={
                        'ml-auto pill text-[10px] ' +
                        (isOutsource ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700')
                      }>
                        {isOutsource ? 'Outsource' : 'In-house'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Step 3 — auto fields. Read-only; values change only when
            the operator picks / unpicks beams above. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label text-xs">Warp count <span className="text-ink-mute">(auto)</span></label>
            <div className="input bg-cloud/40 text-ink-mute select-none">{autoWarpCountLabel}</div>
          </div>
          <div><label className="label text-xs">No. of beams <span className="text-ink-mute">(auto)</span></label>
            <div className="input num bg-cloud/40 text-ink-mute select-none">{autoBeamCount}</div>
          </div>
          <div><label className="label text-xs">Total ends <span className="text-ink-mute">(auto)</span></label>
            <div className="input num bg-cloud/40 text-ink-mute select-none">{autoEndsDisplay || '—'}</div>
          </div>
          <div><label className="label text-xs">Total metres <span className="text-ink-mute">(auto)</span></label>
            <div className="input num bg-cloud/40 text-ink-mute select-none">
              {autoTotalMetres > 0 ? autoTotalMetres.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
            </div>
          </div>
        </div>

        {/* Optional extras */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
          <div><label className="label text-xs">Notes</label>
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>

        {err && <div className="text-sm text-err">{err}</div>}
        <div className="flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add warp beam
          </button>
        </div>
      </div>
      )}

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
              <th className="text-left  px-3 py-3">ID</th>
              <th className="text-left  px-3 py-3">Date</th>
              <th className="text-left  px-3 py-3">Party</th>
              <th className="text-left  px-3 py-3">Quality</th>
              <th className="text-left  px-3 py-3">Warp count</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3" title="Total number of beams issued">Beams</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-left  px-3 py-3">Sizing party</th>
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
                        {/* ID — auto-issued, never editable. */}
                        <td className="px-3 py-2 font-mono text-xs text-ink-mute">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
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
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        {/* Auto-issued ID derived from the row's
                            numeric primary key — short, sortable, and
                            unique without a schema change. */}
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                        <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                        <td className="px-3 py-2">{r.fabric_quality_id ? qualityById.get(r.fabric_quality_id)?.name ?? '-' : '-'}</td>
                        <td className="px-3 py-2">{r.warp_count_id ? countById.get(r.warp_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.total_ends ?? '-'}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{r.beam_count}</td>
                        <td className="px-3 py-2 text-right num">{(r.original_metres ?? r.total_metres) ?? '-'}</td>
                        <td className="px-3 py-2 text-ink-soft">{r.supplier_party_id ? sizingParties.find((p) => p.id === r.supplier_party_id)?.name ?? '#' + r.supplier_party_id : '-'}</td>
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
function WeftBagTab({ rows, parties, counts, allParties, partyById, countById, allPartyById, partyLabel, onChanged }: {
  rows: WeftBagRow[]; parties: PartyOpt[]; counts: CountOpt[]; allParties: PartyOpt[];
  partyById: Map<number, PartyOpt>; countById: Map<number, CountOpt>; allPartyById: Map<number, PartyOpt>;
  /** "Jobwork Party" or "Outsourcing party" depending on the route. */
  partyLabel: string;
  onChanged: () => void;
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
  // Toggle for the inline add form so the page loads with the form
  // hidden and the table front-and-centre (matches BobbinTab pattern).
  const [showAdd, setShowAdd] = useState<boolean>(false);
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
    setShowAdd(false);
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
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">Weft bags issued to jobwork parties. Use Add to log a new bag; Restock to log a fresh batch.</p>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add weft bag given'}
        </button>
      </div>

      {showAdd && (
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add weft bag</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label text-xs">Date *</label><input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">{partyLabel} *</label><select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}><option value="">--- pick ---</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></div>
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
      )}

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

/* ===== Status tab =====
 * Single consolidated table view showing every (party × quality) pair
 * that has any warp beam given, with the party's weft kg + bobbin pcs
 * totals attached. Two filters at the top — Party and Quality — let
 * the operator narrow the view. Quality filter applies to the warp
 * column only; weft and bobbin numbers stay party-level (they aren't
 * tied to a specific fabric quality in the data model). */
function StatusTab({ parties, qualities, counts, bobbins, warpBeams, weftBags, partyById }: {
  parties: PartyOpt[]; qualities: QualityOpt[]; counts: CountOpt[];
  bobbins: BobbinRow[]; warpBeams: WarpBeamRow[]; weftBags: WeftBagRow[];
  partyById: Map<number, PartyOpt>;
}) {
  // Stock-type selector — drives which secondary filter + table layout
  // is shown. Mirrors the way the operator thinks about the page:
  //   Warp   → fabric quality picker, columns = Warp beams + metres
  //   Weft   → yarn count picker,    columns = Weft bags + kg
  //   Bobbin → bobbin code picker,   columns = Pcs + metres (pcs × bobbin_metre)
  type StockType = 'warp' | 'weft' | 'bobbin';
  const [stockType,        setStockType]        = useState<StockType>('warp');
  const [filterPartyId,    setFilterPartyId]    = useState<string>('');
  const [filterQualityId,  setFilterQualityId]  = useState<string>('');
  const [filterCountId,    setFilterCountId]    = useState<string>('');
  const [filterBobbinId,   setFilterBobbinId]   = useState<string>('');
  void partyById;

  const qualityById   = useMemo(() => new Map(qualities.map((q) => [q.id, q])), [qualities]);
  const countById     = useMemo(() => new Map(counts.map((c)    => [c.id, c])), [counts]);
  const bobbinById    = useMemo(() => new Map(bobbins.map((b)   => [b.id, b])), [bobbins]);
  const partyByIdLocal = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);

  // ─── Warp aggregation: (party, fabric_quality) → beams + metres ───
  const warpRows = useMemo(() => {
    if (stockType !== 'warp') return [];
    const m = new Map<string, { partyId: number; qualityId: number; metres: number; beams: number }>();
    for (const w of warpBeams) {
      if (w.fabric_quality_id == null) continue;
      const key = `${w.jobwork_party_id}|${w.fabric_quality_id}`;
      const existing = m.get(key);
      const metres = Number((w.original_metres ?? w.total_metres) ?? 0);
      const beams  = Number(w.beam_count ?? 0);
      if (existing) {
        existing.metres += metres;
        existing.beams  += beams;
      } else {
        m.set(key, { partyId: w.jobwork_party_id, qualityId: w.fabric_quality_id, metres, beams });
      }
    }
    return Array.from(m.values())
      .filter((r) =>
        (filterPartyId   === '' || String(r.partyId)   === filterPartyId) &&
        (filterQualityId === '' || String(r.qualityId) === filterQualityId)
      )
      .map((r) => ({
        ...r,
        partyName:   partyByIdLocal.get(r.partyId)?.name ?? `Party #${r.partyId}`,
        qualityName: qualityById.get(r.qualityId)?.name ?? `Quality #${r.qualityId}`,
      }))
      .sort((a, b) => a.partyName.localeCompare(b.partyName) || a.qualityName.localeCompare(b.qualityName));
  }, [stockType, warpBeams, filterPartyId, filterQualityId, partyByIdLocal, qualityById]);

  // ─── Weft aggregation: (party, yarn_count) → bag count + kg ───
  const weftRows = useMemo(() => {
    if (stockType !== 'weft') return [];
    const m = new Map<string, { partyId: number; countId: number; bags: number; kg: number }>();
    for (const wb of weftBags) {
      if (wb.yarn_count_id == null || wb.jobwork_party_id == null) continue;
      const key = `${wb.jobwork_party_id}|${wb.yarn_count_id}`;
      const existing = m.get(key);
      const bags = Number(wb.bag_count ?? 0);
      const kg   = Number((wb.original_kg ?? wb.total_kg) ?? 0);
      if (existing) {
        existing.bags += bags;
        existing.kg   += kg;
      } else {
        m.set(key, { partyId: wb.jobwork_party_id, countId: wb.yarn_count_id, bags, kg });
      }
    }
    return Array.from(m.values())
      .filter((r) =>
        (filterPartyId === '' || String(r.partyId) === filterPartyId) &&
        (filterCountId === '' || String(r.countId) === filterCountId)
      )
      .map((r) => {
        const c = countById.get(r.countId);
        return {
          ...r,
          partyName: partyByIdLocal.get(r.partyId)?.name ?? `Party #${r.partyId}`,
          countLbl:  c ? `${c.code} - ${c.display_name}` : `Count #${r.countId}`,
        };
      })
      .sort((a, b) => a.partyName.localeCompare(b.partyName) || a.countLbl.localeCompare(b.countLbl));
  }, [stockType, weftBags, filterPartyId, filterCountId, partyByIdLocal, countById]);

  // ─── Bobbin aggregation: (party, bobbin) → pcs + metres ───
  // metres per row = pcs × bobbin_metre (from the bobbin master).
  const bobbinRows = useMemo(() => {
    if (stockType !== 'bobbin') return [];
    const m = new Map<string, { partyId: number; bobbinId: number; pcs: number; metres: number }>();
    for (const b of bobbins) {
      if (b.jobwork_party_id == null) continue;
      const key = `${b.jobwork_party_id}|${b.id}`;
      const pcs        = Number((b.original_quantity ?? b.quantity) ?? 0);
      const perBobbin  = Number(b.bobbin_metre ?? 0);
      const metres     = pcs * perBobbin;
      const existing = m.get(key);
      if (existing) {
        existing.pcs    += pcs;
        existing.metres += metres;
      } else {
        m.set(key, { partyId: b.jobwork_party_id, bobbinId: b.id, pcs, metres });
      }
    }
    return Array.from(m.values())
      .filter((r) =>
        (filterPartyId  === '' || String(r.partyId)  === filterPartyId) &&
        (filterBobbinId === '' || String(r.bobbinId) === filterBobbinId)
      )
      .map((r) => {
        const bm = bobbinById.get(r.bobbinId);
        return {
          ...r,
          partyName:  partyByIdLocal.get(r.partyId)?.name ?? `Party #${r.partyId}`,
          bobbinLbl:  bm ? `${bm.code} - ${bm.description}` : `Bobbin #${r.bobbinId}`,
        };
      })
      .sort((a, b) => a.partyName.localeCompare(b.partyName) || a.bobbinLbl.localeCompare(b.bobbinLbl));
  }, [stockType, bobbins, filterPartyId, filterBobbinId, partyByIdLocal, bobbinById]);

  // Footer totals per view.
  const warpTotal   = useMemo(() => warpRows.reduce(  (a, r) => ({ beams: a.beams + r.beams,  metres: a.metres + r.metres }), { beams: 0, metres: 0 }), [warpRows]);
  const weftTotal   = useMemo(() => weftRows.reduce(  (a, r) => ({ bags:  a.bags  + r.bags,   kg:     a.kg     + r.kg     }), { bags:  0, kg:     0 }), [weftRows]);
  const bobbinTotal = useMemo(() => bobbinRows.reduce((a, r) => ({ pcs:   a.pcs   + r.pcs,    metres: a.metres + r.metres }), { pcs:   0, metres: 0 }), [bobbinRows]);

  function clearFilters(): void {
    setFilterPartyId('');
    setFilterQualityId('');
    setFilterCountId('');
    setFilterBobbinId('');
  }

  const visibleRowCount = stockType === 'warp' ? warpRows.length
                         : stockType === 'weft' ? weftRows.length
                                                : bobbinRows.length;

  return (
    <div className="space-y-3">
      {/* ── Stock-type toggle ─────────────────────────────────────── */}
      <div className="flex gap-1 flex-wrap">
        {([
          { key: 'warp',   label: 'Warp (beams + metres)' },
          { key: 'weft',   label: 'Weft (bags + kg)' },
          { key: 'bobbin', label: 'Bobbin (pcs + metres)' },
        ] as Array<{ key: StockType; label: string }>).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setStockType(t.key); clearFilters(); }}
            className={
              'px-3 py-1.5 text-xs font-semibold rounded-md border ' +
              (stockType === t.key
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-cloud text-ink-soft border-line hover:bg-indigo-50')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Filter row — secondary filter switches per stock type ─── */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-[10px]">Party</label>
          <select
            className="input py-1 text-xs min-w-[180px]"
            value={filterPartyId}
            onChange={(e) => setFilterPartyId(e.target.value)}
          >
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {stockType === 'warp' && (
          <div>
            <label className="label text-[10px]">Fabric Quality</label>
            <select
              className="input py-1 text-xs min-w-[180px]"
              value={filterQualityId}
              onChange={(e) => setFilterQualityId(e.target.value)}
            >
              <option value="">All qualities</option>
              {qualities.map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
          </div>
        )}

        {stockType === 'weft' && (
          <div>
            <label className="label text-[10px]">Yarn Count</label>
            <select
              className="input py-1 text-xs min-w-[180px]"
              value={filterCountId}
              onChange={(e) => setFilterCountId(e.target.value)}
            >
              <option value="">All counts</option>
              {counts.map((c) => (
                <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>
              ))}
            </select>
          </div>
        )}

        {stockType === 'bobbin' && (
          <div>
            <label className="label text-[10px]">Bobbin</label>
            <select
              className="input py-1 text-xs min-w-[180px]"
              value={filterBobbinId}
              onChange={(e) => setFilterBobbinId(e.target.value)}
            >
              <option value="">All bobbins</option>
              {bobbins.filter((b) => b.jobwork_party_id != null).map((b) => (
                <option key={b.id} value={b.id}>{b.code} - {b.description}</option>
              ))}
            </select>
          </div>
        )}

        {(filterPartyId !== '' || filterQualityId !== '' || filterCountId !== '' || filterBobbinId !== '') && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-ink-mute hover:text-ink underline self-center"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-xs text-ink-soft">
          {visibleRowCount} row{visibleRowCount === 1 ? '' : 's'}
        </div>
      </div>

      {/* ── Per-view table ─────────────────────────────────────────── */}
      {stockType === 'warp' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Party</th>
                <th className="text-left  px-3 py-3">Fabric Quality</th>
                <th className="text-right px-3 py-3">Warp beams</th>
                <th className="text-right px-3 py-3">Warp metres</th>
              </tr>
            </thead>
            <tbody>
              {warpRows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-soft">No warp entries match the current filters.</td></tr>
              ) : warpRows.map((r) => (
                <tr key={`${r.partyId}-${r.qualityId}`} className="border-t border-line/40">
                  <td className="px-3 py-2 font-semibold">{r.partyName}</td>
                  <td className="px-3 py-2">{r.qualityName}</td>
                  <td className="px-3 py-2 text-right num">{r.beams}</td>
                  <td className="px-3 py-2 text-right num font-semibold text-indigo-700">{r.metres.toFixed(0)} m</td>
                </tr>
              ))}
            </tbody>
            {warpRows.length > 0 && (
              <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                  <td className="px-3 py-3 text-right num font-bold">{warpTotal.beams}</td>
                  <td className="px-3 py-3 text-right num font-bold text-indigo-700">{warpTotal.metres.toFixed(0)} m</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {stockType === 'weft' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Party</th>
                <th className="text-left  px-3 py-3">Yarn Count</th>
                <th className="text-right px-3 py-3">Weft bags</th>
                <th className="text-right px-3 py-3">Weft kg</th>
              </tr>
            </thead>
            <tbody>
              {weftRows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-soft">No weft entries match the current filters.</td></tr>
              ) : weftRows.map((r) => (
                <tr key={`${r.partyId}-${r.countId}`} className="border-t border-line/40">
                  <td className="px-3 py-2 font-semibold">{r.partyName}</td>
                  <td className="px-3 py-2">{r.countLbl}</td>
                  <td className="px-3 py-2 text-right num">{r.bags}</td>
                  <td className="px-3 py-2 text-right num font-semibold text-indigo-700">{r.kg.toFixed(2)} kg</td>
                </tr>
              ))}
            </tbody>
            {weftRows.length > 0 && (
              <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                  <td className="px-3 py-3 text-right num font-bold">{weftTotal.bags}</td>
                  <td className="px-3 py-3 text-right num font-bold text-indigo-700">{weftTotal.kg.toFixed(2)} kg</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {stockType === 'bobbin' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Party</th>
                <th className="text-left  px-3 py-3">Bobbin</th>
                <th className="text-right px-3 py-3">Pcs</th>
                <th className="text-right px-3 py-3">Metres</th>
              </tr>
            </thead>
            <tbody>
              {bobbinRows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-soft">No bobbin entries match the current filters.</td></tr>
              ) : bobbinRows.map((r) => (
                <tr key={`${r.partyId}-${r.bobbinId}`} className="border-t border-line/40">
                  <td className="px-3 py-2 font-semibold">{r.partyName}</td>
                  <td className="px-3 py-2">{r.bobbinLbl}</td>
                  <td className="px-3 py-2 text-right num">{r.pcs}</td>
                  <td className="px-3 py-2 text-right num font-semibold text-indigo-700">{r.metres.toFixed(0)} m</td>
                </tr>
              ))}
            </tbody>
            {bobbinRows.length > 0 && (
              <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                  <td className="px-3 py-3 text-right num font-bold">{bobbinTotal.pcs}</td>
                  <td className="px-3 py-3 text-right num font-bold text-indigo-700">{bobbinTotal.metres.toFixed(0)} m</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

