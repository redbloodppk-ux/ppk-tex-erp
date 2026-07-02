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
import { Boxes, Package, PackageOpen, Layers, AlertTriangle, Coins, TrendingDown, Factory, Truck, Ruler } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatKg, formatMetres, formatRupee } from '@/lib/utils';
import { OpeningStockForm, type ExistingOpeningRow, type BobbinEndsOpt } from './opening-stock-form';
import { InhouseBobbinOpeningStockForm, type InhouseBobbinMasterOpt } from './inhouse-bobbin-form';
import { InhouseBobbinOpeningForm, type BobbinMasterForOpening } from './inhouse-bobbin-opening-form';

export const metadata = { title: 'Warehouse — Unified Stock' };
// Force server-render on every visit so the jobwork tabs always reflect
// the latest inflow rows added on the /app/jobwork page (and outflows
// from fabric receipts). Without this Next.js may serve a cached
// snapshot of the page and the operator sees stale inflows.
export const dynamic = 'force-dynamic';

type Mode = 'inhouse' | 'jobwork' | 'outsource' | 'sizing';

const MODE_TABS = [
  { key: 'inhouse',   label: 'In-house Stock',          icon: Factory },
  { key: 'jobwork',   label: 'Job Work Stock',          icon: Truck   },
  { key: 'outsource', label: 'Outsource Weaving Stock', icon: Truck   },
  { key: 'sizing',    label: 'Sizing Warehouse',        icon: Boxes   },
] as const;

// Outsource mode reuses the JOBWORK_TABS sub-tab list (defined just
// below) because the underlying data tables (jobwork_warp_beam,
// jobwork_weft_bag, bobbin, delivery_challan etc.) are shared; the
// discriminator is the linked party's `jobwork_party.kind`.

// Sizing is now its own top-level mode (Sizing Warehouse) so we no
// longer surface it here as an in-house sub-tab.
const INHOUSE_TABS = [
  { key: 'warp_metre',         label: 'Warp Metre (m)',         icon: Ruler   },
  { key: 'weft_yarn',          label: 'Weft Yarn (kg)',         icon: Boxes   },
  { key: 'porvai_yarn',        label: 'Porvai Yarn (kg)',       icon: Boxes   },
  { key: 'bobbin',             label: 'Bobbins (m)',            icon: Package },
  // The per-event fabric audit log (Fabric (m)) moved to a standalone
  // report under Reports & Alerts: /app/reports/fabric-movements. The
  // loaders below (loadFabric, loadFabricLineage) stay in place so the
  // Jobwork / Outsource sub-tab "Fabric (m)" still renders and so any
  // future report can reuse them.
  // Production-batch fabric inflows (stock_ledger.bucket='production_fabric').
  // Currently inflow-only; outflows (DC shipments) will arrive later.
  { key: 'production_fabric',  label: 'Production Fabric (m)',  icon: PackageOpen },
] as const;

const SIZING_TABS = [
  { key: 'yarn',        label: 'Yarn by Count (kg)', icon: Boxes },
] as const;

const JOBWORK_TABS = [
  { key: 'warp_beam',   label: 'Warp Beam (m)',    icon: Ruler   },
  { key: 'weft_yarn',   label: 'Weft Yarn (kg)',   icon: Boxes   },
  { key: 'porvai_yarn', label: 'Porvai Yarn (kg)', icon: Boxes   },
  { key: 'bobbin',      label: 'Bobbins (m)',      icon: Package },
  { key: 'fabric',      label: 'Fabric (m)',       icon: Layers  },
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
  // Warp-metre tab: filter the pivot by warp ends count. Pairs with
  // `count` (warp/yarn count) so the operator can drill the warp-metre
  // stock to a single (ends + count) group.
  wends?: string;
  // Production-fabric tab: filter both pcs + metres pivots to a single
  // quality column. Holds the pivot column id (`fq:<id>` or `m:<name>`)
  // so it works for merged-quality groups too. Kept separate from
  // `quality` (numeric id, used by jobwork tabs) to avoid cross-tab
  // contamination of a stale param.
  pfq?: string;
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
  const mode: Mode = sp.mode === 'jobwork' ? 'jobwork'
                    : sp.mode === 'outsource' ? 'outsource'
                    : sp.mode === 'sizing' ? 'sizing'
                    : 'inhouse';
  // Default sub-tab per mode. Sizing has one sub-tab ('yarn'); jobwork
  // and outsource share the warp_beam default; inhouse defaults to
  // warp_metre.
  const defaultTab = mode === 'inhouse' ? 'warp_metre'
                   : mode === 'sizing'  ? 'yarn'
                   : 'warp_beam';
  const tab = (sp.tab ?? defaultTab);
  // Both jobwork-style modes pivot over the same data tables — the
  // discriminator is the linked party's kind. Anywhere downstream
  // that checks `mode === 'jobwork'` we treat outsource the same way.
  const isJobworkLike = mode === 'jobwork' || mode === 'outsource';
  const partyKind: 'jobwork' | 'outsource' = mode === 'outsource' ? 'outsource' : 'jobwork';
  const supabase = await createClient();

  // ─── Master data for filters (small tables, fetch all in parallel) ────────
  const [
    { data: mills },
    { data: customers },
    { data: counts },
    { data: bobbinMasters },
    { data: jobworkParties },
    { data: fabricQualities },
    { data: bobbinEndsRaw },
  ] = await Promise.all([
    // Yarn suppliers come from the party table now (migration 098). We
    // resolve the "Mill / Yarn Supplier" party_type id inline and filter
    // by it so the dropdown stays focused on yarn-supplying parties.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pt = await (supabase as any).from('party_type_master')
        .select('id').eq('name', 'Mill / Yarn Supplier').maybeSingle();
      const typeId = pt.data?.id as number | undefined;
      if (!typeId) return { data: [] as Array<{ id: number; name: string }> };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (supabase as any).from('party')
        .select('id, name')
        .contains('party_type_ids', [typeId])
        .eq('status', 'active')
        .order('name');
    })(),
    supabase.from('customer').select('id, name').eq('status', 'active').order('name'),
    supabase.from('yarn_count').select('id, code, display_name, reorder_kg').eq('status', 'active').order('code'),
    // Restricted to in-house bobbins so the in-house warehouse forms
    // only surface bobbins from the in-house stream. Jobwork/outsource
    // tabs query the bobbin master directly with their own mode filter.
    // Cast through any because production_mode was added by migration
    // 142 and the generated database.types.ts is not yet regenerated.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('bobbin').select('id, code, description, reorder_pieces, ends_per_bobbin').eq('production_mode', 'inhouse').eq('status', 'active').order('code'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // Filter the party master to the kind that matches the active
    // mode — jobwork-typed for /warehouse?mode=jobwork and
    // outsource-typed for ?mode=outsource. Inhouse mode ignores this
    // list entirely.
    (supabase as any).from('jobwork_party').select('id, code, name, kind').eq('status', 'active').eq('kind', partyKind).order('name'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('fabric_quality').select('id, code, name').eq('active', true).order('name'),
    // Bobbin master filtered to production_mode='inhouse' — drives the
    // "Bobbin" dropdown on the in-house bobbin opening stock form so the
    // operator only picks from bobbins in the in-house stream.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('bobbin')
      .select('id, code, ends_per_bobbin, bobbin_metre, is_lurex')
      .eq('production_mode', 'inhouse')
      .neq('status', 'archived')
      .order('ends_per_bobbin'),
  ]);

  // Re-shape into the existing BobbinEndsOpt shape consumed by the
  // form. ends_count carries ends_per_bobbin so the opening_stock row
  // is saved with the right integer; id is the bobbin master id so the
  // form can save bobbin_id directly.
  const bobbinMasterRaw = ((bobbinEndsRaw ?? []) as Array<{
    id: number; code: string; ends_per_bobbin: number;
    bobbin_metre: number | null; is_lurex: boolean | null
  }>);
  const bobbinEnds: BobbinEndsOpt[] = bobbinMasterRaw.map((r) => ({
    id: r.id,
    ends_count: r.ends_per_bobbin,
    label: `${r.code} (${r.ends_per_bobbin} ends${r.bobbin_metre ? ` · ${r.bobbin_metre} m/pc` : ''}${r.is_lurex ? ' · lurex' : ''})`,
  }));
  // Full bobbin master shape for the new multi-item in-house bobbin
  // form. It needs the per-piece metres + lurex flag to prefill the
  // M/pc input and label the rows clearly.
  const inhouseBobbinMasters: InhouseBobbinMasterOpt[] = bobbinMasterRaw.map((r) => ({
    id: r.id,
    code: r.code,
    ends_per_bobbin: r.ends_per_bobbin,
    bobbin_metre: r.bobbin_metre,
    is_lurex: Boolean(r.is_lurex),
  }));

  // Richer shape consumed by the new multi-item InhouseBobbinOpeningForm.
  const inhouseBobbinsForForm: BobbinMasterForOpening[] = ((bobbinEndsRaw ?? []) as Array<{
    id: number; code: string; ends_per_bobbin: number;
    bobbin_metre: number | null; is_lurex: boolean | null
  }>).map((r) => ({
    id: r.id,
    code: r.code,
    ends_per_bobbin: r.ends_per_bobbin,
    bobbin_metre: r.bobbin_metre,
    is_lurex: Boolean(r.is_lurex),
  }));

  // ─── Low-stock alerts (cross-cutting, in-house only) ──────────────────────
  // Alerts cover yarn_count.reorder_kg and bobbin.reorder_pieces which
  // belong to in-house stock; we hide the panel in jobwork mode.
  const lowStock = mode === 'inhouse'
    ? await computeLowStock(supabase, counts ?? [], bobbinMasters ?? [])
    : { yarn: [], bobbin: [] };

  // ─── Tab-specific data ────────────────────────────────────────────────────
  // Both inhouse + jobwork now use the same pivot view. Inhouse
  // loaders read opening_stock entries as inflows; jobwork loaders
  // read jobwork_warp_beam / jobwork_weft_bag / bobbin + stock_ledger.
  // Outsource mode reuses the jobwork loaders — the only difference
  // is the party set we pre-filtered above (kind='outsource'). The
  // loaders aggregate by party_id and discard rows whose party isn't
  // in the passed-in set, so jobwork data never leaks into outsource
  // and vice-versa.
  // In-house no longer has a Fabric tab — the per-event audit log
  // moved to /app/reports/fabric-movements. loadFabric() still runs for
  // jobwork / outsource modes where the aggregate Fabric (m) sub-tab
  // remains.
  // Jobwork / Outsource Fabric (m) tab now renders the same per-event pivot
  // ledger the In-house Production Fabric tab uses (see loadJobworkFabricPivot).
  const fabricPivot    = (mode !== 'inhouse' && tab === 'fabric')        ? await loadJobworkFabricPivot(supabase, sp, mode) : null;
  const warpBeamRows   = isJobworkLike && tab === 'warp_beam'           ? await loadJobworkWarpBeam(supabase, sp, jobworkParties ?? [], fabricQualities ?? [], counts ?? []) : null;
  const weftYarnRows   = isJobworkLike && tab === 'weft_yarn'           ? await loadJobworkYarn(supabase, sp, jobworkParties ?? [], counts ?? [], 'weft') : null;
  const porvaiYarnRows = isJobworkLike && tab === 'porvai_yarn'         ? await loadJobworkYarn(supabase, sp, jobworkParties ?? [], counts ?? [], 'porvai') : null;
  const jwBobbinRows   = isJobworkLike && tab === 'bobbin'              ? await loadJobworkBobbin(supabase, sp, jobworkParties ?? [], bobbinMasters ?? []) : null;
  // In-house pivot loaders take the same sp object so they can apply
  // the Fabric Quality / Yarn Count filters at the column level. With
  // no filter set they return the full pivot exactly as before.
  // Warp-metre pivot: load the FULL pivot first so we can derive the
  // available warp-ends options from its columns, then apply the
  // (ends + count) filter for the rendered table.
  const inWarpFull     = mode === 'inhouse' && tab === 'warp_metre'     ? await loadInhouseOpeningStock(supabase, 'warp_beam',   fabricQualities ?? [], counts ?? [], bobbinMasters ?? []) : null;
  const inWarpRows     = inWarpFull ? applyWarpMetreFilter(inWarpFull, sp) : null;
  const warpEndsOpts   = warpEndsOptions(inWarpFull);
  const inWeftRows     = mode === 'inhouse' && tab === 'weft_yarn'      ? applyInhouseColumnFilter(await loadInhouseOpeningStock(supabase, 'weft_yarn',   fabricQualities ?? [], counts ?? [], bobbinMasters ?? []), sp) : null;
  const inPorvaiRows   = mode === 'inhouse' && tab === 'porvai_yarn'    ? applyInhouseColumnFilter(await loadInhouseOpeningStock(supabase, 'porvai_yarn', fabricQualities ?? [], counts ?? [], bobbinMasters ?? []), sp) : null;
  const inBobbinRows   = mode === 'inhouse' && tab === 'bobbin'         ? await loadInhouseOpeningStock(supabase, 'bobbin',      fabricQualities ?? [], counts ?? [], bobbinMasters ?? []) : null;
  // Production Fabric — stock_ledger rows with bucket='production_fabric'.
  // Currently inflow-only (writes from /app/production/new); outflows
  // (DC shipments) will be added later. Columns key by fabric_quality_id
  // with merged-group collapsing (same colInfo pattern the warp pivot uses).
  const inProdFabricRows = mode === 'inhouse' && tab === 'production_fabric' ? await loadInhouseProductionFabric(supabase, fabricQualities ?? []) : null;
  // Sizing warehouse — its own top-level mode. The loader pivots
  // yarn_lot inflows (delivery_destination='sizing') and sizing_job
  // outflows by yarn count, one column per count.
  const sizingRows     = mode === 'sizing'  && tab === 'yarn'           ? await loadSizingWarehouse(supabase, counts ?? [], sp) : null;

  // ── Existing opening entries for the active form's bucket + mode ──
  // Surfaced under the "Add opening stock" form so the operator can see
  // (and delete) any entry that was made earlier. Only loaded when one
  // of the in-house / sizing tabs that actually renders the form is
  // active — keeps the page fast on other tabs.
  const openingFormBucket: 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin' | null =
    mode === 'inhouse' && tab === 'warp_metre'  ? 'warp_beam'   :
    mode === 'inhouse' && tab === 'weft_yarn'   ? 'weft_yarn'   :
    mode === 'inhouse' && tab === 'porvai_yarn' ? 'porvai_yarn' :
    mode === 'inhouse' && tab === 'bobbin'      ? 'bobbin'      :
    mode === 'sizing'  && tab === 'yarn'        ? 'weft_yarn'   :
    null;
  const openingFormMode: 'inhouse' | 'sizing' = mode === 'sizing' ? 'sizing' : 'inhouse';
  const existingOpening = openingFormBucket
    ? await loadExistingOpening(supabase, openingFormBucket, openingFormMode)
    : [];

  const subTabs = isJobworkLike
    ? JOBWORK_TABS
    : mode === 'sizing'
    ? SIZING_TABS
    : INHOUSE_TABS;

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
      {/* Hidden on the in-house Warp Metre tab — that view tracks woven
          metres, where a "low stock" yarn/bobbin alert isn't relevant. */}
      {/* Yarn low-stock alerts removed per request — only bobbin alerts remain. */}
      {tab !== 'warp_metre' && lowStock.bobbin.length > 0 && (
        <section className="card border-rose-200 bg-rose-50/30 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <div className="font-semibold text-sm text-rose-700">
              Low Stock Alerts ({lowStock.bobbin.length})
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
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
            label={tab === 'yarn' ? 'Yarn supplier' : 'Vendor (bobbin supplier)'}
            value={sp.mill}
            // `mills` here is the party-backed yarn-supplier list (see top of file).
            options={(mills ?? []).map((m: { id: number; name: string }) => ({ value: String(m.id), label: m.name }))}
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

        {/* In-house weft / porvai tabs share a Yarn Count filter — the
            pivot's columns are already keyed by yarn count, so the
            filter just collapses the table to the chosen column. */}
        {mode === 'inhouse' && (tab === 'weft_yarn' || tab === 'porvai_yarn') && (
          <FilterSelect
            name="count"
            label="Yarn Count"
            value={sp.count}
            options={(counts ?? []).map(c => ({ value: String(c.id), label: c.code }))}
          />
        )}

        {/* In-house Warp Metre tab: filter the pivot by warp ends and/or
            warp count. The columns are keyed (ends + count), so picking
            either drills the table to the matching warp-spec group(s). */}
        {mode === 'inhouse' && tab === 'warp_metre' && (
          <>
            <FilterSelect
              name="wends"
              label="Warp Ends"
              value={sp.wends}
              options={warpEndsOpts}
            />
            <FilterSelect
              name="count"
              label="Warp Count"
              value={sp.count}
              options={(counts ?? []).map(c => ({ value: String(c.id), label: c.code }))}
            />
          </>
        )}

        {/* In-house Production Fabric tab: filter both the pcs + metres
            pivots to a single fabric quality. Options are pulled from the
            pivot columns themselves, so only qualities with production
            stock show and merged-quality groups work too. */}
        {mode === 'inhouse' && tab === 'production_fabric' && (
          <FilterSelect
            name="pfq"
            label="Fabric Quality"
            value={sp.pfq}
            options={prodFabricQualityOptions(inProdFabricRows)}
          />
        )}

        {/* Sizing warehouse — single yarn-count filter so the operator
            can drill into a specific count column. */}
        {mode === 'sizing' && tab === 'yarn' && (
          <FilterSelect
            name="count"
            label="Yarn Count"
            value={sp.count}
            options={(counts ?? []).map(c => ({ value: String(c.id), label: c.code }))}
          />
        )}

        {/* Jobwork / Outsource filters: party + yarn count / fabric
            quality depending on tab. Party applies to all four
            jobwork-style sub-tabs in either mode. */}
        {isJobworkLike && (
          <FilterSelect
            name="party"
            label={mode === 'outsource' ? 'Outsourcing party' : 'Jobwork Party'}
            value={sp.party}
            options={(jobworkParties ?? []).map((p: { id: number; code: string; name: string }) => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
          />
        )}

        {isJobworkLike && (tab === 'warp_beam' || tab === 'fabric') && (
          <FilterSelect
            name="quality"
            label="Fabric Quality"
            value={sp.quality}
            options={(fabricQualities ?? []).map((q: { id: number; code: string; name: string }) => ({ value: String(q.id), label: `${q.code} - ${q.name}` }))}
          />
        )}

        {isJobworkLike && (tab === 'warp_beam' || tab === 'weft_yarn' || tab === 'porvai_yarn') && (
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
        {(sp.mill || sp.customer || sp.count || sp.location || sp.party || sp.quality || sp.wends || sp.pfq) && (
          <Link href={`/app/warehouse?mode=${mode}&tab=${tab}`} className="btn-sm bg-cloud text-ink-soft hover:bg-cloud/80">
            Clear
          </Link>
        )}
      </form>

      {/* ── Tab body ───────────────────────────────────────────────────── */}
      {mode === 'inhouse' && tab === 'warp_metre'  && (
        <>
          <OpeningStockForm bucket="warp_beam"   qualities={(fabricQualities ?? []) as any} counts={(counts ?? []) as any} bobbinMasters={(bobbinMasters ?? []) as any} existing={existingOpening} />
          <PivotView data={inWarpRows!} emptyMessage="No in-house warp metre stock yet. Use Add opening stock to enter your starting balance per warp ends count." />
        </>
      )}
      {mode === 'inhouse' && tab === 'weft_yarn'   && (
        <>
          <OpeningStockForm bucket="weft_yarn"   qualities={(fabricQualities ?? []) as any} counts={(counts ?? []) as any} bobbinMasters={(bobbinMasters ?? []) as any} existing={existingOpening} />
          <PivotView data={inWeftRows!} emptyMessage="No in-house weft yarn stock yet. Use Add opening stock to enter your starting balance per yarn count." />
        </>
      )}
      {mode === 'inhouse' && tab === 'porvai_yarn' && (
        <>
          <OpeningStockForm bucket="porvai_yarn" qualities={(fabricQualities ?? []) as any} counts={(counts ?? []) as any} bobbinMasters={(bobbinMasters ?? []) as any} existing={existingOpening} />
          <PivotView data={inPorvaiRows!} emptyMessage="No in-house porvai yarn stock yet. Use Add opening stock to enter your starting balance." />
        </>
      )}
      {mode === 'inhouse' && tab === 'bobbin'      && (
        <>
          {/* Multi-item bobbin opening stock form. Mirrors the Job Work
              Bobbin Given form: pick once for date / reference / notes,
              then a multi-row line items table for the bobbin specs. */}
          <InhouseBobbinOpeningStockForm
            bobbins={inhouseBobbinMasters}
            existing={existingOpening}
          />
          <PivotView data={inBobbinRows!} emptyMessage="No in-house bobbin stock yet. Use Add opening stock to enter your starting balance per bobbin spec." />
        </>
      )}
      {mode === 'sizing' && tab === 'yarn'         && (
        <>
          {/* Sizing warehouse uses bucket='weft_yarn' so its opening
              stock rows live in the same column shape (keyed by yarn
              count) the loader expects. The mode='sizing' flag is what
              actually segregates these from in-house weft entries. */}
          <OpeningStockForm
            mode="sizing"
            bucket="weft_yarn"
            qualities={(fabricQualities ?? []) as any}
            counts={(counts ?? []) as any}
            bobbinMasters={(bobbinMasters ?? []) as any}
            existing={existingOpening}
          />
          <PivotView
            data={sizingRows!}
            emptyMessage="No sizing-warehouse activity yet. Yarn purchases with delivery = 'sizing' appear here as inflows; sizing jobs that consume them appear as outflows. Use Add opening stock to record balances brought forward."
          />
        </>
      )}
      {/* In-house Fabric (m) tab has moved — see
          /app/reports/fabric-movements. The render branch was removed
          along with its data loader. */}
      {mode === 'inhouse' && tab === 'production_fabric' && (
        <div className="space-y-6">
          {/* Production fabric can be stocked in pieces (operator entered
              towel pieces directly) or in metres (operator entered metres,
              optionally with a towel-length to convert into pieces on
              another batch). Showing them in separate pivots keeps the
              totals at the bottom unambiguous — each table footers in its
              own unit. */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
              In pieces
            </div>
            <PivotView
              data={applyProdFabricFilter(inProdFabricRows!.pcs, sp.pfq)}
              emptyMessage="No production fabric stocked in pieces yet. Save a batch from Production → New Batch with the metres toggle off to see pcs inflows here."
            />
          </div>
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
              In metres
            </div>
            <PivotView
              data={applyProdFabricFilter(inProdFabricRows!.metres, sp.pfq)}
              emptyMessage="No production fabric stocked in metres yet. Save a batch from Production → New Batch with the metres toggle on to see metre inflows here."
            />
          </div>
        </div>
      )}
      {isJobworkLike && tab === 'warp_beam'   && <PivotView data={warpBeamRows!}   emptyMessage={mode === 'outsource' ? 'No warp beam entries yet. Issue beams from Outsource Weaving → Warp Beam Given to see them here.' : 'No warp beam entries yet. Issue beams from Job Work → Warp Beam Given to see them here.'} />}
      {isJobworkLike && tab === 'weft_yarn'   && <PivotView data={weftYarnRows!}   emptyMessage={mode === 'outsource' ? 'No weft yarn entries yet. Issue yarn from Outsource Weaving → Weft Yarn Given to see them here.' : 'No weft yarn entries yet. Issue yarn from Job Work → Weft Yarn Given to see them here.'} />}
      {isJobworkLike && tab === 'porvai_yarn' && <PivotView data={porvaiYarnRows!} emptyMessage="No porvai yarn entries yet. Assign porvai counts on Fabric Quality master and issue yarn." />}
      {isJobworkLike && tab === 'bobbin'      && <PivotView data={jwBobbinRows!}   emptyMessage={mode === 'outsource' ? 'No bobbin entries yet. Assign bobbins to outsource weavers to see them here.' : 'No bobbin entries yet. Assign bobbins to jobwork parties to see them here.'} />}
      {isJobworkLike && tab === 'fabric'      && <PivotView data={fabricPivot!} emptyMessage={mode === 'outsource' ? 'No outsource fabric stock yet. Finished cloth received from weavers appears here as inflows; DC shipments reduce it.' : 'No jobwork fabric stock yet. Finished cloth produced for the party appears here as inflows; DC shipments reduce it.'} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — kept inline so the file works as a single Server Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter a PivotData down to a single column based on the in-house
 * filter dropdowns. Used by the warp_metre / weft_yarn / porvai_yarn
 * tabs so picking a Fabric Quality or Yarn Count drills the pivot
 * view to just that column's events.
 *
 * Pivot columns are id'd as:
 *   - `fq:<id>`  → fabric_quality_id  (warp_metre opening stock)
 *   - `yc:<id>`  → yarn_count_id      (weft_yarn / porvai_yarn)
 *   - `ends:<n>` → ends per bobbin    (warp_metre pavu inflows)
 *
 * When the filter doesn't match any column we still hand back an empty
 * PivotData (rather than the full unfiltered one) so the operator's
 * intent is preserved.
 */
/**
 * Distinct "warp ends" options for the warp_metre pivot. Columns there are
 * keyed `ends:N` or composite `ends:N|yc:M`; we pull the leading N off each.
 */
function warpEndsOptions(data: PivotData | null): { value: string; label: string }[] {
  if (!data) return [];
  const ends = new Set<number>();
  for (const c of data.columns) {
    const m = /^ends:(\d+)/.exec(c.id);
    if (m && m[1] != null) ends.add(Number(m[1]));
  }
  return Array.from(ends)
    .sort((a, b) => a - b)
    .map((e) => ({ value: String(e), label: `${e} ends` }));
}

/**
 * Warp-metre grouped filter: warp ends (`ends:N`) and/or warp count
 * (`...|yc:M`). Columns there are keyed `ends:N` or `ends:N|yc:M`, so we
 * match the leading ends segment and the trailing yc segment independently.
 */
function applyWarpMetreFilter(data: PivotData, sp: SP): PivotData {
  const wends = sp.wends && /^\d+$/.test(sp.wends) ? sp.wends : null;
  const count = sp.count && /^\d+$/.test(sp.count) ? sp.count : null;
  if (!wends && !count) return data;
  const matches = (id: string): boolean => {
    const endsM = /^ends:(\d+)/.exec(id);
    const countM = /\|yc:(\d+)$/.exec(id);
    if (wends && (!endsM || endsM[1] !== wends)) return false;
    if (count && (!countM || countM[1] !== count)) return false;
    return true;
  };
  return {
    unit: data.unit,
    columns: data.columns.filter((c) => matches(c.id)),
    events: data.events.filter((e) => matches(e.column_id)),
  };
}

function applyInhouseColumnFilter(data: PivotData, sp: SP): PivotData {
  if (!sp.quality && !sp.count) return data;
  // Only apply a filter that actually matches a column id in this
  // pivot. This prevents a stale ?quality= param (e.g. left over from
  // navigating between tabs) from zeroing out a pivot whose columns
  // are keyed differently — the warp_metre pivot now uses `ends:N`
  // columns, not `fq:N`, so a quality filter would otherwise wipe it.
  const haveQualityCols = data.columns.some((c) => c.id.startsWith('fq:'));
  const haveCountCols   = data.columns.some((c) => c.id.startsWith('yc:'));
  const keep = new Set<string>();
  if (sp.quality && haveQualityCols) keep.add(`fq:${sp.quality}`);
  if (sp.count   && haveCountCols)   keep.add(`yc:${sp.count}`);
  if (keep.size === 0) return data;
  return {
    unit: data.unit,
    columns: data.columns.filter((c) => keep.has(c.id)),
    events:  data.events.filter((e) => keep.has(e.column_id)),
  };
}

/** Distinct quality options for the production-fabric tab — union of the
 *  pcs + metres pivot columns. The value is the pivot column id
 *  (`fq:<id>` or `m:<merged_name>`) so picking one keeps exactly that
 *  column, merged groups included. Only qualities that actually carry
 *  production stock appear. */
function prodFabricQualityOptions(
  data: { pcs: PivotData; metres: PivotData } | null,
): { value: string; label: string }[] {
  if (!data) return [];
  const seen = new Map<string, string>();
  for (const c of [...data.pcs.columns, ...data.metres.columns]) {
    if (!seen.has(c.id)) {
      seen.set(c.id, c.sublabel ? `${c.label} - ${c.sublabel}` : c.label);
    }
  }
  return Array.from(seen.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Collapse a production-fabric pivot to a single quality column. */
function applyProdFabricFilter(data: PivotData, pfq?: string): PivotData {
  if (!pfq) return data;
  return {
    unit: data.unit,
    columns: data.columns.filter((c) => c.id === pfq),
    events: data.events.filter((e) => e.column_id === pfq),
  };
}

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
  // Renamed from mill_* to supplier_* after migration 098 (yarn
  // suppliers moved into the unified party table).
  supplier_id: number;
  supplier_name: string;
  yarn_count_id: number;
  count_code: string;
  count_name: string;
  available_kg: number;
  weighted_avg_cost: number;
  lots_count: number;
  used_in_batches: number;
};

async function loadYarn(supabase: any, sp: SP, suppliers: any[], counts: any[]): Promise<YarnRow[]> {
  // Pull all yarn_lot rows with current stock > 0; aggregate in JS so we can
  // also count how many production batches consumed each (supplier, count) pair.
  // After migration 098 the lot is FK'd to party.supplier_party_id (was mill_id).
  let q = supabase
    .from('yarn_lot')
    .select('id, supplier_party_id, yarn_count_id, current_kg, cost_per_kg')
    // neq(0): fully-consumed lots stay hidden, but over-consumed
    // (negative) lots MUST surface so the operator sees the real
    // position instead of a silently clamped zero.
    .neq('current_kg', 0);

  // ?mill=N is kept as the search-param name for back-compat with existing
  // bookmarks; it now filters on supplier_party_id under the hood.
  if (sp.mill)  q = q.eq('supplier_party_id', Number(sp.mill));
  if (sp.count) q = q.eq('yarn_count_id',     Number(sp.count));

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

  const supplierById = new Map(suppliers.map(s => [s.id, s]));
  const countById    = new Map(counts.map(c => [c.id, c]));

  // Group lots by (supplier_party_id, yarn_count_id)
  const grouped = new Map<string, YarnRow>();
  (lots ?? []).forEach((l: any) => {
    const key = `${l.supplier_party_id ?? 0}|${l.yarn_count_id}`;
    const s = supplierById.get(l.supplier_party_id);
    const c = countById.get(l.yarn_count_id);
    let row = grouped.get(key);
    if (!row) {
      row = {
        supplier_id: l.supplier_party_id ?? 0,
        supplier_name: s?.name ?? '—',
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
        <Kpi label="Distinct (Supplier × Count)" value={String(rows.length)} icon={TrendingDown} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Count</th>
              <th className="text-left px-4 py-3">Supplier</th>
              <th className="text-right px-4 py-3">On Hand</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Avg ₹/kg</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Stock Value</th>
              <th className="text-right px-4 py-3">Lots</th>
              <th className="text-right px-4 py-3 hidden sm:table-cell">Used in Batches</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.supplier_id}-${r.yarn_count_id}`} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.count_code}</div>
                  <div className="text-[11px] text-ink-soft">{r.count_name}</div>
                </td>
                <td className="px-4 py-3">{r.supplier_name}</td>
                <td className={'px-4 py-3 text-right num font-semibold ' + (r.available_kg < 0 ? 'text-rose-700' : '')}>{formatKg(r.available_kg, 1)}</td>
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
      // Show negative balances too — over-issued bobbins are a real
      // discrepancy the operator needs to see, not hide.
      .neq('quantity', 0);
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
    .neq('quantity_pcs', 0);

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
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
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
                <td className={'px-4 py-3 text-right num font-semibold ' + (r.total_pcs < 0 ? 'text-rose-700' : '')}>{r.total_pcs.toFixed(2)}</td>
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
  // fabric_quality.id — resolved from costing_master.quality_code →
  // fabric_quality.code (both unique). Used to drill into the per-quality
  // stock ledger at /app/warehouse/fabric/[qualityId]. Null when the
  // costing's quality_code has no matching row in fabric_quality.
  fabric_quality_id: number | null;
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
    .neq('metres_available', 0)
    .order('received_at', { ascending: false });
  // In-house fabric warehouse holds EVERY quality the mill owns,
  // regardless of how it was produced:
  //   • inhouse    — own warp + own loom
  //   • outsourced — own yarn, external weaver
  //   • jobwork    — customer-owned yarn, you weave (yes we count it
  //                  here too because it physically sits in our shed)
  //   • resale     — bought finished cloth to resell
  // Jobwork mode and Outsource mode keep their narrow views so each
  // warehouse tab still tells its own story.
  if (mode === 'jobwork') {
    q = q.eq('source_type', 'jobwork');
  } else if (mode === 'outsource') {
    q = q.eq('source_type', 'outsourced');
  } else {
    q = q.in('source_type', ['inhouse', 'outsourced', 'jobwork', 'resale']);
  }
  const { data } = await q;

  const grouped = new Map<string, FabricRow>();
  (data ?? []).forEach((r: any) => {
    const key = `${r.costing_id}|${r.source_type}`;
    let row = grouped.get(key);
    if (!row) {
      row = {
        costing_id: r.costing_id,
        fabric_quality_id: null,                // filled in below via batch lookup
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

  // ── In-house: fabric PURCHASES are stock too ──
  // Every fabric_purchase delivered in_house with metres left counts as
  // resale stock on its fabric quality. This is the inflow recorded
  // when a purchase is added on Inhouse Stock → Fabric Stock; selling
  // it from the Fabric Sale invoice reduces current_metres.
  if (mode === 'inhouse') {
    const { data: purchases } = await supabase
      .from('fabric_purchase')
      .select('id, current_metres, rate, fabric_quality_id, quality:fabric_quality_id ( code, name )')
      .eq('status', 'active')
      .eq('delivery_destination', 'in_house')
      .neq('current_metres', 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of ((purchases ?? []) as any[])) {
      const key = `fp|${p.fabric_quality_id ?? 'x'}`;
      let row = grouped.get(key);
      if (!row) {
        row = {
          costing_id: 0,
          fabric_quality_id: p.fabric_quality_id ?? null,
          quality_code: p.quality?.code ?? '—',
          quality_name: p.quality?.name ?? '',
          source_type: 'resale',
          metres_available: 0,
          avg_cost_per_m: 0,
          receipts: 0,
        };
        grouped.set(key, row);
      }
      const m    = Number(p.current_metres);
      const cost = Number(p.rate ?? 0);
      row.avg_cost_per_m = (row.metres_available * row.avg_cost_per_m + m * cost) /
                           ((row.metres_available + m) || 1);
      row.metres_available += m;
      row.receipts += 1;
    }
  }

  // Resolve fabric_quality_id for every distinct quality_code in one
  // round-trip. costing_master.quality_code and fabric_quality.code are
  // both unique strings, so the join is by code.
  const codes = Array.from(new Set(
    Array.from(grouped.values())
      .map((r) => r.quality_code)
      .filter((c) => c && c !== '—'),
  ));
  if (codes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: qRows } = await supabase
      .from('fabric_quality')
      .select('id, code')
      .in('code', codes);
    const codeToId = new Map<string, number>(
      ((qRows ?? []) as Array<{ id: number; code: string }>).map((q) => [q.code, Number(q.id)]),
    );
    grouped.forEach((row) => {
      row.fabric_quality_id = codeToId.get(row.quality_code) ?? null;
    });
  }

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
      {/* Mobile: one card per Quality × Source row. */}
      <div className="md:hidden space-y-3">
        {rows.map(r => (
          <div key={`${r.costing_id}-${r.source_type}`} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                {r.fabric_quality_id != null ? (
                  <Link href={`/app/warehouse/fabric/${r.fabric_quality_id}`} className="group inline-block" title="Open per-quality stock ledger">
                    <div className="font-semibold text-indigo-700 group-hover:underline">{r.quality_code}</div>
                    <div className="text-[11px] text-ink-soft">{r.quality_name}</div>
                  </Link>
                ) : (
                  <>
                    <div className="font-semibold">{r.quality_code}</div>
                    <div className="text-[11px] text-ink-soft">{r.quality_name}</div>
                  </>
                )}
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded ${SOURCE_PILL[r.source_type] ?? 'bg-cloud'}`}>
                {SOURCE_LABEL[r.source_type] ?? r.source_type}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-sm">
              <div className="flex justify-between"><span className="text-ink-mute text-xs">Available</span><span className={'num font-semibold ' + (r.metres_available < 0 ? 'text-rose-700' : '')}>{formatMetres(r.metres_available, 1)}</span></div>
              <div className="flex justify-between"><span className="text-ink-mute text-xs">Receipts</span><span className="num">{r.receipts}</span></div>
              <div className="flex justify-between"><span className="text-ink-mute text-xs">Avg ₹/m</span><span className="num">{formatRupee(r.avg_cost_per_m, { decimals: 2 })}</span></div>
              <div className="flex justify-between"><span className="text-ink-mute text-xs">Value</span><span className="num">{formatRupee(r.metres_available * r.avg_cost_per_m, { compact: true })}</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: full summary table. */}
      <div className="card overflow-auto max-h-[75vh] hidden md:block">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3 sticky left-0 top-0 bg-cloud z-40">Quality</th>
              <th className="text-left px-4 py-3 sticky top-0 bg-cloud z-30">Source</th>
              <th className="text-right px-4 py-3 sticky top-0 bg-cloud z-30">Available</th>
              <th className="text-right px-4 py-3 hidden md:table-cell sticky top-0 bg-cloud z-30">Avg ₹/m</th>
              <th className="text-right px-4 py-3 hidden md:table-cell sticky top-0 bg-cloud z-30">Stock Value</th>
              <th className="text-right px-4 py-3 sticky top-0 bg-cloud z-30">Receipts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.costing_id}-${r.source_type}`} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 sticky left-0 bg-paper z-10">
                  {r.fabric_quality_id != null ? (
                    <Link
                      href={`/app/warehouse/fabric/${r.fabric_quality_id}`}
                      className="group inline-block"
                      title="Open per-quality stock ledger"
                    >
                      <div className="font-semibold text-indigo-700 group-hover:underline">
                        {r.quality_code}
                      </div>
                      <div className="text-[11px] text-ink-soft">{r.quality_name}</div>
                    </Link>
                  ) : (
                    <>
                      <div className="font-semibold">{r.quality_code}</div>
                      <div className="text-[11px] text-ink-soft">{r.quality_name}</div>
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded ${SOURCE_PILL[r.source_type] ?? 'bg-cloud'}`}>
                    {SOURCE_LABEL[r.source_type] ?? r.source_type}
                  </span>
                </td>
                <td className={'px-4 py-3 text-right num font-semibold ' + (r.metres_available < 0 ? 'text-rose-700' : '')}>{formatMetres(r.metres_available, 1)}</td>
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

// ─── Jobwork / Outsource Fabric — per-event pivot ledger ────────────────────
// Mirrors the In-house "Production Fabric" pivot (Date / Reference / one
// column per fabric quality with a running balance), but sourced from
// fabric_stock instead of stock_ledger. Each fabric_stock row expands into
// an IN event (metres_in, dated at received_at, referenced by its batch
// code) and — when depleted — an OUT event (metres_out) so the column's
// closing balance equals metres_available, matching the old summary view.
// Columns key by fabric_quality_id (resolved from the costing's quality
// code) so the Fabric Quality filter lines up; party comes from the batch.
async function loadJobworkFabricPivot(supabase: any, sp: SP, mode: Mode): Promise<PivotData> {
  const sourceType = mode === 'outsource' ? 'outsourced' : 'jobwork';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('fabric_stock')
    .select(`
      id, costing_id, metres_in, metres_out, received_at, batch_id,
      costing:costing_id ( quality_code, quality_name )
    `)
    .eq('source_type', sourceType)
    .order('received_at');
  const rows = ((data ?? []) as Array<{
    id: number;
    metres_in: number | string | null;
    metres_out: number | string | null;
    received_at: string | null;
    batch_id: number | null;
    costing: { quality_code: string | null; quality_name: string | null } | null;
  }>);

  // Batch code (for the Reference column) + party_id (for the party filter).
  const batchIds = Array.from(new Set(rows.map((r) => r.batch_id).filter((x): x is number => x != null)));
  const batchById = new Map<number, { batch_code: string | null; party_id: number | null }>();
  if (batchIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bRows } = await (supabase as any)
      .from('production_batch').select('id, batch_code, party_id').in('id', batchIds);
    for (const b of ((bRows ?? []) as Array<{ id: number; batch_code: string | null; party_id: number | null }>)) {
      batchById.set(b.id, { batch_code: b.batch_code, party_id: b.party_id });
    }
  }

  // costing.quality_code → fabric_quality (id + name). Both codes are unique
  // strings, so the join is by code. The id keys the pivot column so the
  // Fabric Quality filter (a fabric_quality.id) matches.
  const codes = Array.from(new Set(rows.map((r) => r.costing?.quality_code).filter((c): c is string => !!c)));
  const qualityByCode = new Map<string, { id: number; name: string }>();
  if (codes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: qRows } = await (supabase as any)
      .from('fabric_quality').select('id, code, name').in('code', codes);
    for (const q of ((qRows ?? []) as Array<{ id: number; code: string; name: string }>)) {
      qualityByCode.set(q.code, { id: q.id, name: q.name });
    }
  }

  const partyFilter = sp.party && /^\d+$/.test(sp.party) ? Number(sp.party) : null;

  const cols = new Map<string, PivotColumn>();
  const events: PivotEvent[] = [];

  for (const r of rows) {
    const batch = r.batch_id != null ? batchById.get(r.batch_id) : undefined;
    if (partyFilter !== null && (batch?.party_id ?? null) !== partyFilter) continue;

    const code = r.costing?.quality_code ?? null;
    const q = code ? qualityByCode.get(code) : undefined;
    const colId = q ? `fq:${q.id}` : code ? `code:${code}` : 'unknown';
    if (!cols.has(colId)) {
      cols.set(colId, { id: colId, label: code ?? '(no quality)', sublabel: q?.name ?? r.costing?.quality_name ?? '' });
    }

    const ref = batch?.batch_code ?? `Receipt #${r.id}`;
    const mIn = Number(r.metres_in ?? 0);
    const mOut = Number(r.metres_out ?? 0);
    if (mIn > 0) events.push({ event_date: r.received_at ?? '', column_id: colId, direction: 'in', quantity: mIn, reference: ref, notes: '' });
    if (mOut > 0) events.push({ event_date: r.received_at ?? '', column_id: colId, direction: 'out', quantity: mOut, reference: ref, notes: 'Shipped / depleted' });
  }

  // Fabric Quality filter — keep only the chosen quality's column + events.
  const qualityFilter = sp.quality && /^\d+$/.test(sp.quality) ? `fq:${sp.quality}` : null;
  let columns = Array.from(cols.values()).sort((a, b) => a.label.localeCompare(b.label));
  let evs = events;
  if (qualityFilter) {
    columns = columns.filter((c) => c.id === qualityFilter);
    evs = events.filter((e) => e.column_id === qualityFilter);
  }

  return { unit: 'm', columns, events: evs };
}

// ─── Fabric lineage (per-event view for the In-house Fabric tab) ────────────
// One row per stock event so the operator can see for every metre of
// fabric: which DC brought it in, which fabric receipt logged it, and
// which sales invoice (if any) took it out — plus the payment status
// of that invoice. Two event kinds share the same shape:
//   • IN  — sourced from fabric_receipt_item joined to fabric_receipt
//           and to its source DC (the DC we sent OUT to the weaver, or
//           the DC representing our own production).
//   • OUT — sourced from delivery_challan_item where the DC's
//           production_mode = 'inhouse' (the DC that goes TO a customer)
//           plus the invoice it's linked to and that invoice's payment
//           rollup.
// Joined and merged in the page so neither side needs a new view.
type FabricLineageDirection = 'in' | 'out';
type FabricLineageStatus =
  | 'in_stock'
  | 'invoiced_paid'
  | 'invoiced_unpaid'
  | 'invoiced_partial'
  | 'draft_dc';

interface FabricLineageRow {
  id: string;                         // composite key for React
  direction: FabricLineageDirection;
  event_date: string;                 // ISO
  quality_id: number | null;
  quality_code: string;
  quality_name: string;
  source_kind: 'inhouse' | 'jobwork' | 'outsource' | 'resale' | 'unknown';
  dc_id: number | null;
  dc_code: string | null;
  receipt_id: number | null;
  receipt_code: string | null;
  invoice_id: number | null;
  invoice_no: string | null;
  party_name: string;
  metres: number;
  invoice_total: number;              // 0 for IN rows
  invoice_paid: number;               // 0 for IN rows
  invoice_balance: number;            // 0 for IN rows
  status: FabricLineageStatus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFabricLineage(supabase: any, sp: SP): Promise<FabricLineageRow[]> {
  const qualityFilter = sp.quality && /^\d+$/.test(sp.quality) ? Number(sp.quality) : null;

  // ── IN side: fabric_receipt_item × fabric_receipt × delivery_challan ──
  let inQ = supabase.from('fabric_receipt_item').select(`
    id, fabric_quality_id, received_metres,
    receipt:receipt_id (
      id, code, receipt_date, party_id,
      dc:dc_id ( id, code, production_mode ),
      party:party_id ( id, name )
    )
  `);
  if (qualityFilter !== null) inQ = inQ.eq('fabric_quality_id', qualityFilter);
  const { data: inRowsRaw } = await inQ;

  // ── OUT side: delivery_challan_item × delivery_challan × invoice ──
  // EVERY DC type reduces in-house fabric stock — the cloth physically
  // leaves our shed in all three cases:
  //   • inhouse   — sale to customer (invoiced)
  //   • outsource — fabric going out to a vendor (e.g. for finishing) or sold
  //   • jobwork   — finished cloth returned to the customer who owns the yarn
  // We surface all three modes so the per-quality stock ledger matches
  // the physical movement on the floor. The Source column distinguishes
  // them visually.
  let outQ = supabase.from('delivery_challan_item').select(`
    id, fabric_quality_id, metres,
    dc:dc_id!inner (
      id, code, dc_date, status, production_mode, invoice_id, bill_to_name,
      invoice:invoice_id ( id, invoice_no, total, amount_paid, balance, status )
    )
  `).in('dc.production_mode', ['inhouse', 'outsource', 'jobwork']);
  if (qualityFilter !== null) outQ = outQ.eq('fabric_quality_id', qualityFilter);
  const { data: outRowsRaw } = await outQ;

  // ── IN side 2: fabric PURCHASES (resale stock bought in) ──
  let purQ = supabase.from('fabric_purchase').select(`
    id, code, received_date, received_metres, fabric_quality_id,
    supplier:supplier_party_id ( name )
  `).eq('status', 'active').eq('delivery_destination', 'in_house');
  if (qualityFilter !== null) purQ = purQ.eq('fabric_quality_id', qualityFilter);
  const { data: purRowsRaw } = await purQ;

  // ── OUT side 2: Fabric Sale invoice lines sold "Direct from Stock"
  //    (each carries the fabric_purchase batch it sold from) ──
  const { data: saleRowsRaw } = await supabase.from('invoice_line').select(`
    id, quantity,
    purchase:fabric_purchase_id!inner ( id, code, fabric_quality_id ),
    invoice:invoice_id!inner ( id, invoice_no, invoice_date, total, amount_paid, balance, status, party_name )
  `).not('fabric_purchase_id', 'is', null);

  // ── Quality lookup ──
  const qIds = new Set<number>();
  for (const r of (inRowsRaw ?? []) as Array<{ fabric_quality_id: number | null }>) if (r.fabric_quality_id) qIds.add(r.fabric_quality_id);
  for (const r of (outRowsRaw ?? []) as Array<{ fabric_quality_id: number | null }>) if (r.fabric_quality_id) qIds.add(r.fabric_quality_id);
  for (const r of (purRowsRaw ?? []) as Array<{ fabric_quality_id: number | null }>) if (r.fabric_quality_id) qIds.add(r.fabric_quality_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((saleRowsRaw ?? []) as any[])) if (r.purchase?.fabric_quality_id) qIds.add(Number(r.purchase.fabric_quality_id));
  let qualityById = new Map<number, { code: string; name: string }>();
  if (qIds.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: qRows } = await (supabase as any)
      .from('fabric_quality').select('id, code, name').in('id', Array.from(qIds));
    qualityById = new Map((qRows ?? []).map((q: { id: number; code: string; name: string }) => [q.id, { code: q.code, name: q.name }]));
  }

  const sourceKindFromMode = (mode: string | null | undefined): FabricLineageRow['source_kind'] => {
    if (mode === 'inhouse') return 'inhouse';
    if (mode === 'jobwork') return 'jobwork';
    if (mode === 'outsource') return 'outsource';
    return 'unknown';
  };

  const inRows: FabricLineageRow[] = ((inRowsRaw ?? []) as Array<{
    id: number; fabric_quality_id: number | null; received_metres: number | string | null;
    receipt: { id: number; code: string | null; receipt_date: string | null; party_id: number | null;
      dc: { id: number; code: string | null; production_mode: string | null } | null;
      party: { id: number; name: string | null } | null;
    } | null;
  }>).map((r): FabricLineageRow => {
    const qid = r.fabric_quality_id;
    const q = qid != null ? qualityById.get(qid) : null;
    return {
      id: `in:${r.id}`,
      direction: 'in',
      event_date: r.receipt?.receipt_date ?? '',
      quality_id: qid,
      quality_code: q?.code ?? '—',
      quality_name: q?.name ?? '',
      source_kind: sourceKindFromMode(r.receipt?.dc?.production_mode),
      dc_id: r.receipt?.dc?.id ?? null,
      dc_code: r.receipt?.dc?.code ?? null,
      receipt_id: r.receipt?.id ?? null,
      receipt_code: r.receipt?.code ?? null,
      invoice_id: null,
      invoice_no: null,
      party_name: r.receipt?.party?.name ?? '—',
      metres: Number(r.received_metres ?? 0),
      invoice_total: 0,
      invoice_paid: 0,
      invoice_balance: 0,
      status: 'in_stock',
    };
  });

  const outRows: FabricLineageRow[] = ((outRowsRaw ?? []) as Array<{
    id: number; fabric_quality_id: number | null; metres: number | string | null;
    dc: { id: number; code: string | null; dc_date: string | null; status: string | null;
      production_mode: string | null; invoice_id: number | null; bill_to_name: string | null;
      invoice: { id: number; invoice_no: string | null; total: number | string | null;
        amount_paid: number | string | null; balance: number | string | null; status: string | null;
      } | null;
    };
  }>).map((r): FabricLineageRow => {
    const qid = r.fabric_quality_id;
    const q = qid != null ? qualityById.get(qid) : null;
    const inv = r.dc?.invoice ?? null;
    const total = Number(inv?.total ?? 0);
    const paid  = Number(inv?.amount_paid ?? 0);
    const balance = Number(inv?.balance ?? Math.max(0, total - paid));
    let status: FabricLineageStatus;
    if (!inv) status = 'draft_dc';
    else if (balance <= 0.01 && total > 0) status = 'invoiced_paid';
    else if (paid > 0 && balance > 0.01) status = 'invoiced_partial';
    else status = 'invoiced_unpaid';
    return {
      id: `out:${r.id}`,
      direction: 'out',
      event_date: r.dc?.dc_date ?? '',
      quality_id: qid,
      quality_code: q?.code ?? '—',
      quality_name: q?.name ?? '',
      source_kind: sourceKindFromMode(r.dc?.production_mode),
      dc_id: r.dc?.id ?? null,
      dc_code: r.dc?.code ?? null,
      receipt_id: null,
      receipt_code: null,
      invoice_id: inv?.id ?? null,
      invoice_no: inv?.invoice_no ?? null,
      party_name: r.dc?.bill_to_name ?? '—',
      metres: Number(r.metres ?? 0),
      invoice_total: total,
      invoice_paid: paid,
      invoice_balance: balance,
      status,
    };
  });

  // Purchases → IN events (resale stock arriving).
  const purchaseRows: FabricLineageRow[] = ((purRowsRaw ?? []) as Array<{
    id: number; code: string | null; received_date: string | null;
    received_metres: number | string | null; fabric_quality_id: number | null;
    supplier: { name: string | null } | null;
  }>).map((r): FabricLineageRow => {
    const q = r.fabric_quality_id != null ? qualityById.get(r.fabric_quality_id) : null;
    return {
      id: `fp:${r.id}`,
      direction: 'in',
      event_date: r.received_date ?? '',
      quality_id: r.fabric_quality_id,
      quality_code: q?.code ?? '—',
      quality_name: q?.name ?? '',
      source_kind: 'resale',
      dc_id: null,
      dc_code: r.code,
      receipt_id: null,
      receipt_code: null,
      invoice_id: null,
      invoice_no: null,
      party_name: r.supplier?.name ?? '—',
      metres: Number(r.received_metres ?? 0),
      invoice_total: 0,
      invoice_paid: 0,
      invoice_balance: 0,
      status: 'in_stock',
    };
  });

  // Fabric Sale "Direct from Stock" lines → OUT events.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saleRows: FabricLineageRow[] = (((saleRowsRaw ?? []) as any[])
    .filter((r) => qualityFilter === null || Number(r.purchase?.fabric_quality_id) === qualityFilter)
    .map((r): FabricLineageRow => {
      const qid = r.purchase?.fabric_quality_id != null ? Number(r.purchase.fabric_quality_id) : null;
      const q = qid != null ? qualityById.get(qid) : null;
      const total = Number(r.invoice?.total ?? 0);
      const paid = Number(r.invoice?.amount_paid ?? 0);
      const balance = Number(r.invoice?.balance ?? Math.max(0, total - paid));
      let status: FabricLineageStatus;
      if (balance <= 0.01 && total > 0) status = 'invoiced_paid';
      else if (paid > 0 && balance > 0.01) status = 'invoiced_partial';
      else status = 'invoiced_unpaid';
      return {
        id: `sale:${r.id}`,
        direction: 'out',
        event_date: String(r.invoice?.invoice_date ?? ''),
        quality_id: qid,
        quality_code: q?.code ?? '—',
        quality_name: q?.name ?? '',
        source_kind: 'resale',
        dc_id: null,
        dc_code: r.purchase?.code ?? null,
        receipt_id: null,
        receipt_code: null,
        invoice_id: r.invoice?.id ?? null,
        invoice_no: r.invoice?.invoice_no ?? null,
        party_name: r.invoice?.party_name ?? '—',
        metres: Number(r.quantity ?? 0),
        invoice_total: total,
        invoice_paid: paid,
        invoice_balance: balance,
        status,
      };
    }));

  return [...inRows, ...outRows, ...purchaseRows, ...saleRows].sort((a, b) =>
    a.event_date === b.event_date ? a.id.localeCompare(b.id) : (a.event_date < b.event_date ? 1 : -1),
  );
}

const LINEAGE_STATUS_PILL: Record<FabricLineageStatus, { label: string; cls: string }> = {
  in_stock:         { label: 'In Stock',         cls: 'bg-emerald-50 text-emerald-700' },
  invoiced_paid:    { label: 'Invoiced · Paid',  cls: 'bg-emerald-100 text-emerald-800' },
  invoiced_partial: { label: 'Invoiced · Part',  cls: 'bg-amber-50 text-amber-700' },
  invoiced_unpaid:  { label: 'Invoiced · Unpaid',cls: 'bg-rose-50 text-rose-700' },
  draft_dc:         { label: 'DC (no invoice)',  cls: 'bg-slate-100 text-slate-600' },
};

const SOURCE_KIND_LABEL: Record<FabricLineageRow['source_kind'], string> = {
  inhouse:   'In-house',
  jobwork:   'Job Work',
  outsource: 'Outsource',
  resale:    'Resale',
  unknown:   '—',
};

function FabricLineageView({ rows }: { rows: FabricLineageRow[] }): React.ReactElement {
  if (rows.length === 0) {
    return (
      <div className="card p-6 text-center text-ink-soft text-sm mt-4">
        No incoming or outgoing fabric events yet.
      </div>
    );
  }
  const received = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.metres, 0);
  const invoicedOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.metres, 0);
  const unpaidValue = rows
    .filter((r) => r.direction === 'out' && (r.status === 'invoiced_unpaid' || r.status === 'invoiced_partial'))
    .reduce((s, r) => s + r.invoice_balance, 0);

  return (
    <>
      <div className="grid sm:grid-cols-4 gap-3 mt-6 mb-3">
        <Kpi label="Events shown"    value={String(rows.length)} icon={Layers} />
        <Kpi label="Received (in)"   value={formatMetres(received, 0)} icon={Truck} />
        <Kpi label="Sold (out)"      value={formatMetres(invoicedOut, 0)} icon={Truck} />
        <Kpi label="Unpaid (₹)"      value={formatRupee(unpaidValue, { compact: true })} icon={Coins} />
      </div>
      {/* Mobile: one card per fabric event. */}
      <div className="md:hidden space-y-3">
        {rows.map((r) => {
          let pill = LINEAGE_STATUS_PILL[r.status];
          if (r.direction === 'out' && r.source_kind === 'jobwork') {
            pill = { label: 'Jobwork Return', cls: 'bg-amber-50 text-amber-700' };
          } else if (r.direction === 'out' && r.source_kind === 'outsource' && r.status === 'draft_dc') {
            pill = { label: 'Outsource Send', cls: 'bg-indigo-50 text-indigo-700' };
          }
          return (
            <div key={r.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {r.quality_id != null ? (
                    <Link href={`/app/warehouse/fabric/${r.quality_id}`} className="group inline-block" title="Open per-quality stock ledger">
                      <div className="font-semibold text-indigo-700 group-hover:underline">{r.quality_code}</div>
                      {r.quality_name && <div className="text-[10px] text-ink-mute">{r.quality_name}</div>}
                    </Link>
                  ) : (
                    <>
                      <div className="font-semibold">{r.quality_code}</div>
                      {r.quality_name && <div className="text-[10px] text-ink-mute">{r.quality_name}</div>}
                    </>
                  )}
                  <div className="text-[11px] text-ink-soft mt-1">{r.event_date || '—'}</div>
                </div>
                <div className="text-right">
                  <div className={'num font-semibold ' + (r.direction === 'in' ? 'text-emerald-700' : 'text-rose-600')}>
                    {(r.direction === 'in' ? '+ ' : '\u2212 ') + formatMetres(r.metres, 1)}
                  </div>
                  <span className={`pill ${pill.cls} text-[10px] uppercase tracking-wide mt-1 inline-block`}>{pill.label}</span>
                </div>
              </div>
              <div className="text-xs mt-2">
                <span className="inline-flex items-center gap-1">
                  <span className={'inline-block w-1.5 h-1.5 rounded-full ' + (r.direction === 'in' ? 'bg-emerald-500' : 'bg-rose-500')} />
                  {SOURCE_KIND_LABEL[r.source_kind]} · {r.direction === 'in' ? 'IN' : 'OUT'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-ink-mute">DC</span>
                  {r.dc_id != null ? <Link href={`/app/delivery-challan/${r.dc_id}`} className="text-indigo-700 hover:underline font-mono">{r.dc_code ?? '—'}</Link> : <span className="text-ink-mute font-mono">—</span>}
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-ink-mute">Receipt</span>
                  {r.receipt_id != null ? <Link href={`/app/jobwork/fabric-receipt/${r.receipt_id}`} className="text-indigo-700 hover:underline font-mono">{r.receipt_code ?? '—'}</Link> : <span className="text-ink-mute font-mono">—</span>}
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-ink-mute">Invoice</span>
                  {r.invoice_id != null ? <Link href={`/app/invoices/${r.invoice_id}`} className="text-indigo-700 hover:underline font-mono">{r.invoice_no ?? `#${r.invoice_id}`}</Link> : <span className="text-ink-mute font-mono">—</span>}
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-ink-mute">Party</span>
                  <span className="text-right">{r.party_name}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: full per-event table. */}
      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-3 sticky left-0 z-20 bg-cloud">Date</th>
              <th className="text-left  px-3 py-3">Quality</th>
              <th className="text-left  px-3 py-3">Source</th>
              <th className="text-left  px-3 py-3">DC</th>
              <th className="text-left  px-3 py-3">Fabric Receipt</th>
              <th className="text-left  px-3 py-3">Invoice</th>
              <th className="text-left  px-3 py-3">Party</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-left  px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // For non-inhouse OUT events (jobwork return / outsource send)
              // the invoice-status pill is meaningless because there is no
              // sale invoice — these are physical movements out of the shed.
              // We override the pill so the operator sees the movement type
              // instead of "DC (no invoice)".
              let pill = LINEAGE_STATUS_PILL[r.status];
              if (r.direction === 'out' && r.source_kind === 'jobwork') {
                pill = { label: 'Jobwork Return', cls: 'bg-amber-50 text-amber-700' };
              } else if (r.direction === 'out' && r.source_kind === 'outsource' && r.status === 'draft_dc') {
                pill = { label: 'Outsource Send', cls: 'bg-indigo-50 text-indigo-700' };
              }
              return (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap sticky left-0 z-10 bg-paper">
                    {r.event_date || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.quality_id != null ? (
                      <Link
                        href={`/app/warehouse/fabric/${r.quality_id}`}
                        className="group inline-block"
                        title="Open per-quality stock ledger"
                      >
                        <div className="font-semibold text-indigo-700 group-hover:underline">{r.quality_code}</div>
                        {r.quality_name && <div className="text-[10px] text-ink-mute">{r.quality_name}</div>}
                      </Link>
                    ) : (
                      <>
                        <div className="font-semibold">{r.quality_code}</div>
                        {r.quality_name && <div className="text-[10px] text-ink-mute">{r.quality_name}</div>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className={'inline-block w-1.5 h-1.5 rounded-full ' +
                        (r.direction === 'in' ? 'bg-emerald-500' : 'bg-rose-500')} />
                      {SOURCE_KIND_LABEL[r.source_kind]} · {r.direction === 'in' ? 'IN' : 'OUT'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.dc_id != null
                      ? <Link href={`/app/delivery-challan/${r.dc_id}`} className="text-indigo-700 hover:underline">{r.dc_code ?? '—'}</Link>
                      : <span className="text-ink-mute">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.receipt_id != null
                      ? <Link href={`/app/jobwork/fabric-receipt/${r.receipt_id}`} className="text-indigo-700 hover:underline">{r.receipt_code ?? '—'}</Link>
                      : <span className="text-ink-mute">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.invoice_id != null
                      ? <Link href={`/app/invoices/${r.invoice_id}`} className="text-indigo-700 hover:underline">{r.invoice_no ?? `#${r.invoice_id}`}</Link>
                      : <span className="text-ink-mute">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.party_name}</td>
                  <td className={'px-3 py-2 text-right num font-semibold ' + (r.direction === 'in' ? 'text-emerald-700' : 'text-rose-600')}>
                    {(r.direction === 'in' ? '+ ' : '\u2212 ') + formatMetres(r.metres, 1)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`pill ${pill.cls} text-[11px] uppercase tracking-wide`}>{pill.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-mute mt-2">
        IN rows come from Fabric Receipts (cloth arriving in the shed). OUT rows come from every DC type —
        in-house Sales DCs show their invoice payment status; Jobwork DCs are tagged &ldquo;Jobwork Return&rdquo;
        (cloth returned to the yarn owner); Outsource DCs without an invoice are tagged &ldquo;Outsource Send&rdquo;.
      </p>
    </>
  );
}

// ─── Jobwork pivot view ─────────────────────────────────────────────────────
// Pivot table: one column per (ends count / yarn count / bobbin spec),
// one row per movement (date + reference). Each row shows the metres /
// kg / pcs for that movement under the matching column. Footer shows
// per-column totals and closing balance. Outflow rows come from
// stock_ledger; inflow rows from jobwork_warp_beam / jobwork_weft_bag /
// bobbin master.

type LedgerUnit = 'm' | 'kg' | 'pcs';

interface PivotColumn {
  id: string;
  label: string;
  sublabel?: string;
}

interface PivotEvent {
  event_date: string;
  column_id: string;
  direction: 'in' | 'out';
  quantity: number;
  reference: string;
  notes: string;
}

interface PivotData {
  unit: LedgerUnit;
  columns: PivotColumn[];
  events: PivotEvent[];
}

/** Pivot-style ledger. Rows = events (date), columns = ends / yarn count /
 *  bobbin spec. Each row populates one cell with the in/out delta. Footer
 *  shows totals per column. Date column shown on the left so the user can
 *  scan timeline; column headers run across the top for "warp metre,
 *  weft, bobbin, porvai" tabs. */
function PivotView({ data, emptyMessage }: { data: PivotData; emptyMessage: string }) {
  if (data.events.length === 0 && data.columns.length === 0) {
    return <div className="card p-8 text-center text-ink-soft text-sm">{emptyMessage}</div>;
  }
  // True chronological order: by event_date asc, then inflows before
  // outflows on the same date (so the day's beam-given event appears
  // before the day's fabric-receipt event), then by column id as a
  // stable tiebreaker. This is what gives us an accurate per-event
  // running balance below.
  const sorted = [...data.events].sort((a, b) => {
    if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1;
    if (a.direction !== b.direction) return a.direction === 'in' ? -1 : 1;
    return a.column_id.localeCompare(b.column_id);
  });

  const totals: Record<string, { in: number; out: number }> = {};
  for (const col of data.columns) totals[col.id] = { in: 0, out: 0 };
  for (const e of sorted) {
    const t = totals[e.column_id] ?? (totals[e.column_id] = { in: 0, out: 0 });
    if (e.direction === 'in') t.in += e.quantity;
    else                       t.out += e.quantity;
  }
  const grandClosing = data.columns.reduce((s, c) => s + (totals[c.id]?.in ?? 0) - (totals[c.id]?.out ?? 0), 0);
  const grandIn      = data.columns.reduce((s, c) => s + (totals[c.id]?.in ?? 0), 0);
  const grandOut     = data.columns.reduce((s, c) => s + (totals[c.id]?.out ?? 0), 0);

  // Pre-compute the per-event running balance per column so each row
  // can render the new balance INSIDE the active cell. Walk the
  // chronologically-sorted events once, capture the snapshot of the
  // active column AFTER applying that event. The running-balance pass
  // MUST stay chronological for the math to work — once it's done we
  // reverse the rows for display so the newest event is at the top.
  const runningByCol: Record<string, number> = {};
  for (const col of data.columns) runningByCol[col.id] = 0;
  const balanceAfterEvent: number[] = new Array(sorted.length).fill(0);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    const cur = runningByCol[e.column_id] ?? 0;
    const next = e.direction === 'in' ? cur + e.quantity : cur - e.quantity;
    runningByCol[e.column_id] = next;
    balanceAfterEvent[i] = next;
  }
  // Display order: newest at the top so the most recent entry is
  // visible without scrolling. We pair each event with its
  // chronological running balance index so the "bal X" inside the
  // active cell still reflects the balance AS OF that event.
  type DisplayRow = { event: PivotEvent; balanceAfter: number };
  const displayRows: DisplayRow[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    displayRows.push({ event: sorted[i]!, balanceAfter: balanceAfterEvent[i] ?? 0 });
  }

  return (
    <>
      <div className="grid sm:grid-cols-4 gap-3 mb-4">
        <Kpi label="Closing balance" value={fmtUnit(grandClosing, data.unit)} icon={Coins} negative={grandClosing < 0} />
        <Kpi label="Total inflow"    value={fmtUnit(grandIn, data.unit)}      icon={Layers} />
        <Kpi label="Total outflow"   value={fmtUnit(grandOut, data.unit)}     icon={TrendingDown} />
        <Kpi label="Columns × events" value={`${data.columns.length} × ${sorted.length}`} icon={Package} />
      </div>

      {/* Mobile: one summary card per column (beam / quality / spec).
          Each card collapses that column's pivot maths into total in,
          total out and closing balance so the operator never has to
          scroll a wide matrix on a phone. */}
      <div className="md:hidden space-y-3">
        {data.columns.length === 0 ? (
          <div className="card p-6 text-center text-ink-soft text-xs">No stock items yet.</div>
        ) : data.columns.map(c => {
          const tin = totals[c.id]?.in ?? 0;
          const tout = totals[c.id]?.out ?? 0;
          const closing = tin - tout;
          return (
            <div key={c.id} className="card p-4">
              <div className="font-bold text-ink text-sm">{c.label}</div>
              {c.sublabel && <div className="text-[11px] text-ink-mute">{c.sublabel}</div>}
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">In</div>
                  <div className="num text-sm text-emerald-700">{'+ ' + fmtUnit(tin, data.unit)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Out</div>
                  <div className="num text-sm text-rose-700">{'\u2212 ' + fmtUnit(tout, data.unit)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Balance</div>
                  <div className={`num text-sm font-bold ${closing < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{fmtUnit(closing, data.unit)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: full pivot matrix (one row per movement). */}
      <div className="card overflow-auto max-h-[75vh] hidden md:block">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-cloud text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              {/* Frozen top-left corner: sticky both top and left. */}
              <th className="text-left px-3 py-2 sticky left-0 top-0 bg-cloud z-40">Date</th>
              <th className="text-left px-3 py-2 sticky top-0 bg-cloud z-30">Reference</th>
              {data.columns.map(c => (
                <th key={c.id} className="text-right px-3 py-2 min-w-[110px] sticky top-0 bg-cloud z-30">
                  <div className="font-bold text-ink">{c.label}</div>
                  {c.sublabel && <div className="text-[10px] font-normal text-ink-mute normal-case">{c.sublabel}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={2 + data.columns.length} className="px-3 py-6 text-center text-ink-mute text-xs">No movements yet. Issue stock from Job Work or post a Fabric Receipt to see entries here.</td></tr>
            ) : displayRows.map(({ event: e, balanceAfter }, i) => (
              <tr key={i} className="border-t border-line/40">
                <td className="px-3 py-2 text-xs text-ink-soft sticky left-0 bg-paper z-10">{e.event_date || '-'}</td>
                <td className="px-3 py-2 text-xs">
                  {e.reference}
                  {e.notes && <div className="text-[10px] text-ink-mute">{e.notes}</div>}
                </td>
                {data.columns.map(c => {
                  const isActive = e.column_id === c.id;
                  const newBalance = balanceAfter;
                  return (
                    <td key={c.id} className={`px-3 py-2 text-right num text-xs ${isActive ? (e.direction === 'in' ? 'text-emerald-700' : 'text-rose-700') : ''}`}>
                      {isActive ? (
                        <>
                          <div className="font-semibold">
                            {(e.direction === 'in' ? '+ ' : '\u2212 ') + fmtUnit(e.quantity, data.unit)}
                          </div>
                          <div className={`text-[10px] mt-0.5 ${newBalance < 0 ? 'text-rose-700' : 'text-ink-mute'}`}>
                            bal {fmtUnit(newBalance, data.unit)}
                          </div>
                        </>
                      ) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {/* Totals stick to the bottom of the scroll area so they stay
              visible while scrolling through the rows. The three rows are
              stacked with bottom offsets (~2.25rem per row) so they pin
              above one another instead of overlapping. */}
          <tfoot className="border-t-2 border-line bg-cloud font-semibold">
            <tr>
              <td className="px-3 py-2 sticky left-0 bottom-[4.5rem] bg-cloud z-30" colSpan={2}>Total In</td>
              {data.columns.map(c => {
                const v = totals[c.id]?.in ?? 0;
                return (
                  <td key={c.id} className="px-3 py-2 text-right num text-emerald-700 text-xs sticky bottom-[4.5rem] bg-cloud z-20">
                    {'+ ' + fmtUnit(v, data.unit)}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className="px-3 py-2 sticky left-0 bottom-[2.25rem] bg-cloud z-30" colSpan={2}>Total Out</td>
              {data.columns.map(c => {
                const v = totals[c.id]?.out ?? 0;
                return (
                  <td key={c.id} className="px-3 py-2 text-right num text-rose-700 text-xs sticky bottom-[2.25rem] bg-cloud z-20">
                    {'\u2212 ' + fmtUnit(v, data.unit)}
                  </td>
                );
              })}
            </tr>
            <tr className="border-t-2 border-line">
              <td className="px-3 py-2 sticky left-0 bottom-0 bg-cloud z-30" colSpan={2}>Closing balance</td>
              {data.columns.map(c => {
                const closing = (totals[c.id]?.in ?? 0) - (totals[c.id]?.out ?? 0);
                return (
                  <td key={c.id} className={`px-3 py-2 text-right num text-sm font-bold sticky bottom-0 bg-cloud z-20 ${closing < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {fmtUnit(closing, data.unit)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** Run a Supabase select and return [] on error (e.g. table missing
 *  because migration 090 not applied yet). Keeps the page rendering. */
async function safeSelect<T>(p: Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  try {
    const res = await p;
    if (res.error) return [];
    return (res.data ?? []) as T[];
  } catch {
    return [];
  }
}

/** Pull the active opening_stock rows for one (bucket, mode). Used to
 *  render an inline list with delete buttons under the form. The row
 *  shape is imported from the form component so the type stays in one
 *  place. */
async function loadExistingOpening(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bucket: 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin',
  mode: 'inhouse' | 'sizing',
): Promise<ExistingOpeningRow[]> {
  const rows = await safeSelect<ExistingOpeningRow>(
    supabase.from('opening_stock')
      .select('id, bucket, fabric_quality_id, yarn_count_id, bobbin_id, ends_per_bobbin, warp_ends, quantity, unit, open_date, reference_no, notes')
      .eq('bucket', bucket)
      .eq('mode', mode)
      .eq('status', 'active')
      .order('open_date', { ascending: false }),
  );
  return rows;
}

interface LedgerEvent {
  event_date: string;
  direction: 'in' | 'out';
  quantity: number;
  reference: string;
  notes: string;
}

interface LedgerGroup {
  key: string;
  title: string;
  subtitle: string;
  extra: string;
  unit: LedgerUnit;
  events: LedgerEvent[];
}

function fmtUnit(qty: number, unit: LedgerUnit): string {
  if (unit === 'm')   return formatMetres(qty, 1);
  if (unit === 'kg')  return formatKg(qty, 2);
  return qty.toFixed(2) + ' pcs';
}

function sortEvents(a: LedgerEvent, b: LedgerEvent): number {
  if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1;
  if (a.direction !== b.direction) return a.direction === 'in' ? -1 : 1;
  return 0;
}

// ─── Warp Beam pivot ────────────────────────────────────────────────────────
// Columns = distinct fabric qualities. For qualities with is_merged=true
// AND a merged_name set, all siblings of the merge group collapse into
// ONE column labelled with the merged_name. Standalone qualities appear
// as their own column labelled with fq.code + fq.name.
// Rows = each warp-beam-given event (inflow) and each fabric-receipt-
// consumed event (outflow), in date order. Cell = +metres for inflow,
// -metres for outflow.
// ─── In-house pivot loader ──────────────────────────────────────────────────
// Aggregates inflows AND outflows for the requested in-house bucket
// and shapes them into the PivotData the warehouse view expects.
//   - warp_beam   → columns = fabric quality (or merged_name)
//   - weft_yarn   → columns = yarn count
//   - porvai_yarn → columns = yarn count
//   - bobbin      → columns = ends_per_bobbin
//
// Inflows are sourced from:
//   1. opening_stock rows for this bucket (mode='inhouse', status='active')
//   2. For weft_yarn / porvai_yarn: yarn_lot purchases whose
//      delivery_destination='in_house' (the operator's warehouse, not
//      the sizing mill). The bucket discriminator is the yarn_count's
//      yarn_kind ('weft' vs 'porvai').
//   3. For bobbin: bobbin master rows with production_mode='inhouse'.
//
// Outflows: warp comes from in-house fabric receipt items; weft /
// porvai / bobbin come from the stock_ledger rows the in-house
// fabric-receipt reducer writes (jobwork_party_id NULL), plus bobbin
// returns to supplier.
async function loadInhouseOpeningStock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bucket: 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qualities: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  counts: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bobbinMasters: any[],
): Promise<PivotData> {
  const openingRows = await safeSelect<{
    id: number; fabric_quality_id: number | null; yarn_count_id: number | null;
    bobbin_id: number | null; ends_per_bobbin: number | null; warp_ends: number | null;
    quantity: number | string | null; open_date: string | null;
    reference_no: string | null; notes: string | null;
  }>(
    supabase.from('opening_stock')
      .select('id, fabric_quality_id, yarn_count_id, bobbin_id, ends_per_bobbin, warp_ends, quantity, open_date, reference_no, notes')
      .eq('bucket', bucket)
      .eq('mode', 'inhouse')
      .eq('status', 'active'),
  );

  const qualityById = new Map(qualities.map((q) => [q.id, q]));
  const countById   = new Map(counts.map((c) => [c.id, c]));
  const bobMasterById = new Map(bobbinMasters.map((b) => [b.id, b]));

  const colMap = new Map<string, PivotColumn>();
  const events: PivotEvent[] = [];

  const unit: LedgerUnit = bucket === 'warp_beam' ? 'm' : (bucket === 'bobbin' ? 'm' : 'kg');

  const ensureCountCol = (countId: number): string => {
    const id = `yc:${countId}`;
    if (!colMap.has(id)) {
      const c = countById.get(countId);
      colMap.set(id, {
        id,
        label: c?.code ?? `Count #${countId}`,
        sublabel: c?.display_name ?? '',
      });
    }
    return id;
  };

  const ensureEndsCol = (ends: number): string => {
    const id = `ends:${ends}`;
    if (!colMap.has(id)) colMap.set(id, { id, label: `${ends} ends`, sublabel: '' });
    return id;
  };

  /** Composite key for warp metre columns: (warp_ends + warp_count_id).
   *  Two warps that share the ends number but use different warp counts
   *  (e.g. 1770 × 29s vs 1770 × 2/40s) MUST land on separate pivot
   *  columns — without this they collapse into one and the operator
   *  can't tell them apart. countId is optional only so legacy rows
   *  without a count still render somewhere.
   *
   *  A warp spec that matches an in-house fabric quality IS that
   *  quality's stock — e.g. "1770 ends · C-2-40" and COLOR OE are the
   *  same metres — so every source (opening stock, pavu, warp beam
   *  purchases, fabric receipts) lands on ONE shared column, labelled
   *  with the quality (or merged) name and sub-labelled with the spec. */
  const qualityNameBySpec = new Map<string, string>();
  /** quality id → warpCountId from the costing snapshot. Fallback for
   *  receipts when fabric_quality_warp_count has no sno=1 row. */
  const snapWarpCountByQuality = new Map<number, number>();
  const ensureEndsCountCol = (ends: number, countId: number | null): string => {
    const id = countId != null ? `ends:${ends}|yc:${countId}` : `ends:${ends}`;
    if (!colMap.has(id)) {
      const c = countId != null ? countById.get(countId) : null;
      const countSuffix = c ? ` · ${c.code}` : '';
      const spec = `${ends} ends${countSuffix}`;
      const qualityName = qualityNameBySpec.get(`${ends}|${countId ?? ''}`);
      colMap.set(id, {
        id,
        label: qualityName ?? spec,
        sublabel: qualityName !== undefined ? spec : (c?.display_name ?? ''),
      });
    }
    return id;
  };

  if (bucket === 'warp_beam') {
    // Map each in-house quality's warp spec (totalEnds + warpCountId
    // from its costing snapshot) to the quality name — merged groups
    // use the merged name. Qualities sharing one spec share one column,
    // with their names joined.
    const fqRows = await safeSelect<{
      id: number; code: string | null; name: string;
      is_merged: boolean | null; merged_name: string | null;
      calc_snapshot: Record<string, unknown> | null;
    }>(
      supabase.from('fabric_quality')
        .select('id, code, name, is_merged, merged_name, calc_snapshot')
        .eq('active', true)
        .eq('production_mode', 'inhouse'),
    );
    for (const q of fqRows) {
      const snap = q.calc_snapshot ?? {};
      const ends = Number(snap['totalEnds']);
      const countId = Number(snap['warpCountId']);
      if (Number.isFinite(countId) && countId > 0) snapWarpCountByQuality.set(q.id, countId);
      if (!Number.isFinite(ends) || ends <= 0) continue;
      const specKey = `${ends}|${Number.isFinite(countId) && countId > 0 ? countId : ''}`;
      const mn = q.is_merged === true ? (q.merged_name ?? '').trim() : '';
      const name = mn !== '' ? mn : (q.code ?? q.name);
      const existing = qualityNameBySpec.get(specKey);
      if (existing === undefined) qualityNameBySpec.set(specKey, name);
      else if (!existing.split(' / ').includes(name)) qualityNameBySpec.set(specKey, `${existing} / ${name}`);
    }
  }

  // ── 1. Opening stock inflows ────────────────────────────────────
  for (const r of openingRows) {
    let colId = 'unknown';
    let label = '(no key)';
    let sublabel = '';
    if (bucket === 'warp_beam') {
      // Prefer the composite (warp_ends + yarn_count_id) key so warps
      // with the same ends count but different warp counts (e.g.
      // 1770 × 29s vs 1770 × 2/40s) sit on separate columns.
      // Fall back to fabric_quality_id for legacy rows entered before
      // the warp_ends column existed.
      if (r.warp_ends != null) {
        colId = ensureEndsCountCol(Number(r.warp_ends), r.yarn_count_id);
        events.push({
          event_date: r.open_date ?? '',
          column_id: colId,
          direction: 'in',
          quantity: Number(r.quantity ?? 0),
          reference: r.reference_no ?? 'Opening stock',
          notes: r.notes ?? '',
        });
        continue;
      }
      if (r.fabric_quality_id != null) {
        const fq = qualityById.get(r.fabric_quality_id);
        colId = `fq:${r.fabric_quality_id}`;
        label = fq?.code ?? fq?.name ?? `FQ #${r.fabric_quality_id}`;
        sublabel = fq?.name ?? '';
      }
    } else if ((bucket === 'weft_yarn' || bucket === 'porvai_yarn') && r.yarn_count_id != null) {
      colId = ensureCountCol(r.yarn_count_id);
      events.push({
        event_date: r.open_date ?? '',
        column_id: colId,
        direction: 'in',
        quantity: Number(r.quantity ?? 0),
        reference: r.reference_no ?? 'Opening stock',
        notes: r.notes ?? '',
      });
      continue;
    } else if (bucket === 'bobbin') {
      const ends = r.ends_per_bobbin ?? (r.bobbin_id != null ? bobMasterById.get(r.bobbin_id)?.ends_per_bobbin : null);
      if (ends != null) {
        colId = ensureEndsCol(Number(ends));
        events.push({
          event_date: r.open_date ?? '',
          column_id: colId,
          direction: 'in',
          quantity: Number(r.quantity ?? 0),
          reference: r.reference_no ?? 'Opening stock',
          notes: r.notes ?? '',
        });
        continue;
      }
    }
    if (!colMap.has(colId)) colMap.set(colId, { id: colId, label, sublabel });
    events.push({
      event_date: r.open_date ?? '',
      column_id: colId,
      direction: 'in',
      quantity: Number(r.quantity ?? 0),
      reference: r.reference_no ?? 'Opening stock',
      notes: r.notes ?? '',
    });
  }

  // ── 2. Yarn purchase inflows (weft / porvai only) ───────────────
  // Pulls yarn_lot rows whose delivery_destination = 'in_house' so
  // every kilogram physically delivered into the operator's
  // warehouse is reflected as an inflow on the matching count
  // column. Without this, the tab was rendering empty even when
  // yarn had clearly been purchased.
  if (bucket === 'weft_yarn' || bucket === 'porvai_yarn') {
    // yarn_lot.yarn_kind discriminates 'yarn' (= warp / weft) from
    // 'porvai' (= selvedge). The warp warehouse already has its own
    // tab (warp_metre), so the weft_yarn tab here surfaces the
    // remaining 'yarn'-kind lots that aren't tied to a specific warp
    // beam. Old rows without a yarn_kind value default to 'yarn'.
    const wantedKind = bucket === 'weft_yarn' ? 'yarn' : 'porvai';
    const lotRows = await safeSelect<{
      id: number; lot_code: string | null; yarn_count_id: number | null;
      received_date: string | null; received_kg: number | string | null;
      delivery_destination: string | null; yarn_kind: string | null;
    }>(
      supabase.from('yarn_lot')
        .select('id, lot_code, yarn_count_id, received_date, received_kg, delivery_destination, yarn_kind')
        .eq('delivery_destination', 'in_house')
        .eq('yarn_kind', wantedKind),
    );
    for (const l of lotRows) {
      if (l.yarn_count_id == null) continue;
      const colId = ensureCountCol(l.yarn_count_id);
      events.push({
        event_date: l.received_date ?? '',
        column_id: colId,
        direction: 'in',
        quantity: Number(l.received_kg ?? 0),
        reference: l.lot_code ?? `Lot #${l.id}`,
        notes: 'Yarn purchase (delivery=in_house)',
      });
    }

    // ── 3. Outflows ───────────────────────────────────────────────
    // In-house fabric receipts write their yarn consumption to
    // stock_ledger (bucket weft_yarn / porvai_yarn, jobwork_party_id
    // NULL, quantity in kg). Surface those as outflows on the matching
    // count column so the tab nets to the live balance.
    const yarnOuts = await safeSelect<{
      yarn_count_id: number | null; quantity: number | string | null;
      event_date: string | null; reference_no: string | null; notes: string | null;
    }>(
      supabase.from('stock_ledger')
        .select('yarn_count_id, quantity, event_date, reference_no, notes')
        .eq('bucket', bucket)
        .eq('direction', 'out')
        .is('jobwork_party_id', null)
        // production_batch outflows are handled by the dedicated
        // production-batch loop below — excluding them here prevents
        // every batch consumption from being counted twice.
        .neq('source_kind', 'production_batch'),
    );
    for (const o of yarnOuts) {
      if (o.yarn_count_id == null) continue;
      const kg = Number(o.quantity ?? 0);
      if (kg <= 0) continue;
      events.push({
        event_date: o.event_date ?? '',
        column_id: ensureCountCol(o.yarn_count_id),
        direction: 'out',
        quantity: kg,
        reference: o.reference_no ?? 'Fabric receipt',
        notes: o.notes ?? 'In-house consumption',
      });
    }
  }

  // ── Bobbin — purchases in, receipt consumption out ────────────────
  // Inflows: opening stock (handled above) + bobbin purchases (pcs ×
  // m/pc). Outflows: ONLY the in-house fabric receipt consumption
  // recorded in stock_ledger (jobwork_party_id NULL, metres).
  // NOTE: bobbin RETURNS to supplier are EMPTY bobbins (the spools
  // themselves) — a piece-count record, never a yarn-metre movement —
  // so they deliberately do NOT appear as outflows here.
  if (bucket === 'bobbin') {
    const [purRows, outRows] = await Promise.all([
      safeSelect<{
        id: number; purchase_date: string | null; invoice_no: string | null;
        pieces_purchased: number | string | null;
        bobbin: { ends_per_bobbin: number | null; bobbin_metre: number | string | null; production_mode: string | null } | null;
      }>(
        supabase.from('bobbin_purchase')
          .select('id, purchase_date, invoice_no, pieces_purchased, bobbin:bobbin_id ( ends_per_bobbin, bobbin_metre, production_mode )'),
      ),
      safeSelect<{
        quantity: number | string | null; event_date: string | null;
        reference_no: string | null; notes: string | null;
        bobbin: { ends_per_bobbin: number | null } | null;
      }>(
        supabase.from('stock_ledger')
          .select('quantity, event_date, reference_no, notes, bobbin:bobbin_id ( ends_per_bobbin )')
          .eq('bucket', 'bobbin')
          .eq('direction', 'out')
          .is('jobwork_party_id', null)
          // production_batch outflows handled by the dedicated loop
          // below — exclude here so each batch isn't counted twice.
          .neq('source_kind', 'production_batch'),
      ),
    ]);
    for (const p of purRows) {
      if (p.bobbin?.production_mode !== 'inhouse') continue;
      const ends = Number(p.bobbin?.ends_per_bobbin ?? 0);
      const m = Number(p.pieces_purchased ?? 0) * Number(p.bobbin?.bobbin_metre ?? 0);
      if (ends <= 0 || m <= 0) continue;
      events.push({
        event_date: p.purchase_date ?? '',
        column_id: ensureEndsCol(ends),
        direction: 'in',
        quantity: m,
        reference: p.invoice_no ?? `Purchase #${p.id}`,
        notes: 'Bobbin purchase',
      });
    }
    for (const o of outRows) {
      const ends = Number(o.bobbin?.ends_per_bobbin ?? 0);
      const m = Number(o.quantity ?? 0);
      if (ends <= 0 || m <= 0) continue;
      events.push({
        event_date: o.event_date ?? '',
        column_id: ensureEndsCol(ends),
        direction: 'out',
        quantity: m,
        reference: o.reference_no ?? 'Fabric receipt',
        notes: o.notes ?? 'In-house consumption',
      });
    }
  }

  // ── Warp Metre — pavu inflows + in-house fabric receipt outflows ─
  // Every pavu sitting in-house and still in stock shows up here as
  // an inflow on the matching ends column. Outflows come from
  // in-house fabric receipts (DCs whose production_mode='inhouse'):
  // the metres received become an outflow against the warp metre
  // stock.
  if (bucket === 'warp_beam') {
    // In-house warp beam purchases (Inhouse Stock → Warp Beam tab).
    // Purchases land on the SAME (ends + count) column as opening
    // stock / pavu inflows — the column label carries the quality name
    // via qualityNameBySpec, so e.g. COLOR OE purchases and the
    // "1770 ends · C-2-40" opening stock are ONE merged column.
    const beamPurchases = await safeSelect<{
      id: number; code: string | null; purchase_date: string | null;
      metres: number | string | null; yarn_count_id: number | null;
      ends: { ends_count: number | null } | null;
    }>(
      supabase.from('inhouse_warp_beam_purchase')
        .select('id, code, purchase_date, metres, yarn_count_id, ends:ends_id ( ends_count )')
        .eq('status', 'active'),
    );
    for (const b of beamPurchases) {
      const ends = Number(b.ends?.ends_count ?? 0);
      const metres = Number(b.metres ?? 0);
      if (ends <= 0 || metres <= 0) continue;
      const colId = ensureEndsCountCol(ends, b.yarn_count_id);
      events.push({
        event_date: b.purchase_date ?? '',
        column_id: colId,
        direction: 'in',
        quantity: metres,
        reference: b.code ?? `WB #${b.id}`,
        notes: 'Warp beam purchase',
      });
    }

    // Pavu inflows — in-house, in_stock, with a real meters value.
    const inhousePavus = await safeSelect<{
      id: number; pavu_code: string | null; ends: number | null;
      meters: number | string | null;
      sizing_job_id: number | null;
      created_at: string | null;
    }>(
      supabase.from('pavu')
        .select('id, pavu_code, ends, meters, sizing_job_id, created_at')
        .eq('production_mode', 'in_house')
        .eq('status', 'in_stock'),
    );
    // Resolve each pavu's date AND warp_count_id from its sizing job.
    // sizing_job.warp_count_id is what disambiguates pavu inflows with
    // matching ends but different warp counts — feeding into the
    // composite (ends + count) column key so they don't collide.
    const sizingJobIds = Array.from(new Set(
      inhousePavus.map((p) => p.sizing_job_id).filter((x): x is number => x != null),
    ));
    const dateBySizingJob  = new Map<number, string | null>();
    const countBySizingJob = new Map<number, number | null>();
    if (sizingJobIds.length > 0) {
      const jobs = await safeSelect<{ id: number; date_sent: string | null; warp_count_id: number | null }>(
        supabase.from('sizing_job').select('id, date_sent, warp_count_id').in('id', sizingJobIds),
      );
      for (const j of jobs) {
        dateBySizingJob.set(j.id, j.date_sent);
        countBySizingJob.set(j.id, j.warp_count_id);
      }
    }
    for (const p of inhousePavus) {
      const ends = Number(p.ends ?? 0);
      const meters = Number(p.meters ?? 0);
      if (ends <= 0 || meters <= 0) continue;
      const warpCountId = p.sizing_job_id != null ? (countBySizingJob.get(p.sizing_job_id) ?? null) : null;
      const colId = ensureEndsCountCol(ends, warpCountId);
      const eventDate = (p.sizing_job_id != null ? dateBySizingJob.get(p.sizing_job_id) ?? null : null)
        ?? (p.created_at ?? '').slice(0, 10);
      events.push({
        event_date: eventDate,
        column_id: colId,
        direction: 'in',
        quantity: meters,
        reference: p.pavu_code ?? `Pavu #${p.id}`,
        notes: 'In-house pavu (in stock)',
      });
    }

    // In-house fabric receipt outflows. Each fabric_receipt row that
    // sits against a DC with production_mode='inhouse' represents
    // warp metres consumed from this stock. We use received_metres so
    // even pcs-mode receipts (which store pieces) get the resolved
    // metre count.
    const receipts = await safeSelect<{
      id: number; code: string | null; receipt_date: string | null;
      total_metres: number | string | null;
      dc: { id: number; code: string | null; production_mode: string | null } | null;
      items: Array<{ fabric_quality_id: number | null; ends_count_snapshot: number | null; received_metres: number | string | null }>;
    }>(
      supabase.from('fabric_receipt')
        .select(`
          id, code, receipt_date, total_metres,
          dc:dc_id!inner ( id, code, production_mode ),
          items:fabric_receipt_item ( fabric_quality_id, ends_count_snapshot, received_metres )
        `)
        .eq('dc.production_mode', 'inhouse'),
    );

    // Resolve the primary warp count for every fabric_quality that
    // appears in the receipts. fabric_quality_warp_count is a multi-row
    // table (one row per sno) — we use sno=1 as the primary count.
    // Multi-warp qualities will pick their first listed count; that
    // matches the pavu side because pavu also locks to a single
    // sizing_job.warp_count_id per beam.
    const receiptQualityIds = Array.from(new Set(
      receipts.flatMap((r) => (Array.isArray(r.items) ? r.items : []))
        .map((it) => it.fabric_quality_id)
        .filter((x): x is number => x != null),
    ));
    const warpCountByQuality = new Map<number, number | null>();
    if (receiptQualityIds.length > 0) {
      const links = await safeSelect<{ fabric_quality_id: number; yarn_count_id: number | null; sno: number }>(
        supabase.from('fabric_quality_warp_count')
          .select('fabric_quality_id, yarn_count_id, sno')
          .in('fabric_quality_id', receiptQualityIds)
          .eq('sno', 1),
      );
      for (const l of links) warpCountByQuality.set(l.fabric_quality_id, l.yarn_count_id);
    }

    for (const r of receipts) {
      const items = Array.isArray(r.items) ? r.items : [];
      for (const it of items) {
        const ends = Number(it.ends_count_snapshot ?? 0);
        const m    = Number(it.received_metres ?? 0);
        if (m <= 0) continue;
        // Outflows land on the same shared (ends + count) column as
        // every inflow source, so per-spec stock nets correctly.
        if (ends <= 0) continue;
        const warpCountId = it.fabric_quality_id != null
          ? (warpCountByQuality.get(it.fabric_quality_id)
             ?? snapWarpCountByQuality.get(it.fabric_quality_id)
             ?? null)
          : null;
        const colId = ensureEndsCountCol(ends, warpCountId);
        events.push({
          event_date: r.receipt_date ?? '',
          column_id: colId,
          direction: 'out',
          quantity: m,
          reference: r.code ?? `Receipt #${r.id}`,
          notes: 'In-house fabric receipt',
        });
      }
    }
  }

  // ── Production batch outflows (shared, all in-house buckets) ─────
  // Saving a Production Batch (/app/production/new) writes one
  // stock_ledger row per material consumed, with
  // source_kind='production_batch'. These outflows must land on the
  // same in-house pivot columns as every other source so the live
  // balance reflects what production actually used. No other source
  // currently uses source_kind='production_batch', so we don't have
  // to dedupe against existing events.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any; // table not in generated types
  const slRows = await safeSelect<{
    id: number;
    fabric_quality_id: number | null;
    yarn_count_id: number | null;
    bobbin_id: number | null;
    quantity: number | string | null;
    event_date: string | null;
    reference_no: string | null;
    notes: string | null;
    direction: string;
    source_id: number | null;
  }>(
    sb.from('stock_ledger')
      .select('id, fabric_quality_id, yarn_count_id, bobbin_id, quantity, event_date, reference_no, notes, direction, source_id')
      .eq('bucket', bucket)
      .eq('source_kind', 'production_batch'),
  );

  // For warp_beam, resolve `ends` via costing_master.warp_ends keyed
  // by production_batch.id. Two-step plain fetch instead of a nested
  // PostgREST relational select — that syntax was silently returning
  // null on this DB, so events landed on no column and got skipped.
  const endsByBatch = new Map<number, number>();
  if (bucket === 'warp_beam' && slRows.length > 0) {
    const batchIds = Array.from(
      new Set(slRows.map((r) => r.source_id).filter((v): v is number => v != null)),
    );
    if (batchIds.length > 0) {
      const batches = await safeSelect<{ id: number; costing_id: number | null }>(
        sb.from('production_batch').select('id, costing_id').in('id', batchIds),
      );
      const costingIds = Array.from(
        new Set(batches.map((b) => b.costing_id).filter((v): v is number => v != null)),
      );
      const endsByCosting = new Map<number, number>();
      if (costingIds.length > 0) {
        const costings = await safeSelect<{ id: number; warp_ends: number | null }>(
          sb.from('costing_master').select('id, warp_ends').in('id', costingIds),
        );
        for (const c of costings) {
          const we = Number(c.warp_ends ?? 0);
          if (Number.isFinite(we) && we > 0) endsByCosting.set(c.id, we);
        }
      }
      for (const b of batches) {
        if (b.costing_id == null) continue;
        const we = endsByCosting.get(b.costing_id);
        if (we != null) endsByBatch.set(b.id, we);
      }
    }
  }

  for (const row of slRows) {
    let colId: string | null = null;
    if (bucket === 'warp_beam') {
      // Resolve to the same shared (ends + count) column used by
      // pavu / opening stock / fabric receipts. Ends come from
      // costing_master.warp_ends (canonical), count from the
      // stock_ledger row's yarn_count_id.
      const ends = row.source_id != null ? endsByBatch.get(row.source_id) ?? null : null;
      if (ends != null) {
        colId = ensureEndsCountCol(ends, row.yarn_count_id);
      } else if (row.yarn_count_id != null) {
        colId = ensureCountCol(row.yarn_count_id);
      } else {
        continue;
      }
    } else if (bucket === 'weft_yarn' || bucket === 'porvai_yarn') {
      if (row.yarn_count_id == null) continue;
      colId = ensureCountCol(row.yarn_count_id);
    } else if (bucket === 'bobbin') {
      if (row.bobbin_id == null) continue;
      const bm = bobMasterById.get(row.bobbin_id) as
        | { ends_per_bobbin?: number | null }
        | undefined;
      const ends = Number(bm?.ends_per_bobbin ?? 0);
      if (!Number.isFinite(ends) || ends <= 0) continue;
      colId = ensureEndsCol(ends);
    }
    if (colId == null) continue;
    events.push({
      event_date: row.event_date ?? '',
      column_id: colId,
      direction: row.direction === 'in' ? 'in' : 'out',
      quantity: Number(row.quantity ?? 0),
      reference: row.reference_no ?? `Ledger #${row.id}`,
      notes: row.notes ?? 'Production batch',
    });
  }

  const columns = Array.from(colMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  return { unit, columns, events };
}

// ─── Sizing warehouse loader ────────────────────────────────────────────────
// Inflows: yarn_lot rows received with delivery_destination='sizing'
//   - event_date = received_date
//   - quantity = received_kg
//   - column = yarn_count_id
// Outflows: sizing_job consumption (yarn_used_kg once recorded, else yarn_sent_kg
//   as a placeholder for jobs still in-flight)
//   - event_date = date_sent
//   - quantity = yarn_used_kg (actual yarn consumed at the sizing mill); falls
//     back to yarn_sent_kg only when usage hasn't been recorded yet, so the
//     leftover/wastage (sent - used) stays in the warehouse balance instead of
//     being shown as permanently gone
//   - column = yarn_count_id resolved from the linked yarn_lot
async function loadSizingWarehouse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  counts: any[],
  sp: SP,
): Promise<PivotData> {
  const countFilter = sp.count && /^\d+$/.test(sp.count) ? Number(sp.count) : null;
  const lots = await safeSelect<{
    id: number; lot_code: string; yarn_count_id: number | null;
    received_date: string | null; received_kg: number | string | null;
    delivery_destination: string | null;
  }>(
    (() => {
      let q = supabase.from('yarn_lot')
        .select('id, lot_code, yarn_count_id, received_date, received_kg, delivery_destination')
        .eq('delivery_destination', 'sizing');
      if (countFilter !== null) q = q.eq('yarn_count_id', countFilter);
      return q;
    })(),
  );

  const lotById = new Map(lots.map((l) => [l.id, l]));

  const jobs = await safeSelect<{
    id: number; job_code: string | null; yarn_lot_id: number | null;
    yarn_sent_kg: number | string | null; yarn_used_kg: number | string | null;
    date_sent: string | null; status: string | null;
  }>(
    supabase.from('sizing_job')
      .select('id, job_code, yarn_lot_id, yarn_sent_kg, yarn_used_kg, date_sent, status'),
  );

  const countById = new Map(counts.map((c) => [c.id, c]));
  const colMap = new Map<string, PivotColumn>();
  const events: PivotEvent[] = [];

  const colIdFor = (cId: number | null): string => `yc:${cId ?? 'unknown'}`;
  const ensureCol = (cId: number | null): string => {
    const id = colIdFor(cId);
    if (colMap.has(id)) return id;
    const c = cId != null ? countById.get(cId) : null;
    colMap.set(id, {
      id,
      label: c?.code ?? (cId != null ? `Count #${cId}` : '(no count)'),
      sublabel: c?.display_name ?? '',
    });
    return id;
  };

  // Opening-stock inflows. Anything entered via the Add opening
  // stock form on the Sizing Warehouse tab lives in opening_stock
  // with mode='sizing'. Treat the open_date as the event date and
  // route each row to its yarn-count column. Honour the same
  // yarn-count filter that's applied to the lot query above.
  const openingRows = await safeSelect<{
    id: number; yarn_count_id: number | null;
    quantity: number | string | null; open_date: string | null;
    reference_no: string | null; notes: string | null;
  }>(
    (() => {
      let q = supabase.from('opening_stock')
        .select('id, yarn_count_id, quantity, open_date, reference_no, notes')
        .eq('mode', 'sizing')
        .eq('status', 'active');
      if (countFilter !== null) q = q.eq('yarn_count_id', countFilter);
      return q;
    })(),
  );
  for (const r of openingRows) {
    const colId = ensureCol(r.yarn_count_id);
    events.push({
      event_date: r.open_date ?? '',
      column_id: colId,
      direction: 'in',
      quantity: Number(r.quantity ?? 0),
      reference: r.reference_no ?? 'Opening stock',
      notes: r.notes ?? 'Opening balance (sizing warehouse)',
    });
  }
  for (const l of lots) {
    const cId = l.yarn_count_id;
    const colId = ensureCol(cId);
    events.push({
      event_date: l.received_date ?? '',
      column_id: colId,
      direction: 'in',
      quantity: Number(l.received_kg ?? 0),
      reference: l.lot_code ?? `Lot #${l.id}`,
      notes: 'Yarn purchase (delivery=sizing)',
    });
  }
  for (const j of jobs) {
    if (j.yarn_lot_id == null) continue;
    const lot = lotById.get(j.yarn_lot_id);
    if (!lot) continue; // Only count sizing jobs that draw from sizing-warehouse yarn lots
    const colId = ensureCol(lot.yarn_count_id);
    const usedQty = Number(j.yarn_used_kg ?? 0);
    const sentQty = Number(j.yarn_sent_kg ?? 0);
    const qty = usedQty > 0 ? usedQty : sentQty;
    if (qty <= 0) continue;
    events.push({
      event_date: j.date_sent ?? '',
      column_id: colId,
      direction: 'out',
      quantity: qty,
      reference: j.job_code ?? `Sizing job #${j.id}`,
      notes: usedQty > 0 ? 'Used in sizing' : 'Sent to sizing',
    });
  }

  const columns = Array.from(colMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  return { unit: 'kg', columns, events };
}

async function loadJobworkWarpBeam(
  supabase: any, sp: SP, parties: any[], qualities: any[], counts: any[],
): Promise<PivotData> {
  // Restrict the query to the party set the caller passed in. The
  // caller pre-filters jobwork_party by kind (jobwork vs outsource)
  // so this filter keeps the warehouse data segregated between the
  // two warehouse modes.
  const partyIdSet: number[] = (parties as Array<{ id: number }>).map((p) => p.id);
  if (partyIdSet.length === 0) {
    return { unit: 'm', columns: [], events: [] };
  }
  // Read merge metadata for every fabric_quality we may encounter so we
  // can collapse merged siblings into a single column.
  const fqMergeById = new Map<number, { code: string; name: string; is_merged: boolean; merged_name: string | null }>();
  if (qualities.length > 0) {
    const qIds = qualities.map((q: any) => q.id);
    const mergeRows = await safeSelect<{ id: number; code: string; name: string; is_merged: boolean | null; merged_name: string | null }>(
      supabase.from('fabric_quality')
        .select('id, code, name, is_merged, merged_name')
        .in('id', qIds),
    );
    for (const r of mergeRows) {
      fqMergeById.set(r.id, {
        code: r.code ?? '',
        name: r.name ?? '',
        is_merged: r.is_merged === true,
        merged_name: r.merged_name ?? null,
      });
    }
  }

  // Inflows: jobwork_warp_beam rows. Use original_metres if column exists,
  // else fall back to total_metres.
  let beams = await safeSelect<{
    id: number; jobwork_party_id: number | null; fabric_quality_id: number | null;
    warp_count_id: number | null; total_metres: number | string | null;
    original_metres?: number | string | null; given_date: string | null;
    reference_no: string | null; beam_count: number | null;
  }>(
    (() => {
      let q = supabase
        .from('jobwork_warp_beam')
        .select('id, jobwork_party_id, fabric_quality_id, warp_count_id, total_metres, original_metres, given_date, reference_no, beam_count')
        .in('jobwork_party_id', partyIdSet);
      if (sp.party)   q = q.eq('jobwork_party_id',  Number(sp.party));
      if (sp.quality) q = q.eq('fabric_quality_id', Number(sp.quality));
      if (sp.count)   q = q.eq('warp_count_id',     Number(sp.count));
      return q;
    })(),
  );
  // Fallback without original_metres if migration 090 not yet applied.
  if (beams.length === 0) {
    beams = await safeSelect(
      (() => {
        let q = supabase
          .from('jobwork_warp_beam')
          .select('id, jobwork_party_id, fabric_quality_id, warp_count_id, total_metres, given_date, reference_no, beam_count')
          .in('jobwork_party_id', partyIdSet);
        if (sp.party)   q = q.eq('jobwork_party_id',  Number(sp.party));
        if (sp.quality) q = q.eq('fabric_quality_id', Number(sp.quality));
        if (sp.count)   q = q.eq('warp_count_id',     Number(sp.count));
        return q;
      })(),
    );
  }

  // Outflows: stock_ledger. May not exist yet → safeSelect returns [].
  const outRows = await safeSelect<{
    fabric_quality_id: number | null; quantity: number | string | null;
    event_date: string | null; reference_no: string | null; notes: string | null;
  }>(
    (() => {
      let q = supabase
        .from('stock_ledger')
        .select('fabric_quality_id, quantity, event_date, reference_no, notes')
        .eq('bucket', 'warp_beam')
        .in('jobwork_party_id', partyIdSet);
      if (sp.party)   q = q.eq('jobwork_party_id',  Number(sp.party));
      if (sp.quality) q = q.eq('fabric_quality_id', Number(sp.quality));
      return q;
    })(),
  );

  // Build columns + events keyed by fabric quality (with merged groups
  // collapsed into a single column). Column id =
  //   m:<merged_name>  for merged-delivery siblings
  //   fq:<id>          for standalone qualities
  //   unknown          for rows with no fabric_quality_id
  const colMap = new Map<string, PivotColumn>();
  const events: PivotEvent[] = [];
  const partyById = new Map(parties.map((p: any) => [p.id, p]));

  const colInfo = (qualityId: number | null): { id: string; label: string; sublabel: string } => {
    if (qualityId == null) return { id: 'unknown', label: '(no quality)', sublabel: '' };
    const m = fqMergeById.get(qualityId);
    if (m && m.is_merged && m.merged_name && m.merged_name.trim() !== '') {
      return { id: `m:${m.merged_name.trim()}`, label: m.merged_name.trim(), sublabel: 'merged group' };
    }
    return { id: `fq:${qualityId}`, label: m?.code ?? `FQ #${qualityId}`, sublabel: m?.name ?? '' };
  };
  const ensureCol = (qualityId: number | null): string => {
    const info = colInfo(qualityId);
    if (!colMap.has(info.id)) {
      colMap.set(info.id, { id: info.id, label: info.label, sublabel: info.sublabel });
    }
    return info.id;
  };

  for (const b of beams) {
    const colId = ensureCol(b.fabric_quality_id);
    const m = b.fabric_quality_id != null ? fqMergeById.get(b.fabric_quality_id) : null;
    const p = b.jobwork_party_id != null ? partyById.get(b.jobwork_party_id) : null;
    events.push({
      event_date: b.given_date ?? '',
      column_id: colId,
      direction: 'in',
      quantity: Number(b.original_metres ?? b.total_metres ?? 0),
      reference: `${b.reference_no ?? 'Beam #' + b.id} · ${p?.name ?? ''}`,
      notes: [m?.code, b.beam_count ? `${b.beam_count} beam(s)` : ''].filter(Boolean).join(' · '),
    });
  }
  for (const o of outRows) {
    const colId = ensureCol(o.fabric_quality_id);
    events.push({
      event_date: o.event_date ?? '',
      column_id: colId,
      direction: 'out',
      quantity: Number(o.quantity ?? 0),
      reference: o.reference_no ?? 'Fabric receipt',
      notes: o.notes ?? '',
    });
  }
  void counts;
  const columns = Array.from(colMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  return { unit: 'm', columns, events };
}

// ─── Bobbin pivot (jobwork) ─────────────────────────────────────────────────
// Columns = distinct ends_per_bobbin values (e.g. "30 ends", "32 ends").
// Bobbins with the same ends count but different bobbin_metre still
// share one column. Rows = bobbin purchases (inflow) and fabric-receipt
// consumption (outflow). All quantities expressed in METRES (inflow:
// quantity × bobbin_metre per piece; outflow: ledger qty pcs ×
// bobbin_metre of the consumed bobbin).
// Outsource mode uses the same loader via the partyIdSet filter (see
// loadJobworkWarpBeam above for the pattern).
async function loadJobworkBobbin(
  supabase: any, sp: SP, parties: any[], _bobbinMasters: any[],
): Promise<PivotData> {
  const partyIdSet: number[] = (parties as Array<{ id: number }>).map((p) => p.id);
  if (partyIdSet.length === 0) {
    return { unit: 'm', columns: [], events: [] };
  }
  // Inflows now come from jobwork_bobbin_issue (one row per "give N pieces
  // of bobbin X to party Y on date Z" event). The bobbin master is joined
  // for its code + ends_per_bobbin + bobbin_metre. Previously the bobbin
  // master itself was overloaded with these rows; migration 141 separates
  // the concerns.
  const issues = await safeSelect<{
    id: number; jobwork_party_id: number;
    pieces_issued: number | string | null;
    original_pieces: number | string | null;
    issue_date: string | null;
    reference_no: string | null; notes: string | null;
    bobbin: {
      id: number; code: string | null;
      ends_per_bobbin: number | null;
      bobbin_metre: number | string | null;
    } | null;
  }>(
    (() => {
      let q = supabase
        .from('jobwork_bobbin_issue')
        .select(`id, jobwork_party_id, pieces_issued, original_pieces, issue_date, reference_no, notes,
                 bobbin:bobbin_id ( id, code, ends_per_bobbin, bobbin_metre )`)
        .eq('status', 'active')
        .in('jobwork_party_id', partyIdSet);
      if (sp.party) q = q.eq('jobwork_party_id', Number(sp.party));
      return q;
    })(),
  );
  // Re-shape into the bob[] flat structure the rest of the loader uses.
  const bobs = issues.map((r) => ({
    id: r.id,
    code: r.bobbin?.code ?? `JB-${r.id}`,
    description: r.notes,
    jobwork_party_id: r.jobwork_party_id,
    quantity: r.pieces_issued,
    original_quantity: r.original_pieces,
    bobbin_metre: r.bobbin?.bobbin_metre ?? null,
    ends_per_bobbin: r.bobbin?.ends_per_bobbin ?? null,
    purchase_date: r.issue_date,
  }));

  const outRows = await safeSelect<{
    bobbin_id: number | null; quantity: number | string | null;
    event_date: string | null; reference_no: string | null; notes: string | null;
  }>(
    (() => {
      let q = supabase
        .from('stock_ledger')
        .select('bobbin_id, quantity, event_date, reference_no, notes')
        .eq('bucket', 'bobbin')
        .in('jobwork_party_id', partyIdSet);
      if (sp.party) q = q.eq('jobwork_party_id', Number(sp.party));
      return q;
    })(),
  );

  const partyById = new Map(parties.map((p: any) => [p.id, p]));
  const bobInfoById = new Map<number, { code: string; ends_per_bobbin: number | null; bobbin_metre: number | string | null }>();
  for (const b of bobs) bobInfoById.set(b.id, b);

  const colMap = new Map<string, PivotColumn>();
  const events: PivotEvent[] = [];

  const endsColId = (ends: number | null): { id: string; label: string } => {
    if (ends == null || ends <= 0) return { id: 'ends_unknown', label: '(no ends)' };
    return { id: `ends_${ends}`, label: `${ends} ends` };
  };

  for (const b of bobs) {
    const col = endsColId(b.ends_per_bobbin);
    if (!colMap.has(col.id)) colMap.set(col.id, { id: col.id, label: col.label, sublabel: 'metres' });
    const p = b.jobwork_party_id != null ? partyById.get(b.jobwork_party_id) : null;
    // Inflow quantity = pcs × metres-per-piece. If bobbin_metre is null
    // or zero, fall back to the raw pcs count so the row still shows.
    const pcs = Number(b.original_quantity ?? b.quantity ?? 0);
    const perPc = Number(b.bobbin_metre ?? 0);
    const metres = perPc > 0 ? pcs * perPc : pcs;
    events.push({
      event_date: b.purchase_date ?? '',
      column_id: col.id,
      direction: 'in',
      quantity: Math.round(metres * 100) / 100,
      reference: `${b.code} · ${p?.name ?? ''}`,
      notes: perPc > 0 ? `${pcs} pcs × ${perPc} m/pc` : (b.description ?? ''),
    });
  }
  for (const o of outRows) {
    const bob = o.bobbin_id != null ? bobInfoById.get(o.bobbin_id) : null;
    const col = endsColId(bob?.ends_per_bobbin ?? null);
    if (!colMap.has(col.id)) colMap.set(col.id, { id: col.id, label: col.label, sublabel: 'metres' });
    // stock_ledger.quantity for bobbin is stored in METRES (1 m fabric
    // consumes 1 m bobbin yarn). No conversion needed.
    const metresCut = Number(o.quantity ?? 0);
    events.push({
      event_date: o.event_date ?? '',
      column_id: col.id,
      direction: 'out',
      quantity: Math.round(metresCut * 100) / 100,
      reference: o.reference_no ?? 'Fabric receipt',
      notes: o.notes ?? '',
    });
  }

  const columns = Array.from(colMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  return { unit: 'm', columns, events };
}

// ─── Weft / Porvai Yarn pivot ───────────────────────────────────────────────
// Columns = distinct yarn_count codes used as the chosen kind (weft or
// porvai). Rows = each weft-bag-given event (inflow) and each fabric-
// receipt-consumed event (outflow). Porvai counts are partitioned via
// fabric_quality.calc_snapshot.porvaiCountId; all other counts are
// considered weft by default.
async function loadJobworkYarn(
  supabase: any, sp: SP, parties: any[], counts: any[], kind: 'weft' | 'porvai',
): Promise<PivotData> {
  // Restrict to the caller's party set (filtered by jobwork_party.kind
  // at the page level) so jobwork rows don't leak into the outsource
  // warehouse view and vice-versa.
  const partyIdSet: number[] = (parties as Array<{ id: number }>).map((p) => p.id);
  if (partyIdSet.length === 0) {
    return { unit: 'kg', columns: [], events: [] };
  }
  const fqRows = await safeSelect<{ calc_snapshot: { porvaiCountId?: number | string } | null }>(
    supabase.from('fabric_quality').select('calc_snapshot'),
  );
  const porvaiCountIds = new Set<number>();
  for (const r of fqRows) {
    const pid = r.calc_snapshot?.porvaiCountId;
    if (pid != null && pid !== '') {
      const n = Number(pid);
      if (Number.isFinite(n) && n > 0) porvaiCountIds.add(n);
    }
  }

  let bags = await safeSelect<{
    id: number; jobwork_party_id: number | null; yarn_count_id: number | null;
    total_kg: number | string | null; original_kg?: number | string | null;
    given_date: string | null; reference_no: string | null; bag_count: number | null;
  }>(
    (() => {
      let q = supabase
        .from('jobwork_weft_bag')
        .select('id, jobwork_party_id, yarn_count_id, total_kg, original_kg, given_date, reference_no, bag_count')
        .in('jobwork_party_id', partyIdSet);
      if (sp.party) q = q.eq('jobwork_party_id', Number(sp.party));
      if (sp.count) q = q.eq('yarn_count_id',    Number(sp.count));
      return q;
    })(),
  );
  if (bags.length === 0) {
    bags = await safeSelect(
      (() => {
        let q = supabase
          .from('jobwork_weft_bag')
          .select('id, jobwork_party_id, yarn_count_id, total_kg, given_date, reference_no, bag_count')
          .in('jobwork_party_id', partyIdSet);
        if (sp.party) q = q.eq('jobwork_party_id', Number(sp.party));
        if (sp.count) q = q.eq('yarn_count_id',    Number(sp.count));
        return q;
      })(),
    );
  }

  const bucket = kind === 'porvai' ? 'porvai_yarn' : 'weft_yarn';
  const outRows = await safeSelect<{
    yarn_count_id: number | null; quantity: number | string | null;
    event_date: string | null; reference_no: string | null; notes: string | null;
  }>(
    (() => {
      let q = supabase
        .from('stock_ledger')
        .select('yarn_count_id, quantity, event_date, reference_no, notes')
        .eq('bucket', bucket)
        .in('jobwork_party_id', partyIdSet);
      if (sp.party) q = q.eq('jobwork_party_id', Number(sp.party));
      if (sp.count) q = q.eq('yarn_count_id',    Number(sp.count));
      return q;
    })(),
  );

  const partyById = new Map(parties.map((p: any) => [p.id, p]));
  const countById = new Map(counts.map((c: any) => [c.id, c]));

  const colMap = new Map<string, PivotColumn>();
  const events: PivotEvent[] = [];

  const colIdFor = (cId: number | null): string => `yc_${cId ?? 'unknown'}`;
  const ensureCol = (cId: number | null) => {
    const id = colIdFor(cId);
    if (colMap.has(id)) return id;
    const c = cId != null ? countById.get(cId) : null;
    colMap.set(id, {
      id,
      label: c?.code ?? (cId != null ? `Count #${cId}` : '(no count)'),
      sublabel: c?.display_name ?? '',
    });
    return id;
  };

  for (const b of bags) {
    const cId = b.yarn_count_id;
    const isPorvai = cId != null && porvaiCountIds.has(Number(cId));
    if (kind === 'porvai' && !isPorvai) continue;
    if (kind === 'weft' && isPorvai) continue;
    const colId = ensureCol(cId);
    const p = b.jobwork_party_id != null ? partyById.get(b.jobwork_party_id) : null;
    events.push({
      event_date: b.given_date ?? '',
      column_id: colId,
      direction: 'in',
      quantity: Number(b.original_kg ?? b.total_kg ?? 0),
      reference: `${b.reference_no ?? 'Bag #' + b.id} · ${p?.name ?? ''}`,
      notes: b.bag_count ? `${b.bag_count} bag(s)` : '',
    });
  }
  for (const o of outRows) {
    const colId = ensureCol(o.yarn_count_id);
    events.push({
      event_date: o.event_date ?? '',
      column_id: colId,
      direction: 'out',
      quantity: Number(o.quantity ?? 0),
      reference: o.reference_no ?? 'Fabric receipt',
      notes: o.notes ?? '',
    });
  }

  const columns = Array.from(colMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  return { unit: 'kg', columns, events };
}

// ─── Ledger view (shared renderer) ──────────────────────────────────────────
function LedgerView({ groups, emptyMessage }: { groups: LedgerGroup[]; emptyMessage: string }) {
  if (!groups.length) {
    return <div className="card p-8 text-center text-ink-soft text-sm">{emptyMessage}</div>;
  }
  const totals = groups.map(g => {
    const closing = g.events.reduce((bal, e) => bal + (e.direction === 'in' ? e.quantity : -e.quantity), 0);
    return { g, closing };
  });
  const grandClosing = totals.reduce((s, t) => s + t.closing, 0);
  const unit = groups[0]?.unit ?? 'm';

  return (
    <>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="Closing balance (all)" value={fmtUnit(grandClosing, unit)} icon={Coins} negative={grandClosing < 0} />
        <Kpi label="Groups" value={String(groups.length)} icon={Layers} />
        <Kpi label="Total events" value={String(groups.reduce((s, g) => s + g.events.length, 0))} icon={TrendingDown} />
      </div>

      <div className="space-y-4">
        {totals.map(({ g, closing }) => {
          let running = 0;
          const totalIn = g.events.reduce((s, e) => s + (e.direction === 'in' ? e.quantity : 0), 0);
          const totalOut = g.events.reduce((s, e) => s + (e.direction === 'out' ? e.quantity : 0), 0);
          return (
            <div key={g.key} className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-line/60 bg-cloud/40 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-bold">{g.title}</div>
                  <div className="text-xs text-ink-soft">{g.subtitle}{g.extra ? ' · ' + g.extra : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-ink-mute">Closing balance</div>
                  <div className={`text-base font-bold num ${closing < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {fmtUnit(closing, g.unit)}
                  </div>
                </div>
              </div>
              {/* Mobile: collapse the per-event table into an In / Out /
                  Balance summary, matching the pivot column cards. */}
              <div className="md:hidden px-4 py-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">In</div>
                  <div className="num text-sm text-emerald-700">{'+ ' + fmtUnit(totalIn, g.unit)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Out</div>
                  <div className="num text-sm text-rose-700">{'\u2212 ' + fmtUnit(totalOut, g.unit)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Balance</div>
                  <div className={`num text-sm font-bold ${closing < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{fmtUnit(closing, g.unit)}</div>
                </div>
              </div>
              <table className="w-full text-sm hidden md:table">
                <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">Reference</th>
                    <th className="text-left px-4 py-2 hidden md:table-cell">Notes</th>
                    <th className="text-right px-4 py-2">In</th>
                    <th className="text-right px-4 py-2">Out</th>
                    <th className="text-right px-4 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {g.events.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-mute text-xs">No movements yet.</td></tr>
                  ) : g.events.map((e, i) => {
                    running += e.direction === 'in' ? e.quantity : -e.quantity;
                    return (
                      <tr key={i} className="border-t border-line/40">
                        <td className="px-4 py-2 text-xs text-ink-soft">{e.event_date || '-'}</td>
                        <td className="px-4 py-2 text-xs">{e.reference}</td>
                        <td className="px-4 py-2 text-xs text-ink-soft hidden md:table-cell">{e.notes}</td>
                        <td className="px-4 py-2 text-right num text-emerald-700">
                          {e.direction === 'in' ? '+ ' + fmtUnit(e.quantity, g.unit) : ''}
                        </td>
                        <td className="px-4 py-2 text-right num text-rose-700">
                          {e.direction === 'out' ? '\u2212 ' + fmtUnit(e.quantity, g.unit) : ''}
                        </td>
                        <td className={`px-4 py-2 text-right num font-semibold ${running < 0 ? 'text-rose-700' : ''}`}>
                          {fmtUnit(running, g.unit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-line bg-cloud/30">
                  <tr>
                    <td colSpan={5} className="px-4 py-2 font-semibold text-right">Closing balance</td>
                    <td className={`px-4 py-2 text-right num font-bold ${closing < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {fmtUnit(closing, g.unit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── In-house Production Fabric pivot ───────────────────────────────────────
// Sources stock_ledger rows tagged with bucket='production_fabric'. These
// are written by the production-batch save endpoint (/app/production/new)
// when a finished fabric quantity is recorded against a production batch.
//
// Currently all rows are direction='in' — there is no DC-shipment writer
// yet that emits direction='out' for this bucket. The loader handles both
// directions anyway so the pivot will net correctly once outflows ship.
//
// Columns key by fabric_quality_id with the same merged-group collapsing
// used by the warp_beam pivot (loadJobworkWarpBeam) — qualities with
// is_merged=true and a merged_name share one column labelled with that
// merged name. Standalone qualities get their own column.
//
// Unit: production fabric may be recorded in metres (when the batch was
// entered in metres) or pieces (when the operator entered towel pieces
// directly with no conversion). Both forms can co-exist for the same
// quality, so we split the ledger into two PivotData blocks — one
// for pcs rows and one for m rows — and render them stacked. Each
// pivot keeps its own totals/footer so the operator can read the
// pcs and metres balance independently.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadInhouseProductionFabric(
  supabase: any,
  qualities: any[],
): Promise<{ pcs: PivotData; metres: PivotData }> {
  // Read merge metadata for every known fabric_quality so we can
  // collapse merged siblings into a single pivot column. Mirrors the
  // pattern in loadJobworkWarpBeam.
  const fqMergeById = new Map<number, { code: string; name: string; is_merged: boolean; merged_name: string | null }>();
  if (qualities.length > 0) {
    const qIds = (qualities as Array<{ id: number }>).map((q) => q.id);
    const mergeRows = await safeSelect<{ id: number; code: string; name: string; is_merged: boolean | null; merged_name: string | null }>(
      supabase.from('fabric_quality')
        .select('id, code, name, is_merged, merged_name')
        .in('id', qIds),
    );
    for (const r of mergeRows) {
      fqMergeById.set(r.id, {
        code: r.code ?? '',
        name: r.name ?? '',
        is_merged: r.is_merged === true,
        merged_name: r.merged_name ?? null,
      });
    }
  }

  // Pull every production_fabric ledger row. Cast through any because
  // stock_ledger isn't fully typed in the generated database.types.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ledger } = await (supabase as any)
    .from('stock_ledger')
    .select('id, bucket, direction, fabric_quality_id, quantity, unit, event_date, source_kind, source_id, reference_no, notes')
    .eq('bucket', 'production_fabric')
    .order('event_date');
  const rows = ((ledger ?? []) as Array<{
    id: number;
    direction: 'in' | 'out' | string;
    fabric_quality_id: number | null;
    quantity: number | string | null;
    unit: string | null;
    event_date: string | null;
    reference_no: string | null;
    notes: string | null;
  }>);

  // colInfo: maps a fabric_quality_id to its pivot column identity,
  // collapsing merged siblings via merged_name. Same shape used by the
  // warp-beam pivot loader.
  const colInfo = (qualityId: number | null): { id: string; label: string; sublabel: string } => {
    if (qualityId == null) return { id: 'unknown', label: '(no quality)', sublabel: '' };
    const m = fqMergeById.get(qualityId);
    if (m && m.is_merged && m.merged_name && m.merged_name.trim() !== '') {
      return { id: `m:${m.merged_name.trim()}`, label: m.merged_name.trim(), sublabel: 'merged group' };
    }
    return { id: `fq:${qualityId}`, label: m?.code ?? `FQ #${qualityId}`, sublabel: m?.name ?? '' };
  };

  // One pivot per unit. Columns are only added to a pivot when at least
  // one row of that unit lands on the quality so the pcs/metres tables
  // don't show empty columns for qualities that only ship in the other
  // unit.
  const pcsCols = new Map<string, PivotColumn>();
  const pcsEvents: PivotEvent[] = [];
  const mCols = new Map<string, PivotColumn>();
  const mEvents: PivotEvent[] = [];

  const ensureCol = (
    target: Map<string, PivotColumn>,
    qualityId: number | null,
  ): string => {
    const info = colInfo(qualityId);
    if (!target.has(info.id)) {
      target.set(info.id, { id: info.id, label: info.label, sublabel: info.sublabel });
    }
    return info.id;
  };

  for (const r of rows) {
    const dir: 'in' | 'out' = r.direction === 'out' ? 'out' : 'in';
    const u = (r.unit ?? '').toLowerCase();
    const isPcs = u === 'pcs';
    const target = isPcs ? pcsCols : mCols;
    const bucket = isPcs ? pcsEvents : mEvents;
    const colId = ensureCol(target, r.fabric_quality_id);
    bucket.push({
      event_date: r.event_date ?? '',
      column_id: colId,
      direction: dir,
      quantity: Number(r.quantity ?? 0),
      reference: r.reference_no ?? `Ledger #${r.id}`,
      notes: r.notes ?? '',
    });
  }

  const sortCols = (m: Map<string, PivotColumn>) =>
    Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label));

  return {
    pcs: { unit: 'pcs', columns: sortCols(pcsCols), events: pcsEvents },
    metres: { unit: 'm', columns: sortCols(mCols), events: mEvents },
  };
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
  label, value, icon: Icon, negative = false,
}: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; negative?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
        <Icon className="w-4 h-4 text-ink-mute" />
      </div>
      <div className={`num text-xl font-bold ${negative ? 'text-rose-700' : ''}`}>{value}</div>
    </div>
  );
}
