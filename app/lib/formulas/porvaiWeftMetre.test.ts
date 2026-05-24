import { describe, it, expect } from 'vitest';
import { porvaiWeftMetre } from './porvaiWeftMetre';

describe('porvaiWeftMetre', () => {
  it('neC=35.43, ppi=46, slev=1.65 → ≈ 279.85 m/g (per spec)', () => {
    // (1690 * 35.43 / 46) / (1.65 + 3) = (59876.7/46)/4.65 = 1301.67/4.65 ≈ 279.93
    const r = porvaiWeftMetre({ neC: 35.43, pickPpi: 46, slevageLengthM: 1.65 });
    expect(r.toNumber()).toBeCloseTo(279.93, 1);
  });
  it('returns 0 when neC or ppi is 0', () => {
    expect(porvaiWeftMetre({ neC: 0, pickPpi: 46, slevageLengthM: 1.65 }).toNumber()).toBe(0);
    expect(porvaiWeftMetre({ neC: 35.43, pickPpi: 0, slevageLengthM: 1.65 }).toNumber()).toBe(0);
  });
});
