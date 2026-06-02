'use client';
/**
 * Shared form for /app/delivery-challan/new and /app/delivery-challan/[id].
 *
 * Flow:
 *   1. Operator picks production mode (in-house vs jobwork).
 *   2. Party dropdown narrows to either Customer-type parties (in-house)
 *      or Jobwork Party-type parties (jobwork).
 *   3. On party change, bill-to name/address/GSTIN/state snapshot autofill.
 *   4. Ship-to has a "same as bill to" checkbox; uncheck to pick a
 *      different party as ship-to (e.g. a separate shipping warehouse).
 *   5. Item rows: fabric quality dropdown auto-fills HSN; operator enters
 *      metres / pieces / bundles / rate. Amount = metres x rate.
 *   6. Header totals (metres, pieces, bundles, amount) are computed live
 *      and snapshotted on save so the Sales Orders page can show them
 *      without re-aggregating items.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';

export type ProductionMode = 'inhouse' | 'jobwork';

export interface PartyOpt {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  billing_address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  party_type_ids: number[] | null;
}

export interface QualityOpt {
  id: number;
  code: string | null;
  name: string;
  hsn: string | null;
  rate_per_m: number | string | null;
}

export interface DcItem {
  id?: number;
  sno: number;
  fabric_quality_id: string;
  description: string;
  hsn: string;
  metres: string;
  pieces: string;
  bundles: string;
  rate_per_m: string;
}

export interface DcFormValues {
  id?: number;
  code?: string;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  production_mode: ProductionMode;
  party_id: string;
  ship_to_same: boolean;
  ship_to_party_id: string;
  bill_to_name: string;
  bill_to_address: string;
  bill_to_gstin: string;
  bill_to_state: string;
  bill_to_state_code: string;
  ship_to_name: string;
  ship_to_address: string;
  ship_to_gstin: string;
  ship_to_state: string;
  ship_to_state_code: string;
  vehicle_no: string;
  transport_mode: string;
  lr_no: string;
  lr_date: string;
  driver_name: string;
  driver_phone: string;
  distance_km: string;
  notes: string;
  items: DcItem[];
}

interface DcFormProps {
  initial?: DcFormValues;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY_ITEM: DcItem = {
  sno: 1, fabric_quality_id: '', description: '', hsn: '',
  metres: '', pieces: '', bundles: '', rate_per_m: '',
};

export const EMPTY_DC: DcFormValues = {
  dc_date: todayISO(),
  status: 'draft',
  production_mode: 'inhouse',
  party_id: '',
  ship_to_same: true,
  ship_to_party_id: '',
  bill_to_name: '', bill_to_address: '', bill_to_gstin: '', bill_to_state: '', bill_to_state_code: '',
  ship_to_name: '', ship_to_address: '', ship_to_gstin: '', ship_to_state: '', ship_to_state_code: '',
  vehicle_no: '', transport_mode: '', lr_no: '', lr_date: '',
  driver_name: '', driver_phone: '', distance_km: '',
  notes: '',
  items: [{ ...EMPTY_ITEM }],
};

function num(s: string): number {
  const t = (s ?? '').toString().trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export function DeliveryChallanForm({ initial }: DcFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial?.id != null;

  const [form, setForm] = useState<DcFormValues>({ ...EMPTY_DC, ...(initial ?? {}) });
  const [allParties, setAllParties]   = useState<PartyOpt[]>([]);
  const [qualities,  setQualities]    = useState<QualityOpt[]>([]);
  const [customerTypeId, setCustomerTypeId] = useState<number | null>(null);
  const [jobworkTypeId,  setJobworkTypeId]  = useState<number | null>(null);
  const [busy,  setBusy]  = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Load reference data ----
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [ptRes, partyRes, fqRes] = await Promise.all([
        sb.from('party_type_master').select('id, name').in('name', ['Customer', 'Jobwork Party']),
        sb.from('party').select('id, code, name, gstin, billing_address, city, state, state_code, pincode, party_type_ids').eq('status', 'active').order('name'),
        sb.from('fabric_quality').select('id, code, name, hsn, rate_per_m').eq('active', true).order('name'),
      ]);
      const types = (ptRes.data ?? []) as Array<{ id: number; name: string }>;
      setCustomerTypeId(types.find((t) => t.name === 'Customer')?.id ?? null);
      setJobworkTypeId(types.find((t) => t.name === 'Jobwork Party')?.id ?? null);
      setAllParties((partyRes.data ?? []) as PartyOpt[]);
      setQualities((fqRes.data ?? []) as QualityOpt[]);
    })();
  }, [supabase]);

  // ---- Derived: party dropdown filtered by production mode ----
  const filteredParties = useMemo<PartyOpt[]>(() => {
    if (form.production_mode === 'jobwork') {
      return jobworkTypeId === null
        ? allParties
        : allParties.filter((p) => (p.party_type_ids ?? []).includes(jobworkTypeId));
    }
    return customerTypeId === null
      ? allParties
      : allParties.filter((p) => (p.party_type_ids ?? []).includes(customerTypeId));
  }, [allParties, form.production_mode, customerTypeId, jobworkTypeId]);

  const partyById = useMemo(() => new Map(allParties.map((p) => [p.id, p])), [allParties]);

  // ---- Auto-fill bill-to from selected party ----
  function pickParty(partyIdStr: string): void {
    setForm((f) => {
      const next = { ...f, party_id: partyIdStr };
      const p = partyById.get(Number(partyIdStr));
      if (p) {
        next.bill_to_name       = p.name;
        next.bill_to_address    = [p.billing_address, p.city, p.pincode].filter(Boolean).join(', ');
        next.bill_to_gstin      = p.gstin ?? '';
        next.bill_to_state      = p.state ?? '';
        next.bill_to_state_code = p.state_code ?? '';
      }
      return next;
    });
  }

  // ---- Auto-fill ship-to from selected ship-to party (when not "same as") ----
  function pickShipToParty(partyIdStr: string): void {
    setForm((f) => {
      const next = { ...f, ship_to_party_id: partyIdStr };
      const p = partyById.get(Number(partyIdStr));
      if (p) {
        next.ship_to_name       = p.name;
        next.ship_to_address    = [p.billing_address, p.city, p.pincode].filter(Boolean).join(', ');
        next.ship_to_gstin      = p.gstin ?? '';
        next.ship_to_state      = p.state ?? '';
        next.ship_to_state_code = p.state_code ?? '';
      }
      return next;
    });
  }

  // ---- Item row helpers ----
  function setItem(idx: number, patch: Partial<DcItem>): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }
  function addItem(): void {
    setForm((f) => ({
      ...f,
      items: [...f.items, { ...EMPTY_ITEM, sno: f.items.length + 1 }],
    }));
  }
  function removeItem(idx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items
        .filter((_, i) => i !== idx)
        .map((it, i) => ({ ...it, sno: i + 1 })),
    }));
  }
  function pickFabric(idx: number, fqIdStr: string): void {
    const fq = qualities.find((q) => String(q.id) === fqIdStr);
    setItem(idx, {
      fabric_quality_id: fqIdStr,
      description: fq?.name ?? '',
      hsn: fq?.hsn ?? '',
      rate_per_m: fq?.rate_per_m == null ? '' : String(fq.rate_per_m),
    });
  }

  // ---- Live totals (snapshot saved on submit) ----
  const totals = useMemo(() => {
    let m = 0, p = 0, b = 0, amt = 0;
    for (const it of form.items) {
      const metres = num(it.metres);
      const pieces = num(it.pieces);
      const bundles = num(it.bundles);
      const rate = num(it.rate_per_m);
      m   += metres;
      p   += pieces;
      b   += bundles;
      amt += metres * rate;
    }
    return { metres: m, pieces: p, bundles: b, amount: amt };
  }, [form.items]);

  // ---- Save ----
  async function handleSave(): Promise<void> {
    setError(null);
    if (form.party_id === '') { setError('Pick a party.'); return; }
    if (!form.ship_to_same && form.ship_to_party_id === '') {
      setError('Pick a Ship-To party (or tick "Same as Bill-To").');
      return;
    }
    if (form.items.length === 0) { setError('Add at least one item.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const headerPayload = {
      // code is auto-generated by trigger on insert
      dc_date: form.dc_date,
      status: form.status,
      production_mode: form.production_mode,
      party_id: Number(form.party_id),
      ship_to_same: form.ship_to_same,
      ship_to_party_id: form.ship_to_same ? null
        : (form.ship_to_party_id === '' ? null : Number(form.ship_to_party_id)),
      bill_to_name: form.bill_to_name || null,
      bill_to_address: form.bill_to_address || null,
      bill_to_gstin: form.bill_to_gstin || null,
      bill_to_state: form.bill_to_state || null,
      bill_to_state_code: form.bill_to_state_code || null,
      ship_to_name: form.ship_to_same ? form.bill_to_name : (form.ship_to_name || null),
      ship_to_address: form.ship_to_same ? form.bill_to_address : (form.ship_to_address || null),
      ship_to_gstin: form.ship_to_same ? form.bill_to_gstin : (form.ship_to_gstin || null),
      ship_to_state: form.ship_to_same ? form.bill_to_state : (form.ship_to_state || null),
      ship_to_state_code: form.ship_to_same ? form.bill_to_state_code : (form.ship_to_state_code || null),
      vehicle_no: form.vehicle_no || null,
      transport_mode: form.transport_mode || null,
      lr_no: form.lr_no || null,
      lr_date: form.lr_date || null,
      driver_name: form.driver_name || null,
      driver_phone: form.driver_phone || null,
      distance_km: form.distance_km === '' ? null : Number(form.distance_km),
      total_metres: totals.metres,
      total_pieces: totals.pieces,
      total_bundles: totals.bundles,
      total_amount: totals.amount,
      notes: form.notes || null,
    };

    let dcId: number;
    if (isEdit && form.id != null) {
      const { error: err } = await sb.from('delivery_challan').update(headerPayload).eq('id', form.id);
      if (err) { setBusy(false); setError(err.message); return; }
      dcId = form.id;
      // Replace items: delete old, insert new (simpler than diffing).
      await sb.from('delivery_challan_item').delete().eq('dc_id', dcId);
    } else {
      const { data, error: err } = await sb.from('delivery_challan').insert(headerPayload).select('id').single();
      if (err || !data?.id) { setBusy(false); setError(err?.message ?? 'Insert failed'); return; }
      dcId = data.id as number;
    }

    const itemsPayload = form.items.map((it) => ({
      dc_id: dcId,
      sno: it.sno,
      fabric_quality_id: it.fabric_quality_id === '' ? null : Number(it.fabric_quality_id),
      description: it.description || null,
      hsn: it.hsn || null,
      metres: num(it.metres) || null,
      pieces: num(it.pieces) || null,
      bundles: num(it.bundles) || null,
      rate_per_m: num(it.rate_per_m) || null,
      amount: num(it.metres) * num(it.rate_per_m) || null,
    }));
    if (itemsPayload.length > 0) {
      const { error: itemErr } = await sb.from('delivery_challan_item').insert(itemsPayload);
      if (itemErr) { setBusy(false); setError(itemErr.message); return; }
    }
    setBusy(false);
    router.push('/app/delivery-challan');
    router.refresh();
  }

  return (
    <form className="card p-5 space-y-5 max-w-5xl" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* Header row: DC no, date, status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="label">DC No</label>
          <div className="input bg-cloud/40 text-ink-mute">
            {form.code ?? 'Auto (DC/26-27/NNNN)'}
          </div>
        </div>
        <div>
          <label className="label">DC Date *</label>
          <input type="date" className="input" required value={form.dc_date}
            onChange={(e) => setForm({ ...form, dc_date: e.target.value })} />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input capitalize" value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as DcFormValues['status'] })}>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed (ready to invoice)</option>
            <option value="invoiced">Invoiced</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="label">Production Mode *</label>
          <div className="flex gap-1.5">
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'inhouse', party_id: '' })}
              className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
                (form.production_mode === 'inhouse'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
              In-house
            </button>
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'jobwork', party_id: '' })}
              className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
                (form.production_mode === 'jobwork'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
              Job-work
            </button>
          </div>
        </div>
      </div>

      {/* Party picker */}
      <div className="rounded-lg border border-line bg-cloud/20 p-4 space-y-3">
        <div>
          <label className="label">
            {form.production_mode === 'jobwork' ? 'Jobwork Party *' : 'Customer *'}
          </label>
          <select className="input w-full" required value={form.party_id}
            onChange={(e) => pickParty(e.target.value)}>
            <option value="">--- pick a {form.production_mode === 'jobwork' ? 'jobwork party' : 'customer'} ---</option>
            {filteredParties.map((p) => (
              <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
            ))}
          </select>
          {filteredParties.length === 0 && form.party_id === '' && (
            <p className="text-[11px] text-ink-mute mt-1">
              No active parties tagged as <span className="font-semibold">
                {form.production_mode === 'jobwork' ? 'Jobwork Party' : 'Customer'}
              </span> yet. Tag a party in <a href="/app/parties" target="_blank" className="text-indigo-700 underline">Parties</a>.
            </p>
          )}
        </div>

        {/* Bill-To snapshot */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Bill-To Name</label>
            <input className="input" value={form.bill_to_name}
              onChange={(e) => setForm({ ...form, bill_to_name: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Bill-To GSTIN</label>
            <input className="input num uppercase" value={form.bill_to_gstin}
              onChange={(e) => setForm({ ...form, bill_to_gstin: e.target.value.toUpperCase() })} />
          </div>
          <div className="md:col-span-2">
            <label className="label text-xs">Bill-To Address</label>
            <textarea className="input min-h-[60px]" value={form.bill_to_address}
              onChange={(e) => setForm({ ...form, bill_to_address: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">State</label>
            <input className="input" value={form.bill_to_state}
              onChange={(e) => setForm({ ...form, bill_to_state: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">State Code</label>
            <input className="input num" maxLength={2} value={form.bill_to_state_code}
              onChange={(e) => setForm({ ...form, bill_to_state_code: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Ship-To picker */}
      <div className="rounded-lg border border-line bg-cloud/20 p-4 space-y-3">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={form.ship_to_same}
            onChange={(e) => setForm({ ...form, ship_to_same: e.target.checked })} />
          <span className="text-sm font-semibold">Ship-To same as Bill-To</span>
        </label>
        {!form.ship_to_same && (
          <>
            <div>
              <label className="label">Ship-To Party</label>
              <select className="input w-full" value={form.ship_to_party_id}
                onChange={(e) => pickShipToParty(e.target.value)}>
                <option value="">--- pick a shipping party ---</option>
                {allParties.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Ship-To Name</label>
                <input className="input" value={form.ship_to_name}
                  onChange={(e) => setForm({ ...form, ship_to_name: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">Ship-To GSTIN</label>
                <input className="input num uppercase" value={form.ship_to_gstin}
                  onChange={(e) => setForm({ ...form, ship_to_gstin: e.target.value.toUpperCase() })} />
              </div>
              <div className="md:col-span-2">
                <label className="label text-xs">Ship-To Address</label>
                <textarea className="input min-h-[60px]" value={form.ship_to_address}
                  onChange={(e) => setForm({ ...form, ship_to_address: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">State</label>
                <input className="input" value={form.ship_to_state}
                  onChange={(e) => setForm({ ...form, ship_to_state: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">State Code</label>
                <input className="input num" maxLength={2} value={form.ship_to_state_code}
                  onChange={(e) => setForm({ ...form, ship_to_state_code: e.target.value })} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Item rows */}
      <div className="rounded-lg border border-line bg-paper">
        <div className="flex items-center justify-between p-3 border-b border-line/60">
          <h3 className="font-display font-bold text-sm">Items</h3>
          <button type="button" className="btn-ghost text-xs" onClick={addItem}>
            <Plus className="w-3.5 h-3.5" /> Add row
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-2 py-2 w-10">#</th>
                <th className="text-left px-2 py-2">Fabric Quality</th>
                <th className="text-left px-2 py-2">Description</th>
                <th className="text-left px-2 py-2 w-20">HSN</th>
                <th className="text-right px-2 py-2 w-24">Metres</th>
                <th className="text-right px-2 py-2 w-20">Pcs</th>
                <th className="text-right px-2 py-2 w-20">Bundles</th>
                <th className="text-right px-2 py-2 w-24">Rate/m</th>
                <th className="text-right px-2 py-2 w-28">Amount</th>
                <th className="px-1 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx} className="border-t border-line/40">
                  <td className="px-2 py-1.5 text-ink-mute">{it.sno}</td>
                  <td className="px-2 py-1.5">
                    <select className="input h-8 text-xs w-full"
                      value={it.fabric_quality_id}
                      onChange={(e) => pickFabric(idx, e.target.value)}>
                      <option value="">--- pick ---</option>
                      {qualities.map((q) => (
                        <option key={q.id} value={q.id}>{q.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input h-8 text-xs w-full" value={it.description}
                      onChange={(e) => setItem(idx, { description: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input h-8 text-xs num w-full" value={it.hsn}
                      onChange={(e) => setItem(idx, { hsn: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" step={0.01} className="input h-8 text-xs num w-full text-right"
                      value={it.metres} onChange={(e) => setItem(idx, { metres: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" className="input h-8 text-xs num w-full text-right"
                      value={it.pieces} onChange={(e) => setItem(idx, { pieces: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" className="input h-8 text-xs num w-full text-right"
                      value={it.bundles} onChange={(e) => setItem(idx, { bundles: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" step={0.01} className="input h-8 text-xs num w-full text-right"
                      value={it.rate_per_m} onChange={(e) => setItem(idx, { rate_per_m: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 text-right num text-xs">
                    {(num(it.metres) * num(it.rate_per_m)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button type="button" className="text-rose-600 hover:text-rose-800"
                      onClick={() => removeItem(idx)} disabled={form.items.length === 1}
                      title={form.items.length === 1 ? 'At least one row is required' : 'Remove row'}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                <td colSpan={4} className="px-2 py-2 text-right text-[11px] uppercase tracking-wide text-ink-soft">Total</td>
                <td className="px-2 py-2 text-right num">{totals.metres.toLocaleString('en-IN', { maximumFractionDigits: 2 })} m</td>
                <td className="px-2 py-2 text-right num">{totals.pieces.toLocaleString('en-IN')}</td>
                <td className="px-2 py-2 text-right num">{totals.bundles.toLocaleString('en-IN')}</td>
                <td />
                <td className="px-2 py-2 text-right num text-indigo-700">
                  Rs {totals.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Transport details */}
      <div className="rounded-lg border border-line bg-cloud/20 p-4">
        <h3 className="font-display font-bold text-sm mb-2">Transport</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label text-xs">Vehicle No</label>
            <input className="input num uppercase" value={form.vehicle_no}
              onChange={(e) => setForm({ ...form, vehicle_no: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <label className="label text-xs">Mode</label>
            <input className="input" placeholder="Road / Rail / Air" value={form.transport_mode}
              onChange={(e) => setForm({ ...form, transport_mode: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">LR / RR No</label>
            <input className="input" value={form.lr_no}
              onChange={(e) => setForm({ ...form, lr_no: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">LR Date</label>
            <input type="date" className="input" value={form.lr_date}
              onChange={(e) => setForm({ ...form, lr_date: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Driver Name</label>
            <input className="input" value={form.driver_name}
              onChange={(e) => setForm({ ...form, driver_name: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Driver Phone</label>
            <input className="input num" value={form.driver_phone}
              onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Distance (km)</label>
            <input type="number" className="input num" value={form.distance_km}
              onChange={(e) => setForm({ ...form, distance_km: e.target.value })} />
          </div>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[60px]" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-2">{error}</div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isEdit ? 'Save Changes' : 'Create DC'}
        </button>
      </div>
    </form>
  );
}
