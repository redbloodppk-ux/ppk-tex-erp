/**
 * Fabric Receipt list.
 *
 * Three tabs — In-house / Job Work / Outsource Weaving — segregate
 * receipts by the production_mode of the source delivery challan they
 * were created against. Each tab is a self-contained list with its
 * own KPI strip; filters (party / date range) apply within the tab.
 *
 * Tabs are driven by the `?tab=` query parameter (inhouse | jobwork |
 * outsource). We hard-INNER-join the delivery_challan to filter on
 * production_mode so the SQL stays cheap even on large receipt
 * histories.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Eye } from 'lucide-react';
import { BackfillSnapshotsButton } from './backfill-button';
import { ReorganizeReceiptsButton } from './reorganize-button';
import { RebuildLedgerButton } from './rebuild-ledger-button';

export const metadata = { title: 'Fabric Receipts' };
export const dynamic = 'force-dynamic';

type TabKind = 'inhouse' | 'jobwork' | 'outsource';

interface TabConfig {
  kind: TabKind;
  label: string;
  productionMode: string;
  partyTypeName: string | null;
  pickDcHref: string;
  pickDcLabel: string;
}

const TABS: ReadonlyArray<TabConfig> = [
  {
    kind: 'inhouse',
    label: 'In-house',
    productionMode: 'inhouse',
    partyTypeName: null,
    pickDcHref: '/app/delivery-challan',
    pickDcLabel: 'Pick an in-house DC',
  },
  {
    kind: 'jobwork',
    label: 'Job Work',
    productionMode: 'jobwork',
    partyTypeName: 'Jobwork Party',
    pickDcHref: '/app/jobwork',
    pickDcLabel: 'Pick a jobwork DC',
  },
  {
    kind: 'outsource',
    label: 'Outsource Weaving',
    productionMode: 'outsource',
    partyTypeName: 'Outsource Weaver',
    pickDcHref: '/app/outsource',
    pickDcLabel: 'Pick an outsource DC',
  },
];

interface StockSnapshotJson {
  warp_beam?:   { before_m?: number;  consumed_m?: number;  after_m?: number  };
  weft_yarn?:   { before_kg?: number; consumed_kg?: number; after_kg?: number };
  porvai_yarn?: { before_kg?: number; consumed_kg?: number; after_kg?: number };
  bobbin?:      { before_m?: number;  consumed_m?: number;  after_m?: number  };
}

interface ReceiptRow {
  id: number;
  code: string;
  receipt_date: string;
  receipt_type: string;
  party_dc_no: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  status: string;
  remarks: string | null;
  stock_snapshot: StockSnapshotJson | null;
  party: { id: number; name: string; code: string } | null;
  dc: { id: number; code: string; production_mode: string | null } | null;
}

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    party?: string;
    from?: string;
    to?: string;
  }>;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function fmtMetres(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function resolveTab(raw: string | undefined): TabConfig {
  const match = TABS.find((t) => t.kind === raw);
  // Default to Job Work (legacy behaviour). Cast through the TabConfig
  // union because tuple-index lookups widen to `T | undefined` under
  // `noUncheckedIndexedAccess`, even though TABS[1] is statically
  // known at compile time.
  return match ?? (TABS[1] as TabConfig);
}

export default async function FabricReceiptListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab = resolveTab(sp.tab);
  const partyId = sp.party && /^\d+$/.test(sp.party) ? Number(sp.party) : null;
  const fromDate = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null;
  const toDate   = sp.to   && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)   ? sp.to   : null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Inner-join delivery_challan so we can filter by its production_mode.
  // The `!inner` hint forces PostgREST to make the join mandatory
  // (excluding receipts with no DC link) and embeds the filter into the
  // parent query.
  const baseCols = `
    id, code, receipt_date, receipt_type, party_dc_no,
    total_metres, total_pieces, status, remarks,
    party:party_id ( id, name, code ),
    dc:dc_id!inner ( id, code, production_mode )
  `;
  const buildQuery = (includeSnapshot: boolean) => {
    let q = sb.from('fabric_receipt')
      .select(includeSnapshot ? baseCols.replace('remarks,', 'remarks, stock_snapshot,') : baseCols)
      .eq('dc.production_mode', tab.productionMode)
      .order('receipt_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(200);
    if (partyId !== null) q = q.eq('party_id', partyId);
    if (fromDate !== null) q = q.gte('receipt_date', fromDate);
    if (toDate   !== null) q = q.lte('receipt_date', toDate);
    return q;
  };

  let { data, error } = await buildQuery(true);
  if (error && /stock_snapshot/i.test(error.message ?? '')) {
    const fallback = await buildQuery(false);
    data  = fallback.data;
    error = fallback.error;
  }
  const rows = (data ?? []) as ReceiptRow[];

  // Party filter dropdown. We narrow the list to the party type that
  // matches this tab (Jobwork Party / Outsource Weaver). In-house has
  // no fixed type, so we show every active party.
  let partyTypeId: number | null = null;
  if (tab.partyTypeName !== null) {
    const { data: ptRow } = await sb
      .from('party_type_master')
      .select('id')
      .eq('name', tab.partyTypeName)
      .maybeSingle();
    partyTypeId = ptRow?.id ?? null;
  }

  const { data: partyData } = await sb
    .from('party')
    .select('id, code, name, party_type_ids, party_type_id')
    .eq('status', 'active')
    .order('name');
  const allParties = (partyData ?? []) as Array<{
    id: number; code: string; name: string;
    party_type_ids: Array<number | string> | null;
    party_type_id: number | null;
  }>;
  const parties = partyTypeId == null
    ? allParties
    : allParties.filter((p) => {
        const ids = Array.isArray(p.party_type_ids) ? p.party_type_ids.map((x) => Number(x)) : [];
        return ids.includes(partyTypeId) || Number(p.party_type_id) === partyTypeId;
      });

  // KPI totals across the filtered rows.
  const totals = rows.reduce<{ m: number; p: number }>(
    (acc, r) => ({
      m: acc.m + Number(r.total_metres ?? 0),
      p: acc.p + (r.total_pieces ?? 0),
    }),
    { m: 0, p: 0 },
  );

  const baseHref = '/app/jobwork/fabric-receipt';
  const tabHref = (kind: TabKind): string => `${baseHref}?tab=${kind}`;

  return (
    <div>
      <PageHeader
        title="Fabric Receipts"
        subtitle="Inbound fabric, segregated by production mode. Pick a tab to see only receipts of that kind."
        crumbs={[
          { label: 'Job Work', href: '/app/jobwork' },
          { label: 'Fabric Receipts' },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ReorganizeReceiptsButton />
            <RebuildLedgerButton />
            <BackfillSnapshotsButton />
            <Link href={tab.pickDcHref} className="btn-secondary text-xs">
              {tab.pickDcLabel}
            </Link>
          </div>
        }
      />

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-line/60">
        {TABS.map((t) => {
          const active = t.kind === tab.kind;
          return (
            <Link
              key={t.kind}
              href={tabHref(t.kind)}
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

      {/* Filter card */}
      <form action={baseHref} method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        {/* Preserve tab across submits */}
        <input type="hidden" name="tab" value={tab.kind} />
        <div className="flex flex-col">
          <label htmlFor="party" className="text-[10px] uppercase tracking-wide text-ink-mute">Party</label>
          <select id="party" name="party" defaultValue={partyId !== null ? String(partyId) : ''} className="input py-1 text-xs min-w-[200px]">
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="from" className="text-[10px] uppercase tracking-wide text-ink-mute">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate ?? ''} className="input py-1 text-xs max-w-[150px]" />
        </div>
        <div className="flex flex-col">
          <label htmlFor="to" className="text-[10px] uppercase tracking-wide text-ink-mute">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate ?? ''} className="input py-1 text-xs max-w-[150px]" />
        </div>
        <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
        {(partyId !== null || fromDate !== null || toDate !== null) && (
          <Link href={tabHref(tab.kind)} className="text-xs text-ink-mute hover:text-ink underline self-center">
            Clear filters
          </Link>
        )}
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Receipts shown</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total metres</div>
          <div className="num text-xl font-bold">{fmtMetres(totals.m)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total pieces</div>
          <div className="num text-xl font-bold">{totals.p}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Distinct parties</div>
          <div className="num text-xl font-bold">{new Set(rows.map((r) => r.party?.id).filter(Boolean)).size}</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load receipts: {error.message}</div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-3">FR No</th>
              <th className="text-left  px-3 py-3">Date</th>
              <th className="text-left  px-3 py-3">Party</th>
              <th className="text-left  px-3 py-3">DC No</th>
              <th className="text-right px-3 py-3" title="Pieces if the receipt was entered in PCS, otherwise metres">Metres/Pcs</th>
              <th className="text-right px-3 py-3" title="Warp metres consumed">Warp Δ</th>
              <th className="text-right px-3 py-3" title="Weft yarn kg consumed">Weft Δ</th>
              <th className="text-right px-3 py-3" title="Porvai yarn kg consumed">Porvai Δ</th>
              <th className="text-right px-3 py-3" title="Bobbin metres consumed">Bobbin Δ</th>
              <th className="text-right px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-ink-soft">
                  No {tab.label.toLowerCase()} fabric receipts yet.{' '}
                  <Link href={tab.pickDcHref} className="text-indigo font-semibold">{tab.pickDcLabel} &rarr;</Link>
                </td>
              </tr>
            ) : rows.map((r) => {
              const snap = r.stock_snapshot;
              const warpΔ   = snap?.warp_beam?.consumed_m    ?? 0;
              const weftΔ   = snap?.weft_yarn?.consumed_kg   ?? 0;
              const porvaiΔ = snap?.porvai_yarn?.consumed_kg ?? 0;
              const bobbinΔ = snap?.bobbin?.consumed_m       ?? 0;
              const noSnapshot = snap == null;
              return (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/app/jobwork/fabric-receipt/${r.id}`} className="text-indigo hover:underline">{r.code}</Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{fmtDate(r.receipt_date)}</td>
                  <td className="px-3 py-2 font-medium">{r.party?.name ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.dc ? (
                      <Link href={`/app/delivery-challan/${r.dc.id}`} className="text-indigo hover:underline">{r.dc.code}</Link>
                    ) : (r.party_dc_no ?? '-')}
                  </td>
                  <td className="px-3 py-2 text-right num">
                    {/* Show the ACTUAL delivery quantity. If the receipt
                        was entered in PCS (towel mode), show pieces; the
                        metres value would just be pieces × towel_length
                        which is a derived/converted number, so we skip
                        it. If the receipt was in MTR mode, show metres. */}
                    {(r.total_pieces ?? 0) > 0
                      ? <>{r.total_pieces} <span className="text-[10px] text-ink-mute">pcs</span></>
                      : <>{fmtMetres(r.total_metres)} <span className="text-[10px] text-ink-mute">m</span></>}
                  </td>
                  <td className="px-3 py-2 text-right num text-xs text-rose-700">
                    {noSnapshot ? <span className="text-ink-mute">-</span> : warpΔ > 0 ? '\u2212 ' + fmtMetres(warpΔ) + ' m' : '-'}
                  </td>
                  <td className="px-3 py-2 text-right num text-xs text-rose-700">
                    {noSnapshot ? <span className="text-ink-mute">-</span> : weftΔ > 0 ? '\u2212 ' + fmtMetres(weftΔ) + ' kg' : '-'}
                  </td>
                  <td className="px-3 py-2 text-right num text-xs text-rose-700">
                    {noSnapshot ? <span className="text-ink-mute">-</span> : porvaiΔ > 0 ? '\u2212 ' + fmtMetres(porvaiΔ) + ' kg' : '-'}
                  </td>
                  <td className="px-3 py-2 text-right num text-xs text-rose-700">
                    {noSnapshot ? <span className="text-ink-mute">-</span> : bobbinΔ > 0 ? '\u2212 ' + fmtMetres(bobbinΔ) + ' m' : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/app/jobwork/fabric-receipt/${r.id}`} className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex" title="View receipt">
                      <Eye className="w-4 h-4" />
                    </Link>
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
