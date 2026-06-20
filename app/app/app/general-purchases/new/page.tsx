/**
 * /app/general-purchases/new — record a new General Purchase GST bill.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { GeneralPurchaseForm, type PartyOpt } from '../general-purchase-form';

export const metadata = { title: 'New General Purchase' };
export const dynamic = 'force-dynamic';

export default async function NewGeneralPurchasePage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data } = await sb
    .from('party')
    .select('id, code, name')
    .eq('status', 'active')
    .order('name');
  const parties = (data ?? []) as PartyOpt[];

  return (
    <div>
      <PageHeader
        title="New General Purchase"
        subtitle="Single taxable amount + GST. Appears in the Purchase Register."
      />
      <GeneralPurchaseForm parties={parties} />
    </div>
  );
}
