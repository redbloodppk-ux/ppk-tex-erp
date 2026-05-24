'use client';
/**
 * New Costing Master  (CORR Group 2 · T-A15)
 * --------------------------------------------------------------------------
 * Tabbed form for creating a fabric quality (costing master row) with a live
 * Quoted Cost ₹/m preview pinned at the top.
 *
 * Build Guide T-A15 acceptance:
 *   - Tabbed: Identity / Warp / Weft / Bobbin / Porvai / Costs / Market
 *   - Live in-form preview of Quoted Cost ₹/m using lib/formulas (Decimal)
 *   - Save → costing_master row with save_path='formal', status='pending'
 *
 * True Cost preview is intentionally NOT shown here — that needs LOOMS
 * overhead from T-B12 (LOOMS Calibration screen, task #64). For now only
 * Quoted Cost is computed in-form. True Cost still comes from the DB view
 * v_costing_two_cost on the list page.
 *
 * Per Build Guide §1.4: yarn wastage default 2%, editable per costing.
 * No global setting page — it's just a column default.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import {
  warpCost, weftCost, pickCost, bobbinCost,
  porvaiCost, porvaiNeC, quotedCost,
} from '@/lib/formulas';
import { formatRupee } from '@/lib/utils';
import type { Database } from '@/lib/database.types';

type CostingInsert = Database['public']['Tables']['costing_master']['Insert'];

// ── types ──────────────────────────────────────────────────────────────────
type FabricType    = 'woven' | 'towel' | 'dupatta';
type ProductionMode = 'inhouse' | 'vendor' | 'both';
type TabId = 'identity' | 'warp' | 'weft' | 'bobbin' | 'porvai' | 'costs' | 'market';

interface YarnCount {
  id: number;
  code: string;
  display_name: string;
  yarn_type: 'cotton' | 'polyester' | 'blend';
  nec_computed: number | null;
  ne: number | null;
  denier: number | null;
}
interface Bobbin {
  id: number;
  code: string;
  description: string;
  bobbin_metre: number;
  bobbin_price: number;
  loading_per_metre: number;
  is_lurex: boolean;
}
interface WeightedAvg {
  yarn_count_id: number;
  weighted_avg_cost: number | null;
}

// ── defaults from FabricCosting_FrozenSpec_v1.1 + Build Guide §1.4 ─────────
const DEFAULTS = {
  yarn_wastage_pct:     '2',     // 2% — editable per costing (Build Guide §1.4)
  porvai_wastage_pct:   '2',
  shrinkage_pct:        '2',
  weft_allowance_m:     '2',
  selvedge_ends:        '0',
  bobbin_loading:       '0.10',
};

// ── helpers ────────────────────────────────────────────────────────────────
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const pctToDec = (s: string) => num(s) / 100;

export default function NewCostingPage() {
  const router = useRouter();
  const supabase = createClient();

  // ── master data ──────────────────────────────────────────────────────────
  const [counts,  setCounts]  = useState<YarnCount[]>([]);
  const [bobbins, setBobbins] = useState<Bobbin[]>([]);
  const [rates,   setRates]   = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);

  // ── form state ───────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>('identity');

  // Identity
  const [qualityCode, setQualityCode] = useState('');
  const [qualityName, setQualityName] = useState('');
  const [fabricType,  setFabricType]  = useState<FabricType>('woven');
  const [productionMode, setProductionMode] = useState<ProductionMode>('inhouse');
  const [notes, setNotes] = useState('');

  // Warp
  const [warpCountId,  setWarpCountId]  = useState('');
  const [warpEnds,     setWarpEnds]     = useState('');
  const [tapeLengthM,  setTapeLengthM]  = useState('');
  const [shrinkagePct, setShrinkagePct] = useState(DEFAULTS.shrinkage_pct);
  const [yarnWastagePct, setYarnWastagePct] = useState(DEFAULTS.yarn_wastage_pct);
  const [reedCount,    setReedCount]    = useState('');
  const [fabricWidthIn, setFabricWidthIn] = useState('');
  const [selvedgeEnds, setSelvedgeEnds] = useState(DEFAULTS.selvedge_ends);

  // Weft
  const [weftCountId,    setWeftCountId]    = useState('');
  const [pickPpi,        setPickPpi]        = useState('');
  const [fabricLengthM,  setFabricLengthM]  = useState('');
  const [weftAllowanceM, setWeftAllowanceM] = useState(DEFAULTS.weft_allowance_m);

  // Bobbin (up to 2)
  const [useBobbin1, setUseBobbin1] = useState(false);
  const [bobbin1Id,  setBobbin1Id]  = useState('');
  const [bobbin1Loading, setBobbin1Loading] = useState(DEFAULTS.bobbin_loading);
  const [useBobbin2, setUseBobbin2] = useState(false);
  const [bobbin2Id,  setBobbin2Id]  = useState('');
  const [bobbin2Loading, setBobbin2Loading] = useState(DEFAULTS.bobbin_loading);

  // Porvai (towel only)
  const [usePorvai, setUsePorvai] = useState(false);
  const [porvaiCountId, setPorvaiCountId] = useState('');
  const [porvaiSlevageM, setPorvaiSlevageM] = useState('');
  const [porvaiWastagePct, setPorvaiWastagePct] = useState(DEFAULTS.porvai_wastage_pct);

  // Costs (commissions, sizing, auto)
  const [sizingCostPerM,        setSizingCostPerM]        = useState('0');
  const [autoCostPerM,          setAutoCostPerM]          = useState('0');
  const [warpCommissionPerM,    setWarpCommissionPerM]    = useState('0');
  const [fabricCommissionPerM,  setFabricCommissionPerM]  = useState('0');
  const [vendorPickPaise,       setVendorPickPaise]       = useState('');

  // Market
  const [pickPaiseMarket, setPickPaiseMarket] = useState('');

  // ── ui state ─────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── load master data ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [c, b, wa] = await Promise.all([
        supabase.from('yarn_count')
          .select('id, code, display_name, yarn_type, nec_computed, ne, denier')
          .eq('status', 'active').order('code'),
        supabase.from('bobbin')
          .select('id, code, description, bobbin_metre, bobbin_price, loading_per_metre, is_lurex')
          .eq('status', 'active').order('code'),
        supabase.from('v_yarn_weighted_avg')
          .select('yarn_count_id, weighted_avg_cost'),
      ]);
      setCounts(c.data ?? []);
      setBobbins(b.data ?? []);
      const m = new Map<number, number>();
      (wa.data ?? []).forEach((r: any) => {
        if (r.weighted_avg_cost != null) m.set(r.yarn_count_id, Number(r.weighted_avg_cost));
      });
      setRates(m);
      setLoading(false);
    })();
  }, [supabase]);

  // Filter counts for the right purpose
  const cottonCounts   = useMemo(() => counts.filter(c => c.yarn_type === 'cotton'),    [counts]);
  const polyesterCounts = useMemo(() => counts.filter(c => c.yarn_type === 'polyester'), [counts]);

  // Helper: pull the live yarn rate (₹/kg) from the weighted-avg map, or 0
  const rateFor = (id: string) => id ? (rates.get(Number(id)) ?? 0) : 0;

  // ── live preview: Quoted Cost ──────────────────────────────────────────────
  // Recomputes on every keystroke. Cheap (pure Decimal arithmetic).
  const preview = useMemo(() => {
    const warpCt = counts.find(c => c.id === Number(warpCountId));
    const weftCt = counts.find(c => c.id === Number(weftCountId));
    const porvCt = counts.find(c => c.id === Number(porvaiCountId));
    const bob1   = bobbins.find(b => b.id === Number(bobbin1Id));
    const bob2   = bobbins.find(b => b.id === Number(bobbin2Id));

    const wPart = (warpCt && fabricWidthIn && reedCount) ? warpCost({
      ne:            warpCt.nec_computed ?? warpCt.ne ?? 0,
      reedCount:     num(reedCount),
      fabricWidthIn: num(fabricWidthIn),
      shrinkagePct:  pctToDec(shrinkagePct),
      ratePerKg:     rateFor(warpCountId),
      wastagePct:    pctToDec(yarnWastagePct),
    }) : null;

    const ftPart = (weftCt && fabricWidthIn && pickPpi) ? weftCost({
      ne:            weftCt.nec_computed ?? weftCt.ne ?? 0,
      pickPpi:       num(pickPpi),
      fabricWidthIn: num(fabricWidthIn),
      ratePerKg:     rateFor(weftCountId),
      wastagePct:    pctToDec(yarnWastagePct),
    }) : null;

    const pkPart = (pickPpi && fabricWidthIn && pickPaiseMarket) ? pickCost({
      pickPaise:     num(pickPaiseMarket),
      pickPpi:       num(pickPpi),
      fabricWidthIn: num(fabricWidthIn),
    }) : null;

    const b1Part = (useBobbin1 && bob1) ? bobbinCost({
      bobbinPrice:     bob1.bobbin_price,
      bobbinMetre:     bob1.bobbin_metre,
      loadingPerMetre: num(bobbin1Loading),
    }) : null;

    const b2Part = (useBobbin2 && bob2) ? bobbinCost({
      bobbinPrice:     bob2.bobbin_price,
      bobbinMetre:     bob2.bobbin_metre,
      loadingPerMetre: num(bobbin2Loading),
    }) : null;

    const pvPart = (usePorvai && porvCt && pickPpi && porvaiSlevageM) ? porvaiCost({
      neC:            porvCt.nec_computed ?? (porvCt.denier ? porvaiNeC(porvCt.denier).toNumber() : 0),
      pickPpi:        num(pickPpi),
      slevageLengthM: num(porvaiSlevageM),
      ratePerKg:      rateFor(porvaiCountId),
      wastagePct:     pctToDec(porvaiWastagePct),
    }) : null;

    const total = quotedCost({
      warpCost:               wPart ?? 0,
      weftCost:               ftPart ?? 0,
      porvaiCost:             pvPart ?? 0,
      bobbin1Cost:            b1Part ?? 0,
      bobbin2Cost:            b2Part ?? 0,
      pickCostMarket:         pkPart ?? 0,
      sizingCostPerM:         num(sizingCostPerM),
      autoCostPerM:           num(autoCostPerM),
      warpCommissionPerM:     num(warpCommissionPerM),
      fabricCommissionPerM:   num(fabricCommissionPerM),
    });

    return {
      warp:   wPart?.toNumber() ?? 0,
      weft:   ftPart?.toNumber() ?? 0,
      pick:   pkPart?.toNumber() ?? 0,
      bob1:   b1Part?.toNumber() ?? 0,
      bob2:   b2Part?.toNumber() ?? 0,
      porvai: pvPart?.toNumber() ?? 0,
      sizing: num(sizingCostPerM),
      auto:   num(autoCostPerM),
      wcom:   num(warpCommissionPerM),
      fcom:   num(fabricCommissionPerM),
      total:  total.toNumber(),
    };
  }, [
    counts, bobbins, rates,
    warpCountId, weftCountId, porvaiCountId,
    bobbin1Id, bobbin2Id, useBobbin1, useBobbin2, usePorvai,
    bobbin1Loading, bobbin2Loading,
    reedCount, fabricWidthIn, pickPpi, shrinkagePct, yarnWastagePct,
    porvaiSlevageM, porvaiWastagePct,
    pickPaiseMarket,
    sizingCostPerM, autoCostPerM, warpCommissionPerM, fabricCommissionPerM,
  ]);

  // Tab completion indicators (red dot if a required field is missing)
  const required = {
    identity: !!(qualityCode && qualityName),
    warp:     !!(warpCountId && tapeLengthM && reedCount && fabricWidthIn),
    weft:     !!(weftCountId && pickPpi && fabricLengthM),
    bobbin:   true, // optional
    porvai:   !usePorvai || !!(porvaiCountId && porvaiSlevageM),
    costs:    true, // optional
    market:   true, // can save without market rate, but preview won't show pick component
  };

  // ── submit ───────────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Cross-tab validation
    if (!required.identity) return setError('Identity tab: quality code and name are required.');
    if (!required.warp)     return setError('Warp tab: count, tape length, reed and width are required.');
    if (!required.weft)     return setError('Weft tab: count, pick (PPI) and fabric length are required.');
    if (!required.porvai)   return setError('Porvai tab: when enabled, count and slevage length are required.');
    if (fabricType !== 'towel' && usePorvai) {
      return setError('Porvai is only allowed on towels. Untick or change fabric type.');
    }
    if (useBobbin1 && !bobbin1Id) return setError('Bobbin 1 is enabled but no bobbin chosen.');
    if (useBobbin2 && !bobbin2Id) return setError('Bobbin 2 (lurex) is enabled but no bobbin chosen.');

    setBusy(true);

    const payload: CostingInsert = {
      quality_code:    qualityCode.trim(),
      quality_name:    qualityName.trim(),
      fabric_type:     fabricType,
      production_mode: productionMode,
      status:          'active',

      // Warp
      warp_count_id:    Number(warpCountId),
      warp_ends:        warpEnds ? Number(warpEnds) : null,
      tape_length_m:    num(tapeLengthM),
      shrinkage_pct:    pctToDec(shrinkagePct),
      yarn_wastage_pct: pctToDec(yarnWastagePct),

      // Weft
      weft_count_id:    Number(weftCountId),
      pick_ppi:         num(pickPpi),
      fabric_length_m:  num(fabricLengthM),
      weft_allowance_m: num(weftAllowanceM),

      // Reed / width
      reed_count:       Number(reedCount),
      fabric_width_in:  num(fabricWidthIn),
      selvedge_ends:    Number(selvedgeEnds) || 0,

      // Bobbin
      use_bobbin_1:     useBobbin1,
      bobbin_1_id:      useBobbin1 ? Number(bobbin1Id) : null,
      bobbin_1_loading: useBobbin1 ? num(bobbin1Loading) : null,
      use_bobbin_2:     useBobbin2,
      bobbin_2_id:      useBobbin2 ? Number(bobbin2Id) : null,
      bobbin_2_loading: useBobbin2 ? num(bobbin2Loading) : null,

      // Porvai
      use_porvai:               usePorvai,
      porvai_count_id:          usePorvai ? Number(porvaiCountId) : null,
      porvai_slevage_length_m:  usePorvai ? num(porvaiSlevageM) : null,
      porvai_wastage_pct:       pctToDec(porvaiWastagePct),

      // Cost rate inputs
      pick_paise_market:       pickPaiseMarket ? num(pickPaiseMarket) : null,
      vendor_pick_paise:       vendorPickPaise ? num(vendorPickPaise) : null,
      sizing_cost_per_m:       num(sizingCostPerM),
      auto_cost_per_m:         num(autoCostPerM),
      warp_commission_per_m:   num(warpCommissionPerM),
      fabric_commission_per_m: num(fabricCommissionPerM),

      // Provenance & approval (Build Guide T-B11: every formal save starts pending)
      save_path:       'formal',
      approval_status: 'pending',

      notes: notes.trim() || null,
    };

    const { error: insErr } = await supabase
      .from('costing_master')
      .insert(payload);

    setBusy(false);
    if (insErr) {
      // unique-violation on quality_code is the most likely cause
      return setError(insErr.message);
    }
    router.push('/app/costing');
    router.refresh();
  }

  // ── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-5xl">
        <PageHeader title="New Costing" crumbs={[{ label: 'Costing', href: '/app/costing' }, { label: 'New' }]} />
        <div className="card p-6 text-sm text-ink-soft">Loading yarn counts, bobbins, live rates…</div>
      </div>
    );
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: 'identity', label: 'Identity' },
    { id: 'warp',     label: 'Warp' },
    { id: 'weft',     label: 'Weft' },
    { id: 'bobbin',   label: 'Bobbin' },
    ...(fabricType === 'towel' ? [{ id: 'porvai' as TabId, label: 'Porvai' }] : []),
    { id: 'costs',    label: 'Costs' },
    { id: 'market',   label: 'Market' },
  ];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="New Costing"
        crumbs={[{ label: 'Costing', href: '/app/costing' }, { label: 'New' }]}
        subtitle="Saved as Pending Approval. Owner approves before this quality can be quoted."
      />

      {/* ── Live preview bar (pinned at top) ───────────────────────────────── */}
      <div className="card p-4 mb-4 bg-gradient-to-r from-indigo-50 to-violet-50 border-indigo/20">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-soft font-bold">Quoted Cost (live preview)</div>
            <div className="text-3xl font-bold text-indigo-700 num">
              {formatRupee(preview.total, { decimals: 2 })} <span className="text-sm text-ink-soft font-medium">/ m</span>
            </div>
          </div>
          <div className="text-[11px] text-ink-soft grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
            <span>Warp:    {preview.warp.toFixed(2)}</span>
            <span>Weft:    {preview.weft.toFixed(2)}</span>
            <span>Pick:    {preview.pick.toFixed(2)}</span>
            {(preview.bob1 > 0 || useBobbin1) && <span>Bobbin1: {preview.bob1.toFixed(2)}</span>}
            {(preview.bob2 > 0 || useBobbin2) && <span>Bobbin2: {preview.bob2.toFixed(2)}</span>}
            {(preview.porvai > 0 || usePorvai) && <span>Porvai:  {preview.porvai.toFixed(2)}</span>}
            {preview.sizing > 0 && <span>Sizing:  {preview.sizing.toFixed(2)}</span>}
            {preview.auto   > 0 && <span>Auto:    {preview.auto.toFixed(2)}</span>}
            {(preview.wcom + preview.fcom) > 0 && <span>Comm:    {(preview.wcom + preview.fcom).toFixed(2)}</span>}
          </div>
        </div>
        {!pickPaiseMarket && (
          <p className="text-[11px] text-amber-700 mt-2">
            Pick paise (market) not set yet — preview excludes pick cost. Enter it in the Market tab.
          </p>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-line/60">
        {TABS.map(t => {
          const ok = required[t.id as keyof typeof required];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
                tab === t.id
                  ? 'border-indigo text-indigo-700'
                  : 'border-transparent text-ink-soft hover:text-ink'
              }`}
            >
              {t.label}
              {!ok && <span className="ml-1.5 inline-block w-1.5 h-1.5 bg-rose-500 rounded-full" />}
            </button>
          );
        })}
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        {/* ── IDENTITY ──────────────────────────────────────────────────── */}
        {tab === 'identity' && (
          <div className="card p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Quality Code *</label>
                <input
                  value={qualityCode} onChange={e => setQualityCode(e.target.value.toUpperCase())}
                  className="input num" placeholder="120HT" required
                />
                <p className="text-[11px] text-ink-mute mt-1">Short, unique. Used on every invoice.</p>
              </div>
              <div>
                <label className="label">Quality Name *</label>
                <input
                  value={qualityName} onChange={e => setQualityName(e.target.value)}
                  className="input" placeholder="120GSM HT cotton towel" required
                />
              </div>
              <div>
                <label className="label">Fabric Type *</label>
                <select value={fabricType} onChange={e => {
                  const ft = e.target.value as FabricType;
                  setFabricType(ft);
                  if (ft !== 'towel') setUsePorvai(false);
                }} className="input">
                  <option value="woven">Woven (plain fabric)</option>
                  <option value="towel">Towel (can have porvai)</option>
                  <option value="dupatta">Dupatta</option>
                </select>
              </div>
              <div>
                <label className="label">Production Mode *</label>
                <select value={productionMode} onChange={e => setProductionMode(e.target.value as ProductionMode)} className="input">
                  <option value="inhouse">In-house only</option>
                  <option value="vendor">Outsourced only</option>
                  <option value="both">Both (in-house + outsourced)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="input" placeholder="Optional construction notes, customer fit, etc." />
            </div>
          </div>
        )}

        {/* ── WARP ──────────────────────────────────────────────────────── */}
        {tab === 'warp' && (
          <div className="card p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Warp Count *</label>
                <select required value={warpCountId} onChange={e => setWarpCountId(e.target.value)} className="input">
                  <option value="" disabled>Select cotton count…</option>
                  {cottonCounts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.display_name} (Ne {c.nec_computed ?? c.ne})
                    </option>
                  ))}
                </select>
                {warpCountId && (
                  <p className="text-[11px] text-ink-mute mt-1">
                    Live rate: <span className="font-mono">₹{rateFor(warpCountId).toFixed(2)}/kg</span>
                  </p>
                )}
              </div>
              <div>
                <label className="label">Warp Ends</label>
                <input type="number" min={1} value={warpEnds} onChange={e => setWarpEnds(e.target.value)}
                  className="input num" placeholder="auto if blank (Reed × Width)" />
              </div>
              <div>
                <label className="label">Tape Length (m) *</label>
                <input type="number" step="0.01" min={0.01} required value={tapeLengthM}
                  onChange={e => setTapeLengthM(e.target.value)} className="input num" placeholder="1200" />
              </div>
              <div>
                <label className="label">Reed Count *</label>
                <input type="number" min={1} required value={reedCount}
                  onChange={e => setReedCount(e.target.value)} className="input num" placeholder="72" />
              </div>
              <div>
                <label className="label">Fabric Width (in) *</label>
                <input type="number" step="0.1" min={1} required value={fabricWidthIn}
                  onChange={e => setFabricWidthIn(e.target.value)} className="input num" placeholder="53" />
              </div>
              <div>
                <label className="label">Selvedge Ends</label>
                <input type="number" min={0} value={selvedgeEnds}
                  onChange={e => setSelvedgeEnds(e.target.value)} className="input num" />
              </div>
              <div>
                <label className="label">Shrinkage %</label>
                <input type="number" step="0.01" min={0} max={20} value={shrinkagePct}
                  onChange={e => setShrinkagePct(e.target.value)} className="input num" />
                <p className="text-[11px] text-ink-mute mt-1">Typically 2%. Increases warp metre requirement.</p>
              </div>
              <div>
                <label className="label">Yarn Wastage %</label>
                <input type="number" step="0.01" min={0} max={20} value={yarnWastagePct}
                  onChange={e => setYarnWastagePct(e.target.value)} className="input num" />
                <p className="text-[11px] text-ink-mute mt-1">
                  Default 2% per Build Guide §1.4. Applies to warp + weft.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── WEFT ──────────────────────────────────────────────────────── */}
        {tab === 'weft' && (
          <div className="card p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Weft Count *</label>
                <select required value={weftCountId} onChange={e => setWeftCountId(e.target.value)} className="input">
                  <option value="" disabled>Select cotton count…</option>
                  {cottonCounts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.display_name} (Ne {c.nec_computed ?? c.ne})
                    </option>
                  ))}
                </select>
                {weftCountId && (
                  <p className="text-[11px] text-ink-mute mt-1">
                    Live rate: <span className="font-mono">₹{rateFor(weftCountId).toFixed(2)}/kg</span>
                  </p>
                )}
              </div>
              <div>
                <label className="label">Pick (PPI) *</label>
                <input type="number" step="0.01" min={1} required value={pickPpi}
                  onChange={e => setPickPpi(e.target.value)} className="input num" placeholder="60" />
                <p className="text-[11px] text-ink-mute mt-1">Picks per inch.</p>
              </div>
              <div>
                <label className="label">Fabric Length (m) *</label>
                <input type="number" step="0.01" min={0.01} required value={fabricLengthM}
                  onChange={e => setFabricLengthM(e.target.value)} className="input num" />
                <p className="text-[11px] text-ink-mute mt-1">Towel length or fabric piece length.</p>
              </div>
              <div>
                <label className="label">Weft Allowance (m)</label>
                <input type="number" step="0.01" min={0} value={weftAllowanceM}
                  onChange={e => setWeftAllowanceM(e.target.value)} className="input num" />
              </div>
            </div>
          </div>
        )}

        {/* ── BOBBIN ────────────────────────────────────────────────────── */}
        {tab === 'bobbin' && (
          <div className="card p-6 space-y-4">
            <p className="text-xs text-ink-soft">
              Bobbins are small warp beams that run 1:1 with fabric metres. Optional.
              You can use up to 2 (the 2nd is typically lurex / decorative).
            </p>
            {/* Bobbin 1 */}
            <div className="rounded-lg border border-line/60 p-4">
              <label className="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" checked={useBobbin1} onChange={e => setUseBobbin1(e.target.checked)} />
                <span className="font-semibold">Use Bobbin 1</span>
              </label>
              {useBobbin1 && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Bobbin *</label>
                    <select required value={bobbin1Id} onChange={e => setBobbin1Id(e.target.value)} className="input">
                      <option value="" disabled>Select bobbin…</option>
                      {bobbins.filter(b => !b.is_lurex).map(b => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.description} (₹{Number(b.bobbin_price).toFixed(2)} / {Number(b.bobbin_metre).toFixed(0)}m)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Loading ₹/m</label>
                    <input type="number" step="0.0001" min={0} value={bobbin1Loading}
                      onChange={e => setBobbin1Loading(e.target.value)} className="input num" />
                  </div>
                </div>
              )}
            </div>
            {/* Bobbin 2 */}
            <div className="rounded-lg border border-line/60 p-4">
              <label className="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" checked={useBobbin2} onChange={e => setUseBobbin2(e.target.checked)} />
                <span className="font-semibold">Use Bobbin 2 (lurex)</span>
              </label>
              {useBobbin2 && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Bobbin *</label>
                    <select required value={bobbin2Id} onChange={e => setBobbin2Id(e.target.value)} className="input">
                      <option value="" disabled>Select bobbin…</option>
                      {bobbins.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.description} (₹{Number(b.bobbin_price).toFixed(2)} / {Number(b.bobbin_metre).toFixed(0)}m)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Loading ₹/m</label>
                    <input type="number" step="0.0001" min={0} value={bobbin2Loading}
                      onChange={e => setBobbin2Loading(e.target.value)} className="input num" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PORVAI (towels only) ──────────────────────────────────────── */}
        {tab === 'porvai' && fabricType === 'towel' && (
          <div className="card p-6 space-y-4">
            <p className="text-xs text-ink-soft">
              Porvai is the polyester selvedge used on towels. Denier → NeC via 5315/Denier (Build Guide §1.4).
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={usePorvai} onChange={e => setUsePorvai(e.target.checked)} />
              <span className="font-semibold">Use Porvai</span>
            </label>
            {usePorvai && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Porvai Count (polyester) *</label>
                  <select required value={porvaiCountId} onChange={e => setPorvaiCountId(e.target.value)} className="input">
                    <option value="" disabled>Select polyester count…</option>
                    {polyesterCounts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.display_name} ({c.denier}D → NeC {c.nec_computed?.toFixed(2)})
                      </option>
                    ))}
                  </select>
                  {porvaiCountId && (
                    <p className="text-[11px] text-ink-mute mt-1">
                      Live rate: <span className="font-mono">₹{rateFor(porvaiCountId).toFixed(2)}/kg</span>
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Slevage Length (m) *</label>
                  <input type="number" step="0.01" min={0.01} required value={porvaiSlevageM}
                    onChange={e => setPorvaiSlevageM(e.target.value)} className="input num" />
                </div>
                <div>
                  <label className="label">Porvai Wastage %</label>
                  <input type="number" step="0.01" min={0} max={20} value={porvaiWastagePct}
                    onChange={e => setPorvaiWastagePct(e.target.value)} className="input num" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── COSTS ─────────────────────────────────────────────────────── */}
        {tab === 'costs' && (
          <div className="card p-6 space-y-4">
            <p className="text-xs text-ink-soft">
              Additional ₹/m components. Leave blank if not applicable.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Sizing Cost ₹/m</label>
                <input type="number" step="0.0001" min={0} value={sizingCostPerM}
                  onChange={e => setSizingCostPerM(e.target.value)} className="input num" />
                <p className="text-[11px] text-ink-mute mt-1">Will be replaced by sizing_job link in T-B5 follow-up.</p>
              </div>
              <div>
                <label className="label">Auto Cost ₹/m</label>
                <input type="number" step="0.0001" min={0} value={autoCostPerM}
                  onChange={e => setAutoCostPerM(e.target.value)} className="input num" />
              </div>
              <div>
                <label className="label">Warp Commission ₹/m</label>
                <input type="number" step="0.0001" min={0} value={warpCommissionPerM}
                  onChange={e => setWarpCommissionPerM(e.target.value)} className="input num" />
              </div>
              <div>
                <label className="label">Fabric Commission ₹/m</label>
                <input type="number" step="0.0001" min={0} value={fabricCommissionPerM}
                  onChange={e => setFabricCommissionPerM(e.target.value)} className="input num" />
              </div>
              <div>
                <label className="label">Vendor Pick Paise (for True Cost when outsourced)</label>
                <input type="number" step="0.0001" min={0} value={vendorPickPaise}
                  onChange={e => setVendorPickPaise(e.target.value)} className="input num"
                  placeholder="leave blank if in-house only" />
                <p className="text-[11px] text-ink-mute mt-1">
                  Used for True Cost when production_mode is &quot;vendor&quot;. In-house uses LOOMS overhead instead.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── MARKET ────────────────────────────────────────────────────── */}
        {tab === 'market' && (
          <div className="card p-6 space-y-4">
            <p className="text-xs text-ink-soft">
              Market pick rate drives the <strong>Quoted Cost</strong>. The True Cost uses LOOMS overhead
              (in-house) or vendor pick (outsourced) instead.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Pick Paise — Market *</label>
                <input type="number" step="0.0001" min={0} value={pickPaiseMarket}
                  onChange={e => setPickPaiseMarket(e.target.value)} className="input num"
                  placeholder="0.45" />
                <p className="text-[11px] text-ink-mute mt-1">
                  Pick cost ₹/m = pickPaise × PPI × width / 100
                </p>
              </div>
            </div>
          </div>
        )}

        {error && <div className="card p-3 bg-red-50 text-err text-sm">{error}</div>}

        <div className="flex justify-between items-center">
          <p className="text-xs text-ink-soft">
            Red dot on a tab = required field missing. Saved with status <strong>Pending Approval</strong>.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => router.back()} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Saving…' : 'Save Costing'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
