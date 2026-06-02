import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import Link from 'next/link';
import { Plus, Phone, MapPin, Pencil } from 'lucide-react';
import { DeletePartyButton } from './delete-party-button';

export const metadata = { title: 'Parties' };
export const dynamic = 'force-dynamic';

interface PartyRow {
  id: number;
  code: string;
  name: string;
  party_type_id: number | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  credit_limit: number | string | null;
  payment_terms_days: number | null;
  status: 'active' | 'inactive' | 'archived';
}

interface TypeRow { id: number; name: string; }

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const typeFilter = sp.type ?? '';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [typesRes, partiesRes] = await Promise.all([
    sb.from('party_type_master').select('id, name').eq('active', true).order('name'),
    (typeFilter === ''
      ? sb.from('party').select('id, code, name, party_type_id, gstin, phone, email, city, credit_limit, payment_terms_days, status').order('name')
      : sb.from('party').select('id, code, name, party_type_id, gstin, phone, email, city, credit_limit, payment_terms_days, status').eq('party_type_id', Number(typeFilter)).order('name')),
  ]);

  const types = (typesRes.data ?? []) as TypeRow[];
  const parties = (partiesRes.data ?? []) as PartyRow[];
  const typeNameById = new Map(types.map((t) => [t.id, t.name]));

  return (
    <div>
      <PageHeader
        title="Parties"
        subtitle="Unified master for every business you transact with - customers, mills, jobwork, sizing, outsource weavers, bobbin suppliers."
        actions={
          <Link href="/app/parties/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Party
          </Link>
        }
      />

      <div className="card p-3 mb-4 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-ink-mute font-semibold uppercase">Filter by type:</span>
        <Link href="/app/parties"
          className={'pill ' + (typeFilter === '' ? 'bg-indigo-600 text-white' : 'bg-cloud text-ink-soft hover:bg-indigo-50')}>
          All ({parties.length})
        </Link>
        {types.map((t) => (
          <Link key={t.id} href={`/app/parties?type=${t.id}`}
            className={'pill ' + (typeFilter === String(t.id) ? 'bg-indigo-600 text-white' : 'bg-cloud text-ink-soft hover:bg-indigo-50')}>
            {t.name}
          </Link>
        ))}
      </div>

      {partiesRes.error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load parties: {partiesRes.error.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">Type</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">GSTIN</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Contact</th>
              <th className="text-right px-4 py-3">Credit</th>
              <th className="text-right px-4 py-3">Terms</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {parties.length ? parties.map((p) => (
              <tr key={p.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                <td className="px-4 py-3">
                  <Link href={`/app/parties/${p.id}`} className="font-semibold text-ink hover:text-indigo">
                    {p.name}
                  </Link>
                  {p.status !== 'active' && (
                    <span className="ml-2 pill bg-slate-100 text-slate-500">{p.status}</span>
                  )}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell text-xs text-ink-soft">
                  {p.party_type_id ? (typeNameById.get(p.party_type_id) ?? '-') : '-'}
                </td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">{p.gstin ?? '-'}</td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                  <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {p.phone ?? '-'}</div>
                  {p.city && <div className="flex items-center gap-1.5 mt-0.5"><MapPin className="w-3 h-3" /> {p.city}</div>}
                </td>
                <td className="px-4 py-3 text-right num">{formatRupee(p.credit_limit, { compact: true })}</td>
                <td className="px-4 py-3 text-right num text-ink-soft">{p.payment_terms_days ?? 0}d</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <Link
                      href={`/app/parties/${p.id}`}
                      className="p-1 rounded hover:bg-indigo-50 text-indigo-700"
                      title={`Edit ${p.name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <DeletePartyButton partyId={p.id} partyName={p.name} />
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No parties yet. <Link href="/app/parties/new" className="text-indigo font-semibold">Add the first one &rarr;</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
