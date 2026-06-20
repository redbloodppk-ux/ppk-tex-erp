/**
 * /app/general-purchases/[id] — edit an existing General Purchase bill.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { GeneralPurchaseForm, type PartyOpt, type GeneralPurchaseInitial } from '../general-purchase-form';

export const metadata = { title: 'Edit General Purchase' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditGeneralPurchasePage({ params }: PageProps) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ data: bill }, { data: partyData }] = await Promise.all([
    sb.from('general_purchase')
      .select('id, bill_no, bill_date, supplier_party_id, description, taxable, gst_pct, status')
      .eq('id', Number(id))
      .maybeSingle(),
    sb.from('party')
      .select('id, code, name')
      .eq('status', 'active')
      .order('name'),
  ]);

  if (!bill) notFound();

  const initial = bill as GeneralPurchaseInitial;
  const parties = (partyData ?? []) as PartyOpt[];

  return (
    <div>
      <PageHeader
        title={`Edit General Purchase · ${initial.bill_no ?? ''}`}
        subtitle="Single taxable amount + GST. Appears in the Purchase Register."
      />
      <GeneralPurchaseForm initial={initial} parties={parties} />
    </div>
  );
}
