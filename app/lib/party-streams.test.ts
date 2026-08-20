import { describe, it, expect } from 'vitest';
import {
  streamForDocType,
  streamForBillKind,
  directionForStream,
  streamsForDirection,
  STREAM_META,
  ALL_STREAMS,
  type PartyStream,
} from './party-streams';

/** Every doc_type in the invoice_doc_type enum. If a new one is added to
 *  the DB it must be added here too — that is the point of this test. */
const INVOICE_DOC_TYPES = [
  'tax_invoice',
  'yarn_sale',
  'general_sale',
  'credit_note',
  'debit_note',
  'jobwork_invoice',
  'weaving_bill',
] as const;

/** Every bill kind the UnpaidBillsPicker can produce. */
const BILL_KINDS = [
  'invoice',
  'jobwork_invoice',
  'weaving_bill',
  'opening_receivable',
  'opening_payable',
  'sizing_bill',
  'bobbin_purchase',
  'yarn_purchase',
  'fabric_purchase',
  'warp_beam_purchase',
  'general_purchase',
] as const;

describe('party-streams', () => {
  it('maps every invoice doc_type to exactly one known stream', () => {
    for (const dt of INVOICE_DOC_TYPES) {
      expect(ALL_STREAMS).toContain(streamForDocType(dt));
    }
  });

  it('puts jobwork bills on the jobwork stream, not customer', () => {
    // Regression guard for the dashboard bug fixed in 4325b3a: a jobwork
    // bill is money owed TO us, and it is its own account — not lumped
    // in with sales.
    expect(streamForDocType('jobwork_invoice')).toBe('jobwork');
    expect(streamForDocType('tax_invoice')).toBe('customer');
    expect(streamForDocType('yarn_sale')).toBe('customer');
  });

  it('puts weaving bills on outsource', () => {
    expect(streamForDocType('weaving_bill')).toBe('outsource');
  });

  it('maps every bill kind to exactly one known stream', () => {
    for (const k of BILL_KINDS) {
      expect(ALL_STREAMS).toContain(streamForBillKind(k));
    }
  });

  it('classifies purchases as supplier', () => {
    expect(streamForBillKind('yarn_purchase')).toBe('supplier');
    expect(streamForBillKind('sizing_bill')).toBe('supplier');
    expect(streamForBillKind('bobbin_purchase')).toBe('supplier');
    expect(streamForBillKind('fabric_purchase')).toBe('supplier');
    expect(streamForBillKind('warp_beam_purchase')).toBe('supplier');
    expect(streamForBillKind('general_purchase')).toBe('supplier');
    expect(streamForBillKind('opening_payable')).toBe('supplier');
  });

  it('keeps opening receivables on the customer stream', () => {
    expect(streamForBillKind('opening_receivable')).toBe('customer');
  });

  it('gives jobwork an INBOUND direction — they owe us', () => {
    expect(directionForStream('jobwork')).toBe('in');
    expect(directionForStream('customer')).toBe('in');
    expect(directionForStream('supplier')).toBe('out');
    expect(directionForStream('outsource')).toBe('out');
  });

  it('splits the streams cleanly by direction', () => {
    expect(streamsForDirection('in').sort()).toEqual(['customer', 'jobwork']);
    expect(streamsForDirection('out').sort()).toEqual(['outsource', 'supplier']);
  });

  it('has complete metadata for every stream', () => {
    for (const s of ALL_STREAMS) {
      const meta = STREAM_META[s as PartyStream];
      expect(meta).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.short.length).toBeGreaterThan(0);
      expect(meta.blurb.length).toBeGreaterThan(0);
      expect(['in', 'out']).toContain(meta.direction);
    }
  });

  it('has metadata keys and ALL_STREAMS in sync', () => {
    expect(Object.keys(STREAM_META).sort()).toEqual([...ALL_STREAMS].sort());
  });
});
