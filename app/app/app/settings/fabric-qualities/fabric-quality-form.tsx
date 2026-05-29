'use client';
/**
 * Shared Fabric Quality form for /new and /[id].
 * Mirrors the Smart MASTER -> FABRIC CREATION screen:
 *   - Header card (QUALITY, QLTY FOR SALES, HSN, PICK/INCH, REED, REED SPACE,
 *     WIDTH, METER/PC, OUTPUT [unit + value], CRIMP %, GST %)
 *   - 4 child sub-tables (Ends counts / Warp counts / Weft / Weaving rates)
 *
 * The four child tables are FULL rewrites on save: we delete-then-insert
 * the whole set for the parent. This keeps the client logic simple and
 * avoids tracking per-row dirty flags.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Trash2, Archive, Save } from 'lucide-react';

type OutputUnit = '' | 'per_day_m' | 'per_shift_m';
type RecordStatus = 'active' | 'inactive' | 'archived';

export interface EndsRowOption {
  id: number;
  code: string;
  name: string;
}
export interface YarnCountOption {
  id: number;
  code: string;
  display_name: string;
}

export interface FabricQualityHeader {
  name: string;
  quality_for_sales: string;
  hsn: string;
  pick_per_inch: string;
  reed: string;
  reed_space: string;
  width_in: string;
  meter_per_pc: string;
  output_unit: OutputUnit;
  output_value: string;
  crimp_pct: string;
  gst_pct: string;
  weight_gsm: string;
  rate_per_m: string;
  active: boolean;
  status: RecordStatus;
  notes: string;
}

export interface FQEndsLine   { sno: number; ends_id: number | null; }
export interface FQWarpLine   { sno: number; yarn_count_id: number | null; }
export interface FQWeftLine   {
  sno: number; yarn_count_id: number | null;
  wgt_per_mtr_actual: string;
  meter_per_kg: string;
  wgt_per_mtr_manual: string;
}
export interface FQRateLine   { sno: number; fabric_type: string; rate_per_meter: string; }

export interface FabricQualityFormProps {
  fabricQualityId?: number;
  code?: string;
  header?: Partial<FabricQualityHeader>;
  endsLines?: FQEndsLine[];
  warpLines?: FQWarpLine[];
  weftLines?: FQWeftLine[];
  rateLines?: FQRateLine[];
  endsOptions: EndsRowOption[];
  countOptions: YarnCountOption[];
}

const EMPTY_HEADER: FabricQualityHeader = {
  name: '',
  quality_for_sales: '',
  hsn: '',
  pick_per_inch: '',
  reed: '',
  reed_space: '',
  width_in: '',
  meter_per_pc: '',
  output_unit: '',
  output_value: '',
  crimp_pct: '',
  gst_pct: '',
  weight_gsm: '',
  rate_per_m: '',
  active: true,
  status: 'active',
  notes: '',
};

function blankEnds(sno: number): FQEndsLine { return { sno, ends_id: null }; }
function blankWarp(sno: number): FQWarpLine { return { sno, yarn_count_id: null }; }
function blankWeft(sno: number): FQWeftLine {
  return { sno, yarn_count_id: null, wgt_per_mtr_actual: '', meter_per_kg: '', wgt_per_mtr_manual: '' };
}
function blankRate(sno: number): FQRateLine { return { sno, fabric_type: '', rate_per_meter: '' }; }

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function FabricQualityForm(props: FabricQualityFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof props.fabricQualityId === 'number';

  const [hdr, setHdr] = useState<FabricQualityHeader>({ ...EMPTY_HEADER, ...(props.header ?? {}) });
  const [ends, setEnds] = useState<FQEndsLine[]>(
    props.endsLines && props.endsLines.length > 0 ? props.endsLines : [blankEnds(1)],
  );
  const [warps, setWarps] = useState<FQWarpLine[]>(
    props.warpLines && props.warpLines.length > 0 ? props.warpLines : [blankWarp(1)],
  );
  const [wefts, setWefts] = useState<FQWeftLine[]>(
    props.weftLines && props.weftLines.length > 0 ? props.weftLines : [blankWeft(1)],
  );
  const [rates, setRates] = useState<FQRateLine[]>(
    props.rateLines && props.rateLines.length > 0 ? props.rateLines : [blankRate(1)],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function patchHdr(p: Partial<FabricQualityHeader>) { setHdr((h) => ({ ...h, ...p })); }
  function addRow<T>(setter: (fn: (prev: T[]) => T[]) => void, blank: (sno: number) => T) {
    setter((prev) => [...prev, blank(prev.length + 1)]);
  }
  function delRow<T extends { sno: number }>(setter: (fn: (prev: T[]) => T[]) => void, sno: number) {
    setter((prev) => prev.filter((r) => r.sno !== sno).map((r, i) => ({ ...r, sno: i + 1 })));
  }

  async function handleSave() {
    setBusy(true); setError(null); setSavedMsg(null);
    try {
      const name = hdr.name.trim();
      if (name === '') { setError('QUALITY is required.'); setBusy(false); return; }

      const payload = {
        name,
        quality_for_sales: hdr.quality_for_sales.trim() === '' ? null : hdr.quality_for_sales.trim(),
        hsn:               hdr.hsn.trim() === '' ? null : hdr.hsn.trim(),
        pick_per_inch:     toNumOrNull(hdr.pick_per_inch),
        reed:              toNumOrNull(hdr.reed),
        reed_space:        toNumOrNull(hdr.reed_space),
        width_in:          toNumOrNull(hdr.width_in),
        meter_per_pc:      toNumOrNull(hdr.meter_per_pc),
        output_unit:       hdr.output_unit === '' ? null : hdr.output_unit,
        output_value:      toNumOrNull(hdr.output_value),
        crimp_pct:         toNumOrNull(hdr.crimp_pct),
        gst_pct:           toNumOrNull(hdr.gst_pct),
        weight_gsm:        toNumOrNull(hdr.weight_gsm),
        rate_per_m:        toNumOrNull(hdr.rate_per_m),
        active:            hdr.active,
        notes:             hdr.notes.trim() === '' ? null : hdr.notes.trim(),
      };

      // 1) upsert header
      let fqId = props.fabricQualityId ?? null;
      if (isEdit) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: err } = await (supabase as any)
          .from('fabric_quality')
          .update(payload)
          .eq('id', fqId);
        if (err) throw new Error(err.message);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: err } = await (supabase as any)
          .from('fabric_quality')
          .insert(payload)
          .select('id')
          .single();
        if (err) throw new Error(err.message);
        fqId = (data as { id: number }).id;
      }
      if (fqId == null) throw new Error('Failed to resolve fabric_quality id.');

      // 2) replace child tables (delete all, insert filtered non-empty rows)
      const endsRows = ends
        .filter((r) => r.ends_id !== null)
        .map((r) => ({ fabric_quality_id: fqId, sno: r.sno, ends_id: r.ends_id }));
      const warpRows = warps
        .filter((r) => r.yarn_count_id !== null)
        .map((r) => ({ fabric_quality_id: fqId, sno: r.sno, yarn_count_id: r.yarn_count_id }));
      const weftRows = wefts
        .filter((r) =>
          r.yarn_count_id !== null
          || r.wgt_per_mtr_actual.trim() !== ''
          || r.meter_per_kg.trim() !== ''
          || r.wgt_per_mtr_manual.trim() !== '',
        )
        .map((r) => ({
          fabric_quality_id: fqId,
          sno: r.sno,
          yarn_count_id: r.yarn_count_id,
          wgt_per_mtr_actual: toNumOrNull(r.wgt_per_mtr_actual),
          meter_per_kg:       toNumOrNull(r.meter_per_kg),
          wgt_per_mtr_manual: toNumOrNull(r.wgt_per_mtr_manual),
        }));
      const rateRows = rates
        .filter((r) => r.fabric_type.trim() !== '' || r.rate_per_meter.trim() !== '')
        .map((r) => ({
          fabric_quality_id: fqId,
          sno: r.sno,
          fabric_type: r.fabric_type.trim() === '' ? null : r.fabric_type.trim(),
          rate_per_meter: toNumOrNull(r.rate_per_meter),
        }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const dels = await Promise.all([
        sb.from('fabric_quality_ends').delete().eq('fabric_quality_id', fqId),
        sb.from('fabric_quality_warp_count').delete().eq('fabric_quality_id', fqId),
        sb.from('fabric_quality_weft').delete().eq('fabric_quality_id', fqId),
        sb.from('fabric_quality_weaving_rate').delete().eq('fabric_quality_id', fqId),
      ]);
      for (const d of dels) {
        if (d.error) throw new Error(d.error.message);
      }

      const ins = await Promise.all([
        endsRows.length === 0 ? Promise.resolve({ error: null }) : sb.from('fabric_quality_ends').insert(endsRows),
        warpRows.length === 0 ? Promise.resolve({ error: null }) : sb.from('fabric_quality_warp_count').insert(warpRows),
        weftRows.length === 0 ? Promise.resolve({ error: null }) : sb.from('fabric_quality_weft').insert(weftRows),
        rateRows.length === 0 ? Promise.resolve({ error: null }) : sb.from('fabric_quality_weaving_rate').insert(rateRows),
      ]);
      for (const i of ins) {
        if (i.error) throw new Error(i.error.message);
      }

      setBusy(false);
      setSavedMsg('Saved.');
      if (!isEdit) {
        router.push('/app/settings/fabric-qualities/' + String(fqId));
        router.refresh();
      } else {
        router.refresh();
      }
    } catch (e: unknown) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  }

  async function handleArchive() {
    if (!isEdit) return;
    const ok = window.confirm('Archive this fabric quality?');
    if (ok === false) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('fabric_quality').update({ active: false }).eq('id', props.fabricQualityId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push('/app/settings/fabric-qualities');
    router.refresh();
  }

  async function handleDelete() {
    if (!isEdit) return;
    const ok = window.confirm('Permanently delete this fabric quality and ALL its sub-rows? This cannot be undone.');
    if (ok === false) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('fabric_quality').delete().eq('id', props.fabricQualityId);
    setBusy(false);
    if (err) { setError(err.message + ' - try Archive instead.'); return; }
    router.push('/app/settings/fabric-qualities');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* ──────────── HEADER CARD ──────────── */}
      <div className="card p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-2">
            <label className="label">Code</label>
            <div className="input bg-cloud/60 text-ink-mute select-none">
              {props.code ?? 'Auto (FQ-NNNN)'}
            </div>
          </div>
          <div className="md:col-span-4">
            <label className="label">QUALITY *</label>
            <input className="input w-full" value={hdr.name}
              onChange={(e) => patchHdr({ name: e.target.value })} />
          </div>
          <div className="md:col-span-4">
            <label className="label">QLTY FOR SALES</label>
            <input className="input w-full" value={hdr.quality_for_sales}
              onChange={(e) => patchHdr({ quality_for_sales: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">HSN</label>
            <input className="input w-full" value={hdr.hsn}
              onChange={(e) => patchHdr({ hsn: e.target.value })} />
          </div>

          <div className="md:col-span-2">
            <label className="label">PICK/INCH</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.pick_per_inch}
              onChange={(e) => patchHdr({ pick_per_inch: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">REED</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.reed}
              onChange={(e) => patchHdr({ reed: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">REED SPACE</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.reed_space}
              onChange={(e) => patchHdr({ reed_space: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">WIDTH (in)</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.width_in}
              onChange={(e) => patchHdr({ width_in: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">METER/PC</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.meter_per_pc}
              onChange={(e) => patchHdr({ meter_per_pc: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">WEIGHT (gsm)</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.weight_gsm}
              onChange={(e) => patchHdr({ weight_gsm: e.target.value })} />
          </div>

          <div className="md:col-span-3">
            <label className="label">OUTPUT (unit)</label>
            <select className="input w-full" value={hdr.output_unit}
              onChange={(e) => patchHdr({ output_unit: e.target.value as OutputUnit })}>
              <option value="">--- none ---</option>
              <option value="per_day_m">Per Day (m)</option>
              <option value="per_shift_m">Per Shift (m)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">OUTPUT value</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.output_value}
              onChange={(e) => patchHdr({ output_value: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">CRIMP %</label>
            <input type="number" step="0.001" className="input num w-full" value={hdr.crimp_pct}
              onChange={(e) => patchHdr({ crimp_pct: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">GST %</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.gst_pct}
              onChange={(e) => patchHdr({ gst_pct: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <label className="label">Reference rate (Rs/m)</label>
            <input type="number" step="0.01" className="input num w-full" value={hdr.rate_per_m}
              onChange={(e) => patchHdr({ rate_per_m: e.target.value })} />
          </div>

          <div className="md:col-span-12">
            <label className="label">Notes</label>
            <input className="input w-full" value={hdr.notes}
              onChange={(e) => patchHdr({ notes: e.target.value })} placeholder="(optional)" />
          </div>
        </div>
      </div>

      {/* ──────────── ENDS / WARP COUNT (side by side) ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-bold text-sm">Ends Counts</h3>
            <button type="button" className="btn-ghost text-xs"
              onClick={() => addRow(setEnds, blankEnds)}>
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line/60 text-left text-ink-mute">
              <th className="py-2 pr-3 w-12">SNO</th>
              <th className="py-2 pr-3">ENDS COUNT</th>
              <th className="py-2 pr-3 w-12" />
            </tr></thead>
            <tbody>
              {ends.map((r) => (
                <tr key={r.sno} className="border-b border-line/60">
                  <td className="py-1 pr-3 num">{r.sno}</td>
                  <td className="py-1 pr-3">
                    <select className="input w-full"
                      value={r.ends_id === null ? '' : String(r.ends_id)}
                      onChange={(e) => setEnds((prev) => prev.map((x) =>
                        x.sno === r.sno ? { ...x, ends_id: e.target.value === '' ? null : Number(e.target.value) } : x,
                      ))}>
                      <option value="">--- pick ---</option>
                      {props.endsOptions.map((o) => (
                        <option key={o.id} value={String(o.id)}>{o.code} - {o.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-3">
                    <button type="button" className="p-1 rounded hover:bg-red-50 text-red-600"
                      onClick={() => delRow(setEnds, r.sno)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-bold text-sm">Warp Counts</h3>
            <button type="button" className="btn-ghost text-xs"
              onClick={() => addRow(setWarps, blankWarp)}>
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line/60 text-left text-ink-mute">
              <th className="py-2 pr-3 w-12">SNO</th>
              <th className="py-2 pr-3">WARP COUNT</th>
              <th className="py-2 pr-3 w-12" />
            </tr></thead>
            <tbody>
              {warps.map((r) => (
                <tr key={r.sno} className="border-b border-line/60">
                  <td className="py-1 pr-3 num">{r.sno}</td>
                  <td className="py-1 pr-3">
                    <select className="input w-full"
                      value={r.yarn_count_id === null ? '' : String(r.yarn_count_id)}
                      onChange={(e) => setWarps((prev) => prev.map((x) =>
                        x.sno === r.sno ? { ...x, yarn_count_id: e.target.value === '' ? null : Number(e.target.value) } : x,
                      ))}>
                      <option value="">--- pick ---</option>
                      {props.countOptions.map((o) => (
                        <option key={o.id} value={String(o.id)}>{o.code} - {o.display_name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-3">
                    <button type="button" className="p-1 rounded hover:bg-red-50 text-red-600"
                      onClick={() => delRow(setWarps, r.sno)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ──────────── WEFT (left) + WEAVING RATE (right) ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-bold text-sm">Weft Details</h3>
            <button type="button" className="btn-ghost text-xs"
              onClick={() => addRow(setWefts, blankWeft)}>
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line/60 text-left text-ink-mute">
                <th className="py-2 pr-2 w-10">SNO</th>
                <th className="py-2 pr-2">WEFT COUNT</th>
                <th className="py-2 pr-2">WGT/MTR (ACT)</th>
                <th className="py-2 pr-2">METER/1 KG</th>
                <th className="py-2 pr-2">WGT/MTR (MAN)</th>
                <th className="py-2 pr-2 w-8" />
              </tr></thead>
              <tbody>
                {wefts.map((r) => (
                  <tr key={r.sno} className="border-b border-line/60">
                    <td className="py-1 pr-2 num">{r.sno}</td>
                    <td className="py-1 pr-2">
                      <select className="input w-full text-xs"
                        value={r.yarn_count_id === null ? '' : String(r.yarn_count_id)}
                        onChange={(e) => setWefts((prev) => prev.map((x) =>
                          x.sno === r.sno ? { ...x, yarn_count_id: e.target.value === '' ? null : Number(e.target.value) } : x,
                        ))}>
                        <option value="">--- pick ---</option>
                        {props.countOptions.map((o) => (
                          <option key={o.id} value={String(o.id)}>{o.code} - {o.display_name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" step="0.001" className="input num w-20"
                        value={r.wgt_per_mtr_actual}
                        onChange={(e) => setWefts((prev) => prev.map((x) =>
                          x.sno === r.sno ? { ...x, wgt_per_mtr_actual: e.target.value } : x))} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" step="0.001" className="input num w-20"
                        value={r.meter_per_kg}
                        onChange={(e) => setWefts((prev) => prev.map((x) =>
                          x.sno === r.sno ? { ...x, meter_per_kg: e.target.value } : x))} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" step="0.001" className="input num w-20"
                        value={r.wgt_per_mtr_manual}
                        onChange={(e) => setWefts((prev) => prev.map((x) =>
                          x.sno === r.sno ? { ...x, wgt_per_mtr_manual: e.target.value } : x))} />
                    </td>
                    <td className="py-1 pr-2">
                      <button type="button" className="p-1 rounded hover:bg-red-50 text-red-600"
                        onClick={() => delRow(setWefts, r.sno)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-bold text-sm">Weaving Rates</h3>
            <button type="button" className="btn-ghost text-xs"
              onClick={() => addRow(setRates, blankRate)}>
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line/60 text-left text-ink-mute">
              <th className="py-2 pr-3 w-12">SNO</th>
              <th className="py-2 pr-3">FABRIC TYPE</th>
              <th className="py-2 pr-3">RATE/METER (Rs)</th>
              <th className="py-2 pr-3 w-10" />
            </tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.sno} className="border-b border-line/60">
                  <td className="py-1 pr-3 num">{r.sno}</td>
                  <td className="py-1 pr-3">
                    <input className="input w-full" value={r.fabric_type}
                      onChange={(e) => setRates((prev) => prev.map((x) =>
                        x.sno === r.sno ? { ...x, fabric_type: e.target.value } : x))} />
                  </td>
                  <td className="py-1 pr-3">
                    <input type="number" step="0.01" className="input num w-24"
                      value={r.rate_per_meter}
                      onChange={(e) => setRates((prev) => prev.map((x) =>
                        x.sno === r.sno ? { ...x, rate_per_meter: e.target.value } : x))} />
                  </td>
                  <td className="py-1 pr-3">
                    <button type="button" className="p-1 rounded hover:bg-red-50 text-red-600"
                      onClick={() => delRow(setRates, r.sno)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>}
      {savedMsg && <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{savedMsg}</div>}

      <div className="flex justify-between gap-2">
        <div className="flex gap-2">
          {isEdit && (
            <>
              <button type="button" onClick={handleArchive} disabled={busy}
                className="btn-ghost text-amber-700" title="Mark inactive">
                <Archive className="w-4 h-4" /> Archive
              </button>
              <button type="button" onClick={handleDelete} disabled={busy}
                className="btn-ghost text-red-700" title="Permanently delete">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost">Cancel</button>
          <button type="button" onClick={handleSave} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
