/**
 * Single source of truth for which ACCOUNT a money document belongs to,
 * and which way the money flows.
 *
 * WHY THIS EXISTS
 * A party can trade with us in several capacities at once. BMPT TEXTILES
 * is a customer (we sell them yarn), a jobwork party (they send us their
 * material, we weave it and bill them) AND a supplier (we buy yarn from
 * them). Each capacity is a separate running balance — a "stream" — and
 * they must not net silently.
 *
 * Note that `customer` and `jobwork` are BOTH receivable. Direction alone
 * cannot tell them apart, which is exactly why a stream is a distinct
 * concept and not just a synonym for in/out.
 *
 * Direction used to be a hardcoded string typed into each screen. That is
 * how the dashboard came to show job work bills under "Pay" and to sum
 * them into Outstanding Payable (fixed in 4325b3a) while the Jobwork
 * payment tab had the same decision right. Import from this module
 * instead — never write direction="out" by hand.
 *
 * See docs/superpowers/specs/2026-08-20-party-stream-separation-design.md
 */

/** A distinct running balance a party can hold with us. */
export type PartyStream = 'customer' | 'jobwork' | 'outsource' | 'supplier';

/** 'in' = money comes to us (they owe us). 'out' = we pay (we owe them). */
export type MoneyDirection = 'in' | 'out';

export const ALL_STREAMS: readonly PartyStream[] = [
  'customer',
  'jobwork',
  'outsource',
  'supplier',
] as const;

export const STREAM_META: Record<
  PartyStream,
  { label: string; short: string; direction: MoneyDirection; blurb: string }
> = {
  customer: {
    label: 'Customer',
    short: 'CUST',
    direction: 'in',
    blurb: 'Sales invoices — they owe us.',
  },
  jobwork: {
    label: 'Job Work',
    short: 'JW',
    direction: 'in',
    blurb: 'They sent their own material, we wove it and billed them — they owe us.',
  },
  outsource: {
    label: 'Outsource Weaving',
    short: 'OW',
    direction: 'out',
    blurb: 'They wove our cloth and billed us — we owe them.',
  },
  supplier: {
    label: 'Supplier',
    short: 'SUPP',
    direction: 'out',
    blurb: 'Yarn / bobbin / sizing / fabric / warp-beam purchases — we owe them.',
  },
};

/**
 * invoice.doc_type -> stream.
 *
 * Unknown types fall back to 'customer' because the `invoice` table is
 * the sales ledger by default; a new sales-side doc type therefore
 * behaves sensibly before anyone remembers to classify it. New
 * NON-sales doc types must be added here explicitly — party-streams.test.ts
 * enumerates the enum and will fail if one is missed.
 */
export function streamForDocType(docType: string): PartyStream {
  switch (docType) {
    case 'jobwork_invoice':
      return 'jobwork';
    case 'weaving_bill':
      return 'outsource';
    default:
      // tax_invoice, yarn_sale, general_sale, credit_note, debit_note
      return 'customer';
  }
}

/**
 * UnpaidBillsPicker bill `kind` / `doc_type` label -> stream.
 *
 * Anything that is not a sale, a jobwork bill or a weaving bill is a
 * purchase we owe, so 'supplier' is the safe default: it keeps unknown
 * bills OFF the receipt screen rather than letting them be settled with
 * incoming money.
 */
export function streamForBillKind(kind: string): PartyStream {
  switch (kind) {
    case 'jobwork_invoice':
      return 'jobwork';
    case 'weaving_bill':
      return 'outsource';
    // Sales-side documents. UnpaidBillsPicker stores the real
    // invoice.doc_type here, so every sales doc_type must be listed —
    // falling through to the 'supplier' default would put a fabric sale
    // on the payables side.
    case 'invoice':
    case 'tax_invoice':
    case 'yarn_sale':
    case 'general_sale':
    case 'credit_note':
    case 'debit_note':
    case 'opening_receivable':
      return 'customer';
    default:
      // sizing_bill, bobbin_purchase, yarn_purchase, fabric_purchase,
      // warp_beam_purchase, general_purchase, opening_payable
      return 'supplier';
  }
}

/** Which way money moves on this stream. */
export function directionForStream(s: PartyStream): MoneyDirection {
  return STREAM_META[s].direction;
}

/** The streams that sit on one side of the books. */
export function streamsForDirection(d: MoneyDirection): PartyStream[] {
  return ALL_STREAMS.filter((s) => STREAM_META[s].direction === d);
}

/** Narrowing helper for values arriving from the database as plain text. */
export function isPartyStream(v: unknown): v is PartyStream {
  return typeof v === 'string' && (ALL_STREAMS as readonly string[]).includes(v);
}
