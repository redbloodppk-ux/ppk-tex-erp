import { describe, it, expect } from 'vitest';
import {
  ALLOC_TABLE, DOC_TYPE_LABEL, billKey, allocationPayloads,
  loadPartyBills, type BillKind,
} from './party-bills';
import { ALL_STREAMS } from './party-streams';

const ALL_KINDS: BillKind[] = [
  'invoice', 'opening', 'sizing', 'bobbin', 'yarn', 'fabric', 'agent', 'warp_beam',
];

describe('party-bills: allocation mapping', () => {
  it('maps every bill kind to an allocation table', () => {
    for (const k of ALL_KINDS) {
      expect(ALLOC_TABLE[k]).toBeDefined();
      expect(ALLOC_TABLE[k].table).toMatch(/^payment_/);
      expect(ALLOC_TABLE[k].col.length).toBeGreaterThan(0);
    }
  });

  it('gives every kind a DISTINCT table/column pair', () => {
    const seen = new Set(ALL_KINDS.map((k) => `${ALLOC_TABLE[k].table}.${ALLOC_TABLE[k].col}`));
    expect(seen.size).toBe(ALL_KINDS.length);
  });

  it('builds one payload group per table, skipping zero amounts', () => {
    const groups = allocationPayloads(99, [
      { kind: 'invoice', id: 1, amount: 100 },
      { kind: 'invoice', id: 2, amount: 50 },
      { kind: 'yarn',    id: 7, amount: 25 },
      { kind: 'bobbin',  id: 9, amount: 0 },   // dropped
    ]);
    expect(groups).toHaveLength(2);
    const inv = groups.find((g) => g.table === 'payment_allocation');
    expect(inv?.rows).toEqual([
      { payment_id: 99, invoice_id: 1, amount: 100 },
      { payment_id: 99, invoice_id: 2, amount: 50 },
    ]);
    const yarn = groups.find((g) => g.table === 'payment_yarn_allocation');
    expect(yarn?.rows).toEqual([{ payment_id: 99, yarn_lot_id: 7, amount: 25 }]);
  });

  it('keys bills so ids from different sequences cannot collide', () => {
    expect(billKey({ kind: 'invoice', id: 5 })).not.toBe(billKey({ kind: 'yarn', id: 5 }));
  });

  it('labels every doc_type the loader can emit', () => {
    for (const dt of [
      'tax_invoice', 'yarn_sale', 'general_sale', 'jobwork_invoice', 'weaving_bill',
      'opening_receivable', 'opening_payable', 'sizing_bill', 'bobbin_purchase',
      'yarn_purchase', 'fabric_purchase', 'warp_beam_purchase', 'agent_commission',
    ]) {
      expect(DOC_TYPE_LABEL[dt]).toBeDefined();
    }
  });
});

/** Minimal Supabase stub: every .from() returns a chainable that resolves
 *  to whatever rows the fixture holds for that table. */
function stubSb(fixture: Record<string, unknown[]>) {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const m of ['select', 'eq', 'in', 'not', 'gt', 'ilike', 'order', 'is']) {
      c[m] = self;
    }
    // Awaiting the chain resolves to a Supabase-shaped result.
    (c as { then: unknown }).then = (res: (v: unknown) => unknown) =>
      res({ data: fixture[table] ?? [], error: null });
    return c;
  };
  return { from: (t: string) => chain(t) };
}

describe('party-bills: loadPartyBills', () => {
  it('pulls all eight sources and tags each with its stream', async () => {
    const sb = stubSb({
      invoice: [
        { id: 1, invoice_no: 'YS/1', invoice_date: '2026-07-01', doc_type: 'yarn_sale', total: 100, amount_paid: 0, balance: 100 },
        { id: 2, invoice_no: 'JWB/1', invoice_date: '2026-07-02', doc_type: 'jobwork_invoice', total: 200, amount_paid: 0, balance: 200 },
      ],
      party_opening_ledger: [
        { id: 3, invoice_no: 'OP/1', invoice_date: '2026-04-01', direction: 'payable', amount: 300, amount_paid: 0, balance: 300 },
      ],
      yarn_lot: [
        { id: 4, invoice_no: 'Y/1', received_date: '2026-05-01', total_amount: 400, amount_paid: 100 },
      ],
      agent_commission: [
        { id: 5, amount: 50, amount_paid: 0, balance: 50, invoice: { invoice_no: 'AC/1', invoice_date: '2026-06-01' }, yarn_lot: null, fabric_purchase: null },
      ],
    });

    const { bills, error } = await loadPartyBills(sb, 21, 'BMPT TEXTILES');
    expect(error).toBeNull();
    expect(bills).toHaveLength(5);

    const streamOf = (docNo: string): string | undefined =>
      bills.find((b) => b.doc_no === docNo)?.stream;
    expect(streamOf('YS/1')).toBe('customer');
    expect(streamOf('JWB/1')).toBe('jobwork');   // NOT customer
    expect(streamOf('OP/1')).toBe('supplier');   // payable opening
    expect(streamOf('Y/1')).toBe('supplier');
    expect(streamOf('AC/1')).toBe('supplier');

    for (const b of bills) expect(ALL_STREAMS).toContain(b.stream);
  });

  it('computes purchase balances as total - paid and drops settled rows', async () => {
    const sb = stubSb({
      yarn_lot: [
        { id: 1, invoice_no: 'Y/1', received_date: '2026-05-01', total_amount: 400, amount_paid: 100 },
        { id: 2, invoice_no: 'Y/2', received_date: '2026-05-02', total_amount: 500, amount_paid: 500 }, // settled
      ],
    });
    const { bills } = await loadPartyBills(sb, 1, 'X');
    expect(bills).toHaveLength(1);
    expect(bills[0]?.balance).toBe(300);
  });

  it('returns bills oldest first', async () => {
    const sb = stubSb({
      invoice: [
        { id: 1, invoice_no: 'B', invoice_date: '2026-07-05', doc_type: 'tax_invoice', total: 1, amount_paid: 0, balance: 1 },
        { id: 2, invoice_no: 'A', invoice_date: '2026-01-05', doc_type: 'tax_invoice', total: 1, amount_paid: 0, balance: 1 },
      ],
    });
    const { bills } = await loadPartyBills(sb, 1, 'X');
    expect(bills.map((b) => b.doc_no)).toEqual(['A', 'B']);
  });

  it('surfaces an invoice-query error rather than returning a partial list', async () => {
    const sb = {
      from: () => {
        const c: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'not', 'gt', 'ilike', 'order', 'is']) c[m] = () => c;
        (c as { then: unknown }).then = (res: (v: unknown) => unknown) =>
          res({ data: null, error: { message: 'boom' } });
        return c;
      },
    };
    const { bills, error } = await loadPartyBills(sb, 1, 'X');
    expect(error).toBe('boom');
    expect(bills).toEqual([]);
  });
});
