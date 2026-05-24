import { describe, it, expect } from 'vitest';
import { pickCost } from './pickCost';

describe('pickCost', () => {
  it('0.40 paise × 46 ppi × 53 in / 100 = 9.752 ₹/m', () => {
    expect(pickCost({ pickPaise: 0.40, pickPpi: 46, fabricWidthIn: 53 }).toNumber()).toBeCloseTo(9.752, 3);
  });
  it('returns 0 when paise = 0', () => {
    expect(pickCost({ pickPaise: 0, pickPpi: 46, fabricWidthIn: 53 }).toNumber()).toBe(0);
  });
});
