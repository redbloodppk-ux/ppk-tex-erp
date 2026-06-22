import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { Plus, Pencil, Link2 } from 'lucide-react';
import { FabricActiveToggle } from '@/app/components/fabric-active-toggle';
import { FabricDeleteButton } from '@/app/components/fabric-delete-button';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Fabric Qualities' };
export const dynamic = 'force-dynamic';

// Whitelisted sort keys for the fabric_quality list.
const SORTABLE_COLUMNS = new Set(['code', 'name']);

interface FQRow {
  id: number;
  code: string;
  name: string;
  fabric_type: string | null;
  production_mode: string | null;
  width_in: number | null;
  reed_space: number | null;
  pick_per_inch: number | null;
  reed: number | null;
  active: boolean;
  is_merged: boolean;
  merged_name: string | null;
}

const PRODUCTION_MODE_LABEL: Record<string, string> = {
  inhouse: 'In-house',
  job_work: 'Job work',
  outsourcing: 'Outsourcing',
};

function fmtM(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default async function FabricQualitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'name';
  const dir: SortDir = sp.dir === 'desc' ? 'desc' : 'asc';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from('fabric_quality')
    .select('id, code, name, fabric_type, production_mode, width_in, reed_space, pick_per_inch, reed, active, is_merged, merged_name')
    .order(sort, { ascending: dir === 'asc' });

  const rows = (data ?? []) as unknown as FQRow[];

  // Build per-merged-group totals: sum of jobwork_warp_beam.total_metres
  // across every quality sharing the same merged_name. Renders in the
  // "Merged warp m" column so the operator can see the pooled stock that
  // Fabric Receipt will draw from.
  const mergedIds = rows
    .filter((r) => r.is_merged && r.merged_name && r.merged_name.trim() !== '')
    .map((r) => r.id);
  const warpByQId = new Map<number, number>();
  if (mergedIds.length > 0) {
    const { data: wbRows } = await sb
      .from('jobwork_warp_beam')
      .select('fabric_quality_id, total_metres')
      .in('fabric_quality_id', mergedIds)
      .gt('total_metres', 0);
    for (const w of ((wbRows ?? []) as Array<{ fabric_quality_id: number | null; total_metres: number | string | null }>)) {
      if (w.fabric_quality_id == null) continue;
      warpByQId.set(
        w.fabric_quality_id,
        (warpByQId.get(w.fabric_quality_id) ?? 0) + Number(w.total_metres ?? 0),
      );
    }
  }
  const mergedPoolByName = new Map<string, number>();
  for (const r of rows) {
    if (!r.is_merged || !r.merged_name || r.merged_name.trim() === '') continue;
    const key = r.merged_name.trim();
    mergedPoolByName.set(key, (mergedPoolByName.get(key) ?? 0) + (warpByQId.get(r.id) ?? 0));
  }

  return (
    <div>
      <PageHeader
        title="Fabric Qualities"
        subtitle="Smart-style fabric master: header attributes + ends / warp / weft / weaving-rate sub-tables."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Fabric Qualities' }]}
        actions={
          <Link href="/app/settings/fabric-qualities/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Fabric Quality
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load fabric qualities: {error.message}
        </div>
      )}

      {/* Mobile / PWA: card view. The fabric-quality table is wide; below md
          each quality renders as a tap-friendly card. The table is hidden on
          mobile and shown from md upward. */}
      <CardFilter placeholder="Search fabric qualities…">
        {rows.length ? rows.map((r) => (
          <div key={r.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/app/settings/fabric-qualities/${r.id}`} className="font-semibold text-ink hover:text-indigo break-words">
                  {r.name}
                </Link>
                <div className="font-mono text-xs text-ink-soft mt-0.5">{r.code}</div>
              </div>
              <span className="shrink-0">
                <FabricActiveToggle id={r.id} initialActive={r.active} />
              </span>
            </div>

            <div className="text-xs text-ink-soft mt-2 capitalize">
              {r.fabric_type ?? '-'}
              {' · '}
              {r.production_mode ? (PRODUCTION_MODE_LABEL[r.production_mode] ?? r.production_mode) : '-'}
            </div>
            {r.is_merged && r.merged_name && (
              <div className="text-xs mt-1 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                  <Link2 className="w-3 h-3" /> {r.merged_name}
                </span>
                <span className="font-semibold text-emerald-700 num">{fmtM(mergedPoolByName.get(r.merged_name.trim()) ?? 0)} m</span>
              </div>
            )}
            <div className="text-xs text-ink-soft mt-1">
              <span className="text-ink-mute">Pick/inch:</span> <span className="num">{r.pick_per_inch ?? '-'}</span>
              {' · '}<span className="text-ink-mute">Reed:</span> <span className="num">{r.reed ?? '-'}</span>
              {' · '}<span className="text-ink-mute">Width:</span> <span className="num">{r.reed_space ?? '-'}</span>
            </div>

            <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
              <Link
                href={`/app/settings/fabric-qualities/${r.id}`}
                className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold"
              >
                <Pencil className="w-3 h-3" /> Edit
              </Link>
              <FabricDeleteButton id={r.id} label={r.name} />
            </div>
          </div>
        )) : (
          <div className="card p-6 text-center text-sm text-ink-soft">
            No fabric qualities yet. <Link href="/app/settings/fabric-qualities/new" className="text-indigo font-semibold">Add the first one &rarr;</Link>
          </div>
        )}
      </CardFilter>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <SortableTh column="code" label="Code" sort={sort} dir={dir} basePath="/app/settings/fabric-qualities" className="text-left px-4 py-3" />
              <SortableTh column="name" label="Quality" sort={sort} dir={dir} basePath="/app/settings/fabric-qualities" className="text-left px-4 py-3" />
              <th className="text-left px-4 py-3 hidden md:table-cell">Fabric Type</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Production Mode</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Merged as</th>
              <th className="text-right px-4 py-3 hidden lg:table-cell">Merged warp m</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Pick/inch</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Reed</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Loom Width (in)</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                <td className="px-4 py-3">
                  <Link href={`/app/settings/fabric-qualities/${r.id}`}
                    className="font-semibold text-ink hover:text-indigo">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft capitalize">
                  {r.fabric_type ?? '-'}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft">
                  {r.production_mode ? (PRODUCTION_MODE_LABEL[r.production_mode] ?? r.production_mode) : '-'}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {r.is_merged && r.merged_name ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                      <Link2 className="w-3 h-3" /> {r.merged_name}
                    </span>
                  ) : (
                    <span className="text-ink-mute">-</span>
                  )}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-right num text-xs">
                  {r.is_merged && r.merged_name
                    ? <span className="font-semibold text-emerald-700">{fmtM(mergedPoolByName.get(r.merged_name.trim()) ?? 0)} m</span>
                    : <span className="text-ink-mute">-</span>}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-right num">{r.pick_per_inch ?? '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-right num">{r.reed ?? '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-right num">{r.reed_space ?? '-'}</td>
                <td className="px-4 py-3 text-center">
                  <FabricActiveToggle id={r.id} initialActive={r.active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-3">
                    <Link
                      href={`/app/settings/fabric-qualities/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 font-semibold"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </Link>
                    <FabricDeleteButton id={r.id} label={r.name} />
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No fabric qualities yet. <Link href="/app/settings/fabric-qualities/new" className="text-indigo font-semibold">Add the first one &rarr;</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
