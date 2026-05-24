import { describe, it, expect } from 'vitest';
import { bobbinCost } from './bobbinCost';

describe('bobbinCost', () => {
  it('₹250 / 2000m + ₹0.10 loading = ₹0.225/m', () => {
    expect(bobbinCost({ bobbinPrice: 250, bobbinMetre: 2000, loadingPerMetre: 0.10 }).toNumber())
      .toBeCloseTo(0.225, 4);
  });
  it('uses default 0.10 loading', () => {
    expect(bobbinCost({ bobbinPrice: 250, bobbinMetre: 2000 }).toNumber()).toBeCloseTo(0.225, 4);
  });
  it('returns 0 when bobbinMetre = 0', () => {
    expect(bobbinCost({ bobbinPrice: 250, bobbinMetre: 0 }).toNumber()).toBe(0);
  });
});
