import { describe, it, expect } from 'vitest';
import { trueCostInHouse } from './trueCostInHouse';

describe('trueCostInHouse', () => {
  it('includes LOOMS overhead instead of market pick', () => {
    const r = trueCostInHouse({
      warpCost: 42.99, weftCost: 29.42, porvaiCost: 0,
      bobbin1Cost: 0.225, bobbin2Cost: 0,
      loomsOverheadPerM: 7.50,
      sizingCostPerM: 2.0, autoCostPerM: 1.0,
      warpCommissionPerM: 0.5, fabricCommissionPerM: 0.5,
    });
    expect(r.toNumber()).toBeCloseTo(42.99 + 29.42 + 0.225 + 7.50 + 2 + 1 + 0.5 + 0.5, 3);
  });
});
