import { describe, it, expect } from 'vitest';
import { quotedCost } from './quotedCost';

describe('quotedCost', () => {
  it('sums all provided components', () => {
    const r = quotedCost({
      warpCost: 42.99, weftCost: 29.42, porvaiCost: 0,
      bobbin1Cost: 0.225, bobbin2Cost: 0,
      pickCostMarket: 9.752,
      sizingCostPerM: 2.0, autoCostPerM: 1.0,
      warpCommissionPerM: 0.5, fabricCommissionPerM: 0.5,
    });
    expect(r.toNumber()).toBeCloseTo(42.99 + 29.42 + 0.225 + 9.752 + 2 + 1 + 0.5 + 0.5, 3);
  });
  it('treats missing/null components as 0', () => {
    expect(quotedCost({ warpCost: 10, weftCost: 5, pickCostMarket: 3 }).toNumber()).toBe(18);
  });
});
