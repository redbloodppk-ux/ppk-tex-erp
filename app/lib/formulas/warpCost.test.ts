import { describe, it, expect } from 'vitest';
import { warpCost } from './warpCost';

describe('warpCost', () => {
  it('120HT: Ne=80, reed=72, w=53, shrink=2%, rate=₹250/kg, wastage=2%', () => {
    // warpMetre ≈ 0.005932 m/g → 168.6 g/m → 0.1686 kg/m → 0.1686 × 250 × 1.02 ≈ 42.99 / 1000 actually
    // Let's compute step by step: 1/0.005932 = 168.58 g/m. 0.16858 kg/m * 250 * 1.02 = 42.99 — wait that's per kg
    // Correction: 0.16858 kg per m? No, 168.58 g/m = 0.16858 kg/m — yes
    // 0.16858 * 250 = 42.14 ₹/m, * 1.02 = 42.99 ₹/m
    const r = warpCost({ ne: 80, reedCount: 72, fabricWidthIn: 53, shrinkagePct: 0.02, ratePerKg: 250, wastagePct: 0.02 });
    expect(r.toNumber()).toBeCloseTo(42.99, 1);
  });
  it('returns 0 when warpMetre would be 0', () => {
    expect(warpCost({ ne: 0, reedCount: 72, fabricWidthIn: 53, shrinkagePct: 0.02, ratePerKg: 250 }).toNumber()).toBe(0);
  });
  it('uses default 2% wastage when not provided', () => {
    const a = warpCost({ ne: 80, reedCount: 72, fabricWidthIn: 53, shrinkagePct: 0.02, ratePerKg: 250 });
    const b = warpCost({ ne: 80, reedCount: 72, fabricWidthIn: 53, shrinkagePct: 0.02, ratePerKg: 250, wastagePct: 0.02 });
    expect(a.toString()).toBe(b.toString());
  });
});
