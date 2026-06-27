import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { Plus, Pencil, Printer, PackageCheck } from 'lucide-react';
import { CardFilter } from '@/app/components/card-filter';
import { CancelDcButton } from './cancel-dc-button';

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
  searchParams: Promise<{ sort?: string; dir?: string; mode?: string }>;
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

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  let q = sb
    .from('delivery_challan')
    .select('id, code, void_code, dc_date, status, production_mode, party_id, bill_to_name, total_metres, total_pieces, total_bundles, sales_order_id, invoice_id, fabric_receipt_id')
    .order(sort, { ascending: dir === 'asc' })
    .order('id', { ascending: false });
  if (mode !== null) q = q.eq('production_mode', mode);
  const { data, error } = await q;

  const rows = (data ?? []) as DcRow[];

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
  // dc_id -> true when every quality on the DC is a towel quality.
  // Towel qualities store their towel-piece count in total_metres (not metres),
  // so the list must label the figure as towels rather than "m".
  const towelByDc = new Map<number, boolean>();
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
    const qIsTowel = new Map<number, boolean>();
    if (allQIds.size > 0) {
      const { data: qMaster } = await sb
        .from('fabric_quality')
        .select('id, code, name, fabric_type')
        .in('id', Array.from(allQIds));
      for (const q of (qMaster ?? []) as Array<{ id: number; code: string | null; name: string | null; fabric_type: string | null }>) {
        qLabel.set(Number(q.id), q.code ?? q.name ?? '');
        qIsTowel.set(Number(q.id), q.fabric_type === 'towel');
      }
    }
    for (const [dcId, ids] of qIdsByDc) {
      const idList = Array.from(ids);
      const label = idList.map((id) => qLabel.get(id) ?? '').filter(Boolean).join(', ');
      if (label) qualityByDc.set(dcId, label);
      // Treat the DC as a towel DC only when all of its qualities are towels.
      if (idList.length > 0 && idList.every((id) => qIsTowel.get(id) === true)) {
        towelByDc.set(dcId, true);
      }
    }
  }

  // Preserve the mode filter in any links built off this page.
  const qsMode = mode !== null ? `?mode=${mode}` : '';
  const newDcHref = `/app/delivery-challan/new${qsMode}`;

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
          const href = t.key === 'all' ? '/app/delivery-challan' : `/app/delivery-challan?mode=${t.key}`;
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

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load DCs: {error.message}</div>
      )}

      {/* Mobile / PWA: card view. The wide DC table forces horizontal
          scrolling on a phone, so below md we render each DC as a
          tap-friendly card. The table below is hidden on mobile. */}
      <CardFilter placeholder="Search DCs…">
        {rows.length ? rows.map((r) => {
          const pill = statusPill(r.status);
          // A whole-number total_metres on a towel DC is really a towel-piece
          // count, so label it "towels"; decimals mean a real metre delivery.
          const isTowelQty = (towelByDc.get(r.id) ?? false) && Number.isInteger(Number(r.total_metres ?? 0));
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
                {isTowelQty ? (
                  <>
                    <span className="text-ink-mute">Towels: </span><span className="num">{Math.round(Number(r.total_metres ?? 0)).toLocaleString('en-IN')}</span>
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
              <SortableTh column="code" label="DC No" sort={sort} dir={dir} basePath="/app/delivery-challan" extraParams={mode !== null ? { mode } : {}} className="text-left px-3 py-3" />
              <SortableTh column="dc_date" label="Date" sort={sort} dir={dir} basePath="/app/delivery-challan" extraParams={mode !== null ? { mode } : {}} className="text-left px-3 py-3" />
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
              const isTowelQty = (towelByDc.get(r.id) ?? false) && Number.isInteger(Number(r.total_metres ?? 0));
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
                    {isTowelQty
                      ? <>{Math.round(Number(r.total_metres ?? 0)).toLocaleString('en-IN')} towels</>
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
