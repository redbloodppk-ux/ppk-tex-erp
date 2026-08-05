/**
 * party-advance.ts
 * ----------------------------------------------------------------------------
 * Shared helper to find a party's unallocated advance payments — money
 * they've already paid in (direction='in' on the `payment` table) that
 * hasn't been matched against any bill yet.
 *
 * Used by the "advance available" alert shown on bill-creation screens
 * (Jobwork Bill, Sales Invoice, Sizing Bill, Bobbin/Yarn/Fabric/Warp Beam
 * Purchase) so the operator doesn't have to remember an old advance
 * exists — the app surfaces it and lets them apply it right there,
 * instead of the previous workaround of deleting and re-recording the
 * old payment.
 *
 * NOTE: General Purchases are intentionally NOT covered here — there is
 * no payment_general_purchase_allocation table yet, so that bill type is
 * out of scope for now.
 *
 * Per the Correction Guide (see lib/money.ts), all money math here uses
 * decimal.js via lib/money.ts helpers instead of raw JS number math, to
 * avoid floating-point rounding drift across many small allocations.
 */
import { money, sum, sub, round2 } from '@/lib/money';

export interface PartyAdvancePayment {
  id: number;
  paymentNo: string;
  paymentDate: string;
  /** Full original amount of this payment. */
  amount: number;
  /** How much of this payment is still unmatched to any bill. */
  unallocated: number;
}

export interface PartyAdvanceResult {
  /** Sum of `unallocated` across every advance payment for this party. */
  totalUnallocated: number;
  payments: PartyAdvancePayment[];
}

/** The seven bill-type-specific allocation tables in scope for this feature. */
const ALLOCATION_TABLES = [
  'payment_allocation',
  'payment_opening_allocation',
  'payment_sizing_allocation',
  'payment_bobbin_allocation',
  'payment_yarn_allocation',
  'payment_fabric_allocation',
  'payment_warp_beam_allocation',
] as const;

export type AdvanceAllocationTable = (typeof ALLOCATION_TABLES)[number];

/**
 * Look up how much of a party's incoming payments is still unapplied to
 * any bill (their "advance"). Returns an empty result if the party has
 * no leftover advance — callers should render nothing in that case.
 */
export async function getPartyAdvance(
  // Supabase client is passed loosely-typed, matching the `as any` usage
  // convention already used throughout this codebase for table access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  partyId: number,
  // 'in'  = money the party paid US in advance (customer prepayment) —
  //         relevant on receivable-side bills: Jobwork Bill, Sales Invoice.
  // 'out' = money WE paid the party in advance (supplier prepayment) —
  //         relevant on payable-side bills: Sizing, Bobbin/Yarn/Fabric/
  //         Warp Beam Purchase. Defaults to 'in' for back-compat with
  //         existing callers.
  direction: 'in' | 'out' = 'in',
): Promise<PartyAdvanceResult> {
  const { data: paymentsData, error: payErr } = await supabase
    .from('payment')
    .select('id, payment_no, payment_date, amount, party_id')
    .eq('party_id', partyId)
    .eq('direction', direction);

  if (payErr || !paymentsData || paymentsData.length === 0) {
    return { totalUnallocated: 0, payments: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentIds = paymentsData.map((p: any) => p.id);

  // Pull matching allocation rows from all 7 tables in parallel, then
  // sum how much of each payment has already been applied to a bill.
  const allocResults = await Promise.all(
    ALLOCATION_TABLES.map((table) =>
      supabase.from(table).select('payment_id, amount').in('payment_id', paymentIds),
    ),
  );

  const allocatedByPayment = new Map<number, ReturnType<typeof money>>();
  for (const res of allocResults) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (res.data ?? []) as any[]) {
      const prev = allocatedByPayment.get(row.payment_id) ?? money(0);
      allocatedByPayment.set(row.payment_id, sum(prev, row.amount));
    }
  }

  const payments: PartyAdvancePayment[] = [];
  let total = money(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of paymentsData as any[]) {
    const allocated = allocatedByPayment.get(p.id) ?? money(0);
    const unallocatedDecimal = round2(sub(p.amount, allocated));
    const unallocated = unallocatedDecimal.toNumber();
    if (unallocated < 0.005) continue; // fully allocated (or over-adjusted) — nothing to offer
    payments.push({
      id: p.id,
      paymentNo: p.payment_no,
      paymentDate: p.payment_date,
      amount: Number(p.amount ?? 0),
      unallocated,
    });
    total = sum(total, unallocatedDecimal);
  }

  // Oldest advance first — apply the longest-outstanding money first,
  // same convention as the rest of the ledger/allocation code.
  payments.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.id - b.id);

  return { totalUnallocated: round2(total).toNumber(), payments };
}

/** One row the caller wants to insert into a payment_*_allocation table. */
export interface AdvanceAllocationInput {
  paymentId: number;
  amount: number;
}

/**
 * Insert allocation rows for a newly-created bill, splitting an
 * existing advance across it. `table` is one of the 7 payment_*_allocation
 * tables above; `billIdColumn` is that table's FK column name (e.g.
 * 'sizing_job_id'); `billId` is the id of the bill row just created. A
 * DB trigger on each table automatically bumps the bill's amount_paid —
 * this function only inserts the allocation rows, mirroring the exact
 * insert pattern already used in app/payments/page.tsx.
 */
export async function applyAdvanceAllocations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  table: AdvanceAllocationTable,
  billIdColumn: string,
  billId: number,
  allocations: AdvanceAllocationInput[],
): Promise<{ error: string | null }> {
  const rows = allocations
    .filter((a) => a.amount > 0.005)
    .map((a) => ({
      payment_id: a.paymentId,
      [billIdColumn]: billId,
      amount: round2(a.amount).toNumber(),
    }));
  if (rows.length === 0) return { error: null };

  const { error } = await supabase.from(table).insert(rows);
  return { error: error?.message ?? null };
}
