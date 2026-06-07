import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { Plus, Pencil, Printer } from 'lucide-react';

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
  code: string;
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
    .select('id, code, dc_date, status, production_mode, party_id, bill_to_name, total_metres, total_pieces, total_bundles, sales_order_id, invoice_id')
    .order(sort, { ascending: dir === 'asc' })
    .order('id', { ascending: false });
  if (mode !== null) q = q.eq('production_mode', mode);
  const { data, error } = await q;

  const rows = (data ?? []) as DcRow[];

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

      <div className="card overflow-x-auto">
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
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-right px-3 py-3">Pcs</th>
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
              return (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/app/delivery-challan/${r.id}`} className="text-indigo hover:underline">{r.code}</Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{fmtDate(r.dc_date)}</td>
                  <td className="px-3 py-2 text-xs capitalize">{r.production_mode}</td>
                  <td className="px-3 py-2 font-medium">{r.bill_to_name ?? '-'}</td>
                  <td className="px-3 py-2 text-right num">{Number(r.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-right num">{r.total_pieces ?? 0}</td>
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
                    <Link href={`/app/delivery-challan/${r.id}`} className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex" title="Edit DC">
                      <Pencil className="w-4 h-4" />
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
