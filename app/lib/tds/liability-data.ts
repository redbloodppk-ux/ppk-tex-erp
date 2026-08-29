/**
 * Supabase-backed loader for the TDS position.
 *
 * Gathers what the pure `buildTdsMonths` needs and runs it, so the
 * dashboard section, the bell warning and the challan screen all read one
 * calculation. Same reason `loadWinderAllocation` exists: three surfaces
 * showing three slightly different tax figures would be worse than none.
 *
 * WHERE TDS COMES FROM TODAY
 * Only sizing bills, because sizing is the only 194C work being billed.
 * When bobbin or yarn suppliers start attracting TDS, add their table
 * here and nothing downstream changes - the month grouping, the interest
 * and every screen already work off `TdsSource`.
 */
import { buildTdsMonths, type TdsMonth, type TdsRemittance, type TdsSource } from './liability';
import { fetchAll } from '@/lib/supabase/fetch-all';

/** Local YYYY-MM-DD. `toISOString()` would report yesterday before 05:30. */
export function todayISO(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function loadTdsMonths(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  today: string = todayISO(),
): Promise<{ months: TdsMonth[]; error: string | null }> {
  // Bills that had tax withheld. The rate lives on the PARTY (migration
  // 271); a bill whose party has no rate contributes nothing, so a new
  // sizing mill can never silently start generating a tax liability.
  const bills = await fetchAll<{
    bill_no: string | null;
    bill_date: string | null;
    charges_amount: number | string | null;
    bill_party: { name: string | null; tds_pct: number | string | null } | null;
  }>((lo, hi) => supabase
    .from('sizing_job')
    .select('id, bill_no, bill_date, charges_amount, bill_party:party_id ( name, tds_pct )')
    .not('bill_no', 'is', null)
    .not('bill_date', 'is', null)
    .order('id', { ascending: true })
    .range(lo, hi));
  if (bills.error) return { months: [], error: bills.error };

  const sources: TdsSource[] = [];
  for (const b of bills.rows) {
    const pct = Number(b.bill_party?.tds_pct ?? NaN);
    if (!Number.isFinite(pct) || pct <= 0) continue;
    // On the TAXABLE value — charges before GST. See migration 271.
    const amount = Math.round(Number(b.charges_amount ?? 0) * pct) / 100;
    if (!(amount > 0) || !b.bill_date) continue;
    sources.push({
      ref: b.bill_no ?? '',
      deductedOn: b.bill_date,
      amount,
      partyName: b.bill_party?.name ?? '',
    });
  }

  const paid = await fetchAll<{ period_month: string; amount: number | string }>(
    (lo, hi) => supabase
      .from('tds_payment')
      .select('id, period_month, amount')
      .order('id', { ascending: true })
      .range(lo, hi));
  if (paid.error) return { months: [], error: paid.error };

  const remittances: TdsRemittance[] = paid.rows.map((r) => ({
    periodMonth: r.period_month,
    amount: Number(r.amount ?? 0),
  }));

  return { months: buildTdsMonths(sources, remittances, today), error: null };
}

/** Whole days from `today` to `dueDate`; negative once overdue. */
export function daysUntil(dueDate: string, today: string): number {
  const a = new Date(today + 'T00:00:00').getTime();
  const b = new Date(dueDate + 'T00:00:00').getTime();
  return Math.round((b - a) / 86_400_000);
}
