import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import Link from 'next/link';
import { Plus, Phone, MapPin, Star } from 'lucide-react';

export const metadata = { title: 'Mills' };

interface MillRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  is_preferred: boolean;
  status: string;
}

export default async function MillsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mill')
    .select('id, code, name, gstin, phone, email, city, is_preferred, status')
    .order('name');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mills = (data ?? []) as unknown as MillRow[];

  return (
    <div>
      <PageHeader
        title="Mills"
        subtitle="Master list of spinning mills supplying yarn to PPK TEX."
        actions={
          <Link href="/app/mills/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Mill
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load mills: {error.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">GSTIN</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Contact</th>
              <th className="text-center px-4 py-3">Preferred</th>
            </tr>
          </thead>
          <tbody>
            {mills.length ? mills.map((m) => (
              <tr key={m.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{m.code}</td>
                <td className="px-4 py-3">
                  <Link href={`/app/mills/${m.id}`} className="font-semibold text-ink hover:text-indigo">
                    {m.name}
                  </Link>
                  {m.status !== 'active' && (
                    <span className="ml-2 pill bg-slate-100 text-slate-500">{m.status}</span>
                  )}
                  <div className="md:hidden text-xs text-ink-mute font-mono mt-0.5">{m.gstin ?? '-'}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">{m.gstin ?? '-'}</td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                  <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {m.phone ?? '-'}</div>
                  {m.city && <div className="flex items-center gap-1.5 mt-0.5"><MapPin className="w-3 h-3" /> {m.city}</div>}
                </td>
                <td className="px-4 py-3 text-center">
                  {m.is_preferred && <Star className="inline w-4 h-4 fill-amber-400 text-amber-500" />}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No mills yet. <Link href="/app/mills/new" className="text-indigo font-semibold">Add the first one →</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
