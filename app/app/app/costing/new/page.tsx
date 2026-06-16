// New Costing — same UI as the Quick Calculator, plus a Save panel that
// writes one costing_master row (status = active, approval_status = pending)
// and optionally creates a matching fabric_quality row.
//
// On Save: prompts "Create matching Fabric Quality?" -> if Yes also inserts
// fabric_quality with consumption snapshot (migration 060). If No, only the
// costing master row is saved.

'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import { Calculator, Info, Save, Loader2, CheckCircle2 } from 'lucide-react';

const DEFAULT_BAGS_PER_M = 0.50;
const DEFAULT_EMPTY_BEAM_PER_M = 1.00;
const DEFAULT_SIZED_PAAVU_BEAM_PER_M = 1.50;

interface CountOption  { id: number; code: string; display_name: string; }
interface EndsOption   { id: number; code: string; name: string; ends_count: number; }
interface BobbinOption { id: number; code: string; description: string; }

export default function NewCostingPage() {
  const supabase = createClient();
  const router = useRouter();

  // Cloth construction
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
  const [bobbinPrice, setBobbinPrice] = useState(4704);
  const [bobbinMetres, setBobbinMetres] = useState(2000);
  const [bobbinWaste, setBobbinWaste] = useState(0.10);

  const [usePorvai, setUsePorvai] = useState(true);
  const [porvaiByDenier, setPorvaiByDenier] = useState(true);
  const [porvaiDenier, setPorvaiDenier] = useState(150);
  const [porvaiCountManual, setPorvaiCountManual] = useState(35.43);
  const [porvaiPick, setPorvaiPick] = useState(46);
  const [selvedgeLengthIn, setSelvedgeLengthIn] = useState(2.5);
  const [porvaiYarnCost, setPorvaiYarnCost] = useState(195);

  // Mill overheads (bags / empty beams / sized paavu / other charges)
  // and the Profit & market block were removed from the form. The
  // numbers below are constants kept at 0 so the calc still compiles
  // without those terms — they no longer contribute to cost / sell.
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

  // Save panel state
  const [qualityName, setQualityName] = useState('');
  const [warpCountId, setWarpCountId] = useState('');
  const [weftCountId, setWeftCountId] = useState('');
  const [endsId, setEndsId] = useState('');
  const [bobbinId, setBobbinId] = useState('');
  const [porvaiCountId, setPorvaiCountId] = useState('');
  const [counts, setCounts] = useState<CountOption[]>([]);
  const [endsOptions, setEndsOptions] = useState<EndsOption[]>([]);
  const [bobbins, setBobbins] = useState<BobbinOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

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

  // Compute everything
  const r = useMemo(() => {
    const warpMPerKg = warpCount > 0 && totalEnds > 0 && tapeLengthIn > 0
      ? ((1848 * warpCount) / totalEnds) * 36 / tapeLengthIn * 1.01
      : 0;
    const warpKgPerM = warpMPerKg > 0 ? 1 / warpMPerKg : 0;

    const weftMPerKg = weftCount > 0 && picksPerInch > 0 && (loomWidthIn + 3) > 0
      ? (1690 * weftCount) / picksPerInch / (loomWidthIn + 3)
      : 0;
    const weftKgPerM = weftMPerKg > 0 ? 1 / weftMPerKg : 0;

    const gramsPerM = (warpKgPerM + weftKgPerM) * 1000;
    const gramsPerSqM = finishedWidthIn > 0 ? (gramsPerM * 39.37) / finishedWidthIn : 0;

    const warpCost = warpMPerKg > 0
      ? (warpRate + sizingRate + autoWarp) / warpMPerKg + salesCommM
      : 0;
    const weftCost = weftMPerKg > 0 ? (weftRate + autoWeft) / weftMPerKg : 0;
    const pickCost = (picksPerInch * weavingPaise) / 100;

    const bobbinCost = useBobbin && bobbinMetres > 0
      ? bobbinPrice / bobbinMetres + bobbinWaste
      : 0;

    const porvaiCount = porvaiByDenier
      ? (porvaiDenier > 0 ? 5315 / porvaiDenier : 0)
      : porvaiCountManual;
    const porvaiMPerKg = usePorvai && porvaiCount > 0 && porvaiPick > 0 && (selvedgeLengthIn + 3) > 0
      ? (1690 * porvaiCount) / porvaiPick / (selvedgeLengthIn + 3)
      : 0;
    const porvaiCost = usePorvai && porvaiMPerKg > 0 ? porvaiYarnCost / porvaiMPerKg : 0;

    const overheads = bagsPerM + emptyBeamPerM + sizedPaavuPerM + otherChargesPerM;

    const subtotal = warpCost + weftCost + pickCost + bobbinCost + porvaiCost + overheads;
    const profitAmount = subtotal * profitPct;
    const costPerM = subtotal + profitAmount;

    const profitLoss = marketRate > 0 ? marketRate - costPerM : null;
    const costPerTowel = isTowel ? costPerM * towelLength : null;
    const gramsPerTowel = isTowel ? gramsPerM * towelLength : null;

    const metresPerDay = showProd && picksPerInch > 0
      ? (loomRpm * 60 * 24 * efficiency) / 39.37 / picksPerInch
      : 0;
    const towelsPerDay = showProd && isTowel && towelLength > 0
      ? metresPerDay / towelLength
      : 0;
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
    useBobbin, bobbinPrice, bobbinMetres, bobbinWaste,
    usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual, porvaiPick, selvedgeLengthIn, porvaiYarnCost,
    bagsPerM, emptyBeamPerM, sizedPaavuPerM, otherChargesPerM,
    profitPct, marketRate, isTowel, towelLength,
    showProd, loomRpm, efficiency,
  ]);

  async function handleSaveSubmit() {
    setSaveError(null);
    setSaveOk(null);
    if (qualityName.trim() === '') return setSaveError('Costing name is required.');
    if (warpCountId === '')        return setSaveError('Pick the warp yarn count.');
    if (weftCountId === '')        return setSaveError('Pick the weft yarn count.');
    // quality_code is auto-generated by the trg_costing_master_autogen_code
    // trigger (migration 066), so no client-side uniqueness check is needed.

    // /costing/new only inserts a costing_master row. Fabric Quality is a
    // separate master maintained under Settings -> Fabric Qualities; the
    // operator can build a matching fabric there if needed.

    const payload = {
      // quality_code intentionally omitted — auto-filled by trigger.
      quality_name: qualityName.trim(),
      fabric_type:  isTowel ? 'towel' : 'woven',
      production_mode: 'inhouse' as const,
      warp_count_id: Number(warpCountId),
      weft_count_id: Number(weftCountId),
      warp_ends:        endsId !== ''
        ? (endsOptions.find((e) => e.id === Number(endsId))?.ends_count ?? totalEnds)
        : totalEnds,
      tape_length_m:    Number((tapeLengthIn / 39.37).toFixed(4)),
      pick_ppi:         picksPerInch,
      fabric_length_m:  Number((loomWidthIn / 39.37).toFixed(4)),
      reed_count:       reedCount,
      fabric_width_in:  finishedWidthIn,
      selvedge_ends:    0,
      use_bobbin_1:     useBobbin && bobbinId !== '',
      bobbin_1_id:      useBobbin && bobbinId !== '' ? Number(bobbinId) : null,
      bobbin_1_loading: useBobbin ? bobbinWaste : null,
      use_bobbin_2:     false,
      use_porvai:       usePorvai && isTowel,
      porvai_count_id:  usePorvai && porvaiCountId !== '' ? Number(porvaiCountId) : null,
      porvai_slevage_length_m: usePorvai ? Number((selvedgeLengthIn / 39.37).toFixed(4)) : null,
      pick_paise_market: weavingPaise,
      sizing_cost_per_m: sizedPaavuPerM,
      auto_cost_per_m:   autoWarp,
      warp_commission_per_m: salesCommM,
      warp_m_per_kg:   Number(r.warpMPerKg.toFixed(4)),
      warp_kg_per_m:   Number(r.warpKgPerM.toFixed(6)),
      weft_m_per_kg:   Number(r.weftMPerKg.toFixed(4)),
      weft_kg_per_m:   Number(r.weftKgPerM.toFixed(6)),
      porvai_m_per_kg: usePorvai ? Number(r.porvaiMPerKg.toFixed(4)) : null,
      porvai_kg_per_m: usePorvai && r.porvaiMPerKg > 0 ? Number((1 / r.porvaiMPerKg).toFixed(6)) : null,
      grams_per_m:     Number(r.gramsPerM.toFixed(2)),
      gsm:             Number(r.gramsPerSqM.toFixed(2)),
      save_path:        'formal' as const,
      approval_status:  'pending' as const,
      status:           'active' as const,
      notes:            'Saved from New Costing.',
      // Full snapshot of the Calculator inputs so the Edit page can
      // round-trip every field without needing 30+ schema columns.
      calc_snapshot: {
        warpCount, weftCount, totalEnds, picksPerInch, loomWidthIn,
        finishedWidthIn, reedCount, tapeLengthIn,
        warpRate, sizingRate, autoWarp, salesCommM,
        weftRate, autoWeft, weavingPaise,
        useBobbin, bobbinPrice, bobbinMetres, bobbinWaste, bobbinId,
        usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual,
        porvaiPick, selvedgeLengthIn, porvaiYarnCost, porvaiCountId,
        bagsPerM, emptyBeamPerM, sizedPaavuPerM, otherChargesPerM,
        profitPct, marketRate,
        isTowel, towelLength,
        showProd, loomRpm, efficiency,
        warpCountId, weftCountId, endsId,
      },
    };

    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb2 = supabase as any;
    const insertCosting = await sb2.from('costing_master').insert(payload).select('id, quality_code').single();
    if (insertCosting.error) {
      setSaving(false);
      setSaveError(insertCosting.error.message);
      return;
    }
    const generatedCode: string = insertCosting.data.quality_code ?? '';
    setSaving(false);
    setSaveOk('Saved costing ' + generatedCode + '.');
    setTimeout(() => {
      router.push('/app/costing');
      router.refresh();
    }, 800);
  }

  return (
    <div>
      <PageHeader
        title="New Costing"
        subtitle="Build the costing, then Save. The costing row is editable + can be marked active/inactive from the Costing list."
      />

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
              <L title="Inches of warp tape per metre of fabric - typically 39 to 42.">
                Tape Length (in/m) <Info className="inline w-3 h-3 text-ink-mute -mt-0.5" />
              </L>
              <Num value={tapeLengthIn} set={setTapeLengthIn} step={0.5} />
            </Row>
          </div>

          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">Warp rates</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Yarn (Rs/kg)</L><Num value={warpRate} set={setWarpRate} step={5} /></Row>
              <Row><L>Sizing (Rs/kg)</L><Num value={sizingRate} set={setSizingRate} step={1} /></Row>
              <Row><L>Auto / cone (Rs/kg)</L><Num value={autoWarp} set={setAutoWarp} step={0.5} /></Row>
              <Row><L>Sales commission (Rs/m)</L><Num value={salesCommM} set={setSalesCommM} step={0.1} /></Row>
            </div>
          </div>

          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">Weft rates</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Yarn (Rs/kg)</L><Num value={weftRate} set={setWeftRate} step={5} /></Row>
              <Row><L>Auto / cone (Rs/kg)</L><Num value={autoWeft} set={setAutoWeft} step={0.5} /></Row>
              <Row><L>Weaving (paise / pick)</L><Num value={weavingPaise} set={setWeavingPaise} step={0.5} /></Row>
            </div>
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include bobbin / cone cost" checked={useBobbin} set={setUseBobbin} />
            {useBobbin && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Bobbin price (Rs)</L><Num value={bobbinPrice} set={setBobbinPrice} step={50} /></Row>
                <Row><L>Bobbin metres</L><Num value={bobbinMetres} set={setBobbinMetres} step={50} /></Row>
                <Row><L>Waste add (Rs/m)</L><Num value={bobbinWaste} set={setBobbinWaste} step={0.05} /></Row>
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
                    <Row>
                      <L title="Count (NeC) = 5315 / Denier">
                        Denier <Info className="inline w-3 h-3 text-ink-mute -mt-0.5" />
                      </L>
                      <Num value={porvaiDenier} set={setPorvaiDenier} step={5} />
                    </Row>
                  ) : (
                    <Row><L>Porvai count (Ne)</L><Num value={porvaiCountManual} set={setPorvaiCountManual} step={0.5} /></Row>
                  )}
                  <Row><L>Porvai pick</L><Num value={porvaiPick} set={setPorvaiPick} /></Row>
                  <Row><L>Selvedge length (in)</L><Num value={selvedgeLengthIn} set={setSelvedgeLengthIn} step={0.25} /></Row>
                  <Row><L>Porvai yarn (Rs/kg)</L><Num value={porvaiYarnCost} set={setPorvaiYarnCost} step={5} /></Row>
                </div>
                {porvaiByDenier && (
                  <p className="text-[11px] text-ink-mute mt-1.5 italic">
                    Derived count (NeC) = {r.porvaiCount.toFixed(2)}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Mill overheads + Profit & market sections removed. */}

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Calculate for towel?" checked={isTowel} set={setIsTowel} />
            {isTowel && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Towel length (m)</L><Num value={towelLength} set={setTowelLength} step={0.05} /></Row>
              </div>
            )}
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Show production stats" checked={showProd} set={setShowProd} />
            {showProd && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Loom RPM</L><Num value={loomRpm} set={setLoomRpm} step={5} /></Row>
                <Row><L>Efficiency %</L><Pct value={efficiency} set={setEfficiency} /></Row>
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
          <ResultRow label="GSM (g/sq.m)" value={r.gramsPerSqM.toFixed(2)} small />
          {usePorvai && r.porvaiMPerKg > 0 && (
            <>
              <ResultRow label="Porvai m/kg" value={r.porvaiMPerKg.toFixed(2)} small />
              <ResultRow label="Wgt / m (porvai)" value={(1000 / r.porvaiMPerKg).toFixed(2) + ' g'} small />
            </>
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
              <ResultRow label="Weight / towel" value={(r.gramsPerTowel ?? 0).toFixed(1) + ' g'} small />
            </>
          )}

          {showProd && (
            <>
              <Divider />
              <h2 className="font-display font-bold text-base mb-2">Production</h2>
              <ResultRow label="Metres / day" value={r.metresPerDay.toFixed(1)} small />
              {isTowel && (<ResultRow label="Towels / day" value={r.towelsPerDay.toFixed(1)} small />)}
              <ResultRow label="Ends check (reed x width + 50)" value={r.endsCheck.toFixed(0)} small />
            </>
          )}
        </div>
      </div>

      {/* SAVE panel */}
      <div className="card p-5 mt-4 border border-indigo-200 bg-indigo-50/30">
        <h2 className="font-display font-bold text-base mb-1 flex items-center gap-2">
          <Save className="w-4 h-4 text-indigo" /> Save costing
        </h2>

        <p className="text-xs text-ink-mute mb-3">
          Saves this as a costing master row (status = active, pending approval). To create a new fabric, use Settings → Fabric Qualities → New.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Costing Code</label>
            <div className="input bg-cloud/40 text-ink-soft select-none">
              auto-generated on save
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="label">Costing Name *</label>
            <input className="input w-full" placeholder="e.g. Dobby Towel 31in"
              value={qualityName} onChange={(e) => setQualityName(e.target.value)} />
          </div>
          <div>
            <label className="label">Fabric Type</label>
            <div className="input bg-cloud/40 text-ink-soft select-none">{isTowel ? 'Towel' : 'Fabric'}</div>
          </div>
          <div>
            <label className="label">Warp Count *</label>
            <select className="input w-full" value={warpCountId}
              onChange={(e) => setWarpCountId(e.target.value)}>
              <option value="">--- pick ---</option>
              {counts.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">Weft Count *</label>
            <select className="input w-full" value={weftCountId}
              onChange={(e) => setWeftCountId(e.target.value)}>
              <option value="">--- pick ---</option>
              {counts.map((c) => (<option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">Ends spec</label>
            <select className="input w-full" value={endsId}
              onChange={(e) => setEndsId(e.target.value)}>
              <option value="">--- use form value ---</option>
              {endsOptions.map((e) => (
                <option key={e.id} value={String(e.id)}>{e.code} - {e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Bobbin</label>
            <select className="input w-full" value={bobbinId}
              onChange={(e) => setBobbinId(e.target.value)} disabled={useBobbin === false}>
              <option value="">--- none ---</option>
              {bobbins.map((b) => (
                <option key={b.id} value={String(b.id)}>{b.code} - {b.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Porvai yarn count</label>
            <select className="input w-full" value={porvaiCountId}
              onChange={(e) => setPorvaiCountId(e.target.value)} disabled={usePorvai === false}>
              <option value="">--- none ---</option>
              {counts.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>
              ))}
            </select>
          </div>
        </div>

        {saveError && <div className="mt-3 p-3 rounded-lg bg-red-50 text-err text-sm">{saveError}</div>}
        {saveOk && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> {saveOk}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-3">
          <button type="button" disabled={saving} onClick={handleSaveSubmit}
            className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save costing
          </button>
        </div>
      </div>
    </div>
  );
}

// small UI helpers
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
function Pct({ value, set }: { value: number; set: (n: number) => void }) {
  return (
    <div className="relative w-28">
      <input type="number" value={(value * 100).toFixed(2)} step={0.5}
        onChange={(e) => set(Number(e.target.value) / 100)}
        className="input num text-right h-8 text-sm pr-6" />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-mute">%</span>
    </div>
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
