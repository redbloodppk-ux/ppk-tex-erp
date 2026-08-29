import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { loadTdsMonths, todayISO } from '@/lib/tds/liability-data';
import { assessmentYearOf, financialYearOf } from '@/lib/tds/liability';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { TdsChallanForm, type MonthOption, type LedgerOption } from './tds-challan-form';

export const metadata = { title: 'Record TDS Challan' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

export default async function NewTdsChallanPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const { month } = await searchParams;
  const supabase = await createClient();
  const today = todayISO();

  const { months } = await loadTdsMonths(supabase, today);
  const options: MonthOption[] = months
    .filter((m) => m.outstanding > 0.005)
    .map((m) => ({
      month: m.month,
      label: m.label,
      outstanding: m.outstanding,
      interest: m.interest,
      dueDate: m.dueDate,
      interestMonths: m.interestMonths,
      // The portal asks for these; getting the year wrong parks the money
      // against the wrong one and is tedious to unpick.
      financialYear: financialYearOf(m.month),
      assessmentYear: assessmentYearOf(m.month),
    }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cp } = await (supabase as any)
    .from('company_profile').select('tan').limit(1).maybeSingle();
  const tan = (cp as { tan?: string | null } | null)?.tan ?? null;

  // Cash / bank accounts the payment can come out of, same as the wage form.
  const ledgers = await fetchAll<{ id: number; name: string }>((lo, hi) =>
    (supabase as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (t: string) => any;
    }).from('ledger')
      .select('id, name, group_id, ledger_group:group_id ( name )')
      .order('id', { ascending: true })
      .range(lo, hi));

  const sourceLedgers: LedgerOption[] = (ledgers.rows as unknown as Array<{
    id: number; name: string; ledger_group: { name: string } | null;
  }>)
    .filter((l) => {
      const g = (l.ledger_group?.name ?? '').toUpperCase();
      return g === 'CASH-IN-HAND' || g === 'BANK ACCOUNTS' || g === 'BANK OD A/C';
    })
    .map((l) => ({ id: l.id, name: l.name }));

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Record TDS Challan"
        subtitle="Enter what was paid on the government portal. Recording it stops that month accruing interest."
        crumbs={[{ label: 'TDS Payable', href: '/app/tds' }, { label: 'Record challan' }]}
      />
      <TdsChallanForm
        months={options}
        ledgers={sourceLedgers}
        tan={tan}
        preselectMonth={typeof month === 'string' ? month : null}
        today={today}
      />
    </div>
  );
}
