// lib/formulas/warpMetre.test.ts
import { describe, it, expect } from 'vitest';
import { warpMetre } from './warpMetre';

describe('warpMetre', () => {
  // Worked example from FabricCosting_FrozenSpec_v1.1: 120HT warp
  it('120HT: Ne=80, reed=72, width=53, shrinkage=2% → ~0.005932 m/g', () => {
    const r = warpMetre({ ne: 80, reedCount: 72, fabricWidthIn: 53, shrinkagePct: 0.02 });
    expect(r.toNumber()).toBeCloseTo(0.005932, 4);
  });

  it('returns 0 when ne is 0', () => {
    expect(warpMetre({ ne: 0, reedCount: 72, fabricWidthIn: 53, shrinkagePct: 0.02 }).toNumber()).toBe(0);
  });
  it('returns 0 when reedCount is 0', () => {
    expect(warpMetre({ ne: 80, reedCount: 0, fabricWidthIn: 53, shrinkagePct: 0.02 }).toNumber()).toBe(0);
  });
  it('returns 0 when width is 0', () => {
    expect(warpMetre({ ne: 80, reedCount: 72, fabricWidthIn: 0, shrinkagePct: 0.02 }).toNumber()).toBe(0);
  });
  it('handles zero shrinkage', () => {
    const r = warpMetre({ ne: 80, reedCount: 72, fabricWidthIn: 53, shrinkagePct: 0 });
    // 1848 / (80*72*53) ≈ 0.006052
    expect(r.toNumber()).toBeCloseTo(0.006052, 4);
  });
  it('coerces string inputs', () => {
    const r = warpMetre({ ne: '80', reedCount: '72', fabricWidthIn: '53', shrinkagePct: '0.02' });
    expect(r.toNumber()).toBeCloseTo(0.005932, 4);
  });
});
