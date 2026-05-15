// Quick Costing Calculator — matched to "Dobby towel cost calculation.xlsx"
//
// All formulas below are taken directly from the Excel that PPK TEX uses on
// the shop floor, so the on-screen numbers match what the supervisors are
// already used to.
//
// ─── WARP ────────────────────────────────────────────────────────────────
//   WARP_M_PER_KG = ((1848 × WarpCount) / TotalEnds) × 36 / TapeLength × 1.01
//                                                                       ^^^^ 1% waste
//   WARP_KG_PER_M = 1 / WARP_M_PER_KG
//   WARP_COST_M   = (WarpYarn + Sizing + Auto_warp + SalesCommission_kg) / WARP_M_PER_KG
//
// ─── WEFT ────────────────────────────────────────────────────────────────
//   WEFT_M_PER_KG = (1690 × WeftCount) / Pick / (LoomWidth + 3)
//                                                          ^^^ take-up allowance
//   WEFT_COST_M   = (WeftYarn + Auto_weft) / WEFT_M_PER_KG
//
// ─── WEAVING (PICK COST) ─────────────────────────────────────────────────
//   PICK_COST_M   = (Pick × PaisePerPick) / 100        (Excel: (I8 × I28)/100)
//
// ─── BOBBIN & WEFT COST (optional) ───────────────────────────────────────
//   BOBBIN_COST_M = (BobbinPrice / BobbinMetres) + Wastage      [Excel: I35/I37 + 0.1]
//
// ─── PORVAI / SELVEDGE COST (optional) ───────────────────────────────────
//   PORVAI_M_PER_KG = (1690 × PorvaiCount) / Pick / (SelvedgeLength + 3)
//   PORVAI_COST_M   = DenierYarnCost / PORVAI_M_PER_KG
//   (Denier → NeC : Count = 5315 / Denier)
//
// ─── TOTALS ──────────────────────────────────────────────────────────────
//   COST/M     = Warp + Weft + PickCost + Bobbin + Porvai + Overheads
//   PROFIT     = COST/M × Profit%
//   SELL/M     = COST/M + PROFIT          OR   user-entered market rate
//   PROFIT/LOSS (per m)  = MarketRate − COST/M       (if market rate given)
//
// ─── TOWEL MODE ──────────────────────────────────────────────────────────
//   COST/TOWEL = COST/M × TowelLength
//   WGT/TOWEL  = GramsPerM × TowelLength
//
// ─── PRODUCTION (optional) ───────────────────────────────────────────────
//   METRES/DAY  = (LoomRPM × 60 × 24 × Efficiency) / 39.37 / Pick    [Excel: D64]
//   TOWELS/DAY  = METRES/DAY / TowelLength
//   NO_OF_ENDS_check = Reed × FinishedWidth + 50        [Excel: D55]

'use client';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import { Calculator, Info } from 'lucide-react';

// ─── Default "auto" overhead rates (₹/m) ──────────────────────────────────────
const DEFAULT_BAGS_PER_M = 0.50;
const DEFAULT_EMPTY_BEAM_PER_M = 1.00;
const DEFAULT_SIZED_PAAVU_BEAM_PER_M = 1.50;

export default function CostingCalcPage() {
  // ─── Cloth construction (matches Excel D6, D8, D10, I6, I8, I10) ─────
  const [warpCount,    setWarpCount]    = useState(40);     // Ne     (Excel D6)
  const [weftCount,    setWeftCount]    = useState(39);     // Ne     (Excel I6)
  const [totalEnds,    setTotalEnds]    = useState(2400);   //        (Excel D8)
  const [picksPerInch, setPicksPerInch] = useState(46);     //        (Excel I8 / D60)
  const [loomWidthIn,  setLoomWidthIn]  = useState(31.5);   // in     (Excel I10 - fabric length)
  const [finishedWidthIn, setFinishedWidthIn] = useState(31); // in   (Excel D53 - for GSM & no-of-ends check)
  const [reedCount,    setReedCount]    = useState(72);     //        (Excel D51 - for ends check)
  const [tapeLengthIn, setTapeLengthIn] = useState(41.5);   // in/m   (Excel D10)

  // ─── Rates (warp side) ──────────────────────────────────────────────
  const [warpRate,    setWarpRate]    = useState(310);   // ₹/kg     (Excel D20)
  const [sizingRate,  setSizingRate]  = useState(26);    // ₹/kg     (Excel D22)
  const [autoWarp,    setAutoWarp]    = useState(2);     // ₹/kg     (Excel D26)
  const [salesCommM,  setSalesCommM]  = useState(0);     // ₹/m      (Excel D30)

  // ─── Rates (weft side) ──────────────────────────────────────────────
  const [weftRate,    setWeftRate]    = useState(285);   // ₹/kg     (Excel I20)
  const [autoWeft,    setAutoWeft]    = useState(2);     // ₹/kg     (Excel I22)

  // ─── Weaving (pick cost) ────────────────────────────────────────────
  const [weavingPaise, setWeavingPaise] = useState(16);  // paise/pick (Excel I28)

  // ─── Bobbin (optional, Excel G33-I39 block) ─────────────────────────
  const [useBobbin,    setUseBobbin]    = useState(true);
  const [bobbinPrice,  setBobbinPrice]  = useState(4704); // ₹       (Excel I35)
  const [bobbinMetres, setBobbinMetres] = useState(2000); // m       (Excel I37)
  const [bobbinWaste,  setBobbinWaste]  = useState(0.10); // ₹/m     (Excel I39 +0.1)

  // ─── Porvai / Selvedge (optional, Excel G41-I60 block) ──────────────
  const [usePorvai,         setUsePorvai]         = useState(true);
  const [porvaiByDenier,    setPorvaiByDenier]    = useState(true);
  const [porvaiDenier,      setPorvaiDenier]      = useState(150);  // D (Excel M5)
  const [porvaiCountManual, setPorvaiCountManual] = useState(35.43);
  const [porvaiPick,        setPorvaiPick]        = useState(46);   // (Excel I46)
  const [selvedgeLengthIn,  setSelvedgeLengthIn]  = useState(2.5);  // (Excel I48)
  const [porvaiYarnCost,    setPorvaiYarnCost]    = useState(195);  // (Excel I58)

  // ─── Mill overheads (auto-filled, editable) ─────────────────────────
  const [bagsPerM,         setBagsPerM]         = useState(DEFAULT_BAGS_PER_M);
  const [emptyBeamPerM,    setEmptyBeamPerM]    = useState(DEFAULT_EMPTY_BEAM_PER_M);
  const [sizedPaavuPerM,   setSizedPaavuPerM]   = useState(DEFAULT_SIZED_PAAVU_BEAM_PER_M);
  const [otherChargesPerM, setOtherChargesPerM] = useState(0);

  // ─── Margin / market rate ───────────────────────────────────────────
  const [profitPct,  setProfitPct]  = useState(0.10);
  const [marketRate, setMarketRate] = useState(0);   // ₹/m, 0 = ignore

  // ─── Towel mode ─────────────────────────────────────────────────────
  const [isTowel,     setIsTowel]     = useState(true);
  const [towelLength, setTowelLength] = useState(1.7);   // m   (Excel E37)

  // ─── Production stats (optional) ────────────────────────────────────
  const [showProd,    setShowProd]    = useState(true);
  const [loomRpm,     setLoomRpm]     = useState(110);
  const [efficiency,  setEfficiency]  = useState(0.85);  // (Excel D62)

  // ─── Compute everything ─────────────────────────────────────────────
  const r = useMemo(() => {
    // WARP weight per metre (Excel D12, with 1% waste)
    const warpMPerKg = warpCount > 0 && totalEnds > 0 && tapeLengthIn > 0
      ? ((1848 * warpCount) / totalEnds) * 36 / tapeLengthIn * 1.01
      : 0;
    const warpKgPerM = warpMPerKg > 0 ? 1 / warpMPerKg : 0;

    // WEFT weight per metre (Excel I12, with +3 take-up)
    const weftMPerKg = weftCount > 0 && picksPerInch > 0 && (loomWidthIn + 3) > 0
      ? (1690 * weftCount) / picksPerInch / (loomWidthIn + 3)
      : 0;
    const weftKgPerM = weftMPerKg > 0 ? 1 / weftMPerKg : 0;

    const gramsPerM   = (warpKgPerM + weftKgPerM) * 1000;
    const gramsPerSqM = finishedWidthIn > 0 ? (gramsPerM * 39.37) / finishedWidthIn : 0;

    // ─── COSTS PER METRE ─────────────────────────────────────────────
    // Warp (Excel D28): (yarn + sizing + auto) / (m/kg)  +  salesComm (₹/m)
    const warpCost = warpMPerKg > 0
      ? (warpRate + sizingRate + autoWarp) / warpMPerKg + salesCommM
      : 0;

    // Weft (Excel I24): (yarn + auto) / (m/kg)
    const weftCost = weftMPerKg > 0 ? (weftRate + autoWeft) / weftMPerKg : 0;

    // Weaving / pick cost (Excel I30): pick × paisePerPick / 100
    const pickCost = (picksPerInch * weavingPaise) / 100;

    // Bobbin (Excel I39): price/metres + wastage
    const bobbinCost = useBobbin && bobbinMetres > 0
      ? bobbinPrice / bobbinMetres + bobbinWaste
      : 0;

    // Porvai (Excel I50, I60)
    const porvaiCount = porvaiByDenier
      ? (porvaiDenier > 0 ? 5315 / porvaiDenier : 0)
      : porvaiCountManual;
    const porvaiMPerKg = usePorvai && porvaiCount > 0 && porvaiPick > 0 && (selvedgeLengthIn + 3) > 0
      ? (1690 * porvaiCount) / porvaiPick / (selvedgeLengthIn + 3)
      : 0;
    const porvaiCost = usePorvai && porvaiMPerKg > 0 ? porvaiYarnCost / porvaiMPerKg : 0;

    // Mill overheads
    const overheads = bagsPerM + emptyBeamPerM + sizedPaavuPerM + otherChargesPerM;

    // ─── TOTALS ──────────────────────────────────────────────────────
    const subtotal = warpCost + weftCost + pickCost + bobbinCost + porvaiCost + overheads;
    const profitAmount = subtotal * profitPct;
    const costPerM = subtotal + profitAmount;

    const profitLoss = marketRate > 0 ? marketRate - costPerM : null;

    const costPerTowel = isTowel ? costPerM * towelLength : null;
    const gramsPerTowel = isTowel ? gramsPerM * towelLength : null;

    // ─── PRODUCTION (Excel D64, D66) ─────────────────────────────────
    const metresPerDay = showProd && picksPerInch > 0
      ? (loomRpm * 60 * 24 * efficiency) / 39.37 / picksPerInch
      : 0;
    const towelsPerDay = showProd && isTowel && towelLength > 0
      ? metresPerDay / towelLength
      : 0;
    const endsCheck = reedCount * finishedWidthIn + 50; // Excel D55

    return {
      // weights
      warpMPerKg, warpKgPerM, weftMPerKg, weftKgPerM, gramsPerM, gramsPerSqM,
      // costs
      warpCost, weftCost, pickCost, bobbinCost, porvaiCost, overheads,
      bagsPerM, emptyBeamPerM, sizedPaavuPerM, otherChargesPerM,
      // totals
      subtotal, profitAmount, costPerM, profitLoss, costPerTowel, gramsPerTowel,
      // production
      metresPerDay, towelsPerDay, endsCheck, porvaiCount,
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

  return (
    <div>
      <PageHeader
        title="Fabric Costing Calculator"
        subtitle="Matches Dobby towel cost sheet — warp, weft, pick, bobbin, porvai, overheads, profit, towel & production."
      />

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
        {/* ─────────────── INPUTS ─────────────── */}
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
            <Row><L>Finished width (in)</L><Num value={finishedWidthIn} set={setFinishedWidthIn} step={0.5} /></Row>
            <Row><L>Reed</L><Num value={reedCount} set={setReedCount} /></Row>
            <Row>
              <L title="Inches of warp tape per metre of fabric — typically 39 to 42.">
                Tape Length (in/m) <Info className="inline w-3 h-3 text-ink-mute -mt-0.5" />
              </L>
              <Num value={tapeLengthIn} set={setTapeLengthIn} step={0.5} />
            </Row>
          </div>

          {/* Rates */}
          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">Warp rates</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Yarn (₹/kg)</L><Num value={warpRate} set={setWarpRate} step={5} /></Row>
              <Row><L>Sizing (₹/kg)</L><Num value={sizingRate} set={setSizingRate} step={1} /></Row>
              <Row><L>Auto / cone (₹/kg)</L><Num value={autoWarp} set={setAutoWarp} step={0.5} /></Row>
              <Row><L>Sales commission (₹/m)</L><Num value={salesCommM} set={setSalesCommM} step={0.1} /></Row>
            </div>
          </div>

          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">Weft rates</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Yarn (₹/kg)</L><Num value={weftRate} set={setWeftRate} step={5} /></Row>
              <Row><L>Auto / cone (₹/kg)</L><Num value={autoWeft} set={setAutoWeft} step={0.5} /></Row>
              <Row><L>Weaving (paise / pick)</L><Num value={weavingPaise} set={setWeavingPaise} step={0.5} /></Row>
            </div>
          </div>

          {/* Bobbin */}
          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include bobbin / cone cost" checked={useBobbin} set={setUseBobbin} />
            {useBobbin && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Bobbin price (₹)</L><Num value={bobbinPrice} set={setBobbinPrice} step={50} /></Row>
                <Row><L>Bobbin metres</L><Num value={bobbinMetres} set={setBobbinMetres} step={50} /></Row>
                <Row><L>Waste add (₹/m)</L><Num value={bobbinWaste} set={setBobbinWaste} step={0.05} /></Row>
              </div>
            )}
          </div>

          {/* Porvai */}
          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include porvai (selvedge)" checked={usePorvai} set={setUsePorvai} />
            {usePorvai && (
              <>
                <div className="mt-2 flex gap-2 text-xs">
                  <button
                    type="button"
                    className={`px-3 py-1.5 rounded-lg border ${porvaiByDenier ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-ink-soft border-line'}`}
                    onClick={() => setPorvaiByDenier(true)}
                  >
                    By denier
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 rounded-lg border ${!porvaiByDenier ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-ink-soft border-line'}`}
                    onClick={() => setPorvaiByDenier(false)}
                  >
                    By count (Ne)
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                  {porvaiByDenier ? (
                    <Row>
                      <L title="Count (NeC) = 5315 ÷ Denier">
                        Denier <Info className="inline w-3 h-3 text-ink-mute -mt-0.5" />
                      </L>
                      <Num value={porvaiDenier} set={setPorvaiDenier} step={5} />
                    </Row>
                  ) : (
                    <Row><L>Porvai count (Ne)</L><Num value={porvaiCountManual} set={setPorvaiCountManual} step={0.5} /></Row>
                  )}
                  <Row><L>Porvai pick</L><Num value={porvaiPick} set={setPorvaiPick} /></Row>
                  <Row><L>Selvedge length (in)</L><Num value={selvedgeLengthIn} set={setSelvedgeLengthIn} step={0.25} /></Row>
                  <Row><L>Porvai yarn (₹/kg)</L><Num value={porvaiYarnCost} set={setPorvaiYarnCost} step={5} /></Row>
                </div>
                {porvaiByDenier && (
                  <p className="text-[11px] text-ink-mute mt-1.5 italic">
                    Derived count (NeC) = {r.porvaiCount.toFixed(2)}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Mill overheads */}
          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">
              Mill overheads <span className="text-xs font-normal text-ink-mute">(auto-filled, editable)</span>
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Bags (₹/m)</L><Num value={bagsPerM} set={setBagsPerM} step={0.05} /></Row>
              <Row><L>Empty beams (₹/m)</L><Num value={emptyBeamPerM} set={setEmptyBeamPerM} step={0.05} /></Row>
              <Row><L>Sized paavu beam (₹/m)</L><Num value={sizedPaavuPerM} set={setSizedPaavuPerM} step={0.05} /></Row>
              <Row><L>Other charges (₹/m)</L><Num value={otherChargesPerM} set={setOtherChargesPerM} step={0.10} /></Row>
            </div>
          </div>

          {/* Profit / market */}
          <div className="border-t border-line/60 pt-3">
            <h3 className="font-display font-bold text-sm mb-2">Profit & market</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row><L>Profit %</L><Pct value={profitPct} set={setProfitPct} /></Row>
              <Row><L title="Optional. If set, profit/loss = market − cost.">Market rate (₹/m)</L><Num value={marketRate} set={setMarketRate} step={1} /></Row>
            </div>
          </div>

          {/* Towel mode */}
          <div className="border-t border-line/60 pt-3">
            <Toggle label="Calculate for towel?" checked={isTowel} set={setIsTowel} />
            {isTowel && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                <Row><L>Towel length (m)</L><Num value={towelLength} set={setTowelLength} step={0.05} /></Row>
              </div>
            )}
          </div>

          {/* Production */}
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

        {/* ─────────────── RESULTS ─────────────── */}
        <div className="card p-5 bg-gradient-to-br from-indigo-50/50 to-violet-50/30 self-start">
          <h2 className="font-display font-bold text-base mb-3">Derived weights</h2>
          <ResultRow label="Warp m/kg"       value={r.warpMPerKg.toFixed(2)} small />
          <ResultRow label="Weft m/kg"       value={r.weftMPerKg.toFixed(2)} small />
          <ResultRow label="Wgt / m (warp)"  value={`${(r.warpKgPerM * 1000).toFixed(2)} g`} small />
          <ResultRow label="Wgt / m (weft)"  value={`${(r.weftKgPerM * 1000).toFixed(2)} g`} small />
          <ResultRow label="Grams / metre"   value={`${r.gramsPerM.toFixed(2)} g`} small />
          <ResultRow label="GSM (g/sq.m)"    value={r.gramsPerSqM.toFixed(2)} small />

          <Divider />

          <h2 className="font-display font-bold text-base mb-3">Cost breakdown (₹ / m)</h2>
          <ResultRow label="Warp"             value={formatRupee(r.warpCost,    { decimals: 3 })} small />
          <ResultRow label="Weft"             value={formatRupee(r.weftCost,    { decimals: 3 })} small />
          <ResultRow label="Weaving (pick)"   value={formatRupee(r.pickCost,    { decimals: 3 })} small />
          {useBobbin && (
            <ResultRow label="Bobbin & weft"  value={formatRupee(r.bobbinCost,  { decimals: 3 })} small />
          )}
          {usePorvai && (
            <ResultRow label="Porvai"         value={formatRupee(r.porvaiCost,  { decimals: 3 })} small />
          )}
          <ResultRow label="Bags"             value={formatRupee(r.bagsPerM,    { decimals: 3 })} small />
          <ResultRow label="Empty beams"      value={formatRupee(r.emptyBeamPerM, { decimals: 3 })} small />
          <ResultRow label="Sized paavu beam" value={formatRupee(r.sizedPaavuPerM,{ decimals: 3 })} small />
          {r.otherChargesPerM > 0 && (
            <ResultRow label="Other charges"  value={formatRupee(r.otherChargesPerM, { decimals: 3 })} small />
          )}

          <Divider />
          <ResultRow label="Subtotal"
                     value={formatRupee(r.subtotal, { decimals: 2 })} />
          <ResultRow label={`Profit (${(profitPct * 100).toFixed(1)}%)`}
                     value={formatRupee(r.profitAmount, { decimals: 2 })} small />
          <Divider />
          <ResultRow label="Cost / metre"
                     value={formatRupee(r.costPerM, { decimals: 2 })}
                     highlight="indigo" big />

          {r.profitLoss !== null && (
            <ResultRow
              label={`P/L vs market ₹${marketRate}/m`}
              value={formatRupee(r.profitLoss, { decimals: 2 })}
              highlight={r.profitLoss >= 0 ? 'emerald' : 'amber'}
              small
            />
          )}

          {isTowel && r.costPerTowel !== null && (
            <>
              <Divider />
              <ResultRow
                label={`Cost / towel (${towelLength} m)`}
                value={formatRupee(r.costPerTowel, { decimals: 2 })}
                highlight="violet"
                big
              />
              <ResultRow
                label="Weight / towel"
                value={`${(r.gramsPerTowel ?? 0).toFixed(1)} g`}
                small
              />
            </>
          )}

          {showProd && (
            <>
              <Divider />
              <h2 className="font-display font-bold text-base mb-2">Production</h2>
              <ResultRow label="Metres / day"  value={r.metresPerDay.toFixed(1)} small />
              {isTowel && (
                <ResultRow label="Towels / day" value={r.towelsPerDay.toFixed(1)} small />
              )}
              <ResultRow label={`Ends check (reed × width + 50)`} value={r.endsCheck.toFixed(0)} small />
            </>
          )}

          <p className="mt-4 text-[11px] text-ink-mute italic leading-relaxed">
            Formulas mirror your Dobby towel Excel: warp m/kg = 1848·Ne·36 / ends / tape × 1.01 · weft m/kg = 1690·Ne / pick / (width+3) · pick cost = pick·paise / 100 · bobbin = price/m + 0.10 · porvai NeC = 5315/denier.
          </p>
        </div>
      </div>
    </div>
  );
}

// ───── small UI helpers ─────────────────────────────────────────────────
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[1fr_auto] items-center gap-2">{children}</div>;
}
function L({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className="text-xs text-ink-soft" title={title}>{children}</span>;
}
function Num({ value, set, step = 1 }: { value: number; set: (n: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      onChange={(e) => set(Number(e.target.value))}
      className="input num text-right h-8 text-sm w-28"
    />
  );
}
function Pct({ value, set }: { value: number; set: (n: number) => void }) {
  return (
    <div className="relative w-28">
      <input
        type="number"
        value={(value * 100).toFixed(2)}
        step={0.5}
        onChange={(e) => set(Number(e.target.value) / 100)}
        className="input num text-right h-8 text-sm pr-6"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-mute">%</span>
    </div>
  );
}
function Toggle({ label, checked, set }: { label: string; checked: boolean; set: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => set(e.target.checked)}
        className="w-4 h-4 accent-indigo-600"
      />
      <span>{label}</span>
    </label>
  );
}
function Divider() {
  return <div className="h-px bg-line/60 my-2" />;
}
function ResultRow({
  label, value, small, big, highlight,
}: {
  label: string;
  value: string;
  small?: boolean;
  big?: boolean;
  highlight?: 'indigo' | 'amber' | 'violet' | 'emerald';
}) {
  const tone = {
    indigo:  'text-indigo-700',
    amber:   'text-amber-700',
    violet:  'text-violet-700',
    emerald: 'text-emerald-700',
  }[highlight ?? 'indigo'];
  const size = big ? 'text-lg font-bold' : small ? 'text-sm text-ink-soft' : 'text-base font-semibold';
  return (
    <div className={`flex items-center justify-between py-1 ${size}`}>
      <span>{label}</span>
      <span className={`num ${highlight ? `${tone} font-bold` : ''}`}>{value}</span>
    </div>
  );
}
