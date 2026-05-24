import { describe, it, expect } from 'vitest';
import { weftCost } from './weftCost';

describe('weftCost', () => {
  it('120HT weft: Ne=80, ppi=46, w=53, rate=₹250/kg, wastage=2%', () => {
    // weftMetre ≈ 0.008666 m/g → ~115.4 g/m → 0.1154 kg/m × 250 × 1.02 ≈ 29.42 ₹/m
    const r = weftCost({ ne: 80, pickPpi: 46, fabricWidthIn: 53, ratePerKg: 250, wastagePct: 0.02 });
    expect(r.toNumber()).toBeCloseTo(29.42, 1);
  });
  it('returns 0 when any input is 0', () => {
    expect(weftCost({ ne: 0, pickPpi: 46, fabricWidthIn: 53, ratePerKg: 250 }).toNumber()).toBe(0);
  });
});
