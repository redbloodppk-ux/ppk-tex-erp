/**
 * The one answer to "which account can I pay from / receive into?"
 *
 * WHY THIS FILE EXISTS
 * Six screens asked that question and five of them answered it differently:
 * TDS filtered on the ledger GROUP, Expenses on the TYPE plus a hardcoded
 * code for owner funds, Wages and Loans on the TYPE alone, Payments on the
 * TYPE with a different spelling of the same list.
 *
 * They had already drifted apart in ways PPK could feel. Owner funds
 * reached only the Expenses screen, so a business cost he paid on his own
 * card could be booked as an expense but not as a wage, a loan, or a TDS
 * challan - and he pays TDS on the portal by card. Worse, when the CASH
 * ledger turned out to be in the wrong group (migration 286) the two
 * group-based screens silently lost their cash option while the four
 * type-based ones carried on working, so the bug was invisible unless you
 * happened to open the TDS challan screen.
 *
 * Neither field can answer it alone, which is why migration 289 made it a
 * fact of its own - ledger.is_payment_source - rather than a cleverer list
 * of names. Type cannot distinguish OWNER FUNDS (a real source) from
 * CREDIT CARD PAYMENT (the exact opposite); they share both type CAPITAL
 * and group CAPITAL ACCOUNT.
 *
 * Everything below reads that one column. Adding a screen means calling
 * fetchPaymentSources, not writing a sixth version of the rule.
 */
import { fetchAll } from '@/lib/supabase/fetch-all';

/** A cash / bank / owner account money can move through. */
export interface PaymentSource {
  id: number;
  name: string;
  /** Ledger group name — decides ordering and the label suffix. */
  groupName: string;
  /** Ready to render: "CASH", "YES BANK OD (Bank)", "... (your own money)". */
  label: string;
}

/**
 * Everyday choices first. Cash, then the bank accounts, then the overdraft,
 * and the owner's own pocket last — it is the unusual one, and putting it
 * on top would invite mis-picks on the common path.
 */
function rank(groupName: string): number {
  switch (groupName.toUpperCase()) {
    case 'CASH-IN-HAND':  return 0;
    case 'BANK ACCOUNTS': return 1;
    case 'BANK OD A/C':   return 2;
    default:              return 3; // CAPITAL ACCOUNT — owner funds
  }
}

/**
 * Say what kind of money it is, without repeating the obvious. "CASH" needs
 * no suffix; owner funds needs the plainest words available, because the
 * whole point is that PPK can tell at a glance he is about to record
 * something he paid for himself.
 */
export function paymentSourceLabel(name: string, groupName: string): string {
  const g = groupName.toUpperCase();
  if (g === 'CASH-IN-HAND') return name;
  if (g === 'BANK ACCOUNTS' || g === 'BANK OD A/C') return `${name} (Bank)`;
  return `${name} (your own money)`;
}

/** Notes, bank, or PPK's own wallet — for screens that show an icon. */
export function paymentSourceIcon(groupName: string): string {
  const g = groupName.toUpperCase();
  if (g === 'CASH-IN-HAND') return '💵';
  if (g === 'BANK ACCOUNTS' || g === 'BANK OD A/C') return '🏦';
  return '👤';
}

export function comparePaymentSources(a: PaymentSource, b: PaymentSource): number {
  return rank(a.groupName) - rank(b.groupName) || a.name.localeCompare(b.name);
}

/** Row shape as PostgREST returns it. */
interface Row {
  id: number;
  name: string;
  ledger_group: { name: string } | null;
}

/**
 * Just enough of a Supabase client to run the query. Both the server and
 * browser clients satisfy it; typing it this loosely is what lets one
 * function serve a server component and a 'use client' form alike.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseLike = { from: (table: string) => any };

/**
 * Every account money can move through, ordered for a dropdown.
 *
 * Works with both the server and browser Supabase clients — the query is
 * plain PostgREST. Paged via fetchAll: the list is short today, but a read
 * that is correct only while a table stays small is the exact trap
 * lib/supabase/fetch-all.ts exists to close.
 */
export async function fetchPaymentSources(sb: SupabaseLike): Promise<PaymentSource[]> {
  const { rows } = await fetchAll<Row>((lo, hi) =>
    sb.from('ledger')
      .select('id, name, ledger_group:group_id ( name )')
      .eq('active', true)
      .eq('is_payment_source', true)
      .order('id', { ascending: true })
      .range(lo, hi));

  return (rows as unknown as Row[])
    .map((r) => {
      const groupName = r.ledger_group?.name ?? '';
      return { id: r.id, name: r.name, groupName, label: paymentSourceLabel(r.name, groupName) };
    })
    .sort(comparePaymentSources);
}

/**
 * The one that should be selected when a form opens with nothing chosen.
 * Cash, because that is how most of the mill's money actually moves.
 */
export function defaultPaymentSource(list: PaymentSource[]): PaymentSource | undefined {
  return list.find((l) => l.groupName.toUpperCase() === 'CASH-IN-HAND') ?? list[0];
}
