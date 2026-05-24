import { describe, it, expect } from 'vitest';
import { weightedAverage } from './weightedAverage';

describe('weightedAverage', () => {
  // Per Build Guide T-B23 worked example
  it('100kg @ ₹200 + 50kg @ ₹215 = ₹205/kg', () => {
    const r = weightedAverage({ oldKg: 100, oldRate: 200, newKg: 50, newRate: 215 });
    expect(r.toNumber()).toBeCloseTo(205, 5);
  });
  it('first purchase (oldKg=0): returns newRate', () => {
    const r = weightedAverage({ oldKg: 0, oldRate: 0, newKg: 100, newRate: 250 });
    expect(r.toNumber()).toBe(250);
  });
  it('returns 0 when both kg are 0', () => {
    expect(weightedAverage({ oldKg: 0, oldRate: 0, newKg: 0, newRate: 0 }).toNumber()).toBe(0);
  });
  it('handles string inputs from DB numerics', () => {
    const r = weightedAverage({ oldKg: '100', oldRate: '200', newKg: '50', newRate: '215' });
    expect(r.toNumber()).toBeCloseTo(205, 5);
  });
});
