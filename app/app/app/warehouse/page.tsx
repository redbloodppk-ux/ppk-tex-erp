/**
 * Warehouse — Unified Stock View (Sprint 2 Phase 1, read-only)
 *
 * Three stock systems on one page:
 *   1. Yarn lots (kg)       — aggregated by (mill, count) via v_yarn_weighted_avg
 *   2. Bobbin stock (pcs)   — aggregated by (bobbin, location) from bobbin_stock
 *   3. Fabric stock (m)     — aggregated by (quality, source) from fabric_stock
 *
 * Plus a Low-Stock Alerts panel on top that scans yarn_count.reorder_kg
 * and bobbin.reorder_pieces.
 *
 * URL params: ?tab=yarn|bobbin|fabric&mill=ID&customer=ID&count=ID&location=KEY
 *
 * Phase 2 (stock adjustments, bobbin transfers) and Phase 3 (Delivery
 * Challan generation) are tracked as separate tasks — this page is
 * read-only for now.
 */

import Link from 'next/link';
import { Boxes, Package, Layers, AlertTriangle, Coins, TrendingDown, Factory, Truck, Ruler } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatKg, formatMetres, formatRupee } from '@/lib/utils';

export const metadata = { title: 'Warehouse — Unified Stock' };

type Mode = 'inhouse' | 'jobwork';

const MODE_TABS = [
  { key: 'inhouse', label: 'In-house Stock', icon: Factory },
  { key: 'jobwork', label: 'Job Work Stock', icon: Truck   },
] as const;

const INHOUSE_TABS = [
  { key: 'yarn',   label: 'Yarn (kg)',     icon: Boxes   },
  { key: 'bobbin', label: 'Bobbins (pcs)', icon: Package },
  { key: 'fabric', label: 'Fabric (m)',    icon: Layers  },
] as const;

const JOBWORK_TABS = [
  { key: 'warp_beam', label: 'Warp Beam (m)', icon: Ruler   },
  { key: 'weft_yarn', label: 'Weft Yarn (kg)', icon: Boxes   },
  { key: 'bobbin',    label: 'Bobbins (pcs)',  icon: Package },
  { key: 'fabric',    label: 'Fabric (m)',     icon: Layers  },
] as const;

type InhouseSubTab = typeof INHOUSE_TABS[number]['key'];
type JobworkSubTab = typeof JOBWORK_TABS[number]['key'];

const LOCATION_LABEL: Record<string, string> = {
  main_godown:    'Main Godown',
  at_vendor:      'At Vendor',
  customer_owned: 'Customer Owned',
};

const LOCATION_PILL: Record<string, string> = {
  main_godown:    'bg-emerald-50 text-emerald-700',
  at_vendor:      'bg-amber-50 text-amber-700',
  customer_owned: 'bg-violet-50 text-violet-700',
};

const SOURCE_LABEL: Record<string, string> = {
  inhouse:    'In-house',
  outsourced: 'Outsourced',
  jobwork:    'Job Work',
  resale:     'Resale',
};

const SOURCE_PILL: Record<string, string> = {
  inhouse:    'bg-indigo-50 text-indigo-700',
  outsourced: 'bg-amber-50 text-amber-700',
  jobwork:    'bg-emerald-50 text-emerald-700',
  resale:     'bg-slate-100 text-slate-700',
};

type SP = {
  mode?: string;
  tab?: string;
  mill?: string;
  customer?: string;
  count?: string;
  location?: string;
  party?: string;
  quality?: string;
};

/** Build URL with one param replaced — used by tab links and filter form. */
function withParam(sp: SP, key: keyof SP, value?: string) {
  const next = new URLSearchParams();
  Object.entries(sp).forEach(([k, v]) => { if (v && k !== key) next.set(k, v); });
  if (value) next.set(key, value);
  const qs = next.toString();
  return qs ? `/app/warehouse?${qs}` : '/app/warehouse';
}

/** Build URL when switching the parent mode - resets the sub-tab + filters
 *  because filters from inhouse mode (mill / yarn count) don't apply to
 *  jobwork mode (party / fabric quality) and vice versa. */
function withMode(mode: Mode) {
  return `/app/warehouse?mode=${mode}`;
}

export default async function WarehousePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const mode: Mode = sp.mode === 'jobwork' ? 'jobwork' : 'inhouse';
  // Pick a default sub-tab based on mode if none specified.
  const defaultTab = mode === 'jobwork' ? 'warp_beam' : 'yarn';
  const tab = (sp.tab ?? defaultTab);
  const supabase = await createClient();

  // ─── Master data for filters (small tables, fetch all in parallel) ────────
  const [
    { data: mills },
    { data: customers },
    { data: counts },
    { data: bobbinMasters },
    { data: jobworkParties },
    { data: fabricQualities },
  ] = await Promise.all([
    supabase.from('mill').select('id, name').eq('status', 'active').order('name'),
    supabase.from('customer').select('id, name').eq('status', 'active').order('name'),
    supabase.from('yarn_count').select('id, code, display_name, reorder_kg').eq('status', 'active').order('code'),
    supabase.from('bobbin').select('id, code, description, reorder_pieces').eq('status', 'active').order('code'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('jobwork_party').select('id, code, name').eq('status', 'active').order('name'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('fabric_quality').select('id, code, name').eq('active', true).order('name'),
  ]);

  // ─── Low-stock alerts (cross-cutting, in-house only) ──────────────────────
  // Alerts cover yarn_count.reorder_kg and bobbin.reorder_pieces which
  // belong to in-house stock; we hide the panel in jobwork mode.
  const lowStock = mode === 'inhouse'
    ? await computeLowStock(supabase, counts ?? [], bobbinMasters ?? [])
    : { yarn: [], bobbin: [] };

  // ─── Tab-specific data ────────────────────────────────────────────────────
  // In-house loaders use existing tables; jobwork loaders hit
  // jobwork_warp_beam / jobwork_weft_bag / bobbin(production_mode='jobwork') /
  // fabric_stock(source_type='jobwork').
  const yarnRows     = mode === 'inhouse' && tab === 'yarn'      ? await loadYarn(supabase, sp, mills ?? [], counts ?? []) : null;
  const bobbinRows   = tab === 'bobbin'    ? await loadBobbin(supabase, sp, mills ?? [], customers ?? [], bobbinMasters ?? [], mode) : null;
  const fabricRows   = tab === 'fabric'    ? await loadFabric(supabase, sp, mode) : null;
  const warpBeamRows = mode === 'jobwork' && tab === 'warp_beam' ? await loadJobworkWarpBeam(supabase, sp, jobworkParties ?? [], fabricQualities ?? [], counts ?? []) : null;
  const weftYarnRows = mode === 'jobwork' && tab === 'weft_yarn' ? await loadJobworkWeftYarn(supabase, sp, jobworkParties ?? [], counts ?? []) : null;

  const subTabs = mode === 'jobwork' ? JOBWORK_TABS : INHOUSE_TABS;

  return (
    <div>
      <PageHeader
        title="Warehouse — Unified Stock"
        subtitle="In-house and Job Work stock on one screen. Switch mode using the tabs below."
      />

      {/* ── Parent mode tabs (in-house vs jobwork) ───────────────────── */}
      <div className="mb-4 flex flex-wrap gap-2">
        {MODE_TABS.map((m) => {
          const Icon = m.icon;
          const active = mode === m.key;
          return (
            <Link
              key={m.key}
              href={withMode(m.key)}
              className={`px-4 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 transition-colors ${
                active
                  ? 'bg-indigo text-white border-indigo shadow-sm'
                  : 'bg-paper text-ink-soft border-line hover:bg-haze hover:text-ink'
              }`}
            >
              <Icon className="w-4 h-4" />
              {m.label}
            </Link>
          );
        })}
      </div>

      {/* ── Low-stock alerts panel ─────────────────────────────────────── */}
      {(lowStock.yarn.length > 0 || lowStock.bobbin.length > 0) && (
        <section className="card border-rose-200 bg-rose-50/30 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <div className="font-semibold text-sm text-rose-700">
              Low Stock Alerts ({lowStock.yarn.length + lowStock.bobbin.length})
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {lowStock.yarn.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-1.5">
                  Yarn counts below reorder level
                </div>
                <ul className="space-y-1 text-sm">
                  {lowStock.yarn.map(item => (
                    <li key={item.id} className="flex justify-between gap-3 px-2 py-1 rounded hover:bg-paper/60">
                      <span className="truncate">
                        <span className="font-semibold">{item.code}</span>
                        <span className="text-ink-soft text-xs ml-2">{item.display_name}</span>
                      </span>
                      <span className="num text-rose-600 font-semibold whitespace-nowrap">
                        {formatKg(item.on_hand_kg, 1)}
                        <span className="text-ink-mute font-normal"> / {formatKg(item.reorder_kg, 0)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {lowStock.bobbin.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-1.5">
                  Bobbins below reorder level
                </div>
                <ul className="space-y-1 text-sm">
                  {lowStock.bobbin.map(item => (
                    <li key={item.id} className="flex justify-between gap-3 px-2 py-1 rounded hover:bg-paper/60">
                      <span className="truncate">
                        <span className="font-semibold">{item.code}</span>
                        <span className="text-ink-soft text-xs ml-2">{item.description}</span>
                      </span>
                      <span className="num text-rose-600 font-semibold whitespace-nowrap">
                        {Number(item.on_hand_pcs).toFixed(2)} pcs
                        <span className="text-ink-mute font-normal"> / {Number(item.reorder_pieces).toFixed(0)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Sub-tabs ───────────────────────────────────────────────────── */}
      <div className="border-b border-line/60 mb-4 flex flex-wrap gap-1">
        {subTabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={withParam({ mode }, 'tab', t.key)}
              className={`px-4 py-2.5 -mb-px border-b-2 text-sm font-medium flex items-center gap-2 transition-colors ${
                active
                  ? 'border-indigo text-indigo'
                  : 'border-transparent text-ink-soft hover:text-ink hover:border-line'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* ── Filter row ─────────────────────────────────────────────────── */}
      <form className="card p-3 mb-4 flex flex-wrap items-end gap-3" method="GET">
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="tab" value={tab} />

        {mode === 'inhouse' && (tab === 'yarn' || tab === 'bobbin') && (
          <FilterSelect
            name="mill"
            label={tab === 'yarn' ? 'Mill (yarn supplier)' : 'Vendor (bobbin supplier)'}
            value={sp.mill}
            options={(mills ?? []).map(m => ({ value: String(m.id), label: m.name }))}
          />
        )}

        {mode === 'inhouse' && tab === 'bobbin' && (
          <>
            <FilterSelect
              name="location"
              label="Location"
              value={sp.location}
              options={[
                { value: 'main_godown',    label: 'Main Godown'    },
                { value: 'at_vendor',      label: 'At Vendor'      },
                { value: 'customer_owned', label: 'Customer Owned' },
              ]}
            />
            <FilterSelect
              name="customer"
              label="Customer (for customer-owned)"
              value={sp.customer}
              options={(customers ?? []).map(c => ({ value: String(c.id), label: c.name }))}
            />
          </>
        )}

        {mode === 'inhouse' && tab === 'yarn' && (
          <FilterSelect
            name="count"
            label="Yarn Count"
            value={sp.count}
            options={(counts ?? []).map(c => ({ value: String(c.id), label: c.code }))}
          />
        )}

        {/* Jobwork filters: party + yarn count / fabric quality depending
            on tab. Party applies to all four jobwork sub-tabs. */}
        {mode === 'jobwork' && (
          <FilterSelect
            name="party"
            label="Jobwork Party"
            value={sp.party}
            options={(jobworkParties ?? []).map((p: { id: number; code: string; name: string }) => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
          />
        )}

        {mode === 'jobwork' && (tab === 'warp_beam' || tab === 'fabric') && (
          <FilterSelect
            name="quality"
            label="Fabric Quality"
            value={sp.quality}
            options={(fabricQualities ?? []).map((q: { id: number; code: string; name: string }) => ({ value: String(q.id), label: `${q.code} - ${q.name}` }))}
          />
        )}

        {mode === 'jobwork' && (tab === 'warp_beam' || tab === 'weft_yarn') && (
          <FilterSelect
            name="count"
            label="Yarn Count"
            value={sp.count}
            options={(counts ?? []).map(c => ({ value: String(c.id), label: c.code }))}
          />
        )}

        <button type="submit" className="btn-sm bg-indigo text-white hover:bg-indigo/90">
          Apply
        </button>
        {(sp.mill || sp.customer || sp.count || sp.location || sp.party || sp.quality) && (
          <Link href={`/app/warehouse?mode=${mode}&tab=${tab}`} className="btn-sm bg-cloud text-ink-soft hover:bg-cloud/80">
            Clear
          </Link>
        )}
      </form>

      {/* ── Tab body ───────────────────────────────────────────────────── */}
      {mode === 'inhouse' && tab === 'yarn'      && <YarnView rows={yarnRows!} />}
      {mode === 'inhouse' && tab === 'bobbin'    && <BobbinView rows={bobbinRows!} />}
      {mode === 'inhouse' && tab === 'fabric'    && <FabricView rows={fabricRows!} />}
      {mode === 'jobwork' && tab === 'warp_beam' && <WarpBeamView rows={warpBeamRows!} />}
      {mode === 'jobwork' && tab === 'weft_yarn' && <WeftYarnView rows={weftYarnRows!} />}
      {mode === 'jobwork' && tab === 'bobbin'    && <BobbinView rows={bobbinRows!} />}
      {mode === 'jobwork' && tab === 'fabric'    && <FabricView rows={fabricRows!} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — kept inline so the file works as a single Server Component
// ─────────────────────────────────────────────────────────────────────────────

function FilterSelect({
  name, label, value, options,
}: {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 min-w-[170px]">
      <span className="text-[11px] uppercase tracking-wider text-ink-mute">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="input-sm"
      >
        <option value="">All</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

// ─── Yarn ────────────────────────────────────────────────────────────────────
type YarnRow = {
  mill_id: number;
  mill_name: string;
  yarn_count_id: number;
  count_code: string;
  count_name: string;
  available_kg: number;
  weighted_avg_cost: number;
  lots_count: number;
  used_in_batches: number;
};

async function loadYarn(supabase: any, sp: SP, mills: any[], counts: any[]): Promise<YarnRow[]> {
  // Pull all yarn_lot rows with current stock > 0; aggregate in JS so we can
  // also count how many production batches consumed each (mill, count) pair.
  let q = supabase
    .from('yarn_lot')
    .select('id, mill_id, yarn_count_id, current_kg, cost_per_kg')
    .gt('current_kg', 0);

  if (sp.mill)  q = q.eq('mill_id',       Number(sp.mill));
  if (sp.count) q = q.eq('yarn_count_id', Number(sp.count));

  const { data: lots } = await q;

  // Count usage from production_batch (warp + weft + porvai legs).
  // Cheap enough to fetch all FK columns; aggregate locally.
  const { data: batchUsage } = await supabase
    .from('production_batch')
    .select('warp_lot_id, weft_lot_id, porvai_lot_id');

  const usageByLot = new Map<number, number>();
  (batchUsage ?? []).forEach((b: any) => {
    [b.warp_lot_id, b.weft_lot_id, b.porvai_lot_id].forEach((lotId: number | null) => {
      if (lotId) usageByLot.set(lotId, (usageByLot.get(lotId) ?? 0) + 1);
    });
  });

  const millById  = new Map(mills.map(m  => [m.id, m]));
  const countById = new Map(counts.map(c => [c.id, c]));

  // Group lots by (mill_id, yarn_count_id)
  const grouped = new Map<string, YarnRow>();
  (lots ?? []).forEach((l: any) => {
    const key = `${l.mill_id}|${l.yarn_count_id}`;
    const m = millById.get(l.mill_id);
    const c = countById.get(l.yarn_count_id);
    let row = grouped.get(key);
    if (!row) {
      row = {
        mill_id: l.mill_id,
        mill_name: m?.name ?? '—',
        yarn_count_id: l.yarn_count_id,
        count_code: c?.code ?? '—',
        count_name: c?.display_name ?? '',
        available_kg: 0,
        weighted_avg_cost: 0,
        lots_count: 0,
        used_in_batches: 0,
      };
      grouped.set(key, row);
    }
    const kg   = Number(l.current_kg);
    const rate = Number(l.cost_per_kg);
    row.weighted_avg_cost = (row.available_kg * row.weighted_avg_cost + kg * rate) /
                            ((row.available_kg + kg) || 1);
    row.available_kg += kg;
    row.lots_count += 1;
    row.used_in_batches += usageByLot.get(l.id) ?? 0;
  });

  return Array.from(grouped.values()).sort((a, b) => b.available_kg - a.available_kg);
}

function YarnView({ rows }: { rows: YarnRow[] }) {
  if (!rows.length) {
    return (
      <div className="card p-8 text-center text-ink-soft text-sm">
        No yarn stock found. Add receipts via Yarn Purchase, or relax the filters.
      </div>
    );
  }
  const totalKg = rows.reduce((s, r) => s + r.available_kg, 0);
  const totalValue = rows.reduce((s, r) => s + r.available_kg * r.weighted_avg_cost, 0);
  return (
    <>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="Total Yarn On Hand" value={formatKg(totalKg, 1)} icon={Boxes} />
        <Kpi label="Stock Value (weighted)" value={formatRupee(totalValue, { compact: true })} icon={Coins} />
        <Kpi label="Distinct (Mill × Count)" value={String(rows.length)} icon={TrendingDown} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Count</th>
              <th className="text-left px-4 py-3">Mill</th>
              <th className="text-right px-4 py-3">On Hand</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Avg ₹/kg</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Stock Value</th>
              <th className="text-right px-4 py-3">Lots</th>
              <th className="text-right px-4 py-3 hidden sm:table-cell">Used in Batches</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.mill_id}-${r.yarn_count_id}`} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.count_code}</div>
                  <div className="text-[11px] text-ink-soft">{r.count_name}</div>
                </td>
                <td className="px-4 py-3">{r.mill_name}</td>
                <td className="px-4 py-3 text-right num font-semibold">{formatKg(r.available_kg, 1)}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{formatRupee(r.weighted_avg_cost, { decimals: 2 })}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{formatRupee(r.available_kg * r.weighted_avg_cost, { compact: true })}</td>
                <td className="px-4 py-3 text-right num">{r.lots_count}</td>
                <td className="px-4 py-3 text-right num hidden sm:table-cell">{r.used_in_batches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Bobbins ─────────────────────────────────────────────────────────────────
type BobbinRow = {
  bobbin_id: number;
  code: string;
  description: string;
  location: string;
  party_id: number | null;
  party_name: string;
  total_pcs: number;
  bobbin_price: number;
};

async function loadBobbin(
  supabase: any, sp: SP, mills: any[], customers: any[], bobbins: any[], mode: Mode,
): Promise<BobbinRow[]> {
  // In-house bobbins come from bobbin_stock (multi-location stock book).
  // Jobwork bobbins come straight off the bobbin master where
  // production_mode='jobwork' - those rows track bobbins handed out to a
  // jobwork party and not yet returned, so quantity > 0 means "still
  // sitting with the party".
  if (mode === 'jobwork') {
    let bq = supabase
      .from('bobbin')
      .select('id, code, description, bobbin_price, quantity, jobwork_party_id, ends_per_bobbin, bobbin_metre')
      .eq('production_mode', 'jobwork')
      .gt('quantity', 0);
    if (sp.party) bq = bq.eq('jobwork_party_id', Number(sp.party));
    const { data: jwBobs } = await bq;

    // Lookup party names for display.
    const partyIds = Array.from(new Set(((jwBobs ?? []) as any[]).map((b) => b.jobwork_party_id).filter((x): x is number => x != null)));
    let partyById = new Map<number, { id: number; name: string; code: string }>();
    if (partyIds.length > 0) {
      const { data: parties } = await supabase.from('jobwork_party').select('id, name, code').in('id', partyIds);
      partyById = new Map(((parties ?? []) as Array<{ id: number; name: string; code: string }>).map((p) => [p.id, p]));
    }

    const out: BobbinRow[] = ((jwBobs ?? []) as any[]).map((b) => ({
      bobbin_id: b.id,
      code: b.code ?? '—',
      description: b.description ?? `${b.ends_per_bobbin ?? '?'} ends × ${b.bobbin_metre ?? '?'} m`,
      location: 'at_vendor',
      party_id: b.jobwork_party_id,
      party_name: b.jobwork_party_id ? partyById.get(b.jobwork_party_id)?.name ?? '—' : '—',
      total_pcs: Number(b.quantity ?? 0),
      bobbin_price: Number(b.bobbin_price ?? 0),
    }));
    return out.sort((a, b) => a.code.localeCompare(b.code) || a.party_name.localeCompare(b.party_name));
  }

  let q = supabase
    .from('bobbin_stock')
    .select('bobbin_id, location, vendor_id, customer_id, quantity_pcs')
    .gt('quantity_pcs', 0);

  if (sp.location)                                  q = q.eq('location', sp.location);
  if (sp.mill && sp.location === 'at_vendor')       q = q.eq('vendor_id', Number(sp.mill));
  if (sp.customer && sp.location === 'customer_owned') q = q.eq('customer_id', Number(sp.customer));

  const { data: stock } = await q;

  // Need bobbin_price too for valuation
  const { data: bobbinPrices } = await supabase
    .from('bobbin')
    .select('id, code, description, bobbin_price');

  const bobbinById   = new Map((bobbinPrices ?? []).map((b: any) => [b.id, b]));
  const millById     = new Map(mills.map(m => [m.id, m]));
  const customerById = new Map(customers.map(c => [c.id, c]));

  // Aggregate by (bobbin_id, location, party)
  const grouped = new Map<string, BobbinRow>();
  (stock ?? []).forEach((s: any) => {
    const partyId = s.vendor_id ?? s.customer_id ?? null;
    const key = `${s.bobbin_id}|${s.location}|${partyId ?? 'none'}`;
    const b = bobbinById.get(s.bobbin_id) as { code?: string; description?: string; bobbin_price?: number } | undefined;
    const partyName = s.vendor_id
      ? millById.get(s.vendor_id)?.name ?? '—'
      : s.customer_id
        ? customerById.get(s.customer_id)?.name ?? '—'
        : '';
    let row = grouped.get(key);
    if (!row) {
      row = {
        bobbin_id: s.bobbin_id,
        code: b?.code ?? '—',
        description: b?.description ?? '',
        location: s.location,
        party_id: partyId,
        party_name: partyName,
        total_pcs: 0,
        bobbin_price: Number(b?.bobbin_price ?? 0),
      };
      grouped.set(key, row);
    }
    row.total_pcs += Number(s.quantity_pcs);
  });

  return Array.from(grouped.values()).sort((a, b) =>
    a.code.localeCompare(b.code) || a.location.localeCompare(b.location)
  );
}

function BobbinView({ rows }: { rows: BobbinRow[] }) {
  if (!rows.length) {
    return (
      <div className="card p-8 text-center text-ink-soft text-sm">
        No bobbin stock found. Add stock via Bobbin Stock module, or relax filters.
      </div>
    );
  }
  const totalPcs = rows.reduce((s, r) => s + r.total_pcs, 0);
  const totalValue = rows.reduce((s, r) => s + r.total_pcs * r.bobbin_price, 0);
  const byLocation = rows.reduce<Record<string, number>>((a, r) => {
    a[r.location] = (a[r.location] ?? 0) + r.total_pcs;
    return a;
  }, {});

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Total Pieces" value={totalPcs.toFixed(2)} icon={Package} />
        <Kpi label="Stock Value" value={formatRupee(totalValue, { compact: true })} icon={Coins} />
        <Kpi label="At Main Godown" value={(byLocation.main_godown ?? 0).toFixed(2)} icon={Boxes} />
        <Kpi label="With Outsiders" value={((byLocation.at_vendor ?? 0) + (byLocation.customer_owned ?? 0)).toFixed(2)} icon={TrendingDown} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Bobbin</th>
              <th className="text-left px-4 py-3">Location</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Party</th>
              <th className="text-right px-4 py-3">Pieces</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Price/pc</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.bobbin_id}-${r.location}-${r.party_id ?? 'n'}-${i}`} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.code}</div>
                  <div className="text-[11px] text-ink-soft">{r.description}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded ${LOCATION_PILL[r.location] ?? 'bg-cloud'}`}>
                    {LOCATION_LABEL[r.location] ?? r.location}
                  </span>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft">{r.party_name || '—'}</td>
                <td className="px-4 py-3 text-right num font-semibold">{r.total_pcs.toFixed(2)}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{formatRupee(r.bobbin_price, { decimals: 0 })}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{formatRupee(r.total_pcs * r.bobbin_price, { compact: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Fabric ──────────────────────────────────────────────────────────────────
type FabricRow = {
  costing_id: number;
  quality_code: string;
  quality_name: string;
  source_type: string;
  metres_available: number;
  avg_cost_per_m: number;
  receipts: number;
};

async function loadFabric(supabase: any, _sp: SP, mode: Mode): Promise<FabricRow[]> {
  let q = supabase
    .from('fabric_stock')
    .select(`
      costing_id, source_type, metres_available, cost_per_m_frozen,
      costing:costing_id ( quality_code, quality_name )
    `)
    .gt('metres_available', 0)
    .order('received_at', { ascending: false });
  // In-house fabric: inhouse + outsourced + resale (everything we own).
  // Jobwork fabric: only fabric received against jobwork DCs.
  if (mode === 'jobwork') {
    q = q.eq('source_type', 'jobwork');
  } else {
    q = q.in('source_type', ['inhouse', 'outsourced', 'resale']);
  }
  const { data } = await q;

  const grouped = new Map<string, FabricRow>();
  (data ?? []).forEach((r: any) => {
    const key = `${r.costing_id}|${r.source_type}`;
    let row = grouped.get(key);
    if (!row) {
      row = {
        costing_id: r.costing_id,
        quality_code: r.costing?.quality_code ?? '—',
        quality_name: r.costing?.quality_name ?? '',
        source_type: r.source_type,
        metres_available: 0,
        avg_cost_per_m: 0,
        receipts: 0,
      };
      grouped.set(key, row);
    }
    const m    = Number(r.metres_available);
    const cost = Number(r.cost_per_m_frozen);
    row.avg_cost_per_m = (row.metres_available * row.avg_cost_per_m + m * cost) /
                         ((row.metres_available + m) || 1);
    row.metres_available += m;
    row.receipts += 1;
  });

  return Array.from(grouped.values()).sort((a, b) => b.metres_available - a.metres_available);
}

function FabricView({ rows }: { rows: FabricRow[] }) {
  if (!rows.length) {
    return (
      <div className="card p-8 text-center text-ink-soft text-sm">
        No finished fabric in stock. Stock appears here after production / outsource / jobwork / resale receipts.
      </div>
    );
  }
  const totalM = rows.reduce((s, r) => s + r.metres_available, 0);
  const totalValue = rows.reduce((s, r) => s + r.metres_available * r.avg_cost_per_m, 0);
  return (
    <>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="Total Metres Ready" value={formatMetres(totalM, 0)} icon={Layers} />
        <Kpi label="Stock Value" value={formatRupee(totalValue, { compact: true })} icon={Coins} />
        <Kpi label="Distinct (Quality × Source)" value={String(rows.length)} icon={TrendingDown} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Quality</th>
              <th className="text-left px-4 py-3">Source</th>
              <th className="text-right px-4 py-3">Available</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Avg ₹/m</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Stock Value</th>
              <th className="text-right px-4 py-3">Receipts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.costing_id}-${r.source_type}`} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.quality_code}</div>
                  <div className="text-[11px] text-ink-soft">{r.quality_name}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded ${SOURCE_PILL[r.source_type] ?? 'bg-cloud'}`}>
                    {SOURCE_LABEL[r.source_type] ?? r.source_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-right num font-semibold">{formatMetres(r.metres_available, 1)}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{formatRupee(r.avg_cost_per_m, { decimals: 2 })}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{formatRupee(r.metres_available * r.avg_cost_per_m, { compact: true })}</td>
                <td className="px-4 py-3 text-right num">{r.receipts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Jobwork: Warp Beam stock ───────────────────────────────────────────────
// Rows in jobwork_warp_beam represent warp metres handed out to a jobwork
// party for a specific fabric quality. total_metres is the live balance:
// fabric receipts deduct from it via the stock-reduction pipeline. We sum
// what's still sitting with the party here.
type WarpBeamRow = {
  party_id: number;
  party_name: string;
  fabric_quality_id: number;
  quality_code: string;
  quality_name: string;
  warp_count_id: number | null;
  count_code: string;
  total_metres: number;
  beam_count: number;
};

async function loadJobworkWarpBeam(
  supabase: any, sp: SP, parties: any[], qualities: any[], counts: any[],
): Promise<WarpBeamRow[]> {
  let q = supabase
    .from('jobwork_warp_beam')
    .select('jobwork_party_id, fabric_quality_id, warp_count_id, total_metres, beam_count')
    .gt('total_metres', 0);
  if (sp.party)   q = q.eq('jobwork_party_id',  Number(sp.party));
  if (sp.quality) q = q.eq('fabric_quality_id', Number(sp.quality));
  if (sp.count)   q = q.eq('warp_count_id',     Number(sp.count));
  const { data: rows } = await q;

  const partyById   = new Map(parties.map((p: any) => [p.id, p]));
  const qualityById = new Map(qualities.map((q: any) => [q.id, q]));
  const countById   = new Map(counts.map((c: any) => [c.id, c]));

  // Aggregate by (party, quality, warp_count)
  const grouped = new Map<string, WarpBeamRow>();
  ((rows ?? []) as any[]).forEach((r) => {
    if (r.jobwork_party_id == null || r.fabric_quality_id == null) return;
    const key = `${r.jobwork_party_id}|${r.fabric_quality_id}|${r.warp_count_id ?? 'n'}`;
    let row = grouped.get(key);
    if (!row) {
      const p = partyById.get(r.jobwork_party_id);
      const fq = qualityById.get(r.fabric_quality_id);
      const c = r.warp_count_id != null ? countById.get(r.warp_count_id) : null;
      row = {
        party_id: r.jobwork_party_id,
        party_name: p?.name ?? '—',
        fabric_quality_id: r.fabric_quality_id,
        quality_code: fq?.code ?? '—',
        quality_name: fq?.name ?? '',
        warp_count_id: r.warp_count_id,
        count_code: c?.code ?? '—',
        total_metres: 0,
        beam_count: 0,
      };
      grouped.set(key, row);
    }
    row.total_metres += Number(r.total_metres ?? 0);
    row.beam_count   += Number(r.beam_count ?? 0);
  });

  return Array.from(grouped.values()).sort((a, b) => b.total_metres - a.total_metres);
}

function WarpBeamView({ rows }: { rows: WarpBeamRow[] }) {
  if (!rows.length) {
    return (
      <div className="card p-8 text-center text-ink-soft text-sm">
        No warp beam stock with jobwork parties. Issue warp beams from Job Work &rarr; Warp Beam Given.
      </div>
    );
  }
  const totalM = rows.reduce((s, r) => s + r.total_metres, 0);
  const totalBeams = rows.reduce((s, r) => s + r.beam_count, 0);
  return (
    <>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="Total Warp Metres" value={formatMetres(totalM, 0)} icon={Ruler} />
        <Kpi label="Beam Count" value={String(totalBeams)} icon={Layers} />
        <Kpi label="Party × Quality rows" value={String(rows.length)} icon={TrendingDown} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Party</th>
              <th className="text-left px-4 py-3">Fabric Quality</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Warp Count</th>
              <th className="text-right px-4 py-3">Metres</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Beams</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.party_id}-${r.fabric_quality_id}-${r.warp_count_id ?? 'n'}`} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">{r.party_name}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.quality_code}</div>
                  <div className="text-[11px] text-ink-soft">{r.quality_name}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">{r.count_code}</td>
                <td className="px-4 py-3 text-right num font-semibold">{formatMetres(r.total_metres, 1)}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{r.beam_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Jobwork: Weft / Porvai Yarn stock ───────────────────────────────────────
// Rows in jobwork_weft_bag represent weft (or porvai) yarn issued to a
// jobwork party. total_kg is the live balance the party is sitting on.
type WeftYarnRow = {
  party_id: number;
  party_name: string;
  yarn_count_id: number;
  count_code: string;
  count_name: string;
  total_kg: number;
  bag_count: number;
};

async function loadJobworkWeftYarn(
  supabase: any, sp: SP, parties: any[], counts: any[],
): Promise<WeftYarnRow[]> {
  let q = supabase
    .from('jobwork_weft_bag')
    .select('jobwork_party_id, yarn_count_id, total_kg, bag_count')
    .gt('total_kg', 0);
  if (sp.party) q = q.eq('jobwork_party_id', Number(sp.party));
  if (sp.count) q = q.eq('yarn_count_id',    Number(sp.count));
  const { data: rows } = await q;

  const partyById = new Map(parties.map((p: any) => [p.id, p]));
  const countById = new Map(counts.map((c: any) => [c.id, c]));

  const grouped = new Map<string, WeftYarnRow>();
  ((rows ?? []) as any[]).forEach((r) => {
    if (r.jobwork_party_id == null || r.yarn_count_id == null) return;
    const key = `${r.jobwork_party_id}|${r.yarn_count_id}`;
    let row = grouped.get(key);
    if (!row) {
      const p = partyById.get(r.jobwork_party_id);
      const c = countById.get(r.yarn_count_id);
      row = {
        party_id: r.jobwork_party_id,
        party_name: p?.name ?? '—',
        yarn_count_id: r.yarn_count_id,
        count_code: c?.code ?? '—',
        count_name: c?.display_name ?? '',
        total_kg: 0,
        bag_count: 0,
      };
      grouped.set(key, row);
    }
    row.total_kg   += Number(r.total_kg ?? 0);
    row.bag_count  += Number(r.bag_count ?? 0);
  });

  return Array.from(grouped.values()).sort((a, b) => b.total_kg - a.total_kg);
}

function WeftYarnView({ rows }: { rows: WeftYarnRow[] }) {
  if (!rows.length) {
    return (
      <div className="card p-8 text-center text-ink-soft text-sm">
        No weft yarn with jobwork parties. Issue yarn from Job Work &rarr; Weft Yarn Given.
      </div>
    );
  }
  const totalKg = rows.reduce((s, r) => s + r.total_kg, 0);
  const totalBags = rows.reduce((s, r) => s + r.bag_count, 0);
  return (
    <>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="Total Yarn" value={formatKg(totalKg, 1)} icon={Boxes} />
        <Kpi label="Bag Count" value={String(totalBags)} icon={Package} />
        <Kpi label="Party × Count rows" value={String(rows.length)} icon={TrendingDown} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Party</th>
              <th className="text-left px-4 py-3">Yarn Count</th>
              <th className="text-right px-4 py-3">On Hand</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Bags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.party_id}-${r.yarn_count_id}`} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">{r.party_name}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.count_code}</div>
                  <div className="text-[11px] text-ink-soft">{r.count_name}</div>
                </td>
                <td className="px-4 py-3 text-right num font-semibold">{formatKg(r.total_kg, 1)}</td>
                <td className="px-4 py-3 text-right num hidden md:table-cell">{r.bag_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Low stock alerts ────────────────────────────────────────────────────────
async function computeLowStock(supabase: any, counts: any[], bobbins: any[]) {
  // Yarn: on-hand kg per count vs yarn_count.reorder_kg
  const { data: lots } = await supabase
    .from('yarn_lot')
    .select('yarn_count_id, current_kg')
    .gt('current_kg', 0);
  const yarnOnHand = ((lots ?? []) as any[]).reduce<Record<number, number>>((a, l: any) => {
    a[l.yarn_count_id] = (a[l.yarn_count_id] ?? 0) + Number(l.current_kg);
    return a;
  }, {});
  const yarnAlerts = counts
    .filter(c => Number(c.reorder_kg) > 0)
    .map(c => ({
      id: c.id,
      code: c.code,
      display_name: c.display_name,
      on_hand_kg: yarnOnHand[c.id] ?? 0,
      reorder_kg: Number(c.reorder_kg),
    }))
    .filter(item => item.on_hand_kg < item.reorder_kg)
    .sort((a, b) => (a.on_hand_kg / a.reorder_kg) - (b.on_hand_kg / b.reorder_kg))
    .slice(0, 10);

  // Bobbins: total pcs per bobbin vs bobbin.reorder_pieces
  const { data: stock } = await supabase
    .from('bobbin_stock')
    .select('bobbin_id, quantity_pcs')
    .gt('quantity_pcs', 0);
  const bobbinOnHand = ((stock ?? []) as any[]).reduce<Record<number, number>>((a, s: any) => {
    a[s.bobbin_id] = (a[s.bobbin_id] ?? 0) + Number(s.quantity_pcs);
    return a;
  }, {});
  const bobbinAlerts = bobbins
    .filter(b => Number(b.reorder_pieces) > 0)
    .map(b => ({
      id: b.id,
      code: b.code,
      description: b.description,
      on_hand_pcs: bobbinOnHand[b.id] ?? 0,
      reorder_pieces: Number(b.reorder_pieces),
    }))
    .filter(item => item.on_hand_pcs < item.reorder_pieces)
    .sort((a, b) => (a.on_hand_pcs / a.reorder_pieces) - (b.on_hand_pcs / b.reorder_pieces))
    .slice(0, 10);

  return { yarn: yarnAlerts, bobbin: bobbinAlerts };
}

// ─── Tiny KPI card ───────────────────────────────────────────────────────────
function Kpi({
  label, value, icon: Icon,
}: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
        <Icon className="w-4 h-4 text-ink-mute" />
      </div>
      <div className="num text-xl font-bold">{value}</div>
    </div>
  );
}
