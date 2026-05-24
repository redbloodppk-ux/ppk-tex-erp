import { describe, it, expect } from 'vitest';
import { trueCostVendor } from './trueCostVendor';

describe('trueCostVendor', () => {
  it('uses vendor pick rate', () => {
    const r = trueCostVendor({
      warpCost: 42.99, weftCost: 29.42,
      bobbin1Cost: 0.225,
      pickCostVendor: 8.50,
      sizingCostPerM: 2.0, autoCostPerM: 1.0,
      warpCommissionPerM: 0.5, fabricCommissionPerM: 0.5,
    });
    expect(r.toNumber()).toBeCloseTo(42.99 + 29.42 + 0.225 + 8.50 + 2 + 1 + 0.5 + 0.5, 3);
  });
});
