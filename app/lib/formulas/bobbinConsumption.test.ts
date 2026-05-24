import { describe, it, expect } from 'vitest';
import { bobbinConsumption, bobbinPiecesSplit } from './bobbinConsumption';

describe('bobbinConsumption', () => {
  it('200m / 1000m bobbin = 0.2 pieces (no rounding)', () => {
    expect(bobbinConsumption({ totalMetres: 200, bobbinMetre: 1000 }).toString()).toBe('0.2');
  });
  it('returns 0 when bobbinMetre = 0', () => {
    expect(bobbinConsumption({ totalMetres: 200, bobbinMetre: 0 }).toString()).toBe('0');
  });
});

describe('bobbinPiecesSplit', () => {
  it('84.835 → { whole: 84, partial: 0.835 }', () => {
    const { whole, partial } = bobbinPiecesSplit('84.835');
    expect(whole.toString()).toBe('84');
    expect(partial.toString()).toBe('0.835');
  });
  it('integer values have zero partial', () => {
    const { whole, partial } = bobbinPiecesSplit(50);
    expect(whole.toString()).toBe('50');
    expect(partial.toString()).toBe('0');
  });
});
