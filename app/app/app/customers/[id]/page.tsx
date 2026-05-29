/**
 * Edit customer.
 *
 * Loads the row by id and hydrates the shared CustomerForm with delete
 * and archive controls. Returns 404 if the id is missing or the row
 * was deleted.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CustomerForm, type CustomerFormValues } from '../customer-form';

export const metadata = { title: 'Edit Customer' };
export const dynamic = 'force-dynamic';

interface CustomerRow {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  credit_limit: number | string | null;
  payment_terms_days: number | null;
  status: 'active' | 'inactive' | 'archived';
}

export default async function EditCustomerPage({
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
    .from('customer')
    .select('id, code, name, gstin, contact_person, phone, email, billing_address, city, state, pincode, credit_limit, payment_terms_days, status')
    .eq('id', numericId)
    .maybeSingle();

  const c = data as unknown as CustomerRow | null;
  if (!c) notFound();

  const initial: CustomerFormValues = {
    name: c.name,
    gstin: c.gstin ?? '',
    contact_person: c.contact_person ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    billing_address: c.billing_address ?? '',
    city: c.city ?? '',
    state: c.state ?? 'Tamil Nadu',
    pincode: c.pincode ?? '',
    credit_limit: Number(c.credit_limit ?? 0) || 0,
    payment_terms_days: c.payment_terms_days ?? 30,
    status: c.status,
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={c.name}
        subtitle={`${c.code} — edit customer details`}
        crumbs={[
          { label: 'Customers', href: '/app/customers' },
          { label: c.name },
        ]}
      />
      <CustomerForm customerId={c.id} initial={initial} code={c.code} />
    </div>
  );
}
