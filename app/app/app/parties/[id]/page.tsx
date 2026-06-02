import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { PartyForm, type PartyFormValues } from '../party-form';

export const metadata = { title: 'Edit Party' };
export const dynamic = 'force-dynamic';

interface PartyRow {
  id: number;
  code: string;
  party_type_id: number | null;
  name: string;
  gstin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  credit_limit: number | string | null;
  payment_terms_days: number | null;
  is_vip: boolean;
  status: 'active' | 'inactive' | 'archived';
  notes: string | null;
}

export default async function EditPartyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('party')
    .select('id, code, party_type_id, name, gstin, contact_person, phone, email, billing_address, city, state, state_code, pincode, credit_limit, payment_terms_days, is_vip, status, notes')
    .eq('id', numericId)
    .maybeSingle();

  const c = data as unknown as PartyRow | null;
  if (!c) notFound();

  const initial: PartyFormValues = {
    party_type_id: c.party_type_id != null ? String(c.party_type_id) : '',
    name: c.name,
    gstin: c.gstin ?? '',
    contact_person: c.contact_person ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    billing_address: c.billing_address ?? '',
    city: c.city ?? '',
    state: c.state ?? 'Tamil Nadu',
    state_code: c.state_code ?? '',
    pincode: c.pincode ?? '',
    credit_limit: Number(c.credit_limit ?? 0) || 0,
    payment_terms_days: c.payment_terms_days ?? 30,
    is_vip: c.is_vip,
    status: c.status,
    notes: c.notes ?? '',
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={c.name}
        subtitle={`${c.code} - edit party details`}
        crumbs={[
          { label: 'Parties', href: '/app/parties' },
          { label: c.name },
        ]}
      />
      <PartyForm partyId={c.id} initial={initial} code={c.code} />
    </div>
  );
}
