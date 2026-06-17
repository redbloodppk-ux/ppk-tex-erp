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
import { Calculator, Info, Save, Loader2, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';

// One row of the "past jobwork bills" modal — surfaces enough to let the
// user decide whether to retro-apply the new rate. `current_cost` is the
// existing point-in-time snapshot (may be NULL on legacy lines).
// `legacy` flags rows that weren't linked via fabric_quality_id but were
// matched by description against the current quality's merged_name
// (backfilled by migration 183).
interface PastJobworkLine {
  line_id: number;
  invoice_id: number;
  invoice_no: string;
  invoice_date: string;
  party_name: string | null;
  quantity: number;
  current_cost: number | null;
  legacy: boolean;
}

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
  /** How many bobbins run alongside the warp (1–4). Each selected
   *  bobbin consumes 1 m of bobbin yarn per metre of fabric, so total
   *  consumption per metre = bobbinNeeded. */
  bobbinNeeded?: number;
  /** One picked bobbin id per slot, length = bobbinNeeded. bobbinId
   *  (above) keeps carrying the FIRST selection so older readers
   *  (ledger rebuild, reports) stay compatible. */
  bobbinIds?: string[];
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
  // "Bobbin needed" = how many bobbins run alongside the warp (1–4).
  // One picker appears per bobbin. Each selected bobbin consumes 1 m
  // of bobbin yarn per metre of fabric, so the total bobbin metres
  // consumed per fabric metre equals this number.
  const [bobbinNeeded, setBobbinNeededRaw] = useState(1);
  const [bobbinIds, setBobbinIds] = useState<string[]>(['']);
  function setBobbinNeeded(n: number): void {
    const clamped = Math.max(1, Math.min(4, Math.round(n) || 1));
    setBobbinNeededRaw(clamped);
    // Resize the selections array, preserving what's already picked.
    setBobbinIds((prev) => {
      const next = prev.slice(0, clamped);
      while (next.length < clamped) next.push('');
      return next;
    });
  }
  function setBobbinIdAt(idx: number, value: string): void {
    setBobbinIds((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }
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

  // The pick_cost_per_m value as it was when the row loaded — used to
  // detect "rate changed" and trigger the retro-apply modal. Stored as a
  // string so we can compare against the raw input value the user sees.
  const [originalPickCost, setOriginalPickCost] = useState<string>('');
  // Snapshot of the merged_name / is_merged from when the row loaded.
  // Used by the retro-apply modal to pull in LEGACY jobwork lines
  // (fabric_quality_id IS NULL) whose description was backfilled to
  // "Jobwork weaving - <merged_name>" by migration 183. Using the
  // original (not the live edit) keeps the modal pointed at lines the
  // bill descriptions actually reference.
  const [originalMergedName, setOriginalMergedName] = useState<string>('');
  const [originalIsMerged, setOriginalIsMerged] = useState<boolean>(false);
  // Past-bills modal state. `pastLines` is populated only when the user
  // actually changes pick_cost_per_m on an existing fabric_quality row
  // AND at least one historical jobwork_invoice line references it.
  const [showRetroModal, setShowRetroModal] = useState<boolean>(false);
  const [pastLines, setPastLines] = useState<PastJobworkLine[]>([]);
  const [pickedLineIds, setPickedLineIds] = useState<Set<number>>(new Set());
  const [retroBusy, setRetroBusy] = useState<boolean>(false);

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
      {
        const loadedCost = data.pick_cost_per_m == null ? '' : String(data.pick_cost_per_m);
        setPickCostPerM(loadedCost);
        // Snapshot the loaded value so the save flow can detect a rate
        // change and offer to retro-apply it to past jobwork bills.
        setOriginalPickCost(loadedCost);
      }
      setIsMerged(Boolean(data.is_merged));
      setMergedName(data.merged_name ?? '');
      // Snapshot for the retro-apply legacy-line lookup (see handleSave).
      setOriginalIsMerged(Boolean(data.is_merged));
      setOriginalMergedName(data.merged_name ?? '');
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
      // New shape: bobbinNeeded + bobbinIds[]. Legacy rows only carry a
      // single bobbinId — surface it as slot 1 with bobbinNeeded = 1.
      {
        const n = Math.max(1, Math.min(4, Number(s.bobbinNeeded ?? 0) || 1));
        const ids = Array.isArray(s.bobbinIds) && s.bobbinIds.length > 0
          ? s.bobbinIds.map((v) => String(v ?? ''))
          : [String(s.bobbinId ?? '')];
        const sized = ids.slice(0, n);
        while (sized.length < n) sized.push('');
        setBobbinNeededRaw(n);
        setBobbinIds(sized);
      }
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

    // Bobbin metres consumed per metre of fabric = number of bobbins
    // running alongside the warp (each consumes 1 m per fabric metre).
    const bobbinPcsPerM = useBobbin ? bobbinNeeded : 0;

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
    useBobbin, bobbinNeeded,
    usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual,
    porvaiPick, selvedgeLengthIn,
    isTowel, towelLength,
  ]);

  // Pick-cost-per-m is the only field that triggers the retro-apply
  // modal — see handleSave. Pure string comparison keeps things simple:
  // the loaded value is normalised to String(numeric) by the load
  // effect, and the input is bound to the same string, so an unchanged
  // value stays string-identical. Trim guards against stray whitespace.
  function hasPickCostChanged(): boolean {
    if (!isEdit) return false;
    return pickCostPerM.trim() !== originalPickCost.trim();
  }

  // Core write — pushes the fabric_quality row (insert OR update). Split
  // out of handleSave so the retro-apply modal can call it after the
  // user confirms.
  async function persistFabricQuality(): Promise<{ ok: true } | { ok: false; message: string }> {
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
      // bobbin_pcs_per_m = bobbin metres consumed per fabric metre
      // (= number of bobbins selected). Legacy rows hold 1.
      bobbin_pcs_per_m: useBobbin && bobbinNeeded > 0
        ? bobbinNeeded : null,
      calc_snapshot: {
        warpCount, weftCount, totalEnds, picksPerInch, loomWidthIn,
        finishedWidthIn, reedCount, tapeLengthIn,
        useBobbin,
        bobbinNeeded,
        // Only persist as many slots as needed; empty slots stay ''.
        bobbinIds: bobbinIds.slice(0, bobbinNeeded),
        // First non-empty selection doubles as the legacy single
        // bobbinId so older readers keep working.
        bobbinId: bobbinIds.find((v) => v !== '') ?? '',
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
    if (err) {
      if (err.code === '23505') {
        return { ok: false, message: `Name "${name.trim()}" is already used. Pick a different name.` };
      }
      return { ok: false, message: err.message };
    }
    return { ok: true };
  }

  // Standard navigate-away once everything succeeded.
  function finishSave(): void {
    setSaveOk(isEdit ? 'Saved.' : 'Fabric quality created.');
    setTimeout(() => {
      router.push('/app/settings/fabric-qualities');
      router.refresh();
    }, 600);
  }

  async function handleSave(): Promise<void> {
    setSaveError(null);
    setSaveOk(null);
    if (name.trim() === '') return setSaveError('Fabric name is required.');

    // Fast path: new row or pick cost untouched → save directly.
    if (!hasPickCostChanged() || props.fabricQualityId == null) {
      setSaving(true);
      const res = await persistFabricQuality();
      setSaving(false);
      if (!res.ok) return setSaveError(res.message);
      finishSave();
      return;
    }

    // Rate changed on an existing row — look up past jobwork bills that
    // currently reference this fabric_quality. If there are none, save
    // straight away (no historical bills to worry about).
    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Common shape for both queries below — the linked one keyed by
    // fabric_quality_id, and the legacy one keyed by description match.
    type Row = {
      id: number; invoice_id: number; quantity: number | string;
      jobwork_cost_per_m: number | string | null;
      description?: string | null;
      invoice: {
        invoice_no: string; invoice_date: string; party_name: string | null;
        doc_type: string; status: string;
      } | null;
    };

    // Query A — lines explicitly linked to THIS fabric_quality_id.
    const { data, error } = await sb
      .from('invoice_line')
      .select('id, invoice_id, quantity, jobwork_cost_per_m, invoice:invoice_id ( invoice_no, invoice_date, party_name, doc_type, status )')
      .eq('fabric_quality_id', props.fabricQualityId);

    if (error) {
      setSaving(false);
      return setSaveError(error.message);
    }

    // Query B — LEGACY unlinked lines whose description matches the
    // pattern 'Jobwork weaving - <merged_name>' (the format migration
    // 183 used to backfill jobwork_cost_per_m). Only fires when the
    // CURRENT quality is part of a merged group at load time; we use
    // the snapshot (originalIsMerged / originalMergedName) because the
    // bill descriptions reference the merged name as it was, not any
    // mid-edit value.
    let legacyData: Row[] = [];
    if (originalIsMerged && originalMergedName.trim() !== '') {
      const pattern = `Jobwork weaving - ${originalMergedName.trim()}`;
      const { data: legacyRows, error: legacyErr } = await sb
        .from('invoice_line')
        .select('id, invoice_id, quantity, jobwork_cost_per_m, description, invoice:invoice_id ( invoice_no, invoice_date, party_name, doc_type, status )')
        .is('fabric_quality_id', null)
        .eq('description', pattern);
      if (legacyErr) {
        setSaving(false);
        return setSaveError(legacyErr.message);
      }
      legacyData = (legacyRows ?? []) as Row[];
    }

    setSaving(false);

    // Apply doc_type + status filter in the client — we ask Supabase for
    // the parent inline, then drop draft / cancelled / non-jobwork rows.
    const linkedRows = ((data ?? []) as Row[])
      .filter((r) => r.invoice != null
        && r.invoice.doc_type === 'jobwork_invoice'
        && r.invoice.status !== 'draft'
        && r.invoice.status !== 'cancelled')
      .map<PastJobworkLine>((r) => ({
        line_id: r.id,
        invoice_id: r.invoice_id,
        invoice_no: r.invoice!.invoice_no,
        invoice_date: r.invoice!.invoice_date,
        party_name: r.invoice!.party_name,
        quantity: Number(r.quantity) || 0,
        current_cost: r.jobwork_cost_per_m == null ? null : Number(r.jobwork_cost_per_m),
        legacy: false,
      }));

    const legacyRowsMapped = legacyData
      .filter((r) => r.invoice != null
        && r.invoice.doc_type === 'jobwork_invoice'
        && r.invoice.status !== 'draft'
        && r.invoice.status !== 'cancelled')
      .map<PastJobworkLine>((r) => ({
        line_id: r.id,
        invoice_id: r.invoice_id,
        invoice_no: r.invoice!.invoice_no,
        invoice_date: r.invoice!.invoice_date,
        party_name: r.invoice!.party_name,
        quantity: Number(r.quantity) || 0,
        current_cost: r.jobwork_cost_per_m == null ? null : Number(r.jobwork_cost_per_m),
        legacy: true,
      }));

    // Merge + de-dupe (a line tied via FK shouldn't ever match the
    // description query because the FK filter excludes it, but keep
    // belt-and-braces). Sort newest-first by invoice_date.
    const seen = new Set<number>();
    const rows = [...linkedRows, ...legacyRowsMapped]
      .filter((r) => {
        if (seen.has(r.line_id)) return false;
        seen.add(r.line_id);
        return true;
      })
      .sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1));

    if (rows.length === 0) {
      // No historical bills affected — save without prompting.
      setSaving(true);
      const res = await persistFabricQuality();
      setSaving(false);
      if (!res.ok) return setSaveError(res.message);
      finishSave();
      return;
    }

    // Show the modal. Default = NOTHING ticked; the operator opts in
    // bill-by-bill so a rate change doesn't silently rewrite history.
    setPastLines(rows);
    setPickedLineIds(new Set());
    setShowRetroModal(true);
  }

  // Modal handlers ---------------------------------------------------------

  function toggleLine(id: number): void {
    setPickedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setPickedLineIds((prev) => {
      if (prev.size === pastLines.length) return new Set();
      return new Set(pastLines.map((l) => l.line_id));
    });
  }

  // Save fabric quality + retro-apply rate to the ticked invoice lines.
  async function confirmRetroApply(applyTicked: boolean): Promise<void> {
    setSaveError(null);
    setRetroBusy(true);
    const res = await persistFabricQuality();
    if (!res.ok) {
      setRetroBusy(false);
      setSaveError(res.message);
      return;
    }

    if (applyTicked && pickedLineIds.size > 0) {
      const newCost = pickCostPerM.trim() === '' ? null : Number(pickCostPerM);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const ids = Array.from(pickedLineIds);
      const { error } = await sb
        .from('invoice_line')
        .update({ jobwork_cost_per_m: newCost })
        .in('id', ids);
      if (error) {
        setRetroBusy(false);
        setSaveError(`Fabric quality saved, but updating ${ids.length} bill line(s) failed: ${error.message}`);
        return;
      }
    }

    setRetroBusy(false);
    setShowRetroModal(false);
    finishSave();
  }

  function cancelRetroModal(): void {
    if (retroBusy) return;
    setShowRetroModal(false);
    setPastLines([]);
    setPickedLineIds(new Set());
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
                    <L title="How many bobbins run alongside the warp. One picker appears per bobbin; each consumes 1 m of bobbin yarn per metre of fabric.">
                      Bobbin needed <Info className="inline w-3 h-3 text-ink-mute -mt-0.5" />
                    </L>
                    <input type="number" value={bobbinNeeded} min={1} max={4} step={1}
                      onChange={(e) => setBobbinNeeded(Number(e.target.value))}
                      className="input num text-right h-8 text-sm w-28" />
                  </Row>
                </div>
                {/* One picker per needed bobbin. Lurex bobbins are
                    reserved for the "Lurex" picker below, so we filter
                    them out here. is_lurex IS NULL is treated as false
                    (legacy rows pre-dating the lurex flag). */}
                {bobbinIds.map((value, idx) => (
                  <div key={idx}>
                    <label className="label text-xs">
                      {bobbinNeeded > 1 ? `Bobbin ${idx + 1}` : 'Bobbin'}
                    </label>
                    <div className="flex items-stretch gap-1.5">
                      <select className="input w-full" value={value}
                        onChange={(e) => setBobbinIdAt(idx, e.target.value)}>
                        <option value="">--- pick a bobbin ---</option>
                        {bobbins
                          .filter((b) => b.is_lurex !== true)
                          .map((b) => (<option key={b.id} value={String(b.id)}>{b.code} - {b.description}</option>))}
                      </select>
                      <NewLink href="/app/bobbin" title="Add new bobbin" />
                    </div>
                  </div>
                ))}

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
                      Lurex bobbin
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
              <ResultRow label="Bobbin m / m fabric" value={r.bobbinPcsPerM.toFixed(0)} small />
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
          {/* Pick cost / m (Rs) only matters for Job Work qualities —
              it's the per-metre wages we pay the jobwork party. For
              In-house and Outsourcing the cost is built up in the
              full Fabric Costing form and saved on costing_master, so
              this field is hidden to keep the mental model clean.
              Future: if mode is changed away from job_work, the value
              still persists in the DB but is no longer surfaced. */}
          {productionMode === 'job_work' ? (
            <div>
              <label className="label">Job work cost / m (Rs)</label>
              <input
                type="number" className="input num w-full" step={0.01} min={0}
                placeholder="e.g. 12.50"
                value={pickCostPerM}
                onChange={(e) => setPickCostPerM(e.target.value)}
              />
              <p className="text-[10px] text-ink-mute mt-0.5">
                Wages we pay the jobwork party per metre. Drives Job work P&L cost line and the jobwork bill rate.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-line/40 bg-cloud/20 p-2 text-[11px] text-ink-mute">
              <div className="font-semibold text-ink-soft mb-1">Costing for this quality</div>
              <p>Cost build-up for {productionMode === 'inhouse' ? 'In-house' : 'Outsource'} qualities lives in the full <a href="/app/costing" className="text-indigo underline">Fabric Costing</a> form. Switch this quality's mode to "Job Work" if you'd like a simple per-metre wages field here instead.</p>
            </div>
          )}
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

      {/* Retro-apply modal — listed when pick_cost_per_m changes on an
          existing fabric_quality that already has historical jobwork
          bills. Default state has NOTHING ticked so the operator
          actively opts in bill-by-bill. */}
      {showRetroModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-line/60 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="font-display font-bold text-base">Apply new rate to past jobwork bills?</h3>
                <p className="text-xs text-ink-mute mt-1">
                  <span className="font-medium">{name}</span> &mdash; pick cost
                  changing from <span className="font-semibold">Rs {originalPickCost || '0'}</span>{' '}
                  to <span className="font-semibold">Rs {pickCostPerM || '0'}</span>.
                  Tick the bills whose snapshot cost you want to overwrite.
                  Untouched bills keep their original point-in-time cost.
                </p>
              </div>
            </div>

            <div className="px-5 py-2 border-b border-line/60 flex items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pickedLineIds.size === pastLines.length && pastLines.length > 0}
                  onChange={toggleAll}
                />
                <span>Select all ({pastLines.length})</span>
              </label>
              <span className="text-ink-mute">|</span>
              <span>{pickedLineIds.size} ticked</span>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-cloud/40 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left w-8"></th>
                    <th className="px-3 py-2 text-left">Invoice #</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Party</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Current Rs/m</th>
                    <th className="px-3 py-2 text-right">New Rs/m</th>
                  </tr>
                </thead>
                <tbody>
                  {pastLines.map((l) => {
                    const ticked = pickedLineIds.has(l.line_id);
                    return (
                      <tr key={l.line_id}
                          className={'border-t border-line/40 ' + (ticked ? 'bg-indigo-50/50' : '')}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={ticked}
                            onChange={() => toggleLine(l.line_id)}
                          />
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">
                          <div className="flex items-center gap-1.5">
                            <span>{l.invoice_no}</span>
                            {l.legacy && (
                              <span
                                title="Description-matched line — no fabric_quality_id link on the bill row."
                                className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-[9px] font-semibold px-1.5 py-0.5 uppercase tracking-wide"
                              >
                                Legacy
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-xs">{l.invoice_date}</td>
                        <td className="px-3 py-1.5 text-xs">{l.party_name ?? '-'}</td>
                        <td className="px-3 py-1.5 text-right num">{l.quantity.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right num">
                          {l.current_cost == null ? '-' : l.current_cost.toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5 text-right num font-semibold text-indigo-700">
                          {pickCostPerM === '' ? '-' : Number(pickCostPerM).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {saveError && (
              <div className="px-5 py-2 bg-red-50 text-err text-xs border-t border-line/60">{saveError}</div>
            )}

            <div className="px-5 py-3 border-t border-line/60 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={cancelRetroModal}
                disabled={retroBusy}
                className="px-3 py-2 text-sm text-ink-soft hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void confirmRetroApply(false)}
                  disabled={retroBusy}
                  className="px-3 py-2 text-sm rounded-lg border border-line bg-white hover:bg-cloud/30 disabled:opacity-50"
                >
                  {retroBusy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                  Save without updating bills
                </button>
                <button
                  type="button"
                  onClick={() => void confirmRetroApply(true)}
                  disabled={retroBusy || pickedLineIds.size === 0}
                  className="btn-primary"
                >
                  {retroBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Apply selected ({pickedLineIds.size}) and save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
