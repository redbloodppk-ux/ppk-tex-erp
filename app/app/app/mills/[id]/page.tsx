/**
 * Edit mill.
 *
 * Loads the row by id and hydrates the shared MillForm with delete and
 * archive controls. Returns 404 if the id is missing or the row was
 * deleted.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { MillForm, type MillFormValues } from '../mill-form';

export const metadata = { title: 'Edit Mill' };
export const dynamic = 'force-dynamic';

interface MillRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  is_preferred: boolean;
  notes: string | null;
  status: 'active' | 'inactive' | 'archived';
}

export default async function EditMillPage({
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
    .from('mill')
    .select('id, code, name, gstin, contact_person, phone, email, address, city, state, is_preferred, notes, status')
    .eq('id', numericId)
    .maybeSingle();

  const m = data as unknown as MillRow | null;
  if (!m) notFound();

  const initial: MillFormValues = {
    name: m.name,
    gstin: m.gstin ?? '',
    contact_person: m.contact_person ?? '',
    phone: m.phone ?? '',
    email: m.email ?? '',
    address: m.address ?? '',
    city: m.city ?? '',
    state: m.state ?? 'Tamil Nadu',
    is_preferred: m.is_preferred,
    notes: m.notes ?? '',
    status: m.status,
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={m.name}
        subtitle={`${m.code} — edit mill details`}
        crumbs={[
          { label: 'Mills', href: '/app/mills' },
          { label: m.name },
        ]}
      />
      <MillForm millId={m.id} initial={initial} code={m.code} />
    </div>
  );
}
