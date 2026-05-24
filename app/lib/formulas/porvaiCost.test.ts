import { describe, it, expect } from 'vitest';
import { porvaiCost } from './porvaiCost';

describe('porvaiCost', () => {
  it('neC=35.43, ppi=46, slev=1.65, rate=₹220/kg, wastage=2% → small ₹/m', () => {
    // mPerGram ≈ 279.93 → g/m ≈ 0.003572 → kg/m ≈ 3.572e-6 × 220 × 1.02 ≈ 8.01e-4 ₹/m
    const r = porvaiCost({ neC: 35.43, pickPpi: 46, slevageLengthM: 1.65, ratePerKg: 220, wastagePct: 0.02 });
    expect(r.toNumber()).toBeCloseTo(0.0008, 4);
  });
  it('returns 0 when porvaiWeftMetre would be 0', () => {
    expect(porvaiCost({ neC: 0, pickPpi: 46, slevageLengthM: 1.65, ratePerKg: 220 }).toNumber()).toBe(0);
  });
});
