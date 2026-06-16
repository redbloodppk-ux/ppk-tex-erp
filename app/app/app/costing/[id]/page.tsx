// /app/costing/[id] — full Calculator UI prefilled from the saved costing
// snapshot. Every input field is editable. Save runs UPDATE on the row +
// updates the snapshot. Delete hard-deletes (FK violation -> archive
// instead).

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import { Calculator, Info, Save, Loader2, CheckCircle2, Trash2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const DEFAULT_BAGS_PER_M = 0.50;
const DEFAULT_EMPTY_BEAM_PER_M = 1.00;
const DEFAULT_SIZED_PAAVU_BEAM_PER_M = 1.50;

interface CountOption  { id: number; code: string; display_name: string; }
interface EndsOption   { id: number; code: string; name: string; ends_count: number; }
interface BobbinOption { id: number; code: string; description: string; }

interface BobbinRow {
  key: string;       // local React key only - random uuid
  bobbinId: string;  // bobbin master id (as string for select compat)
  price: number;
  metres: number;
  waste: number;
}

const newBobbinRow = (): BobbinRow => ({
  key: Math.random().toString(36).slice(2),
  bobbinId: '',
  price: 4704,
  metres: 2000,
  waste: 0.10,
});

interface SnapshotBobbinRow {
  bobbinId?: string;
  price?: number;
  metres?: number;
  waste?: number;
}

interface CalcSnapshot {
  warpCount?: number; weftCount?: number; totalEnds?: number;
  picksPerInch?: number; loomWidthIn?: number; finishedWidthIn?: number;
  reedCount?: number; tapeLengthIn?: number;
  warpRate?: number; sizingRate?: number; autoWarp?: number; salesCommM?: number;
  weftRate?: number; autoWeft?: number; weavingPaise?: number;
  useBobbin?: boolean;
  // Legacy single-bobbin fields (older snapshots)
  bobbinPrice?: number; bobbinMetres?: number;
  bobbinWaste?: number; bobbinId?: string;
  // New multi-bobbin list
  bobbinRows?: SnapshotBobbinRow[];
  usePorvai?: boolean; porvaiByDenier?: boolean; porvaiDenier?: number;
  porvaiCountManual?: number; porvaiPick?: number; selvedgeLengthIn?: number;
  porvaiYarnCost?: number; porvaiCountId?: string;
  bagsPerM?: number; emptyBeamPerM?: number; sizedPaavuPerM?: number;
  otherChargesPerM?: number;
  profitPct?: number; marketRate?: number;
  isTowel?: boolean; towelLength?: number;
  showProd?: boolean; loomRpm?: number; efficiency?: number;
  warpCountId?: string; weftCountId?: string; endsId?: string;
}

interface EditCostingPageProps {
  params: Promise<{ id: string }>;
}

export default function EditCostingPage({ params }: EditCostingPageProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Two edit modes driven by the ?mode= query param on the URL:
  //   - mode is missing or anything else (default - "rates" mode):
  //       reached by clicking the Code in the list. Construction is locked,
  //       rate fields are editable.
  //   - mode = 'construction':
  //       reached by clicking the Edit button in the list. Construction is
  //       editable, rate fields are locked.
  const mode = searchParams.get('mode') ?? 'rates';
  const lockConstruction = mode !== 'construction';
  const lockRates = mode === 'construction';

  const [id, setId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const p = await params;
      setId(Number(p.id));
    })();
  }, [params]);

  // Calculator state - defaults match /app/costing/new
  const [warpCount, setWarpCount] = useState(40);
  const [weftCount, setWeftCount] = useState(39);
  const [totalEnds, setTotalEnds] = useState(2400);
  const [picksPerInch, setPicksPerInch] = useState(46);
  const [loomWidthIn, setLoomWidthIn] = useState(31.5);
  const [finishedWidthIn, setFinishedWidthIn] = useState(31);
  const [reedCount, setReedCount] = useState(72);
  const [tapeLengthIn, setTapeLengthIn] = useState(41.5);

  const [warpRate, setWarpRate] = useState(310);
  const [sizingRate, setSizingRate] = useState(26);
  const [autoWarp, setAutoWarp] = useState(2);
  const [salesCommM, setSalesCommM] = useState(0);

  const [weftRate, setWeftRate] = useState(285);
  const [autoWeft, setAutoWeft] = useState(2);
  const [weavingPaise, setWeavingPaise] = useState(16);

  const [useBobbin, setUseBobbin] = useState(true);
  const [bobbinRows, setBobbinRows] = useState<BobbinRow[]>([]);

  const [usePorvai, setUsePorvai] = useState(true);
  const [porvaiByDenier, setPorvaiByDenier] = useState(true);
  const [porvaiDenier, setPorvaiDenier] = useState(150);
  const [porvaiCountManual, setPorvaiCountManual] = useState(35.43);
  const [porvaiPick, setPorvaiPick] = useState(46);
  const [selvedgeLengthIn, setSelvedgeLengthIn] = useState(2.5);
  const [porvaiYarnCost, setPorvaiYarnCost] = useState(195);

  // Mill overheads (bags / empty beams / sized paavu / other charges)
  // and the Profit & market block were removed from the form. The
  // numbers below stay as constants (zeroed) so the calc still
  // compiles without those terms — they no longer contribute to cost
  // / sell. The fields are still read from the snapshot so we don't
  // crash on older saved rows, but they're never rendered or saved
  // back.
  const bagsPerM = 0;
  const emptyBeamPerM = 0;
  const sizedPaavuPerM = 0;
  const otherChargesPerM = 0;
  const profitPct = 0;
  const marketRate = 0;

  const [isTowel, setIsTowel] = useState(true);
  const [towelLength, setTowelLength] = useState(1.7);

  const [showProd, setShowProd] = useState(true);
  const [loomRpm, setLoomRpm] = useState(110);
  const [efficiency, setEfficiency] = useState(0.85);

  // Save-panel state
  const [qualityCode, setQualityCode] = useState('');
  const [qualityName, setQualityName] = useState('');
  const [warpCountId, setWarpCountId] = useState('');
  const [weftCountId, setWeftCountId] = useState('');
  const [endsId, setEndsId] = useState('');
  const [porvaiCountId, setPorvaiCountId] = useState('');
  const [counts, setCounts] = useState<CountOption[]>([]);
  const [endsOptions, setEndsOptions] = useState<EndsOption[]>([]);
  const [bobbins, setBobbins] = useState<BobbinOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const didApplySnapshot = useRef<boolean>(false);

  // Load master dropdowns once.
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [yc, em, bb] = await Promise.all([
        sb.from('yarn_count').select('id, code, display_name').neq('status', 'archived').order('code'),
        sb.from('ends_master').select('id, code, name, ends_count').eq('active', true).order('ends_count'),
        sb.from('bobbin').select('id, code, description').neq('status', 'archived').order('code'),
      ]);
      setCounts((yc.data ?? []) as unknown as CountOption[]);
      setEndsOptions((em.data ?? []) as unknown as EndsOption[]);
      setBobbins((bb.data ?? []) as unknown as BobbinOption[]);
    })();
  }, [supabase]);

  // Load the saved costing row and apply its calc_snapshot to the form.
  useEffect(() => {
    if (id == null) return;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb
        .from('costing_master')
        .select('quality_code, quality_name, fabric_type, calc_snapshot, use_bobbin_1, bobbin_1_id, bobbin_1_loading')
        .eq('id', id)
        .single();
      if (error) {
        setLoadErr(error.message);
        setLoaded(true);
        return;
      }
      setQualityCode(data.quality_code ?? '');
      setQualityName(data.quality_name ?? '');
      const s = (data.calc_snapshot ?? {}) as CalcSnapshot;
      if (s.warpCount         != null) setWarpCount(s.warpCount);
      if (s.weftCount         != null) setWeftCount(s.weftCount);
      if (s.totalEnds         != null) setTotalEnds(s.totalEnds);
      if (s.picksPerInch      != null) setPicksPerInch(s.picksPerInch);
      if (s.loomWidthIn       != null) setLoomWidthIn(s.loomWidthIn);
      if (s.finishedWidthIn   != null) setFinishedWidthIn(s.finishedWidthIn);
      if (s.reedCount         != null) setReedCount(s.reedCount);
      if (s.tapeLengthIn      != null) setTapeLengthIn(s.tapeLengthIn);
      if (s.warpRate          != null) setWarpRate(s.warpRate);
      if (s.sizingRate        != null) setSizingRate(s.sizingRate);
      if (s.autoWarp          != null) setAutoWarp(s.autoWarp);
      if (s.salesCommM        != null) setSalesCommM(s.salesCommM);
      if (s.weftRate          != null) setWeftRate(s.weftRate);
      if (s.autoWeft          != null) setAutoWeft(s.autoWeft);
      if (s.weavingPaise      != null) setWeavingPaise(s.weavingPaise);
      if (s.useBobbin         != null) setUseBobbin(s.useBobbin);
      if (s.usePorvai         != null) setUsePorvai(s.usePorvai);
      if (s.porvaiByDenier    != null) setPorvaiByDenier(s.porvaiByDenier);
      if (s.porvaiDenier      != null) setPorvaiDenier(s.porvaiDenier);
      if (s.porvaiCountManual != null) setPorvaiCountManual(s.porvaiCountManual);
      if (s.porvaiPick        != null) setPorvaiPick(s.porvaiPick);
      if (s.selvedgeLengthIn  != null) setSelvedgeLengthIn(s.selvedgeLengthIn);
      if (s.porvaiYarnCost    != null) setPorvaiYarnCost(s.porvaiYarnCost);
      if (s.porvaiCountId     != null) setPorvaiCountId(s.porvaiCountId);
      // Mill overheads and Profit & market fields are no longer set
      // from the snapshot — they live as zeroed constants now.
      if (s.isTowel           != null) setIsTowel(s.isTowel);
      if (s.towelLength       != null) setTowelLength(s.towelLength);
      if (s.showProd          != null) setShowProd(s.showProd);
      if (s.loomRpm           != null) setLoomRpm(s.loomRpm);
      if (s.efficiency        != null) setEfficiency(s.efficiency);
      if (s.warpCountId       != null) setWarpCountId(s.warpCountId);
      if (s.weftCountId       != null) setWeftCountId(s.weftCountId);
      if (s.endsId            != null) setEndsId(s.endsId);

      // Load multi-bobbin child rows. Resolution order:
      //   1. costing_master_bobbin rows (the source of truth)
      //   2. snapshot.bobbinRows (fresh saves that haven't hit child table)
      //   3. legacy bobbin_1_* columns + legacy snapshot fields
      const { data: cmbRows } = await sb
        .from('costing_master_bobbin')
        .select('id, bobbin_id, price, metres, waste, sort_order')
        .eq('costing_id', Number(id))
        .order('sort_order');
      const childRows: BobbinRow[] = (cmbRows ?? []).map((row: {
        bobbin_id: number; price: number | null; metres: number | null; waste: number | null;
      }) => ({
        key: Math.random().toString(36).slice(2),
        bobbinId: String(row.bobbin_id),
        price: Number(row.price ?? 0),
        metres: Number(row.metres ?? 0),
        waste: Number(row.waste ?? 0),
      }));

      if (childRows.length > 0) {
        setBobbinRows(childRows);
      } else if (Array.isArray(s.bobbinRows) && s.bobbinRows.length > 0) {
        setBobbinRows(s.bobbinRows.map((row) => ({
          key: Math.random().toString(36).slice(2),
          bobbinId: row.bobbinId ?? '',
          price: Number(row.price ?? 0),
          metres: Number(row.metres ?? 0),
          waste: Number(row.waste ?? 0),
        })));
      } else if (data.bobbin_1_id != null) {
        // Synthesize one row from legacy columns + legacy snapshot.
        setBobbinRows([{
          key: Math.random().toString(36).slice(2),
          bobbinId: String(data.bobbin_1_id),
          price: Number(s.bobbinPrice ?? 4704),
          metres: Number(s.bobbinMetres ?? 2000),
          waste: Number(data.bobbin_1_loading ?? s.bobbinWaste ?? 0.10),
        }]);
      } else if (s.bobbinId || s.bobbinPrice != null || s.bobbinMetres != null) {
        // Older snapshot with bobbin numbers but no FK saved.
        setBobbinRows([{
          key: Math.random().toString(36).slice(2),
          bobbinId: s.bobbinId ?? '',
          price: Number(s.bobbinPrice ?? 4704),
          metres: Number(s.bobbinMetres ?? 2000),
          waste: Number(s.bobbinWaste ?? 0.10),
        }]);
      }

      didApplySnapshot.current = true;
      setLoaded(true);
    })();
  }, [id, supabase]);

  // Compute everything (mirrors /app/costing/new).
  const r = useMemo(() => {
    const warpMPerKg = warpCount > 0 && totalEnds > 0 && tapeLengthIn > 0
      ? ((1848 * warpCount) / totalEnds) * 36 / tapeLengthIn * 1.01 : 0;
    const warpKgPerM = warpMPerKg > 0 ? 1 / warpMPerKg : 0;
    const weftMPerKg = weftCount > 0 && picksPerInch > 0 && (loomWidthIn + 3) > 0
      ? (1690 * weftCount) / picksPerInch / (loomWidthIn + 3) : 0;
    const weftKgPerM = weftMPerKg > 0 ? 1 / weftMPerKg : 0;
    const gramsPerM = (warpKgPerM + weftKgPerM) * 1000;
    const gramsPerSqM = finishedWidthIn > 0 ? (gramsPerM * 39.37) / finishedWidthIn : 0;
    const warpCost = warpMPerKg > 0
      ? (warpRate + sizingRate + autoWarp) / warpMPerKg + salesCommM : 0;
    const weftCost = weftMPerKg > 0 ? (weftRate + autoWeft) / weftMPerKg : 0;
    const pickCost = (picksPerInch * weavingPaise) / 100;
    const bobbinCost = useBobbin
      ? bobbinRows.reduce((sum, row) => {
          if (row.metres > 0) return sum + row.price / row.metres + row.waste;
          return sum;
        }, 0)
      : 0;
    const porvaiCount = porvaiByDenier
      ? (porvaiDenier > 0 ? 5315 / porvaiDenier : 0) : porvaiCountManual;
    const porvaiMPerKg = usePorvai && porvaiCount > 0 && porvaiPick > 0 && (selvedgeLengthIn + 3) > 0
      ? (1690 * porvaiCount) / porvaiPick / (selvedgeLengthIn + 3) : 0;
    const porvaiCost = usePorvai && porvaiMPerKg > 0 ? porvaiYarnCost / porvaiMPerKg : 0;
    const overheads = bagsPerM + emptyBeamPerM + sizedPaavuPerM + otherChargesPerM;
    const subtotal = warpCost + weftCost + pickCost + bobbinCost + porvaiCost + overheads;
    const profitAmount = subtotal * profitPct;
    const costPerM = subtotal + profitAmount;
    const profitLoss = marketRate > 0 ? marketRate - costPerM : null;
    const costPerTowel = isTowel ? costPerM * towelLength : null;
    const gramsPerTowel = isTowel ? gramsPerM * towelLength : null;
    const metresPerDay = showProd && picksPerInch > 0
      ? (loomRpm * 60 * 24 * efficiency) / 39.37 / picksPerInch : 0;
    const towelsPerDay = showProd && isTowel && towelLength > 0
      ? metresPerDay / towelLength : 0;
    const endsCheck = reedCount * finishedWidthIn + 50;
    return {
      warpMPerKg, warpKgPerM, weftMPerKg, weftKgPerM, gramsPerM, gramsPerSqM,
      warpCost, weftCost, pickCost, bobbinCost, porvaiCost, overheads,
      bagsPerM, emptyBeamPerM, sizedPaavuPerM, otherChargesPerM,
      subtotal, profitAmount, costPerM, profitLoss, costPerTowel, gramsPerTowel,
      metresPerDay, towelsPerDay, endsCheck, porvaiCount, porvaiMPerKg,
    };
  }, [
    warpCount, weftCount, totalEnds, picksPerInch, loomWidthIn, finishedWidthIn,
    reedCount, tapeLengthIn,
    warpRate, sizingRate, autoWarp, salesCommM, weftRate, autoWeft, weavingPaise,
    useBobbin, bobbinRows,
    usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual, porvaiPick, selvedgeLengthIn, porvaiYarnCost,
    bagsPerM, emptyBeamPerM, sizedPaavuPerM, otherChargesPerM,
    profitPct, marketRate, isTowel, towelLength,
    showProd, loomRpm, efficiency,
  ]);

  async function handleSave(): Promise<void> {
    if (id == null) return;
    setSaveError(null);
    setSaveOk(null);
    const trimmedCode = qualityCode.trim();
    if (trimmedCode === '')         return setSaveError('Quality code is required.');
    if (qualityName.trim() === '')  return setSaveError('Quality name is required.');
    if (warpCountId === '')         return setSaveError('Pick the warp yarn count.');
    if (weftCountId === '')         return setSaveError('Pick the weft yarn count.');

    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const dup = await sb
      .from('costing_master')
      .select('id')
      .eq('quality_code', trimmedCode)
      .neq('id', id)
      .maybeSingle();
    if (dup.data) {
      setSaving(false);
      setSaveError(`Quality code "${trimmedCode}" is already used by costing #${dup.data.id}.`);
      return;
    }

    // Defensive filter: drop rows whose bobbinId is blank or unknown to
    // avoid FK violations on costing_master_bobbin.
    const validBobbinRows = useBobbin
      ? bobbinRows.filter((row) =>
          row.bobbinId !== '' &&
          Number.isFinite(Number(row.bobbinId)) &&
          bobbins.some((b) => b.id === Number(row.bobbinId)),
        )
      : [];
    const firstValidBobbinRow = validBobbinRows[0] ?? null;

    const payload = {
      quality_code: trimmedCode,
      quality_name: qualityName.trim(),
      fabric_type: isTowel ? 'towel' : 'woven',
      warp_count_id: Number(warpCountId),
      weft_count_id: Number(weftCountId),
      warp_ends: endsId !== ''
        ? (endsOptions.find((e) => e.id === Number(endsId))?.ends_count ?? totalEnds)
        : totalEnds,
      tape_length_m:   Number((tapeLengthIn / 39.37).toFixed(4)),
      pick_ppi:        picksPerInch,
      fabric_length_m: Number((loomWidthIn / 39.37).toFixed(4)),
      reed_count:      reedCount,
      fabric_width_in: finishedWidthIn,
      // Legacy single-bobbin columns. Mirror the FIRST valid child row
      // (if any) for back-compat. Full list lives in
      // costing_master_bobbin (synced below).
      use_bobbin_1: useBobbin && firstValidBobbinRow !== null,
      bobbin_1_id:  useBobbin && firstValidBobbinRow !== null
        ? Number(firstValidBobbinRow.bobbinId)
        : null,
      bobbin_1_loading: useBobbin && firstValidBobbinRow !== null
        ? firstValidBobbinRow.waste
        : null,
      use_bobbin_2:     false,
      bobbin_2_id:      null,
      bobbin_2_loading: null,
      use_porvai:      usePorvai && isTowel,
      porvai_count_id: usePorvai && porvaiCountId !== '' ? Number(porvaiCountId) : null,
      porvai_slevage_length_m: usePorvai ? Number((selvedgeLengthIn / 39.37).toFixed(4)) : null,
      pick_paise_market: weavingPaise,
      sizing_cost_per_m: sizedPaavuPerM,
      auto_cost_per_m: autoWarp,
      warp_commission_per_m: salesCommM,
      warp_m_per_kg:   Number(r.warpMPerKg.toFixed(4)),
      warp_kg_per_m:   Number(r.warpKgPerM.toFixed(6)),
      weft_m_per_kg:   Number(r.weftMPerKg.toFixed(4)),
      weft_kg_per_m:   Number(r.weftKgPerM.toFixed(6)),
      porvai_m_per_kg: usePorvai ? Number(r.porvaiMPerKg.toFixed(4)) : null,
      porvai_kg_per_m: usePorvai && r.porvaiMPerKg > 0 ? Number((1 / r.porvaiMPerKg).toFixed(6)) : null,
      grams_per_m: Number(r.gramsPerM.toFixed(2)),
      gsm:         Number(r.gramsPerSqM.toFixed(2)),
      calc_snapshot: {
        warpCount, weftCount, totalEnds, picksPerInch, loomWidthIn,
        finishedWidthIn, reedCount, tapeLengthIn,
        warpRate, sizingRate, autoWarp, salesCommM,
        weftRate, autoWeft, weavingPaise,
        useBobbin, bobbinRows,
        usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual,
        porvaiPick, selvedgeLengthIn, porvaiYarnCost, porvaiCountId,
        bagsPerM, emptyBeamPerM, sizedPaavuPerM, otherChargesPerM,
        profitPct, marketRate,
        isTowel, towelLength,
        showProd, loomRpm, efficiency,
        warpCountId, weftCountId, endsId,
      },
    };

    const { error } = await sb.from('costing_master').update(payload).eq('id', id);
    if (error) {
      setSaving(false);
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        setSaveError(`Quality code "${trimmedCode}" is already used. Pick a different code.`);
      } else {
        setSaveError(error.message);
      }
      return;
    }

    // Sync child bobbin rows: nuke and re-insert. Simpler than diffing
    // and the table is small (a handful of rows per costing).
    const delChildren = await sb
      .from('costing_master_bobbin')
      .delete()
      .eq('costing_id', id);
    if (delChildren.error) {
      setSaving(false);
      setSaveError('Saved master but failed to clear old bobbin rows: ' + delChildren.error.message);
      return;
    }
    if (validBobbinRows.length > 0) {
      const childPayload = validBobbinRows.map((row, idx) => ({
        costing_id: id,
        bobbin_id:  Number(row.bobbinId),
        price:      row.price,
        metres:     row.metres,
        waste:      row.waste,
        sort_order: idx,
      }));
      const insChildren = await sb
        .from('costing_master_bobbin')
        .insert(childPayload);
      if (insChildren.error) {
        setSaving(false);
        setSaveError('Saved master but failed to insert bobbin rows: ' + insChildren.error.message);
        return;
      }
    }

    setSaving(false);
    setSaveOk('Saved.');
    setTimeout(() => {
      router.push('/app/costing');
      router.refresh();
    }, 600);
  }

  async function handleDelete(): Promise<void> {
    if (id == null) return;
    const ok = window.confirm(
      `Delete costing ${qualityCode || '#' + id}?\n\nThis cannot be undone. If the costing is in use by sales orders, invoices, or production, the delete will fail.`,
    );
    if (!ok) return;
    setSaveError(null);
    setDeleting(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('costing_master').delete().eq('id', id);
    setDeleting(false);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') {
        setSaveError('In use by other records — untick Active on the list to archive instead.');
      } else {
        setSaveError(error.message);
      }
      return;
    }
    router.push('/app/costing');
    router.refresh();
  }

  if (!loaded) {
    return (
      <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading costing...
      </div>
    );
  }
  if (loadErr) {
    return (
      <div className="card p-6 text-err text-sm">
        {loadErr}
      </div>
    );
  }
  void didApplySnapshot.current;

  return (
    <div>
      <PageHeader
        title={
          (mode === 'construction' ? 'Edit Construction' : 'Edit Rates')
          + (qualityCode ? ' - ' + qualityCode : '')
        }
        subtitle={mode === 'construction'
          ? 'Structural fields editable; rate fields locked. Switch back to Rates by clicking the costing code on the list.'
          : 'Rate fields editable; construction locked. Click Edit on the list to change construction.'}
        actions={
          <Link href="/app/costing" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back to list
          </Link>
        }
      />

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="card p-5 space-y-4">
          <h2 className="font-display font-bold text-base flex items-center gap-2">
            <Calculator className="w-4 h-4 text-indigo" /> Cloth construction
          </h2>

          <p className="text-[11px] text-ink-mute italic">
            {mode === 'construction'
              ? 'Construction mode: structural fields are editable; rate fields below are locked.'
              : 'Rates mode: rate fields are editable; construction is locked. Use the Edit button on the list to change construction.'}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <Row><L>Warp Count (Ne)</L><Num value={warpCount} set={setWarpCount} step={0.5} lock={lockConstruction} /></Row>
            <Row><L>Weft Count (Ne)</L><Num value={weftCount} set={setWeftCount} step={0.5} lock={lockConstruction} /></Row>
            <Row><L>Total Ends</L><Num value={totalEnds} set={setTotalEnds} step={10} lock={lockConstruction} /></Row>
            <Row><L>Pick / Inch</L><Num value={picksPerInch} set={setPicksPerInch} lock={lockConstruction} /></Row>
            <Row><L>Loom width (in)</L><Num value={loomWidthIn} set={setLoomWidthIn} step={0.5} lock={lockConstruction} /></Row>
            <Row><L>Reed space (in)</L><Num value={finishedWidthIn} set={setFinishedWidthIn} step={0.5} lock={lockConstruction} /></Row>
            <Row><L>Reed</L><Num value={reedCount} set={setReedCount} lock={lockConstruction} /></Row>
            <Row>
              <L title="Inches of warp tape per metre of fabric - typically 39 to 42.">
                Tape Length (in/m) <Info className="inline w-3 h-3 text-ink-mute -mt-0.5" />
              </L>
              <Num value={tapeLengthIn} set={setTapeLengthIn} step={0.5} lock={lockConstruction} />
            </Row>
          </div>

          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">Warp rates</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Yarn (Rs/kg)</L><Num value={warpRate} set={setWarpRate} step={5} lock={lockRates} /></Row>
              <Row><L>Sizing (Rs/kg)</L><Num value={sizingRate} set={setSizingRate} step={1} lock={lockRates} /></Row>
              <Row><L>Auto / cone (Rs/kg)</L><Num value={autoWarp} set={setAutoWarp} step={0.5} lock={lockRates} /></Row>
              <Row><L>Sales commission (Rs/m)</L><Num value={salesCommM} set={setSalesCommM} step={0.1} lock={lockRates} /></Row>
            </div>
          </div>

          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">Weft rates</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Yarn (Rs/kg)</L><Num value={weftRate} set={setWeftRate} step={5} lock={lockRates} /></Row>
              <Row><L>Auto / cone (Rs/kg)</L><Num value={autoWeft} set={setAutoWeft} step={0.5} lock={lockRates} /></Row>
              <Row><L>Weaving (paise / pick)</L><Num value={weavingPaise} set={setWeavingPaise} step={0.5} lock={lockRates} /></Row>
            </div>
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include bobbin / cone cost" checked={useBobbin} set={setUseBobbin} lock={lockConstruction} />
            {useBobbin && (
              <div className="mt-2 space-y-3">
                {bobbinRows.length === 0 && (
                  <p className="text-xs text-ink-mute italic">
                    No bobbins added yet. Click below to add the first one.
                  </p>
                )}
                {bobbinRows.map((row, idx) => (
                  <div key={row.key} className="rounded-lg border border-line/60 p-3 bg-white/40">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-ink-soft">
                        Bobbin #{idx + 1}
                      </span>
                      <button type="button"
                        disabled={lockConstruction}
                        onClick={() => setBobbinRows((prev) => prev.filter((_, i) => i !== idx))}
                        className={
                          'text-xs font-semibold ' +
                          (lockConstruction
                            ? 'text-ink-mute cursor-not-allowed'
                            : 'text-rose-700 hover:text-rose-900')
                        }>
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      <Row>
                        <L>Bobbin</L>
                        <select
                          className={
                            'input h-8 text-sm w-56 ' +
                            (lockConstruction ? 'bg-cloud/40 text-ink-soft cursor-not-allowed' : '')
                          }
                          disabled={lockConstruction}
                          value={row.bobbinId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBobbinRows((prev) => prev.map((r, i) =>
                              i === idx ? { ...r, bobbinId: v } : r,
                            ));
                          }}>
                          <option value="">--- pick ---</option>
                          {bobbins.map((b) => (
                            <option key={b.id} value={String(b.id)}>{b.code} - {b.description}</option>
                          ))}
                        </select>
                      </Row>
                      <Row>
                        <L>Bobbin price (Rs)</L>
                        <Num value={row.price} step={50} lock={lockRates}
                          set={(n) => setBobbinRows((prev) => prev.map((r, i) =>
                            i === idx ? { ...r, price: n } : r,
                          ))} />
                      </Row>
                      <Row>
                        <L>Bobbin metres</L>
                        <Num value={row.metres} step={50} lock={lockConstruction}
                          set={(n) => setBobbinRows((prev) => prev.map((r, i) =>
                            i === idx ? { ...r, metres: n } : r,
                          ))} />
                      </Row>
                      <Row>
                        <L>Waste add (Rs/m)</L>
                        <Num value={row.waste} step={0.05} lock={lockRates}
                          set={(n) => setBobbinRows((prev) => prev.map((r, i) =>
                            i === idx ? { ...r, waste: n } : r,
                          ))} />
                      </Row>
                    </div>
                  </div>
                ))}
                <button type="button"
                  disabled={lockConstruction}
                  onClick={() => setBobbinRows((prev) => [...prev, newBobbinRow()])}
                  className={
                    'inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg border px-3 py-1.5 ' +
                    (lockConstruction
                      ? 'bg-cloud/40 text-ink-mute border-line cursor-not-allowed'
                      : bobbinRows.length === 0
                        ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                        : 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50')
                  }>
                  + Add bobbin
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include porvai (selvedge)" checked={usePorvai} set={setUsePorvai} lock={lockConstruction} />
            {usePorvai && (
              <>
                <div className="mt-2 flex gap-2 text-xs">
                  <button type="button" disabled={lockConstruction}
                    onClick={() => setPorvaiByDenier(true)}
                    className={"px-3 py-1.5 rounded-lg border " + (lockConstruction ? 'opacity-60 cursor-not-allowed ' : '') + (porvaiByDenier ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-ink-soft border-line")}>By denier</button>
                  <button type="button" disabled={lockConstruction}
                    onClick={() => setPorvaiByDenier(false)}
                    className={"px-3 py-1.5 rounded-lg border " + (lockConstruction ? 'opacity-60 cursor-not-allowed ' : '') + (porvaiByDenier === false ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-ink-soft border-line")}>By count (Ne)</button>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                  {porvaiByDenier ? (
                    <Row><L>Denier</L><Num value={porvaiDenier} set={setPorvaiDenier} step={5} lock={lockConstruction} /></Row>
                  ) : (
                    <Row><L>Porvai count (Ne)</L><Num value={porvaiCountManual} set={setPorvaiCountManual} step={0.5} lock={lockConstruction} /></Row>
                  )}
                  <Row><L>Porvai pick</L><Num value={porvaiPick} set={setPorvaiPick} lock={lockConstruction} /></Row>
                  <Row><L>Selvedge length (in)</L><Num value={selvedgeLengthIn} set={setSelvedgeLengthIn} step={0.25} lock={lockConstruction} /></Row>
                  <Row><L>Porvai yarn (Rs/kg)</L><Num value={porvaiYarnCost} set={setPorvaiYarnCost} step={5} lock={lockRates} /></Row>
                </div>
              </>
            )}
          </div>

          {/* Mill overheads + Profit & market sections removed. */}

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Calculate for towel?" checked={isTowel} set={setIsTowel} lock={lockConstruction} />
            {isTowel && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Towel length (m)</L><Num value={towelLength} set={setTowelLength} step={0.05} lock={lockConstruction} /></Row>
              </div>
            )}
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Show production stats" checked={showProd} set={setShowProd} lock={lockConstruction} />
            {showProd && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Loom RPM</L><Num value={loomRpm} set={setLoomRpm} step={5} lock={lockConstruction} /></Row>
                <Row><L>Efficiency %</L><Pct value={efficiency} set={setEfficiency} lock={lockConstruction} /></Row>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5 bg-gradient-to-br from-indigo-50/50 to-violet-50/30 self-start">
          <h2 className="font-display font-bold text-base mb-3">Derived weights</h2>
          <ResultRow label="Warp m/kg" value={r.warpMPerKg.toFixed(2)} small />
          <ResultRow label="Weft m/kg" value={r.weftMPerKg.toFixed(2)} small />
          <ResultRow label="Grams / metre" value={r.gramsPerM.toFixed(2) + ' g'} small />
          <ResultRow label="GSM (g/sq.m)" value={r.gramsPerSqM.toFixed(2)} small />
          {usePorvai && r.porvaiMPerKg > 0 && (
            <ResultRow label="Porvai m/kg" value={r.porvaiMPerKg.toFixed(2)} small />
          )}
          <Divider />
          <h2 className="font-display font-bold text-base mb-3">Cost breakdown (Rs / m)</h2>
          <ResultRow label="Warp" value={formatRupee(r.warpCost, { decimals: 3 })} small />
          <ResultRow label="Weft" value={formatRupee(r.weftCost, { decimals: 3 })} small />
          <ResultRow label="Weaving (pick)" value={formatRupee(r.pickCost, { decimals: 3 })} small />
          {useBobbin && (<ResultRow label="Bobbin & weft" value={formatRupee(r.bobbinCost, { decimals: 3 })} small />)}
          {usePorvai && (<ResultRow label="Porvai" value={formatRupee(r.porvaiCost, { decimals: 3 })} small />)}
          <Divider />
          <ResultRow label="Subtotal" value={formatRupee(r.subtotal, { decimals: 2 })} />
          <Divider />
          <ResultRow label="Cost / metre" value={formatRupee(r.costPerM, { decimals: 2 })} highlight="indigo" big />
          {isTowel && r.costPerTowel !== null && (
            <>
              <Divider />
              <ResultRow label={"Cost / towel (" + towelLength + " m)"}
                value={formatRupee(r.costPerTowel, { decimals: 2 })} highlight="violet" big />
            </>
          )}
        </div>
      </div>

      <div className="card p-5 mt-4 border border-indigo-200 bg-indigo-50/30">
        <h2 className="font-display font-bold text-base mb-1 flex items-center gap-2">
          <Save className="w-4 h-4 text-indigo" /> Save changes
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Costing Code</label>
            <input className="input num w-full bg-cloud/40 text-ink-soft cursor-not-allowed"
              value={qualityCode} disabled readOnly />
          </div>
          <div className="md:col-span-2">
            <label className="label">Costing Name *</label>
            <input className="input w-full" value={qualityName}
              onChange={(e) => setQualityName(e.target.value)} />
          </div>
          <div>
            <label className="label">Fabric Type</label>
            <div className="input bg-cloud/40 text-ink-soft select-none">{isTowel ? 'Towel' : 'Fabric'}</div>
          </div>
          <div>
            <label className="label">Warp Count *</label>
            <select className={'input w-full ' + (lockConstruction ? 'bg-cloud/40 text-ink-soft cursor-not-allowed' : '')}
              value={warpCountId} disabled={lockConstruction}
              onChange={(e) => setWarpCountId(e.target.value)}>
              <option value="">--- pick ---</option>
              {counts.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">Weft Count *</label>
            <select className={'input w-full ' + (lockConstruction ? 'bg-cloud/40 text-ink-soft cursor-not-allowed' : '')}
              value={weftCountId} disabled={lockConstruction}
              onChange={(e) => setWeftCountId(e.target.value)}>
              <option value="">--- pick ---</option>
              {counts.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">Ends spec</label>
            <select className={'input w-full ' + (lockConstruction ? 'bg-cloud/40 text-ink-soft cursor-not-allowed' : '')}
              value={endsId} disabled={lockConstruction}
              onChange={(e) => setEndsId(e.target.value)}>
              <option value="">--- use form value ---</option>
              {endsOptions.map((e) => (<option key={e.id} value={String(e.id)}>{e.code} - {e.name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">Porvai yarn count</label>
            <select className={'input w-full ' + (lockConstruction ? 'bg-cloud/40 text-ink-soft cursor-not-allowed' : '')}
              value={porvaiCountId} disabled={lockConstruction || usePorvai === false}
              onChange={(e) => setPorvaiCountId(e.target.value)}>
              <option value="">--- none ---</option>
              {counts.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
            </select>
          </div>
        </div>

        {saveError && <div className="mt-3 p-3 rounded-lg bg-red-50 text-err text-sm">{saveError}</div>}
        {saveOk    && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> {saveOk}
          </div>
        )}

        <div className="flex justify-between items-center mt-3">
          <button type="button" disabled={deleting || saving} onClick={handleDelete}
            className="inline-flex items-center gap-1.5 text-sm text-rose-700 hover:text-rose-900 font-semibold disabled:opacity-50">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete this costing
          </button>
          <button type="button" disabled={saving || deleting} onClick={handleSave}
            className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[1fr_auto] items-center gap-2">{children}</div>;
}
function L({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className="text-xs text-ink-soft" title={title}>{children}</span>;
}
function Num({ value, set, step = 1, lock = false }: {
  value: number; set: (n: number) => void; step?: number; lock?: boolean;
}) {
  return (
    <input type="number" value={Number.isFinite(value) ? value : 0} step={step}
      onChange={(e) => set(Number(e.target.value))} disabled={lock}
      className={
        'input num text-right h-8 text-sm w-28 ' +
        (lock ? 'bg-cloud/40 text-ink-soft cursor-not-allowed' : '')
      } />
  );
}
function Pct({ value, set, lock = false }: {
  value: number; set: (n: number) => void; lock?: boolean;
}) {
  return (
    <div className="relative w-28">
      <input type="number" value={(value * 100).toFixed(2)} step={0.5}
        onChange={(e) => set(Number(e.target.value) / 100)} disabled={lock}
        className={
          'input num text-right h-8 text-sm pr-6 ' +
          (lock ? 'bg-cloud/40 text-ink-soft cursor-not-allowed' : '')
        } />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-mute">%</span>
    </div>
  );
}
function Toggle({ label, checked, set, lock = false }: {
  label: string; checked: boolean; set: (b: boolean) => void; lock?: boolean;
}) {
  return (
    <label className={'flex items-center gap-2 text-sm font-semibold ' + (lock ? 'cursor-not-allowed text-ink-mute' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked} disabled={lock}
        onChange={(e) => set(e.target.checked)}
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
