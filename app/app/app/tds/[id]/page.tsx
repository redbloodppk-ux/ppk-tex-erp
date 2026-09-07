/**
 * View / edit one recorded TDS challan.
 *
 * PPK, 2026-09-07: "we need view and edit option for challan". Challans
 * could be entered but never reopened, so the duplicate August row saved on
 * 7 Sep needed a database migration to remove. This is the screen that
 * should have handled it.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { labelFor } from '@/lib/tds/liability';
import { loadTdsMonths, todayISO } from '@/lib/tds/liability-data';
import { ChallanEditForm, type ChallanRow, type LedgerOption } from './challan-edit-form';

export const metadata = { title: 'TDS Challan' };
export const dynamic = 'force-dynamic';

export default async function TdsChallanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('tds_payment')
    .select('id, period_month, amount, interest_amount, paid_date, challan_no, notes, source_ledger_id')
    .eq('id', numericId)
    .maybeSingle();

  const challan = data as ChallanRow | null;
  if (!challan) notFound();

  // What was actually withheld that month, so the form can say whether the
  // challan covers it. Read through loadTdsMonths rather than recomputed —
  // one answer to "how much was withheld", shared with the TDS page.
  const { months } = await loadTdsMonths(supabase, todayISO());
  const withheldThatMonth =
    months.find((m) => m.month === challan.period_month)?.tds ?? 0;

  const ledgers = await fetchAll<{
    id: number; name: string; ledger_group: { name: string } | null;
  }>((lo, hi) =>
    (supabase as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (t: string) => any;
    }).from('ledger')
      .select('id, name, group_id, ledger_group:group_id ( name )')
      .order('id', { ascending: true })
      .range(lo, hi));

  const sourceLedgers: LedgerOption[] = ledgers.rows
    .filter((l) => {
      const g = (l.ledger_group?.name ?? '').toUpperCase();
      return g === 'CASH-IN-HAND' || g === 'BANK ACCOUNTS' || g === 'BANK OD A/C';
    })
    .map((l) => ({ id: l.id, name: l.name }));

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="TDS Challan"
        subtitle="Correct what was recorded, or remove a row entered twice."
        crumbs={[{ label: 'TDS Payable', href: '/app/tds' }, { label: 'Challan' }]}
      />
      <ChallanEditForm
        challan={challan}
        ledgers={sourceLedgers}
        withheldThatMonth={withheldThatMonth}
        monthLabel={labelFor(challan.period_month)}
      />
    </div>
  );
}
