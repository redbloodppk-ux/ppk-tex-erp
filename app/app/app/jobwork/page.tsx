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

type Tab = 'bobbin' | 'warp_beam' | 'weft_bag' | 'warp_yarn' | 'status';

interface PartyOpt { id: number; code: string; name: string; }
interface QualityOpt { id: number; code: string | null; name: string; }
interface CountOpt { id: number; code: string; display_name: string; }
interface EndsOpt { id: number; code: string; name: string; ends_count: number | null; }
interface FabricDefaults { warp_count_id: number | null; ends_id: number | null; total_ends: number | null; }

interface BobbinRow {
  id: number; code: string; description: string;
  ends_per_bobbin: number; bobbin_metre: number; quantity: number; gst_pct: number;
  bobbin_price: number; jobwork_party_id: number | null; vendor_id: number | null;
  purchase_date: string | null; invoice_no: string | null; is_lurex: boolean;
  notes: string | null;
}
interface WarpBeamRow {
  id: number; jobwork_party_id: number;
  fabric_quality_id: number | null; warp_count_id: number | null;
  given_date: string; total_ends: number | null;
  tape_length_m: number | null; beam_count: number;
  total_metres: number | null; reference_no: string | null; notes: string | null;
  supplier_party_id: number | null;
}
interface WeftBagRow {
  id: number; jobwork_party_id: number;
  yarn_count_id: number | null; given_date: string;
  bag_count: number | null; total_kg: number | null;
  reference_no: string | null; notes: string | null;
  supplier_party_id: number | null;
}
interface WarpYarnRow {
  id: number; jobwork_party_id: number;
  fabric_quality_id: number | null; ends_id: number | null;
  warp_count_id: number | null; given_date: string;
  total_kg: number | null; sizing_rate_per_kg: number | null;
  total_cost: number | null; reference_no: string | null; notes: string | null;
  supplier_party_id: number | null;
}

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
  const [tab, setTab] = useState<Tab>('bobbin');
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [allParties, setAllParties] = useState<PartyOpt[]>([]);
  const [bobbinSuppliers, setBobbinSuppliers] = useState<PartyOpt[]>([]);
  const [sizingParties, setSizingParties] = useState<PartyOpt[]>([]);
  const [fabricDefaults, setFabricDefaults] = useState<Map<number, FabricDefaults>>(new Map());
  const [qualities, setQualities] = useState<QualityOpt[]>([]);
  const [counts, setCounts] = useState<CountOpt[]>([]);
  const [endsOptions, setEndsOptions] = useState<EndsOpt[]>([]);
  const [bobbins, setBobbins] = useState<BobbinRow[]>([]);
  const [warpBeams, setWarpBeams] = useState<WarpBeamRow[]>([]);
  const [weftBags, setWeftBags] = useState<WeftBagRow[]>([]);
  const [warpYarns, setWarpYarns] = useState<WarpYarnRow[]>([]);
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

    const [p, ap, bs, sp, q, c, ends, fqe, fqw, b, w, wb, wy] = await Promise.all([
      sb.from('jobwork_party').select('id, code, name').eq('status', 'active').order('name'),
      sb.from('party').select('id, code, name').eq('status', 'active').order('name'),
      bobbinSupplierTypeId === null
        ? Promise.resolve({ data: [], error: null })
        : sb.from('party').select('id, code, name').eq('status', 'active').eq('party_type_id', bobbinSupplierTypeId).order('name'),
      sizingPartyTypeId === null
        ? Promise.resolve({ data: [], error: null })
        : sb.from('party').select('id, code, name').eq('status', 'active').eq('party_type_id', sizingPartyTypeId).order('name'),
      sb.from('fabric_quality').select('id, code, name').eq('active', true).order('name'),
      sb.from('yarn_count').select('id, code, display_name').neq('status', 'archived').order('code'),
      sb.from('ends_master').select('id, code, name, ends_count').eq('active', true).order('ends_count'),
      // Child tables used to auto-fill warp count + total ends when a fabric
      // is picked in the Warp Beam tab. Order by sno so we take the
      // "primary" (sno=1) entry for each fabric.
      sb.from('fabric_quality_ends').select('fabric_quality_id, ends_id, sno').order('sno'),
      sb.from('fabric_quality_warp_count').select('fabric_quality_id, yarn_count_id, sno').order('sno'),
      sb.from('bobbin').select('id, code, description, ends_per_bobbin, bobbin_metre, quantity, gst_pct, bobbin_price, jobwork_party_id, vendor_id, supplier_party_id, purchase_date, invoice_no, is_lurex, notes').eq('production_mode', 'jobwork').neq('status', 'archived').order('purchase_date', { ascending: false, nullsFirst: false }),
      sb.from('jobwork_warp_beam').select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, tape_length_m, beam_count, total_metres, reference_no, notes, supplier_party_id').eq('status', 'active').order('given_date', { ascending: false }),
      sb.from('jobwork_weft_bag').select('id, jobwork_party_id, yarn_count_id, given_date, bag_count, total_kg, reference_no, notes, supplier_party_id').eq('status', 'active').order('given_date', { ascending: false }),
      sb.from('jobwork_warp_yarn').select('id, jobwork_party_id, fabric_quality_id, ends_id, warp_count_id, given_date, total_kg, sizing_rate_per_kg, total_cost, reference_no, notes, supplier_party_id').eq('status', 'active').order('given_date', { ascending: false }),
    ]);
    const errObj = [p, ap, bs, sp, q, c, ends, fqe, fqw, b, w, wb, wy].find((r) => r.error);
    if (errObj) {
      setError(errObj.error.message);
    } else {
      const endsRows = (ends.data ?? []) as EndsOpt[];
      const fqeRows  = (fqe.data ?? []) as Array<{ fabric_quality_id: number; ends_id: number | null; sno: number }>;
      const fqwRows  = (fqw.data ?? []) as Array<{ fabric_quality_id: number; yarn_count_id: number | null; sno: number }>;

      // Build map: fabric_quality_id -> {warp_count_id, ends_id, total_ends}
      // Take the first (lowest sno) entry from each child list as the
      // "primary" spec for that fabric.
      const endsCountById = new Map<number, number | null>(endsRows.map((e) => [e.id, e.ends_count]));
      const defaults = new Map<number, FabricDefaults>();
      for (const r of fqeRows) {
        const cur = defaults.get(r.fabric_quality_id);
        if (!cur || (cur.ends_id === null && r.ends_id !== null)) {
          defaults.set(r.fabric_quality_id, {
            warp_count_id: cur?.warp_count_id ?? null,
            ends_id: r.ends_id,
            total_ends: r.ends_id != null ? endsCountById.get(r.ends_id) ?? null : null,
          });
        }
      }
      for (const r of fqwRows) {
        const cur = defaults.get(r.fabric_quality_id) ?? { warp_count_id: null, ends_id: null, total_ends: null };
        if (cur.warp_count_id === null) {
          defaults.set(r.fabric_quality_id, { ...cur, warp_count_id: r.yarn_count_id });
        }
      }

      setParties((p.data ?? []) as PartyOpt[]);
      setAllParties((ap.data ?? []) as PartyOpt[]);
      setBobbinSuppliers((bs.data ?? []) as PartyOpt[]);
      setSizingParties((sp.data ?? []) as PartyOpt[]);
      setQualities((q.data ?? []) as QualityOpt[]);
      setCounts((c.data ?? []) as CountOpt[]);
      setEndsOptions(endsRows);
      setFabricDefaults(defaults);
      setBobbins((b.data ?? []) as BobbinRow[]);
      setWarpBeams((w.data ?? []) as WarpBeamRow[]);
      setWeftBags((wb.data ?? []) as WeftBagRow[]);
      setWarpYarns((wy.data ?? []) as WarpYarnRow[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const allPartyById = useMemo(() => new Map(allParties.map((p) => [p.id, p])), [allParties]);
  const qualityById = useMemo(() => new Map(qualities.map((q) => [q.id, q])), [qualities]);
  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts]);
  const endsById = useMemo(() => new Map(endsOptions.map((e) => [e.id, e])), [endsOptions]);

  return (
    <div>
      <PageHeader
        title="Job Work"
        subtitle="Track bobbin / warp beam / weft bag / warp yarn issued to each jobwork party. Inline edit, delete, restock supported."
        actions={
          <Link href="/app/parties?type=3" className="btn-ghost">
            Manage Jobwork Parties
          </Link>
        }
      />

      <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
        <TabButton active={tab === 'bobbin'}    onClick={() => setTab('bobbin')}>Bobbin given</TabButton>
        <TabButton active={tab === 'warp_beam'} onClick={() => setTab('warp_beam')}>Warp beam given</TabButton>
        <TabButton active={tab === 'weft_bag'}  onClick={() => setTab('weft_bag')}>Weft bag given</TabButton>
        <TabButton active={tab === 'warp_yarn'} onClick={() => setTab('warp_yarn')}>Warp yarn given</TabButton>
        <TabButton active={tab === 'status'}    onClick={() => setTab('status')}>Status</TabButton>
      </div>

      {error && <div className="card p-3 mb-3 text-err text-sm">{error}</div>}
      {loading ? (
        <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
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
      ) : tab === 'warp_yarn' ? (
        <WarpYarnTab
          rows={warpYarns} parties={parties} qualities={qualities} counts={counts} endsOptions={endsOptions} allParties={allParties}
          partyById={partyById} qualityById={qualityById} countById={countById} endsById={endsById} allPartyById={allPartyById}
          onChanged={load}
        />
      ) : (
        <StatusTab
          parties={parties} qualities={qualities}
          bobbins={bobbins} warpBeams={warpBeams} weftBags={weftBags} warpYarns={warpYarns}
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
    <div className="p-3 bg-indigo-50/40 border-y border-indigo-200 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
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
      <div className="min-w-0">
        <label className="label text-[10px]">Supplier party</label>
        <select className="input h-8 text-sm w-full" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">--- none ---</option>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5 justify-end min-w-0">
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

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">Bobbin purchases marked as jobwork. Click Restock to log a new batch of the same spec.</p>
        <Link href="/app/bobbin" className="btn-primary">
          <Plus className="w-4 h-4" /> Add Bobbin Stock
        </Link>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Code</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Description</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-right px-3 py-3">Qty</th>
              <th className="text-left px-3 py-3">Purchased</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-soft">No jobwork bobbin entries yet.</td></tr>
            ) : rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr className="border-t border-line/40">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.jobwork_party_id ? (partyById.get(r.jobwork_party_id)?.name ?? '-') : '-'}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.description}</td>
                  <td className="px-3 py-2 text-right num">{r.ends_per_bobbin}</td>
                  <td className="px-3 py-2 text-right num">{r.bobbin_metre}</td>
                  <td className="px-3 py-2 text-right num font-semibold">{r.quantity}</td>
                  <td className="px-3 py-2 text-ink-soft">{fmtDate(r.purchase_date)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setRestockId(restockId === r.id ? null : r.id)}
                      className="text-indigo-700 hover:text-indigo-900" title="Restock">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
                {restockId === r.id && (
                  <tr><td colSpan={8} className="p-0">
                    <RestockForm parties={bobbinSuppliers}
                      qtyFields={[{ key: 'qty', label: 'Qty', step: 1 }]}
                      onCancel={() => setRestockId(null)}
                      onSave={(data) => restock(r, data)} />
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
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
    const { error } = await sb.from('jobwork_warp_beam').update({
      jobwork_party_id: editForm.jobwork_party_id,
      fabric_quality_id: editForm.fabric_quality_id,
      warp_count_id: editForm.warp_count_id,
      given_date: editForm.given_date,
      total_ends: editForm.total_ends,
      beam_count: editForm.beam_count,
      total_metres: editForm.total_metres,
      reference_no: editForm.reference_no,
      notes: editForm.notes,
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
              <th className="text-left px-3 py-3">DC #</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ink-soft">No warp beams issued yet.</td></tr>
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
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.warp_count_id ?? ''} onChange={(e) => setEditForm({ ...ef, warp_count_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></td>
                        <td className="px-2 py-2"><input type="number" className="input num h-8 text-xs w-20" value={ef.total_ends ?? ''} onChange={(e) => setEditForm({ ...ef, total_ends: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" min={1} className="input num h-8 text-xs w-16" value={ef.beam_count} onChange={(e) => setEditForm({ ...ef, beam_count: Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.01} className="input num h-8 text-xs w-20" value={ef.total_metres ?? ''} onChange={(e) => setEditForm({ ...ef, total_metres: e.target.value === '' ? null : Number(e.target.value) })} /></td>
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
                        <td className="px-3 py-2 text-right num">{r.total_metres ?? '-'}</td>
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
                    <tr><td colSpan={9} className="p-0">
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
    const { error } = await sb.from('jobwork_weft_bag').update({
      jobwork_party_id: editForm.jobwork_party_id,
      yarn_count_id: editForm.yarn_count_id,
      given_date: editForm.given_date,
      bag_count: editForm.bag_count,
      total_kg: editForm.total_kg,
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
                        <td className="px-3 py-2 text-right num font-semibold">{r.total_kg ?? '-'}</td>
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
        </table>
      </div>
    </div>
  );
}

/* ===== Warp Yarn tab (NEW) ===== */
function WarpYarnTab({ rows, parties, qualities, counts, endsOptions, allParties, partyById, qualityById, countById, endsById, allPartyById, onChanged }: {
  rows: WarpYarnRow[]; parties: PartyOpt[]; qualities: QualityOpt[]; counts: CountOpt[]; endsOptions: EndsOpt[]; allParties: PartyOpt[];
  partyById: Map<number, PartyOpt>; qualityById: Map<number, QualityOpt>; countById: Map<number, CountOpt>;
  endsById: Map<number, EndsOpt>; allPartyById: Map<number, PartyOpt>; onChanged: () => void;
}) {
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

/* ===== Status tab ===== */
function StatusTab({ parties, qualities, bobbins, warpBeams, weftBags, warpYarns, partyById }: {
  parties: PartyOpt[]; qualities: QualityOpt[];
  bobbins: BobbinRow[]; warpBeams: WarpBeamRow[]; weftBags: WeftBagRow[]; warpYarns: WarpYarnRow[];
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
    const out = new Map<number, { bobbinQty: number; warpBeams: number; warpMetres: number; weftBags: number; weftKg: number; warpYarnKg: number }>();
    for (const p of parties) out.set(p.id, { bobbinQty: 0, warpBeams: 0, warpMetres: 0, weftBags: 0, weftKg: 0, warpYarnKg: 0 });
    for (const b of bobbins) { if (b.jobwork_party_id == null) continue; const r = out.get(b.jobwork_party_id); if (r) r.bobbinQty += Number(b.quantity ?? 0); }
    for (const w of warpBeams) { const r = out.get(w.jobwork_party_id); if (r) { r.warpBeams += Number(w.beam_count ?? 0); r.warpMetres += Number(w.total_metres ?? 0); } }
    for (const wb of weftBags) { const r = out.get(wb.jobwork_party_id); if (r) { r.weftBags += Number(wb.bag_count ?? 0); r.weftKg += Number(wb.total_kg ?? 0); } }
    for (const wy of warpYarns) { const r = out.get(wy.jobwork_party_id); if (r) r.warpYarnKg += Number(wy.total_kg ?? 0); }
    return out;
  }, [parties, bobbins, warpBeams, weftBags, warpYarns]);

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
                <th className="text-right px-3 py-3">Warp yarn kg</th>
              </tr>
            </thead>
            <tbody>
              {parties.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-soft">No parties yet.</td></tr>
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
                    <td className="px-3 py-2 text-right num">{(b?.warpYarnKg ?? 0).toFixed(2)}</td>
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

