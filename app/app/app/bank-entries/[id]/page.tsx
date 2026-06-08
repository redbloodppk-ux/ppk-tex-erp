import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { BankEntryForm, type BankCategoryOpt, type LedgerOpt } from '../bank-entry-form';

export const dynamic = 'force-dynamic';

export default async function EditBankEntryPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ data: row }, { data: cats }, { data: allLedgers }] = await Promise.all([
    sb.from('bank_entry')
      .select('id, entry_no, entry_date, direction, amount, bank_ledger_id, other_ledger_id, category_id, mode, reference, notes, status')
      .eq('id', numericId)
      .maybeSingle(),
    sb.from('bank_category')
      .select('id, code, name, direction, pl_treatment, display_order')
      .eq('active', true)
      .order('display_order'),
    sb.from('ledger')
      .select('id, code, name, type:type_id ( name )')
      .eq('active', true)
      .order('name'),
  ]);
  if (!row) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flatten = (rows: any[]): LedgerOpt[] => (rows ?? []).map((r) => ({
    id: r.id, code: r.code, name: r.name, type_name: r.type?.name ?? null,
  }));
  const allFlat = flatten(allLedgers);
  const bankFlat = allFlat.filter((l) => {
    const t = (l.type_name ?? '').toUpperCase();
    return t.includes('BANK') || t.includes('CASH');
  });
  const bankList: LedgerOpt[] = bankFlat.length > 0 ? bankFlat : allFlat;

  // Hide party-type ledgers from the "Other ledger" picker — those
  // belong to /app/payments, not Bank Entries. If an existing entry's
  // other_ledger_id IS a party (legacy data created before the filter),
  // we re-include just that one row so the edit form can show it.
  const PARTY_TYPES = new Set([
    'CUSTOMER', 'SUPPLIER', 'AGENT',
    'JOB WORK(VENDOR)', 'SIZING(VENDOR)', 'WEAVING(VENDOR)',
  ]);
  const otherLedgersList: LedgerOpt[] = allFlat.filter((l) => {
    if (row.other_ledger_id != null && l.id === row.other_ledger_id) return true;
    const t = (l.type_name ?? '').toUpperCase();
    return !PARTY_TYPES.has(t);
  });

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={`Edit Bank Entry ${row.entry_no}`}
        subtitle="Adjust details, or cancel the entry (soft-delete)."
        crumbs={[
          { label: 'Bank Entries', href: '/app/bank-entries' },
          { label: row.entry_no },
        ]}
      />
      <BankEntryForm
        initial={row}
        categories={(cats ?? []) as BankCategoryOpt[]}
        bankLedgers={bankList}
        allLedgers={otherLedgersList}
      />
    </div>
  );
}
