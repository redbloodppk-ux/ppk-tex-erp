import { describe, it, expect } from 'vitest';
import { weftMetre } from './weftMetre';

describe('weftMetre', () => {
  it('120HT weft: Ne=80, ppi=46, width=53 → ~0.008666 m/g', () => {
    const r = weftMetre({ ne: 80, pickPpi: 46, fabricWidthIn: 53 });
    expect(r.toNumber()).toBeCloseTo(0.008666, 4);
  });
  it('returns 0 for any zero input', () => {
    expect(weftMetre({ ne: 0, pickPpi: 46, fabricWidthIn: 53 }).toNumber()).toBe(0);
    expect(weftMetre({ ne: 80, pickPpi: 0, fabricWidthIn: 53 }).toNumber()).toBe(0);
    expect(weftMetre({ ne: 80, pickPpi: 46, fabricWidthIn: 0 }).toNumber()).toBe(0);
  });
});
