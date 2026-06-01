import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil } from 'lucide-react';
import { FabricActiveToggle } from '@/app/components/fabric-active-toggle';
import { FabricDeleteButton } from '@/app/components/fabric-delete-button';

export const metadata = { title: 'Fabric Qualities' };
export const dynamic = 'force-dynamic';

interface FQRow {
  id: number;
  code: string;
  name: string;
  hsn: string | null;
  width_in: number | null;
  pick_per_inch: number | null;
  reed: number | null;
  active: boolean;
}

export default async function FabricQualitiesPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('fabric_quality')
    .select('id, code, name, hsn, width_in, pick_per_inch, reed, active')
    .order('name');

  const rows = (data ?? []) as unknown as FQRow[];

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

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Quality</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">HSN</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Pick/inch</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Reed</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Width (in)</th>
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
                <td className="px-4 py-3 hidden md:table-cell text-ink-soft">{r.hsn ?? '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-right num">{r.pick_per_inch ?? '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-right num">{r.reed ?? '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-right num">{r.width_in ?? '-'}</td>
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
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-soft">
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
