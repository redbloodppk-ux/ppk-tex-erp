'use client';
/**
 * Delivery Challan form (shared by /new and /[id]).
 *
 * Hierarchical item model:
 *   Item (fabric quality + HSN)
 *     Bundle #1
 *       Piece 1: 5.20 m
 *       Piece 2: 6.10 m
 *     Bundle #2
 *       Piece 1: 5.50 m
 *       ...
 *
 * The operator first says "how many bundles" - we render that many bundle
 * cards. In each card they add piece-metre entries (one entry per piece).
 *
 * Item-level snapshots:
 *   metres  = sum of every piece across every bundle
 *   pieces  = total piece count across every bundle
 *   bundles = number of bundles
 *
 * Header-level snapshots are sums across all items.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Trash2, Save, X } from 'lucide-react';

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
}

/** Each piece is just a metres value (as a string for controlled input). */
export type Piece = string;

/** A bundle is an ordered list of pieces. */
export interface Bundle {
  sno: number;
  pieces: Piece[];
}

export interface DcItem {
  id?: number;
  sno: number;
  fabric_quality_id: string;
  description: string;
  hsn: string;
  bundles: Bundle[];
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

function emptyItem(sno: number): DcItem {
  return {
    sno,
    fabric_quality_id: '',
    description: '',
    hsn: '',
    bundles: [{ sno: 1, pieces: [''] }],
  };
}

export const EMPTY_DC: DcFormValues = {
  dc_date: todayISO(),
  status: 'draft',
  production_mode: 'inhouse',
  party_id: '',
  ship_to_same: true,
  ship_to_party_id: '',
  bill_to_name: '', bill_to_address: '', bill_to_gstin: '', bill_to_state: '', bill_to_state_code: '',
  ship_to_name: '', ship_to_address: '', ship_to_gstin: '', ship_to_state: '', ship_to_state_code: '',
  vehicle_no: '',
  notes: '',
  items: [emptyItem(1)],
};

function num(s: string): number {
  const t = (s ?? '').toString().trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Sum of piece metres across one bundle. */
function bundleMetres(b: Bundle): number {
  return b.pieces.reduce((s, p) => s + num(p), 0);
}

/** Item-level snapshots: metres = sum across bundles, pieces = total
 *  pieces, bundles = bundle count. Empty piece strings are ignored. */
function itemTotals(it: DcItem): { metres: number; pieces: number; bundles: number } {
  let metres = 0;
  let pieces = 0;
  for (const b of it.bundles) {
    for (const p of b.pieces) {
      const v = num(p);
      if (v > 0) {
        metres += v;
        pieces += 1;
      }
    }
  }
  return { metres, pieces, bundles: it.bundles.length };
}

export function DeliveryChallanForm({ initial }: DcFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial?.id != null;

  const [form, setForm] = useState<DcFormValues>({ ...EMPTY_DC, ...(initial ?? {}) });
  const [allParties, setAllParties]         = useState<PartyOpt[]>([]);
  const [qualities,  setQualities]          = useState<QualityOpt[]>([]);
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
        sb.from('fabric_quality').select('id, code, name, hsn').eq('active', true).order('name'),
      ]);
      const types = (ptRes.data ?? []) as Array<{ id: number; name: string }>;
      setCustomerTypeId(types.find((t) => t.name === 'Customer')?.id ?? null);
      setJobworkTypeId(types.find((t) => t.name === 'Jobwork Party')?.id ?? null);
      setAllParties((partyRes.data ?? []) as PartyOpt[]);
      setQualities((fqRes.data ?? []) as QualityOpt[]);
    })();
  }, [supabase]);

  // ---- Party dropdown filtered by mode ----
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

  // ---- Item helpers ----
  function setItem(idx: number, patch: Partial<DcItem>): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }
  function addItem(): void {
    setForm((f) => ({ ...f, items: [...f.items, emptyItem(f.items.length + 1)] }));
  }
  function removeItem(idx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sno: i + 1 })),
    }));
  }
  function pickFabric(idx: number, fqIdStr: string): void {
    const fq = qualities.find((q) => String(q.id) === fqIdStr);
    setItem(idx, {
      fabric_quality_id: fqIdStr,
      description: fq?.name ?? '',
      hsn: fq?.hsn ?? '',
    });
  }

  // ---- Bundle helpers ----
  // When the operator types "Bundles = N" we either grow or shrink the
  // bundle list to length N. New bundles start with one empty piece input.
  function setBundleCount(itemIdx: number, count: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        const target = Math.max(0, Math.min(count, 200));
        const cur = it.bundles;
        let next: Bundle[];
        if (target > cur.length) {
          const grow: Bundle[] = [];
          for (let k = cur.length; k < target; k++) {
            grow.push({ sno: k + 1, pieces: [''] });
          }
          next = [...cur, ...grow];
        } else if (target < cur.length) {
          next = cur.slice(0, target);
        } else {
          next = cur;
        }
        return { ...it, bundles: next.map((b, k) => ({ ...b, sno: k + 1 })) };
      }),
    }));
  }
  function setPiece(itemIdx: number, bundleIdx: number, pieceIdx: number, value: string): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            return { ...b, pieces: b.pieces.map((p, k) => (k === pieceIdx ? value : p)) };
          }),
        };
      }),
    }));
  }
  function addPiece(itemIdx: number, bundleIdx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => (j === bundleIdx ? { ...b, pieces: [...b.pieces, ''] } : b)),
        };
      }),
    }));
  }
  function removePiece(itemIdx: number, bundleIdx: number, pieceIdx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            const next = b.pieces.filter((_, k) => k !== pieceIdx);
            return { ...b, pieces: next.length === 0 ? [''] : next };
          }),
        };
      }),
    }));
  }

  // ---- DC-level totals snapshot ----
  const headerTotals = useMemo(() => {
    let metres = 0, pieces = 0, bundles = 0;
    for (const it of form.items) {
      const t = itemTotals(it);
      metres  += t.metres;
      pieces  += t.pieces;
      bundles += t.bundles;
    }
    return { metres, pieces, bundles };
  }, [form.items]);

  // ---- Save ----
  async function handleSave(): Promise<void> {
    setError(null);
    if (form.party_id === '') { setError('Pick a party.'); return; }
    if (!form.ship_to_same && form.ship_to_party_id === '') {
      setError('Pick a Ship-To party (or tick "Same as Bill-To").'); return;
    }
    if (form.vehicle_no.trim() === '') { setError('Vehicle number is required.'); return; }
    if (form.items.length === 0)       { setError('Add at least one item.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const headerPayload = {
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
      vehicle_no: form.vehicle_no.trim(),
      total_metres: headerTotals.metres,
      total_pieces: headerTotals.pieces,
      total_bundles: headerTotals.bundles,
      notes: form.notes || null,
    };

    let dcId: number;
    if (isEdit && form.id != null) {
      // On edit only, allow overriding the auto-generated DC code so the
      // user can correct a typo or re-align to a different series. On
      // create we always let fn_autogen_code assign it.
      const editPayload = {
        ...headerPayload,
        code: (form.code ?? '').trim() || null,
      };
      const { error: err } = await sb.from('delivery_challan').update(editPayload).eq('id', form.id);
      if (err) { setBusy(false); setError(err.message); return; }
      dcId = form.id;
      await sb.from('delivery_challan_item').delete().eq('dc_id', dcId);
    } else {
      const { data, error: err } = await sb.from('delivery_challan').insert(headerPayload).select('id').single();
      if (err || !data?.id) { setBusy(false); setError(err?.message ?? 'Insert failed'); return; }
      dcId = data.id as number;
    }

    const itemsPayload = form.items.map((it) => {
      const t = itemTotals(it);
      return {
        dc_id: dcId,
        sno: it.sno,
        fabric_quality_id: it.fabric_quality_id === '' ? null : Number(it.fabric_quality_id),
        description: it.description || null,
        hsn: it.hsn || null,
        metres: t.metres || null,
        pieces: t.pieces || null,
        bundles: t.bundles || null,
        bundles_detail: it.bundles.map((b) => ({
          sno: b.sno,
          pieces: b.pieces.map((p) => num(p)).filter((n) => n > 0),
        })),
      };
    });
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
      {/* Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="label">DC No {isEdit && <span className="text-[10px] text-ink-mute font-normal">(editable)</span>}</label>
          {isEdit ? (
            <input
              type="text"
              className="input font-mono text-xs"
              value={form.code ?? ''}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="DC/26-27/0001"
              required
            />
          ) : (
            <div className="input bg-cloud/40 text-ink-mute">Auto (assigned on save)</div>
          )}
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
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>In-house</button>
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'jobwork', party_id: '' })}
              className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
                (form.production_mode === 'jobwork'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>Job-work</button>
          </div>
        </div>
      </div>

      {/* Vehicle number — mandatory */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Vehicle Number *</label>
          <input className="input num uppercase" required placeholder="TN 38 AB 1234"
            value={form.vehicle_no}
            onChange={(e) => setForm({ ...form, vehicle_no: e.target.value.toUpperCase() })} />
        </div>
      </div>

      {/* Party */}
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
        </div>
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

      {/* Ship-To */}
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

      {/* Items + bundles */}
      <div className="rounded-lg border border-line bg-paper">
        <div className="flex items-center justify-between p-3 border-b border-line/60">
          <h3 className="font-display font-bold text-sm">Items</h3>
          <button type="button" className="btn-ghost text-xs" onClick={addItem}>
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>
        <div className="p-3 space-y-4">
          {form.items.map((it, itemIdx) => {
            const tot = itemTotals(it);
            return (
              <div key={itemIdx} className="rounded-lg border border-line bg-cloud/10 p-3 space-y-3">
                {/* Item header row */}
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-12 md:col-span-1 text-xs text-ink-mute pt-2">Item #{it.sno}</div>
                  <div className="col-span-12 md:col-span-4">
                    <label className="label text-[10px]">Fabric Quality</label>
                    <select className="input h-9 text-sm w-full"
                      value={it.fabric_quality_id}
                      onChange={(e) => pickFabric(itemIdx, e.target.value)}>
                      <option value="">--- pick ---</option>
                      {qualities.map((q) => (
                        <option key={q.id} value={q.id}>{q.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-8 md:col-span-4">
                    <label className="label text-[10px]">Description</label>
                    <input className="input h-9 text-sm" value={it.description}
                      onChange={(e) => setItem(itemIdx, { description: e.target.value })} />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="label text-[10px]">HSN</label>
                    <input className="input h-9 text-sm num" value={it.hsn}
                      onChange={(e) => setItem(itemIdx, { hsn: e.target.value })} />
                  </div>
                  <div className="col-span-12 md:col-span-1 flex justify-end md:justify-center pt-5">
                    <button type="button"
                      onClick={() => removeItem(itemIdx)}
                      disabled={form.items.length === 1}
                      className="p-1.5 rounded hover:bg-rose-50 text-rose-600 disabled:opacity-40"
                      title={form.items.length === 1 ? 'At least one item is required' : 'Remove item'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Bundles count picker */}
                <div className="flex flex-wrap items-end gap-3 border-t border-line/40 pt-3">
                  <div>
                    <label className="label text-[10px]">No. of bundles</label>
                    <input type="number" min={0} max={200} step={1}
                      className="input h-9 text-sm num w-28 text-right"
                      value={it.bundles.length}
                      onChange={(e) => setBundleCount(itemIdx, Number(e.target.value) || 0)} />
                  </div>
                  <p className="text-[11px] text-ink-mute pb-2">
                    Type the bundle count, then enter each piece's metres inside each bundle below.
                  </p>
                </div>

                {/* Per-bundle piece-entry cards */}
                {it.bundles.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {it.bundles.map((b, bundleIdx) => {
                      const bMetres = bundleMetres(b);
                      const bPieces = b.pieces.filter((p) => num(p) > 0).length;
                      return (
                        <div key={bundleIdx} className="rounded-lg border border-line bg-white p-2.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-ink-soft">Bundle #{b.sno}</span>
                            <span className="text-[10px] text-ink-mute">
                              {bPieces} pcs / {bMetres.toFixed(2)} m
                            </span>
                          </div>
                          <div className="space-y-1">
                            {b.pieces.map((p, pieceIdx) => (
                              <div key={pieceIdx} className="flex items-center gap-1">
                                <span className="text-[10px] text-ink-mute w-5 text-right">{pieceIdx + 1}.</span>
                                <input
                                  type="number" step={0.01} min={0}
                                  placeholder="metres"
                                  className="input h-8 text-xs num flex-1 text-right"
                                  value={p}
                                  onChange={(e) => setPiece(itemIdx, bundleIdx, pieceIdx, e.target.value)}
                                />
                                <button type="button"
                                  onClick={() => removePiece(itemIdx, bundleIdx, pieceIdx)}
                                  disabled={b.pieces.length === 1}
                                  className="text-rose-500 hover:text-rose-700 p-1 disabled:opacity-30"
                                  title="Remove piece">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button type="button"
                            onClick={() => addPiece(itemIdx, bundleIdx)}
                            className="mt-1.5 w-full text-[11px] text-indigo-700 hover:bg-indigo-50 py-1 rounded border border-dashed border-line">
                            + Add piece
                          </button>
                          <div className="mt-1.5 pt-1.5 border-t border-line/60 text-right text-[11px] font-semibold text-indigo-700">
                            Total: {bMetres.toFixed(2)} m
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Item totals (auto-snapshot) */}
                <div className="flex flex-wrap justify-end gap-4 border-t border-line/40 pt-2 text-xs">
                  <div>Total Metres: <span className="num font-bold text-indigo-700">{tot.metres.toFixed(2)} m</span></div>
                  <div>No. of Pcs: <span className="num font-bold">{tot.pieces}</span></div>
                  <div>No. of Bundles: <span className="num font-bold">{tot.bundles}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* DC-level totals */}
        <div className="border-t-2 border-line bg-cloud/40 px-3 py-3 flex flex-wrap justify-end gap-6 text-sm font-semibold">
          <div>DC Total Metres: <span className="num text-indigo-700">{headerTotals.metres.toFixed(2)} m</span></div>
          <div>DC Total Pcs: <span className="num">{headerTotals.pieces}</span></div>
          <div>DC Total Bundles: <span className="num">{headerTotals.bundles}</span></div>
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
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isEdit ? 'Save Changes' : 'Create DC'}
        </button>
      </div>
    </form>
  );
}
