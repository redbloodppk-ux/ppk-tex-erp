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

  const [{ data: bill }, { data: partyData }, { data: itemData }] = await Promise.all([
    sb.from('general_purchase')
      .select('id, bill_no, bill_date, supplier_party_id, description, taxable, gst_pct, round_off, status')
      .eq('id', Number(id))
      .maybeSingle(),
    sb.from('party')
      .select('id, code, name')
      .eq('status', 'active')
      .order('name'),
    sb.from('general_purchase_item')
      .select('id, item_name, qty, unit, rate, gst_pct')
      .eq('general_purchase_id', Number(id))
      .order('position'),
  ]);

  if (!bill) notFound();

  const initial = { ...bill, items: itemData ?? [] } as GeneralPurchaseInitial;
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
