import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import Link from 'next/link';
import { Plus, Phone, MapPin, Pencil, CheckCircle2 } from 'lucide-react';
import { DeletePartyButton } from './delete-party-button';

export const metadata = { title: 'Parties' };
export const dynamic = 'force-dynamic';

interface PartyRow {
  id: number;
  code: string;
  name: string;
  party_type_id: number | null;
  party_type_ids: number[] | null;
  gstin: string | null;
  /** ISO timestamp set by GstinLookup on successful verification.
   *  Non-null means the green tick shows next to the GSTIN cell. */
  gstin_verified_at: string | null;
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
      ? sb.from('party').select('id, code, name, party_type_id, party_type_ids, gstin, gstin_verified_at, phone, email, city, credit_limit, payment_terms_days, status').order('name')
      // Use array containment (`@>`) so the filter pill matches parties
      // whose party_type_ids includes the selected type. Supabase exposes
      // this via the .contains() filter.
      : sb.from('party').select('id, code, name, party_type_id, party_type_ids, gstin, gstin_verified_at, phone, email, city, credit_limit, payment_terms_days, status').contains('party_type_ids', [Number(typeFilter)]).order('name')),
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

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
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
                  {p.gstin_verified_at && (
                    // Green tick = the GSTIN on this party was successfully
                    // verified via the GST lookup widget. The tick is cleared
                    // automatically by a DB trigger if the GSTIN changes
                    // (migration 099).
                    <span
                      className="inline-flex align-text-bottom ml-1.5"
                      title="GSTIN verified"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="GSTIN verified" />
                    </span>
                  )}
                  {p.status !== 'active' && (
                    <span className="ml-2 pill bg-slate-100 text-slate-500">{p.status}</span>
                  )}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell text-xs text-ink-soft">
                  {(() => {
                    // Show every type the party belongs to, comma-separated.
                    // Falls back to the legacy single party_type_id when the
                    // array hasn't been populated yet (pre-migration rows).
                    const ids = Array.isArray(p.party_type_ids) && p.party_type_ids.length > 0
                      ? p.party_type_ids
                      : (p.party_type_id ? [p.party_type_id] : []);
                    if (ids.length === 0) return '-';
                    return ids
                      .map((id) => typeNameById.get(id))
                      .filter((s): s is string => Boolean(s))
                      .join(', ') || '-';
                  })()}
                </td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">
                  {p.gstin ? (
                    <span className="inline-flex items-center gap-1">
                      {p.gstin}
                      {p.gstin_verified_at && (
                        <span title={`Verified on ${new Date(p.gstin_verified_at).toLocaleDateString()}`}>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-label="verified" />
                        </span>
                      )}
                    </span>
                  ) : '-'}
                </td>
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
