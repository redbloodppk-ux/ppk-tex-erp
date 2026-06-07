'use client';
// FabricQualityForm — construction-only Calculator UI.
//
// Same shape as /app/costing/new (warp/weft/ends, porvai, etc.) minus bobbin
// but ALL rate / cost inputs are stripped. The Derived Weights panel
// shows m/kg, grams/m and GSM only — no Rs/m or profit calculations.
//
// The full input state is snapshotted into fabric_quality.calc_snapshot
// so the edit page round-trips every field.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Calculator, Info, Save, Loader2, Trash2, CheckCircle2 } from 'lucide-react';

// Legacy types kept exported so the existing /new + /[id] server pages
// keep type-checking. The construction form does not actually use the
// per-row line arrays anymore.
export interface EndsRowOption { id: number; code: string; name: string; }
export interface YarnCountOption { id: number; code: string; display_name: string; }
export interface FabricQualityHeader {
  name: string; quality_for_sales: string; hsn: string;
  pick_per_inch: string; reed: string; reed_space: string;
  width_in: string; meter_per_pc: string;
  output_unit: string; output_value: string;
  crimp_pct: string; gst_pct: string;
  weight_gsm: string; rate_per_m: string;
  // Migration 078: cost of pick yarn allocated per metre of fabric (Rs/m).
  pick_cost_per_m: string;
  // Migration 089: merge several qualities under one common name so
  // their warp / weft / bobbin stock is treated as a single pool
  // during Fabric Receipt.
  is_merged: boolean;
  merged_name: string;
  active: boolean; status: string; notes: string;
}
export interface FQEndsLine { sno: number; ends_id: number | null; }
export interface FQWarpLine { sno: number; yarn_count_id: number | null; }
export interface FQWeftLine {
  sno: number; yarn_count_id: number | null;
  wgt_per_mtr_actual: string; meter_per_kg: string; wgt_per_mtr_manual: string;
}
export interface FQRateLine { sno: number; fabric_type: string; rate_per_meter: string; }

interface BobbinOption { id: number; code: string; description: string; is_lurex?: boolean | null; }
interface FabricTypeOption { id: number; code: string; name: string; }

interface CalcSnapshot {
  warpCount?: number; weftCount?: number; totalEnds?: number;
  picksPerInch?: number; loomWidthIn?: number; finishedWidthIn?: number;
  reedCount?: number; tapeLengthIn?: number;
  usePorvai?: boolean; porvaiByDenier?: boolean; porvaiDenier?: number;
  porvaiCountManual?: number; porvaiPick?: number; selvedgeLengthIn?: number;
  porvaiCountId?: string;
  isTowel?: boolean; towelLength?: number;
  warpCountId?: string; weftCountId?: string; endsId?: string;
  code?: string; fabricType?: string;
  productionMode?: 'inhouse' | 'job_work' | 'outsourcing';
  useBobbin?: boolean; bobbinMetres?: number; bobbinId?: string;
  // Lurex (metallic accent yarn) is wound on a second bobbin/cone
  // alongside the primary one. When `isLurex` is on, `bobbinId2`
  // holds the lurex bobbin picked from the master. Disabling the
  // checkbox clears bobbin 2 so we don't ship a stale FK.
  isLurex?: boolean; bobbinId2?: string;
  hsn?: string; crimpPct?: number; gstPct?: number;
  notes?: string;
}

export interface FabricQualityFormProps {
  fabricQualityId?: number;
  // Legacy props from the previous form — kept for API compatibility with
  // /settings/fabric-qualities/[id]; not used here.
  code?: string;
  header?: Partial<FabricQualityHeader>;
  endsLines?: FQEndsLine[];
  warpLines?: FQWarpLine[];
  weftLines?: FQWeftLine[];
  rateLines?: FQRateLine[];
  endsOptions: EndsRowOption[];
  countOptions: YarnCountOption[];
}

export function FabricQualityForm(props: FabricQualityFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof props.fabricQualityId === 'number';

  // Cloth construction state
  const [warpCount, setWarpCount] = useState(40);
  const [weftCount, setWeftCount] = useState(39);
  const [totalEnds, setTotalEnds] = useState(2400);
  const [picksPerInch, setPicksPerInch] = useState(46);
  const [loomWidthIn, setLoomWidthIn] = useState(31.5);
  const [finishedWidthIn, setFinishedWidthIn] = useState(31);
  const [reedCount, setReedCount] = useState(72);
  const [tapeLengthIn, setTapeLengthIn] = useState(41.5);

  const [useBobbin, setUseBobbin] = useState(false);
  // Bobbin metres defaults to 1 and is non-editable on this form. The
  // costing flow stores the true bobbin metres on the Bobbin master
  // record; here we only need a non-zero divisor so the bobbin pcs/m
  // calculation behaves consistently.
  const [bobbinMetres] = useState(1);
  const [bobbinId, setBobbinId] = useState('');
  // Lurex (a metallic-thread cone wound alongside the primary bobbin)
  // is opt-in per fabric quality. The Bobbin 2 picker below is only
  // enabled while `isLurex` is true; unticking the box clears the
  // selection so we never write a stale FK on save.
  const [isLurex, setIsLurex] = useState<boolean>(false);
  const [bobbinId2, setBobbinId2] = useState<string>('');

  const [usePorvai, setUsePorvai] = useState(true);
  const [porvaiByDenier, setPorvaiByDenier] = useState(true);
  const [porvaiDenier, setPorvaiDenier] = useState(150);
  const [porvaiCountManual, setPorvaiCountManual] = useState(35.43);
  const [porvaiPick, setPorvaiPick] = useState(46);
  const [selvedgeLengthIn, setSelvedgeLengthIn] = useState(2.5);

  const [isTowel, setIsTowel] = useState(true);
  const [towelLength, setTowelLength] = useState(1.7);

  // Header / dropdown state
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [fabricType, setFabricType] = useState<string>('woven');
  const [productionMode, setProductionMode] = useState<'inhouse' | 'job_work' | 'outsourcing'>('inhouse');
  const [hsn, setHsn] = useState('');
  const [crimpPct, setCrimpPct] = useState(0);
  const [gstPct, setGstPct] = useState(5);
  // Migration 078: cost of pick yarn allocated per metre of fabric. Manually
  // entered. Empty string = NULL in DB.
  const [pickCostPerM, setPickCostPerM] = useState<string>('');
  // Migration 089: merge several qualities under one common name so
  // their warp / weft / bobbin stock is treated as a single pool during
  // Fabric Receipt. The text field is enabled only when isMerged is on.
  const [isMerged, setIsMerged] = useState<boolean>(false);
  const [mergedName, setMergedName] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [warpCountId, setWarpCountId] = useState('');
  const [weftCountId, setWeftCountId] = useState('');
  const [endsId, setEndsId] = useState('');
  const [porvaiCountId, setPorvaiCountId] = useState('');
  const [bobbins, setBobbins] = useState<BobbinOption[]>([]);
  const [fabricTypes, setFabricTypes] = useState<FabricTypeOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const didApplySnapshot = useRef<boolean>(false);

  // Load Bobbin master + Fabric Type master once.
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [bb, ft] = await Promise.all([
        // Pull is_lurex so the Bobbin 2 picker can restrict its options
        // to lurex bobbins only — operators shouldn't be able to pick a
        // regular bobbin as the "lurex" cone.
        sb.from('bobbin').select('id, code, description, is_lurex').neq('status', 'archived').order('code'),
        sb.from('fabric_type_master').select('id, code, name').eq('active', true).order('name'),
      ]);
      setBobbins((bb.data ?? []) as unknown as BobbinOption[]);
      setFabricTypes((ft.data ?? []) as unknown as FabricTypeOption[]);
    })();
  }, [supabase]);

  // On edit: load existing fabric_quality row + apply its calc_snapshot.
  useEffect(() => {
    if (!isEdit || props.fabricQualityId == null) return;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('fabric_quality')
        .select('name, code, fabric_type, production_mode, hsn, crimp_pct, gst_pct, pick_cost_per_m, is_merged, merged_name, notes, calc_snapshot')
        .eq('id', props.fabricQualityId)
        .single();
      if (!data) return;
      setName(data.name ?? '');
      setCode(data.code ?? '');
      if (typeof data.fabric_type === 'string' && data.fabric_type.length > 0) {
        setFabricType(data.fabric_type);
      }
      if (data.production_mode === 'inhouse' || data.production_mode === 'job_work' || data.production_mode === 'outsourcing') {
        setProductionMode(data.production_mode);
      }
      setHsn(data.hsn ?? '');
      if (data.crimp_pct != null) setCrimpPct(Number(data.crimp_pct));
      if (data.gst_pct   != null) setGstPct(Number(data.gst_pct));
      setPickCostPerM(data.pick_cost_per_m == null ? '' : String(data.pick_cost_per_m));
      setIsMerged(Boolean(data.is_merged));
      setMergedName(data.merged_name ?? '');
      setNotes(data.notes ?? '');

      const s = (data.calc_snapshot ?? {}) as CalcSnapshot;
      if (s.warpCount         != null) setWarpCount(s.warpCount);
      if (s.weftCount         != null) setWeftCount(s.weftCount);
      if (s.totalEnds         != null) setTotalEnds(s.totalEnds);
      if (s.picksPerInch      != null) setPicksPerInch(s.picksPerInch);
      if (s.loomWidthIn       != null) setLoomWidthIn(s.loomWidthIn);
      if (s.finishedWidthIn   != null) setFinishedWidthIn(s.finishedWidthIn);
      if (s.reedCount         != null) setReedCount(s.reedCount);
      if (s.tapeLengthIn      != null) setTapeLengthIn(s.tapeLengthIn);
      if (s.useBobbin         != null) setUseBobbin(s.useBobbin);
      if (s.bobbinId          != null) setBobbinId(s.bobbinId);
      if (s.isLurex           != null) setIsLurex(s.isLurex);
      if (s.bobbinId2         != null) setBobbinId2(s.bobbinId2);
      if (s.usePorvai         != null) setUsePorvai(s.usePorvai);
      if (s.porvaiByDenier    != null) setPorvaiByDenier(s.porvaiByDenier);
      if (s.porvaiDenier      != null) setPorvaiDenier(s.porvaiDenier);
      if (s.porvaiCountManual != null) setPorvaiCountManual(s.porvaiCountManual);
      if (s.porvaiPick        != null) setPorvaiPick(s.porvaiPick);
      if (s.selvedgeLengthIn  != null) setSelvedgeLengthIn(s.selvedgeLengthIn);
      if (s.porvaiCountId     != null) setPorvaiCountId(s.porvaiCountId);
      if (s.isTowel           != null) setIsTowel(s.isTowel);
      if (s.towelLength       != null) setTowelLength(s.towelLength);
      if (s.warpCountId       != null) setWarpCountId(s.warpCountId);
      if (s.weftCountId       != null) setWeftCountId(s.weftCountId);
      if (s.endsId            != null) setEndsId(s.endsId);
      didApplySnapshot.current = true;
    })();
  }, [isEdit, props.fabricQualityId, supabase]);

  // Construction-only derived numbers. No rates, no cost.
  const r = useMemo(() => {
    const warpMPerKg = warpCount > 0 && totalEnds > 0 && tapeLengthIn > 0
      ? ((1848 * warpCount) / totalEnds) * 36 / tapeLengthIn * 1.01 : 0;
    const warpKgPerM = warpMPerKg > 0 ? 1 / warpMPerKg : 0;
    const weftMPerKg = weftCount > 0 && picksPerInch > 0 && (loomWidthIn + 3) > 0
      ? (1690 * weftCount) / picksPerInch / (loomWidthIn + 3) : 0;
    const weftKgPerM = weftMPerKg > 0 ? 1 / weftMPerKg : 0;
    const gramsPerM = (warpKgPerM + weftKgPerM) * 1000;
    const gramsPerSqM = finishedWidthIn > 0 ? (gramsPerM * 39.37) / finishedWidthIn : 0;

    const porvaiCount = porvaiByDenier
      ? (porvaiDenier > 0 ? 5315 / porvaiDenier : 0) : porvaiCountManual;
    const porvaiMPerKg = usePorvai && porvaiCount > 0 && porvaiPick > 0 && (selvedgeLengthIn + 3) > 0
      ? (1690 * porvaiCount) / porvaiPick / (selvedgeLengthIn + 3) : 0;
    const porvaiKgPerM = usePorvai && porvaiMPerKg > 0 ? 1 / porvaiMPerKg : 0;

    const gramsPerTowel = isTowel ? gramsPerM * towelLength : null;
    const endsCheck = reedCount * finishedWidthIn + 50;

    const bobbinPcsPerM = useBobbin && bobbinMetres > 0 ? 1 / bobbinMetres : 0;

    return {
      warpMPerKg, warpKgPerM, weftMPerKg, weftKgPerM,
      gramsPerM, gramsPerSqM, gramsPerTowel,
      porvaiCount, porvaiMPerKg, porvaiKgPerM,
      bobbinPcsPerM,
      endsCheck,
    };
  }, [
    warpCount, weftCount, totalEnds, picksPerInch, loomWidthIn,
    finishedWidthIn, reedCount, tapeLengthIn,
    useBobbin, bobbinMetres,
    usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual,
    porvaiPick, selvedgeLengthIn,
    isTowel, towelLength,
  ]);

  async function handleSave(): Promise<void> {
    setSaveError(null);
    setSaveOk(null);
    if (name.trim() === '') return setSaveError('Fabric name is required.');

    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      fabric_type: fabricType,
      production_mode: productionMode,
      hsn: hsn.trim() || null,
      pick_per_inch: picksPerInch,
      reed: reedCount,
      reed_space: loomWidthIn,
      width_in: finishedWidthIn,
      meter_per_pc: isTowel ? towelLength : null,
      crimp_pct: crimpPct,
      gst_pct: gstPct,
      pick_cost_per_m: pickCostPerM.trim() === '' ? null : Number(pickCostPerM),
      is_merged: isMerged,
      merged_name: isMerged ? (mergedName.trim() || null) : null,
      weight_gsm: Number(r.gramsPerSqM.toFixed(2)),
      active: true,
      notes: notes.trim() || null,
      weft_kg_per_m: Number(r.weftKgPerM.toFixed(6)),
      porvai_kg_per_m: usePorvai && r.porvaiMPerKg > 0
        ? Number(r.porvaiKgPerM.toFixed(6)) : null,
      bobbin_pcs_per_m: useBobbin && bobbinMetres > 0
        ? Number(r.bobbinPcsPerM.toFixed(6)) : null,
      calc_snapshot: {
        warpCount, weftCount, totalEnds, picksPerInch, loomWidthIn,
        finishedWidthIn, reedCount, tapeLengthIn,
        useBobbin, bobbinMetres, bobbinId,
        // Lurex is a per-fabric flag; bobbinId2 only travels when the
        // checkbox is on (we cleared it in the UI when unticked but
        // belt-and-braces it here too so a stale FK can't sneak in).
        isLurex, bobbinId2: isLurex ? bobbinId2 : '',
        usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual,
        porvaiPick, selvedgeLengthIn, porvaiCountId,
        isTowel, towelLength,
        warpCountId, weftCountId, endsId,
        code, fabricType, productionMode, hsn, crimpPct, gstPct, notes,
      },
    };

    let err: { message: string; code?: string } | null = null;
    if (isEdit && props.fabricQualityId != null) {
      const res = await sb.from('fabric_quality').update(payload).eq('id', props.fabricQualityId);
      err = res.error;
    } else {
      const res = await sb.from('fabric_quality').insert(payload);
      err = res.error;
    }
    setSaving(false);
    if (err) {
      if (err.code === '23505') {
        setSaveError(`Name "${name.trim()}" is already used. Pick a different name.`);
      } else {
        setSaveError(err.message);
      }
      return;
    }
    setSaveOk(isEdit ? 'Saved.' : 'Fabric quality created.');
    setTimeout(() => {
      router.push('/app/settings/fabric-qualities');
      router.refresh();
    }, 600);
  }

  async function handleDelete(): Promise<void> {
    if (!isEdit || props.fabricQualityId == null) return;
    const ok = window.confirm(
      `Delete fabric quality "${name}"?\n\nThis cannot be undone. If it is referenced by orders / production, the delete will fail.`,
    );
    if (!ok) return;
    setSaveError(null);
    setDeleting(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('fabric_quality').delete().eq('id', props.fabricQualityId);
    setDeleting(false);
    if (error) {
      if ((error as { code?: string }).code === '23503') {
        setSaveError('In use by other records - cannot delete.');
      } else {
        setSaveError(error.message);
      }
      return;
    }
    router.push('/app/settings/fabric-qualities');
    router.refresh();
  }

  void didApplySnapshot.current;

  return (
    <div>
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="card p-5 space-y-4">
          <h2 className="font-display font-bold text-base flex items-center gap-2">
            <Calculator className="w-4 h-4 text-indigo" /> Cloth construction
          </h2>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <Row><L>Warp Count (Ne)</L><Num value={warpCount} set={setWarpCount} step={0.5} /></Row>
            <Row><L>Weft Count (Ne)</L><Num value={weftCount} set={setWeftCount} step={0.5} /></Row>
            <Row><L>Total Ends</L><Num value={totalEnds} set={setTotalEnds} step={10} /></Row>
            <Row><L>Pick / Inch</L><Num value={picksPerInch} set={setPicksPerInch} /></Row>
            <Row><L>Loom width (in)</L><Num value={loomWidthIn} set={setLoomWidthIn} step={0.5} /></Row>
            <Row><L>Reed space (in)</L><Num value={finishedWidthIn} set={setFinishedWidthIn} step={0.5} /></Row>
            <Row><L>Reed</L><Num value={reedCount} set={setReedCount} /></Row>
            <Row>
              <L title="Inches of warp tape per metre of fabric.">
                Tape Length (in/m) <Info className="inline w-3 h-3 text-ink-mute -mt-0.5" />
              </L>
              <Num value={tapeLengthIn} set={setTapeLengthIn} step={0.5} />
            </Row>
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include bobbin / cone" checked={useBobbin} set={setUseBobbin} />
            {useBobbin && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <Row>
                    <L>Bobbin metres</L>
                    <input type="number" value={bobbinMetres} disabled readOnly
                      className="input num text-right h-8 text-sm w-28 bg-cloud/40 text-ink-soft cursor-not-allowed" />
                  </Row>
                </div>
                <div>
                  <label className="label text-xs">Bobbin</label>
                  <div className="flex items-stretch gap-1.5">
                    <select className="input w-full" value={bobbinId}
                      onChange={(e) => setBobbinId(e.target.value)}>
                      <option value="">--- pick a bobbin ---</option>
                      {bobbins.map((b) => (<option key={b.id} value={String(b.id)}>{b.code} - {b.description}</option>))}
                    </select>
                    <NewLink href="/app/bobbin" title="Add new bobbin" />
                  </div>
                </div>

                {/* Lurex (metallic accent yarn) toggle. When ticked, a
                    second Bobbin picker becomes active and is restricted
                    to bobbins flagged is_lurex=true on the master. The
                    checkbox lives inside the useBobbin block because
                    there's no meaningful lurex without a primary bobbin. */}
                <div className="pt-1">
                  <Toggle
                    label="Lurex (metallic accent)"
                    checked={isLurex}
                    set={(b) => {
                      setIsLurex(b);
                      // Clear bobbin 2 the moment lurex is turned off
                      // so the snapshot/save never carries a stale FK.
                      if (!b) setBobbinId2('');
                    }}
                  />
                  <div className="mt-1.5">
                    <label className={'label text-xs ' + (isLurex ? '' : 'text-ink-mute')}>
                      Bobbin 2 (lurex)
                    </label>
                    <div className="flex items-stretch gap-1.5">
                      <select
                        className={'input w-full ' + (isLurex ? '' : 'bg-cloud/40 text-ink-mute cursor-not-allowed')}
                        value={bobbinId2}
                        onChange={(e) => setBobbinId2(e.target.value)}
                        disabled={!isLurex}
                      >
                        <option value="">
                          {isLurex ? '--- pick a lurex bobbin ---' : 'enable Lurex first'}
                        </option>
                        {bobbins
                          .filter((b) => b.is_lurex === true)
                          .map((b) => (
                            <option key={b.id} value={String(b.id)}>{b.code} - {b.description}</option>
                          ))}
                      </select>
                      <NewLink href="/app/bobbin" title="Add new lurex bobbin" />
                    </div>
                    {isLurex && bobbins.filter((b) => b.is_lurex === true).length === 0 && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        No lurex bobbins on file yet. Click the + above to add one and tick its &ldquo;Is lurex&rdquo; flag.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include porvai (selvedge)" checked={usePorvai} set={setUsePorvai} />
            {usePorvai && (
              <>
                <div className="mt-2 flex gap-2 text-xs">
                  <button type="button"
                    className={"px-3 py-1.5 rounded-lg border " + (porvaiByDenier ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-ink-soft border-line")}
                    onClick={() => setPorvaiByDenier(true)}>By denier</button>
                  <button type="button"
                    className={"px-3 py-1.5 rounded-lg border " + (porvaiByDenier === false ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-ink-soft border-line")}
                    onClick={() => setPorvaiByDenier(false)}>By count (Ne)</button>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                  {porvaiByDenier ? (
                    <Row><L>Denier</L><Num value={porvaiDenier} set={setPorvaiDenier} step={5} /></Row>
                  ) : (
                    <Row><L>Porvai count (Ne)</L><Num value={porvaiCountManual} set={setPorvaiCountManual} step={0.5} /></Row>
                  )}
                  <Row><L>Porvai pick</L><Num value={porvaiPick} set={setPorvaiPick} /></Row>
                  <Row><L>Selvedge length (in)</L><Num value={selvedgeLengthIn} set={setSelvedgeLengthIn} step={0.25} /></Row>
                </div>
                {porvaiByDenier && (
                  <p className="text-[11px] text-ink-mute mt-1.5 italic">
                    Derived count (NeC) = {r.porvaiCount.toFixed(2)}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Towel fabric?" checked={isTowel} set={setIsTowel} />
            {isTowel && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Towel length (m)</L><Num value={towelLength} set={setTowelLength} step={0.05} /></Row>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5 bg-gradient-to-br from-indigo-50/50 to-violet-50/30 self-start">
          <h2 className="font-display font-bold text-base mb-3">Derived weights</h2>
          <ResultRow label="Warp m/kg" value={r.warpMPerKg.toFixed(2)} small />
          <ResultRow label="Weft m/kg" value={r.weftMPerKg.toFixed(2)} small />
          <ResultRow label="Wgt / m (warp)" value={(r.warpKgPerM * 1000).toFixed(2) + ' g'} small />
          <ResultRow label="Wgt / m (weft)" value={(r.weftKgPerM * 1000).toFixed(2) + ' g'} small />
          <ResultRow label="Grams / metre" value={r.gramsPerM.toFixed(2) + ' g'} small />
          <ResultRow label="GSM (g/sq.m)" value={r.gramsPerSqM.toFixed(2)} highlight="indigo" big />
          {usePorvai && r.porvaiMPerKg > 0 && (
            <>
              <Divider />
              <ResultRow label="Porvai m/kg" value={r.porvaiMPerKg.toFixed(2)} small />
              <ResultRow label="Wgt / m (porvai)" value={(r.porvaiKgPerM * 1000).toFixed(2) + ' g'} small />
            </>
          )}
          {useBobbin && r.bobbinPcsPerM > 0 && (
            <>
              <Divider />
              <ResultRow label="Bobbin pcs / m" value={r.bobbinPcsPerM.toFixed(4)} small />
            </>
          )}
          {isTowel && r.gramsPerTowel !== null && (
            <>
              <Divider />
              <ResultRow label={"Weight / towel (" + towelLength + " m)"}
                value={(r.gramsPerTowel ?? 0).toFixed(1) + ' g'} highlight="violet" big />
            </>
          )}
          <Divider />
          <ResultRow label="Ends check (reed x width + 50)" value={r.endsCheck.toFixed(0)} small />
        </div>
      </div>

      {/* IDENTITY + SAVE panel */}
      <div className="card p-5 mt-4 border border-indigo-200 bg-indigo-50/30">
        <h2 className="font-display font-bold text-base mb-3 flex items-center gap-2">
          <Save className="w-4 h-4 text-indigo" /> {isEdit ? 'Save changes' : 'Save fabric quality'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="label">Fabric name *</label>
            <input className="input w-full" placeholder="e.g. Dobby Towel 31in 72x46"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Fabric code</label>
            <input className="input num w-full" placeholder="auto-generated if blank"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <label className="label">Fabric type *</label>
            <div className="flex items-stretch gap-1.5">
              <select className="input w-full" value={fabricType}
                onChange={(e) => setFabricType(e.target.value as string)}>
                {fabricTypes.length === 0 && (
                  <>
                    <option value="woven">Woven</option>
                    <option value="towel">Towel</option>
                    <option value="dupatta">Dupatta</option>
                  </>
                )}
                {fabricTypes.map((t) => (
                  <option key={t.id} value={t.name.toLowerCase()}>{t.name}</option>
                ))}
              </select>
              <NewLink href="/app/settings/fabric-types" title="Add new fabric type" />
            </div>
          </div>
          <div>
            <label className="label">Production mode *</label>
            <select className="input w-full" value={productionMode}
              onChange={(e) => setProductionMode(e.target.value as 'inhouse' | 'job_work' | 'outsourcing')}>
              <option value="inhouse">In-house</option>
              <option value="job_work">Job work</option>
              <option value="outsourcing">Outsourcing</option>
            </select>
          </div>
          <div>
            <label className="label">HSN</label>
            <input className="input w-full" placeholder="optional"
              value={hsn} onChange={(e) => setHsn(e.target.value)} />
          </div>
          <div>
            <label className="label">Warp Count</label>
            <div className="flex items-stretch gap-1.5">
              <select className="input w-full" value={warpCountId}
                onChange={(e) => setWarpCountId(e.target.value)}>
                <option value="">--- pick ---</option>
                {props.countOptions.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
              </select>
              <NewLink href="/app/yarn-counts" title="Add new yarn count" />
            </div>
          </div>
          <div>
            <label className="label">Weft Count</label>
            <div className="flex items-stretch gap-1.5">
              <select className="input w-full" value={weftCountId}
                onChange={(e) => setWeftCountId(e.target.value)}>
                <option value="">--- pick ---</option>
                {props.countOptions.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
              </select>
              <NewLink href="/app/yarn-counts" title="Add new yarn count" />
            </div>
          </div>
          <div>
            <label className="label">Ends spec</label>
            <div className="flex items-stretch gap-1.5">
              <select className="input w-full" value={endsId}
                onChange={(e) => setEndsId(e.target.value)}>
                <option value="">--- use form value ---</option>
                {props.endsOptions.map((e) => (<option key={e.id} value={String(e.id)}>{e.code} - {e.name}</option>))}
              </select>
              <NewLink href="/app/settings/ends-master" title="Add new ends spec" />
            </div>
          </div>
          <div>
            <label className="label">Porvai yarn count</label>
            <div className="flex items-stretch gap-1.5">
              <select className="input w-full" value={porvaiCountId}
                onChange={(e) => setPorvaiCountId(e.target.value)} disabled={usePorvai === false}>
                <option value="">--- none ---</option>
                {props.countOptions.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
              </select>
              <NewLink href="/app/yarn-counts" title="Add new yarn count" />
            </div>
          </div>
          <div>
            <label className="label">Crimp %</label>
            <input type="number" className="input num w-full" step={0.1}
              value={crimpPct} onChange={(e) => setCrimpPct(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">GST %</label>
            <input type="number" className="input num w-full" step={0.5}
              value={gstPct} onChange={(e) => setGstPct(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Pick cost / m (Rs)</label>
            <input
              type="number" className="input num w-full" step={0.01} min={0}
              placeholder="e.g. 12.50"
              value={pickCostPerM}
              onChange={(e) => setPickCostPerM(e.target.value)}
            />
            <p className="text-[10px] text-ink-mute mt-0.5">
              Pick yarn cost allocated per metre of fabric.
            </p>
          </div>
          <div className="md:col-span-2 rounded-md border border-line/60 bg-cloud/20 p-2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isMerged}
                onChange={(e) => setIsMerged(e.target.checked)}
              />
              <span className="text-sm font-medium">Merge delivery</span>
              <span className="text-[10px] text-ink-mute">
                Pool warp / weft / bobbin stock with other qualities of the same common name during Fabric Receipt.
              </span>
            </label>
            <div className="mt-2">
              <label className="text-[10px] uppercase tracking-wide text-ink-mute">Common fabric name</label>
              <input
                type="text"
                className="input w-full"
                placeholder={isMerged ? 'e.g. THALAPATHI 30 INCH' : 'enable Merge delivery first'}
                value={mergedName}
                onChange={(e) => setMergedName(e.target.value)}
                disabled={!isMerged}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="label">Notes</label>
            <input className="input w-full" placeholder="optional"
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {saveError && <div className="mt-3 p-3 rounded-lg bg-red-50 text-err text-sm">{saveError}</div>}
        {saveOk && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> {saveOk}
          </div>
        )}

        <div className="flex justify-between items-center mt-3">
          {isEdit ? (
            <button type="button" disabled={deleting || saving} onClick={handleDelete}
              className="inline-flex items-center gap-1.5 text-sm text-rose-700 hover:text-rose-900 font-semibold disabled:opacity-50">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete this fabric
            </button>
          ) : <span />}
          <button type="button" disabled={saving || deleting} onClick={handleSave}
            className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save changes' : 'Save fabric'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Tiny "+ New" link rendered next to each master dropdown. Opens the
// relevant master's CRUD page in a new tab so the operator can add a
// missing entry without losing the form they're filling in. After
// adding, they refresh the Fabric Quality page to pick up the new row.
function NewLink({ href, title }: { href: string; title: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title}
      className="inline-flex items-center justify-center w-9 px-2 rounded-lg border border-line bg-white text-indigo-700 hover:bg-indigo-50 text-base font-bold shrink-0">
      +
    </a>
  );
}

// small UI helpers (same as costing)
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[1fr_auto] items-center gap-2">{children}</div>;
}
function L({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className="text-xs text-ink-soft" title={title}>{children}</span>;
}
function Num({ value, set, step = 1 }: { value: number; set: (n: number) => void; step?: number }) {
  return (
    <input type="number" value={Number.isFinite(value) ? value : 0} step={step}
      onChange={(e) => set(Number(e.target.value))}
      className="input num text-right h-8 text-sm w-28" />
  );
}
function Toggle({ label, checked, set }: { label: string; checked: boolean; set: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)}
        className="w-4 h-4 accent-indigo-600" />
      <span>{label}</span>
    </label>
  );
}
function Divider() { return <div className="h-px bg-line/60 my-2" />; }
function ResultRow({ label, value, small, big, highlight }: {
  label: string; value: string; small?: boolean; big?: boolean;
  highlight?: 'indigo' | 'amber' | 'violet' | 'emerald';
}) {
  const tone = {
    indigo: 'text-indigo-700', amber: 'text-amber-700',
    violet: 'text-violet-700', emerald: 'text-emerald-700',
  }[highlight ?? 'indigo'];
  const size = big ? 'text-lg font-bold' : small ? 'text-sm text-ink-soft' : 'text-base font-semibold';
  return (
    <div className={"flex items-center justify-between py-1 " + size}>
      <span>{label}</span>
      <span className={"num " + (highlight ? tone + " font-bold" : '')}>{value}</span>
    </div>
  );
}
