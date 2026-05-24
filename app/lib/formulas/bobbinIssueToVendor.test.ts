import { describe, it, expect } from 'vitest';
import { bobbinIssueToVendor } from './bobbinIssueToVendor';

describe('bobbinIssueToVendor', () => {
  it('0.2 pieces → ceil 1', () => {
    expect(bobbinIssueToVendor(0.2).toString()).toBe('1');
  });
  it('84.835 → ceil 85', () => {
    expect(bobbinIssueToVendor('84.835').toString()).toBe('85');
  });
  it('exact integer stays integer (50 → 50)', () => {
    expect(bobbinIssueToVendor(50).toString()).toBe('50');
  });
  it('0 stays 0', () => {
    expect(bobbinIssueToVendor(0).toString()).toBe('0');
  });
});
