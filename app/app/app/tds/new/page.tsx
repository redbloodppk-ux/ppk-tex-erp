import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { loadTdsMonths, todayISO } from '@/lib/tds/liability-data';
import { assessmentYearOf, financialYearOf } from '@/lib/tds/liability';
import { fetchPaymentSources, type SupabaseLike } from '@/lib/ledgers/payment-sources';
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

  // Where the challan money came from. One shared rule — see
  // lib/ledgers/payment-sources.ts. This screen used to filter on the
  // ledger group by hand, which is why it silently offered no cash option
  // while the CASH ledger sat in the wrong group.
  const sources = await fetchPaymentSources(supabase as unknown as SupabaseLike);
  const sourceLedgers: LedgerOption[] = sources.map((l) => ({ id: l.id, name: l.label }));

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
