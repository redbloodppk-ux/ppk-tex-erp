import { describe, it, expect } from 'vitest';
import { porvaiNeC } from './porvaiNeC';

describe('porvaiNeC', () => {
  it('150D → ≈ 35.43 NeC', () => {
    expect(porvaiNeC(150).toNumber()).toBeCloseTo(35.43, 2);
  });
  it('300D → ≈ 17.72 NeC', () => {
    expect(porvaiNeC(300).toNumber()).toBeCloseTo(17.72, 2);
  });
  it('returns 0 for 0 or negative denier', () => {
    expect(porvaiNeC(0).toNumber()).toBe(0);
    expect(porvaiNeC(-1).toNumber()).toBe(0);
  });
});
