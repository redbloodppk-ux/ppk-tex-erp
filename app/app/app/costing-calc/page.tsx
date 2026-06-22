// Quick Costing Calculator — pure calculator, no save. Mirrors the
// New Costing form field-for-field (mode toggle, multi-row bobbin,
// porvai) so the two pages feel identical; the only difference is
// this page never persists anything. Use /app/costing/new to save a
// costing master row.

'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import Link from 'next/link';
import { Calculator, Info, Plus } from 'lucide-react';

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

export default function CostingCalcPage() {
  const supabase = createClient();

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

  // Costing mode: 'inhouse' uses picks-per-inch × paise/100 for the
  // pick cost contribution. 'outsource' uses a single Rs/m rate the
  // outsource weaver charges.
  const [productionMode, setProductionMode] = useState<'inhouse' | 'outsource'>('inhouse');
  const [pickCostPerM, setPickCostPerM] = useState(7.36);

  const [useBobbin, setUseBobbin] = useState(true);
  const [bobbinRows, setBobbinRows] = useState<BobbinRow[]>([]);

  const [usePorvai, setUsePorvai] = useState(true);
  const [porvaiByDenier, setPorvaiByDenier] = useState(true);
  const [porvaiDenier, setPorvaiDenier] = useState(150);
  const [porvaiCountManual, setPorvaiCountManual] = useState(35.43);
  const [porvaiPick, setPorvaiPick] = useState(46);
  const [selvedgeLengthIn, setSelvedgeLengthIn] = useState(2.5);
  const [porvaiYarnCost, setPorvaiYarnCost] = useState(195);

  // Mill overheads + Profit & market were removed from the form (to
  // match New Costing). Kept as 0 constants so the calc still compiles
  // without those terms — they no longer contribute to cost.
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

  // Bobbin master list for the per-row picker (same source as New
  // Costing). Selection does not affect the math here — it only keeps
  // the field set identical to the savable page.
  const [bobbins, setBobbins] = useState<BobbinOption[]>([]);

  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const bb = await sb
        .from('bobbin')
        .select('id, code, description')
        .neq('status', 'archived')
        .order('code');
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
    // Pick cost contribution. Inhouse computes from picks-per-inch x
    // paise; outsource uses a direct Rs/m rate.
    const pickCost = productionMode === 'inhouse'
      ? (picksPerInch * weavingPaise) / 100
      : pickCostPerM;

    const bobbinCost = useBobbin
      ? bobbinRows.reduce((sum, row) => {
          if (row.metres > 0) return sum + row.price / row.metres + row.waste;
          return sum;
        }, 0)
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
    productionMode, pickCostPerM,
    useBobbin, bobbinRows,
    usePorvai, porvaiByDenier, porvaiDenier, porvaiCountManual, porvaiPick, selvedgeLengthIn, porvaiYarnCost,
    bagsPerM, emptyBeamPerM, sizedPaavuPerM, otherChargesPerM,
    profitPct, marketRate, isTowel, towelLength,
    showProd, loomRpm, efficiency,
  ]);

  return (
    <div>
      <PageHeader
        title="Fabric Costing Calculator"
        subtitle="Play with numbers — nothing is saved. Use New Costing to store a costing master row."
        actions={
          <Link href="/app/costing/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Costing
          </Link>
        }
      />

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="card p-5 space-y-4">
          {/* Mode toggle — picks whether the pick cost comes from
              picks-per-inch x paise (inhouse) or a direct Rs/m rate
              the outsource weaver charges (outsource). */}
          <div className="flex items-center gap-2 -mt-1 pb-2 border-b border-line/60">
            <span className="text-xs uppercase tracking-wide text-ink-mute">Mode:</span>
            <button
              type="button"
              onClick={() => setProductionMode('inhouse')}
              className={`px-3 py-1.5 rounded text-xs font-medium border ${
                productionMode === 'inhouse'
                  ? 'bg-indigo text-white border-indigo'
                  : 'bg-white text-ink-soft border-line hover:bg-cloud/60'
              }`}
            >
              In-house
            </button>
            <button
              type="button"
              onClick={() => setProductionMode('outsource')}
              className={`px-3 py-1.5 rounded text-xs font-medium border ${
                productionMode === 'outsource'
                  ? 'bg-indigo text-white border-indigo'
                  : 'bg-white text-ink-soft border-line hover:bg-cloud/60'
              }`}
            >
              Outsource
            </button>
            <span className="ml-2 text-[11px] text-ink-mute">
              {productionMode === 'inhouse'
                ? 'Mill weaves — picks × paise drives the pick cost.'
                : 'Outsource weaver — enter the Rs/m rate they charge.'}
            </span>
          </div>

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
              {productionMode === 'inhouse' ? (
                <Row><L>Weaving (paise / pick)</L><Num value={weavingPaise} set={setWeavingPaise} step={0.5} /></Row>
              ) : (
                <Row><L title="Outsource weaver's rate per metre. Replaces picks-per-inch x paise for the cost calc.">Pick cost (Rs/m)</L><Num value={pickCostPerM} set={setPickCostPerM} step={0.5} /></Row>
              )}
            </div>
          </div>

          <div className="border-t border-line/60 pt-3">
            <Toggle label="Include bobbin / cone cost" checked={useBobbin} set={setUseBobbin} />
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
                        onClick={() => setBobbinRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-xs text-rose-700 hover:text-rose-900 font-semibold">
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      <Row>
                        <L>Bobbin</L>
                        <select className="input h-8 text-sm w-56"
                          value={row.bobbinId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBobbinRows((prev) => prev.map((rw, i) =>
                              i === idx ? { ...rw, bobbinId: v } : rw,
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
                        <Num value={row.price} step={50}
                          set={(n) => setBobbinRows((prev) => prev.map((rw, i) =>
                            i === idx ? { ...rw, price: n } : rw,
                          ))} />
                      </Row>
                      <Row>
                        <L>Bobbin metres</L>
                        <Num value={row.metres} step={50}
                          set={(n) => setBobbinRows((prev) => prev.map((rw, i) =>
                            i === idx ? { ...rw, metres: n } : rw,
                          ))} />
                      </Row>
                      <Row>
                        <L>Waste add (Rs/m)</L>
                        <Num value={row.waste} step={0.05}
                          set={(n) => setBobbinRows((prev) => prev.map((rw, i) =>
                            i === idx ? { ...rw, waste: n } : rw,
                          ))} />
                      </Row>
                    </div>
                  </div>
                ))}
                <button type="button"
                  onClick={() => setBobbinRows((prev) => [...prev, newBobbinRow()])}
                  className={
                    'inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg border px-3 py-1.5 ' +
                    (bobbinRows.length === 0
                      ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                      : 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50')
                  }>
                  + Add bobbin
                </button>
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

      <p className="mt-4 text-[11px] text-ink-mute italic leading-relaxed">
        Formulas mirror your Dobby towel Excel: warp m/kg = 1848 x Ne x 36 / ends / tape x 1.01 . weft m/kg = 1690 x Ne / pick / (width+3) . pick cost = pick x paise / 100 . bobbin = price/m + 0.10 . porvai NeC = 5315 / denier.
      </p>
    </div>
  );
}

// small UI helpers
function Row({ children }: { children: React.ReactNode }) {
  // minmax(0,1fr) lets the label shrink/wrap instead of pushing the
  // fixed-width input out of the card on narrow phones; the input track
  // is capped at 5rem so the box always stays inside its column.
  return <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 min-w-0">{children}</div>;
}
function L({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className="text-xs text-ink-soft" title={title}>{children}</span>;
}
function Num({ value, set, step = 1 }: { value: number; set: (n: number) => void; step?: number }) {
  return (
    <input type="number" value={Number.isFinite(value) ? value : 0} step={step}
      onChange={(e) => set(Number(e.target.value))}
      className="input num text-right h-8 text-sm w-full min-w-0" />
  );
}
function Pct({ value, set }: { value: number; set: (n: number) => void }) {
  return (
    <div className="relative w-full min-w-0">
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
