import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { Plus, Pencil, Printer, PackageCheck } from 'lucide-react';
import { CardFilter } from '@/app/components/card-filter';
import { CancelDcButton } from './cancel-dc-button';
import { DcFilters } from './dc-filters';

export const metadata = { title: 'Delivery Challan' };
export const dynamic = 'force-dynamic';

// Whitelisted sort keys for the DC list. Defaults to dc_date desc.
const SORTABLE_COLUMNS = new Set(['code', 'dc_date']);

// Whitelisted production_mode filter values. Driven from the Fabric
// Receipts "Pick a … DC" buttons — each tab opens this page scoped to
// its own mode so the operator never picks a DC of the wrong kind.
type ModeFilter = 'inhouse' | 'jobwork' | 'outsource';
const MODE_LABEL: Record<ModeFilter, string> = {
  inhouse:   'In-house',
  jobwork:   'Job Work',
  outsource: 'Outsource Weaving',
};
function isModeFilter(v: string | undefined): v is ModeFilter {
  return v === 'inhouse' || v === 'jobwork' || v === 'outsource';
}

interface DcRow {
  id: number;
  code: string | null;
  void_code: string | null;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  production_mode: 'inhouse' | 'jobwork' | 'outsource';
  party_id: number | null;
  bill_to_name: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
  sales_order_id: number | null;
  invoice_id: number | null;
  fabric_receipt_id: number | null;
}

// A cancelled DC has its `code` nulled (the number is freed for reuse) and
// the old number preserved in `void_code`. Show whichever is present.
function dcCode(r: { code: string | null; void_code: string | null }): string {
  return r.code ?? r.void_code ?? '—';
}

// Some fabric types are counted in pieces, not metres: a towel quality stores
// its towel count in total_metres, a dhoti quality its dhoti count, etc. Map
// such a type to its display unit; metre-based types ('fabric', 'woven') → null.
function pieceUnit(fabricType: string | null): string | null {
  switch (fabricType) {
    case 'towel':   return 'towels';
    case 'dhoties': return 'dhotis';
    default:        return null;
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function statusPill(s: DcRow['status']): { label: string; cls: string } {
  switch (s) {
    case 'draft':     return { label: 'Draft',     cls: 'bg-slate-100 text-slate-600' };
    case 'confirmed': return { label: 'Confirmed', cls: 'bg-amber-50 text-amber-700' };
    case 'invoiced':  return { label: 'Invoiced',  cls: 'bg-emerald-50 text-emerald-700' };
    case 'cancelled': return { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700' };
    default:          return { label: s,           cls: 'bg-slate-100 text-slate-600' };
  }
}

export default async function DeliveryChallanListPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string; dir?: string; mode?: string;
    from?: string; to?: string; party?: string; quality?: string;
  }>;
}) {
  const sp = await searchParams;
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'dc_date';
  // Default direction is descending for dc_date (newest first); for code
  // ascending makes more sense. The SortableTh toggles dir on click.
  const dir: SortDir = sp.dir === 'asc' ? 'asc' : sp.dir === 'desc' ? 'desc' : (sort === 'dc_date' ? 'desc' : 'asc');

  // Optional production-mode scope. Driven from the Fabric Receipts
  // "Pick a … DC" buttons — `?mode=inhouse` only shows inhouse DCs and
  // so on. No mode = show everything (legacy behaviour).
  const mode: ModeFilter | null = isModeFilter(sp.mode) ? sp.mode : null;

  // Optional date-range / party / fabric-quality filters — apply across
  // all 4 tabs (via DcFilters, a client filter bar) alongside whatever
  // mode tab is active. Basic format guards so a malformed param can't
  // break the query.
  const isDate = (s: string | undefined): s is string => s != null && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(sp.from) ? sp.from : null;
  const to = isDate(sp.to) ? sp.to : null;
  const partyId = sp.party != null && /^\d+$/.test(sp.party) ? Number(sp.party) : null;
  // Fabric quality filter may carry more than one id at once — a "merged
  // quality" option in the filter bar (e.g. "COLOR OE") stands in for
  // several underlying fabric_quality rows, joined as a comma-separated
  // list in the URL (?quality=10,11). Split + validate each piece.
  const qualityIds: number[] | null = sp.quality != null && /^\d+(,\d+)*$/.test(sp.quality)
    ? Array.from(new Set(sp.quality.split(',').map(Number)))
    : null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Fabric-quality filter isn't a column on delivery_challan itself — it
  // lives on delivery_challan_item. Resolve it to a set of dc ids first so
  // the main query can just .in('id', …) alongside the other filters.
  let qualityDcIds: number[] | null = null;
  if (qualityIds !== null) {
    const { data: qItemRows } = await sb
      .from('delivery_challan_item')
      .select('dc_id')
      .in('fabric_quality_id', qualityIds);
    qualityDcIds = Array.from(new Set(
      ((qItemRows ?? []) as Array<{ dc_id: number | null }>)
        .map((r) => r.dc_id)
        .filter((id): id is number => id != null),
    ));
  }

  let rows: DcRow[] = [];
  let error: { message: string } | null = null;
  if (qualityDcIds === null || qualityDcIds.length > 0) {
    let q = sb
      .from('delivery_challan')
      .select('id, code, void_code, dc_date, status, production_mode, party_id, bill_to_name, total_metres, total_pieces, total_bundles, sales_order_id, invoice_id, fabric_receipt_id')
      .order(sort, { ascending: dir === 'asc' })
      .order('id', { ascending: false });
    if (mode !== null) q = q.eq('production_mode', mode);
    if (from !== null) q = q.gte('dc_date', from);
    if (to !== null) q = q.lte('dc_date', to);
    if (partyId !== null) q = q.eq('party_id', partyId);
    if (qualityDcIds !== null) q = q.in('id', qualityDcIds);
    const res = await q;
    rows = (res.data ?? []) as DcRow[];
    error = res.error;
  }

  // Options for the Party / Fabric Quality filter dropdowns. Parties carry
  // their party_type_ids so the filter bar can scope the list to whichever
  // tab is active (In-house -> Customer, Job Work -> Jobwork Party,
  // Outsource Weaving -> Outsource Weaver) — same rule the New DC form uses.
  const [{ data: partyOpts }, { data: qualityOpts }, { data: partyTypeRows }] = await Promise.all([
    sb.from('party').select('id, code, name, party_type_ids').eq('status', 'active').order('name'),
    sb.from('fabric_quality').select('id, code, name, is_merged, merged_name').eq('active', true).order('code'),
    sb.from('party_type_master').select('id, name').in('name', ['Customer', 'Jobwork Party', 'Outsource Weaver']),
  ]);
  const partyTypes = (partyTypeRows ?? []) as Array<{ id: number; name: string }>;
  const partyTypeIds = {
    inhouse: partyTypes.find((t) => t.name === 'Customer')?.id ?? null,
    jobwork: partyTypes.find((t) => t.name === 'Jobwork Party')?.id ?? null,
    outsource: partyTypes.find((t) => t.name === 'Outsource Weaver')?.id ?? null,
  };

  // Which DCs were cut from a production batch? Those carry already-
  // finished fabric going OUT to a customer — they must NOT be receipted
  // again (that would re-add the same batch's fabric to stock). We fade
  // the "Receive fabric" icon for them. One query: every dc_item with a
  // production_batch_id, scoped to the DCs on screen.
  const batchDcIds = new Set<number>();
  if (rows.length > 0) {
    const { data: batchItems } = await sb
      .from('delivery_challan_item')
      .select('dc_id')
      .not('production_batch_id', 'is', null)
      .in('dc_id', rows.map((r) => r.id));
    for (const it of (batchItems ?? []) as Array<{ dc_id: number | null }>) {
      if (it.dc_id != null) batchDcIds.add(Number(it.dc_id));
    }
  }

  // Fabric quality per DC. A DC's items each reference a fabric_quality;
  // a single DC may carry more than one quality, so we collect the
  // distinct set per DC and join their codes (falling back to name).
  const qualityByDc = new Map<number, string>();
  // dc_id -> piece-unit label ('towels' / 'dhotis') when every quality on the
  // DC is a piece-counted type. These qualities store their PIECE count in
  // total_metres (not metres), so the list labels the figure in pieces, not m.
  const pieceUnitByDc = new Map<number, string>();
  if (rows.length > 0) {
    const { data: qItems } = await sb
      .from('delivery_challan_item')
      .select('dc_id, fabric_quality_id')
      .in('dc_id', rows.map((r) => r.id));
    // dc_id -> ordered set of quality ids
    const qIdsByDc = new Map<number, Set<number>>();
    const allQIds = new Set<number>();
    for (const it of (qItems ?? []) as Array<{ dc_id: number | null; fabric_quality_id: number | null }>) {
      if (it.dc_id == null || it.fabric_quality_id == null) continue;
      let s = qIdsByDc.get(Number(it.dc_id));
      if (!s) { s = new Set<number>(); qIdsByDc.set(Number(it.dc_id), s); }
      s.add(Number(it.fabric_quality_id));
      allQIds.add(Number(it.fabric_quality_id));
    }
    const qLabel = new Map<number, string>();
    const qType = new Map<number, string | null>();
    if (allQIds.size > 0) {
      const { data: qMaster } = await sb
        .from('fabric_quality')
        .select('id, code, name, fabric_type, is_merged, merged_name')
        .in('id', Array.from(allQIds));
      for (const q of (qMaster ?? []) as Array<{ id: number; code: string | null; name: string | null; fabric_type: string | null; is_merged: boolean | null; merged_name: string | null }>) {
        // Show the merged quality name only, when this row belongs to one —
        // several physically-distinct quality codes can share one merged
        // name (e.g. "COLOR OE"), and the list should read as one quality.
        const label = q.is_merged && q.merged_name ? q.merged_name : (q.code ?? q.name ?? '');
        qLabel.set(Number(q.id), label);
        qType.set(Number(q.id), q.fabric_type);
      }
    }
    for (const [dcId, ids] of qIdsByDc) {
      const idList = Array.from(ids);
      // Dedupe labels — two items can reference different quality ids that
      // share the same merged name, which would otherwise repeat it.
      const label = Array.from(new Set(idList.map((id) => qLabel.get(id) ?? '').filter(Boolean))).join(', ');
      if (label) qualityByDc.set(dcId, label);
      // Only a DC whose qualities all share one piece-counted type gets a
      // piece-unit; mixed-type DCs stay in metres to avoid mislabelling.
      const units = new Set(idList.map((id) => pieceUnit(qType.get(id) ?? null)));
      if (idList.length > 0 && units.size === 1) {
        const u = units.values().next().value;
        if (u) pieceUnitByDc.set(dcId, u);
      }
    }
  }

  // Delivery-metres summary for whatever's currently on screen (after mode
  // tab + date/party/quality filters). A piece-counted DC (towel/dhoti) has
  // its piece count stored in total_metres, not real metres — same
  // qtyUnit test the rows use below — so those are kept out of the metres
  // total and rolled into the pieces total instead.
  let summaryTotalMetres = 0;
  let summaryTotalPieces = 0;
  for (const r of rows) {
    const pUnit = pieceUnitByDc.get(r.id);
    const isPieceRow = pUnit && Number.isInteger(Number(r.total_metres ?? 0));
    if (isPieceRow) summaryTotalPieces += Number(r.total_metres ?? 0);
    else summaryTotalMetres += Number(r.total_metres ?? 0);
  }
  const summaryTotalBundles = rows.reduce((s, r) => s + Number(r.total_bundles ?? 0), 0);

  // Preserve the mode filter + any active date/party/quality filters in
  // links built off this page (tab strip, sort headers).
  const qsMode = mode !== null ? `?mode=${mode}` : '';
  const newDcHref = `/app/delivery-challan/new${qsMode}`;
  const filterExtraParams: Record<string, string | undefined> = {
    mode: mode ?? undefined,
    from: from ?? undefined,
    to: to ?? undefined,
    party: partyId !== null ? String(partyId) : undefined,
    quality: qualityIds !== null ? qualityIds.join(',') : undefined,
  };
  function tabHref(key: ModeFilter | 'all'): string {
    const params = new URLSearchParams();
    if (key !== 'all') params.set('mode', key);
    if (from !== null) params.set('from', from);
    if (to !== null) params.set('to', to);
    if (partyId !== null) params.set('party', String(partyId));
    if (qualityIds !== null) params.set('quality', qualityIds.join(','));
    const qs = params.toString();
    return qs ? `/app/delivery-challan?${qs}` : '/app/delivery-challan';
  }

  // Build the subtitle so it reflects the active mode scope.
  const subtitle = mode !== null
    ? `${MODE_LABEL[mode]} DCs only.`
    : 'All Delivery Challans across in-house, jobwork and outsource flows.';

  // Tab strip — each tab is just the same page scoped to one mode.
  // "All" is the legacy view (no filter). The 3-mode tabs let the
  // operator land directly on the kind of DC they want to work with.
  const TAB_DEFS: ReadonlyArray<{ key: ModeFilter | 'all'; label: string }> = [
    { key: 'all',       label: 'All' },
    { key: 'inhouse',   label: 'In-house' },
    { key: 'jobwork',   label: 'Job Work' },
    { key: 'outsource', label: 'Outsource Weaving' },
  ];
  const activeKey: ModeFilter | 'all' = mode ?? 'all';

  return (
    <div>
      <PageHeader
        title={mode !== null ? `Delivery Challan — ${MODE_LABEL[mode]}` : 'Delivery Challan'}
        subtitle={subtitle}
        actions={
          <Link href={newDcHref} className="btn-primary">
            <Plus className="w-4 h-4" /> New DC
          </Link>
        }
      />

      {/* Tab strip — In-house / Job Work / Outsource Weaving each
          scope the table to that mode. The "All" tab keeps the
          legacy unfiltered view available. */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-line/60">
        {TAB_DEFS.map((t) => {
          const active = t.key === activeKey;
          const href = tabHref(t.key);
          return (
            <Link
              key={t.key}
              href={href}
              className={
                'px-4 py-2 text-sm font-medium rounded-t -mb-px border-b-2 transition ' +
                (active
                  ? 'border-indigo text-indigo bg-indigo-50/60'
                  : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze/60')
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Party / Fabric quality / date-range filters — apply across all
          4 tabs above, on top of whatever mode tab is active. */}
      <DcFilters
        parties={(partyOpts ?? []) as Array<{ id: number; code: string | null; name: string; party_type_ids: number[] | null }>}
        qualities={(qualityOpts ?? []) as Array<{ id: number; code: string | null; name: string | null; is_merged: boolean | null; merged_name: string | null }>}
        partyTypeIds={partyTypeIds}
      />

      {/* Delivery-metres summary for the current filter/tab scope. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-xs text-ink-mute">DCs</div>
          <div className="text-lg font-semibold mt-1">{rows.length.toLocaleString('en-IN')}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Total metres</div>
          <div className="text-lg font-semibold mt-1 num">{summaryTotalMetres.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Total pieces</div>
          <div className="text-lg font-semibold mt-1 num">{summaryTotalPieces.toLocaleString('en-IN')}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Total bundles</div>
          <div className="text-lg font-semibold mt-1 num">{summaryTotalBundles.toLocaleString('en-IN')}</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load DCs: {error.message}</div>
      )}

      {/* Mobile / PWA: card view. The wide DC table forces horizontal
          scrolling on a phone, so below md we render each DC as a
          tap-friendly card. The table below is hidden on mobile. */}
      <CardFilter placeholder="Search DCs…">
        {rows.length ? rows.map((r) => {
          const pill = statusPill(r.status);
          // A whole-number total_metres on a piece-counted DC (towel/dhoti) is
          // really a piece count, so label it in pieces; decimals mean a real
          // metre delivery and stay in metres.
          const pUnit = pieceUnitByDc.get(r.id);
          const qtyUnit = pUnit && Number.isInteger(Number(r.total_metres ?? 0)) ? pUnit : null;
          return (
            <div key={r.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/app/delivery-challan/${r.id}`} className="font-mono text-xs font-semibold text-ink hover:text-indigo break-words">
                    {dcCode(r)}
                  </Link>
                  <div className="text-sm font-medium mt-0.5 break-words">{r.bill_to_name ?? '-'}</div>
                  <div className="text-xs text-ink-soft mt-0.5 break-words">
                    <span className="text-ink-mute">Quality: </span>{qualityByDc.get(r.id) ?? '-'}
                  </div>
                </div>
                <span className={`pill ${pill.cls} text-xs uppercase tracking-wide shrink-0`}>{pill.label}</span>
              </div>

              <div className="text-xs text-ink-soft mt-1">
                <span className="text-ink-mute">Date: </span>{fmtDate(r.dc_date)}
                <span className="text-ink-mute"> · Mode: </span><span className="capitalize">{r.production_mode}</span>
              </div>
              <div className="text-xs text-ink-soft mt-1">
                {qtyUnit ? (
                  <>
                    <span className="text-ink-mute capitalize">{qtyUnit}: </span><span className="num">{Math.round(Number(r.total_metres ?? 0)).toLocaleString('en-IN')}</span>
                  </>
                ) : (
                  <>
                    <span className="text-ink-mute">Metres: </span><span className="num">{Number(r.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </>
                )}
                <span className="text-ink-mute"> · Pcs: </span><span className="num">{r.total_pieces ?? 0}</span>
                <span className="text-ink-mute"> · Bundles: </span><span className="num">{r.total_bundles ?? 0}</span>
              </div>

              <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                <Link
                  href={`/app/delivery-challan/${r.id}/print`}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold"
                  title="View / Print / PDF"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </Link>
                {r.status !== 'cancelled' && (
                  <Link href={`/app/delivery-challan/${r.id}`} className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold" title="Edit DC">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Link>
                )}
                {r.status !== 'cancelled' && r.fabric_receipt_id == null && (
                  batchDcIds.has(r.id) ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-slate-300 cursor-not-allowed"
                      title="Made from a production batch — no fabric receipt needed (avoids duplicating batch stock)"
                      aria-disabled="true"
                    >
                      <PackageCheck className="w-3.5 h-3.5" /> Receive
                    </span>
                  ) : (
                    <Link
                      href={`/app/jobwork/fabric-receipt/new?dc=${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-amber-700 font-semibold"
                      title="Create fabric receipt from this DC"
                    >
                      <PackageCheck className="w-3.5 h-3.5" /> Receive
                    </Link>
                  )
                )}
                {r.status !== 'cancelled' && r.invoice_id == null && r.fabric_receipt_id == null && (
                  <span className="inline-flex items-center">
                    <CancelDcButton
                      dcId={r.id}
                      code={r.code}
                      productionMode={r.production_mode}
                      variant="button"
                    />
                  </span>
                )}
              </div>
            </div>
          );
        }) : (
          <div className="card p-6 text-center text-sm text-ink-soft">
            {mode !== null
              ? <>No {MODE_LABEL[mode].toLowerCase()} delivery challans yet. </>
              : <>No delivery challans yet. </>}
            <Link href={newDcHref} className="text-indigo font-semibold">Create the first one &rarr;</Link>
          </div>
        )}
      </CardFilter>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              {/* Sort links must preserve the mode filter — otherwise
                  clicking a header would silently drop the scope and
                  surface every DC again. SortableTh builds its href as
                  `${basePath}?sort=...&dir=...` so the mode param has
                  to ride along via extraParams, not glued onto the
                  basePath (that'd produce ?mode=…?sort=…). */}
              <SortableTh column="code" label="DC No" sort={sort} dir={dir} basePath="/app/delivery-challan" extraParams={filterExtraParams} className="text-left px-3 py-3" />
              <SortableTh column="dc_date" label="Date" sort={sort} dir={dir} basePath="/app/delivery-challan" extraParams={filterExtraParams} className="text-left px-3 py-3" />
              <th className="text-left px-3 py-3">Mode</th>
              <th className="text-left px-3 py-3">Party (Bill-To)</th>
              <th className="text-left px-3 py-3">Fabric Quality</th>
              <th className="text-right px-3 py-3">Qty · Pcs</th>
              <th className="text-right px-3 py-3">Bundles</th>
              <th className="text-left px-3 py-3">Status</th>
              <th className="text-right px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-ink-soft">
                  {mode !== null
                    ? <>No {MODE_LABEL[mode].toLowerCase()} delivery challans yet. </>
                    : <>No delivery challans yet. </>}
                  <Link href={newDcHref} className="text-indigo font-semibold">Create the first one &rarr;</Link>
                </td>
              </tr>
            ) : rows.map((r) => {
              const pill = statusPill(r.status);
              const pUnit = pieceUnitByDc.get(r.id);
              const qtyUnit = pUnit && Number.isInteger(Number(r.total_metres ?? 0)) ? pUnit : null;
              return (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/app/delivery-challan/${r.id}`} className="text-indigo hover:underline">{dcCode(r)}</Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{fmtDate(r.dc_date)}</td>
                  <td className="px-3 py-2 text-xs capitalize">{r.production_mode}</td>
                  <td className="px-3 py-2 font-medium">{r.bill_to_name ?? '-'}</td>
                  <td className="px-3 py-2 text-xs">{qualityByDc.get(r.id) ?? '-'}</td>
                  <td className="px-3 py-2 text-right num whitespace-nowrap">
                    {qtyUnit
                      ? <>{Math.round(Number(r.total_metres ?? 0)).toLocaleString('en-IN')} {qtyUnit}</>
                      : <>{Number(r.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} m</>}
                    <span className="text-ink-mute"> · {r.total_pieces ?? 0} pcs</span>
                  </td>
                  <td className="px-3 py-2 text-right num">{r.total_bundles ?? 0}</td>
                  <td className="px-3 py-2">
                    <span className={`pill ${pill.cls} text-xs uppercase tracking-wide`}>{pill.label}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/app/delivery-challan/${r.id}/print`}
                      target="_blank"
                      className="p-1 rounded hover:bg-emerald-50 text-emerald-700 inline-flex mr-1"
                      title="View / Print / PDF"
                    >
                      <Printer className="w-4 h-4" />
                    </Link>
                    {r.status !== 'cancelled' && (
                      <Link href={`/app/delivery-challan/${r.id}`} className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex" title="Edit DC">
                        <Pencil className="w-4 h-4" />
                      </Link>
                    )}
                    {/* Receive fabric against this DC — opens the fabric
                        receipt form (works for in-house, jobwork and
                        outsource DCs alike). DCs cut from a production
                        batch carry finished goods going OUT to a customer;
                        receipting them would duplicate the batch's stock,
                        so the icon is faded + disabled for those. */}
                    {/* Once a fabric receipt has been cut from this DC,
                        delivery_challan.fabric_receipt_id is set — hide the
                        "Receive fabric" button entirely so a second receipt
                        can never be created against the same DC. (Deleting
                        the receipt clears the link and the button returns.) */}
                    {r.status !== 'cancelled' && r.fabric_receipt_id == null && (
                      batchDcIds.has(r.id) ? (
                        <span
                          className="p-1 rounded inline-flex ml-1 text-slate-300 cursor-not-allowed"
                          title="Made from a production batch — no fabric receipt needed (avoids duplicating batch stock)"
                          aria-disabled="true"
                        >
                          <PackageCheck className="w-4 h-4" />
                        </span>
                      ) : (
                        <Link
                          href={`/app/jobwork/fabric-receipt/new?dc=${r.id}`}
                          className="p-1 rounded hover:bg-amber-50 text-amber-700 inline-flex ml-1"
                          title="Create fabric receipt from this DC"
                        >
                          <PackageCheck className="w-4 h-4" />
                        </Link>
                      )
                    )}
                    {r.status !== 'cancelled' && r.invoice_id == null && r.fabric_receipt_id == null && (
                      <CancelDcButton
                        dcId={r.id}
                        code={r.code}
                        productionMode={r.production_mode}
                        variant="icon"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
