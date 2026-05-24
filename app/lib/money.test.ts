// lib/money.test.ts (CORR-F3)
// ----------------------------------------------------------------------------
// Sample Vitest suite proving the money helpers behave correctly. Extended
// in CORR-F4 with the formula library.
// ----------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import {
  Decimal,
  add, sub, mul, div, sum, round2,
  formatINR, money, paiseToRupees, rupeesToPaise,
} from './money';

describe('money() coercion', () => {
  it('handles null/undefined/empty as 0', () => {
    expect(money(null).toString()).toBe('0');
    expect(money(undefined).toString()).toBe('0');
    expect(money('').toString()).toBe('0');
  });
  it('parses numeric strings', () => {
    expect(money('123.45').toString()).toBe('123.45');
  });
  it('rejects NaN and Infinity', () => {
    expect(money(Number.NaN).toString()).toBe('0');
    expect(money(Number.POSITIVE_INFINITY).toString()).toBe('0');
  });
  it('returns Decimal instances', () => {
    expect(money('1.23')).toBeInstanceOf(Decimal);
  });
});

describe('arithmetic', () => {
  // Classic JS floating-point sin: 0.1 + 0.2 !== 0.3
  it('avoids the 0.1 + 0.2 precision bug', () => {
    expect(add(0.1, 0.2).toString()).toBe('0.3');
  });
  it('subtracts correctly', () => {
    expect(sub('100.00', '33.33').toString()).toBe('66.67');
  });
  it('multiplies correctly', () => {
    expect(mul('12.50', '4').toString()).toBe('50');
  });
  it('divides safely (zero divisor returns 0)', () => {
    expect(div(100, 0).toString()).toBe('0');
    expect(div(100, 4).toString()).toBe('25');
  });
  it('sums an arbitrary list', () => {
    expect(sum(10, '20', new Decimal('30'), null).toString()).toBe('60');
  });
});

describe('round2', () => {
  it("uses banker's rounding", () => {
    // 2.5 → 2 (ties to even), 3.5 → 4 (ties to even)
    expect(round2('2.005').toString()).toBe('2');
    expect(round2('2.015').toString()).toBe('2.02');
  });
});

describe('formatINR', () => {
  it('formats with Indian comma grouping and ₹ symbol', () => {
    const out = formatINR(150000);
    expect(out).toContain('₹');
    expect(out).toContain('1,50,000');
  });
  it('uses compact L/Cr suffixes when requested', () => {
    expect(formatINR(250000, { compact: true })).toBe('₹2.50 L');
    expect(formatINR(15_000_000, { compact: true })).toBe('₹1.50 Cr');
  });
  it('returns em-dash for null', () => {
    expect(formatINR(null)).toBe('—');
  });
});

describe('paise <-> rupees', () => {
  it('paiseToRupees(12345) = 123.45', () => {
    expect(paiseToRupees(12345).toString()).toBe('123.45');
  });
  it('rupeesToPaise(123.45) = 12345', () => {
    expect(rupeesToPaise('123.45').toString()).toBe('12345');
  });
});
