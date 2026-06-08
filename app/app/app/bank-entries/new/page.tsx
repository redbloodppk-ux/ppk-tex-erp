import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { BankEntryForm, type BankCategoryOpt, type LedgerOpt } from '../bank-entry-form';

export const metadata = { title: 'New Bank Entry' };
export const dynamic = 'force-dynamic';

export default async function NewBankEntryPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ data: cats }, { data: bankLedgers }, { data: allLedgers }] = await Promise.all([
    sb.from('bank_category')
      .select('id, code, name, direction, pl_treatment, display_order')
      .eq('active', true)
      .order('display_order'),
    // Bank / Cash ledgers — match common type-name patterns. If the
    // ledger_type table doesn't follow these names we can refine later.
    sb.from('ledger')
      .select('id, code, name, type:type_id ( name )')
      .eq('active', true)
      .order('name'),
    sb.from('ledger')
      .select('id, code, name, type:type_id ( name )')
      .eq('active', true)
      .order('name'),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flatten = (rows: any[]): LedgerOpt[] => (rows ?? []).map((r) => ({
    id: r.id, code: r.code, name: r.name, type_name: r.type?.name ?? null,
  }));
  const allFlat = flatten(allLedgers);
  // Filter the bank-ledger picker to ledger types whose name looks like
  // "BANK" or "CASH". Falls back to ALL ledgers if no match (so the
  // operator isn't blocked on a freshly seeded DB).
  const bankFlat = allFlat.filter((l) => {
    const t = (l.type_name ?? '').toUpperCase();
    return t.includes('BANK') || t.includes('CASH');
  });
  const bankList: LedgerOpt[] = bankFlat.length > 0 ? bankFlat : allFlat;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Bank Entry"
        subtitle="Record a non-party bank transaction (EB bill, loan, interest, cash withdrawal, etc.)."
        crumbs={[{ label: 'Bank Entries', href: '/app/bank-entries' }, { label: 'New' }]}
      />
      <BankEntryForm
        categories={(cats ?? []) as BankCategoryOpt[]}
        bankLedgers={bankList}
        allLedgers={allFlat}
      />
    </div>
  );
}
