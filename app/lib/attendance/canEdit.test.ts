import { describe, it, expect } from 'vitest';
import { canEdit, isAdminRole } from './canEdit';

const NOW = '2026-05-25T12:00:00.000Z';

function hoursAgo(h: number): string {
  return new Date(Date.parse(NOW) - h * 60 * 60 * 1000).toISOString();
}

describe('isAdminRole', () => {
  it('owner and mill_manager are admin roles', () => {
    expect(isAdminRole('owner')).toBe(true);
    expect(isAdminRole('mill_manager')).toBe(true);
  });
  it('other roles are not admin', () => {
    expect(isAdminRole('floor_operator')).toBe(false);
    expect(isAdminRole('accounts')).toBe(false);
    expect(isAdminRole('auditor')).toBe(false);
  });
});

describe('canEdit — free window (< 24h)', () => {
  it('floor operator can edit a record marked 2h ago', () => {
    const r = canEdit({ markedAt: hoursAgo(2), role: 'floor_operator', now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.window).toBe('free');
  });
  it('just under 24h is still free', () => {
    const r = canEdit({ markedAt: hoursAgo(23.9), role: 'floor_operator', now: NOW });
    expect(r.window).toBe('free');
    expect(r.allowed).toBe(true);
  });
});

describe('canEdit — restricted window (24–168h)', () => {
  it('exactly 24h is restricted', () => {
    const r = canEdit({ markedAt: hoursAgo(24), role: 'floor_operator', now: NOW });
    expect(r.window).toBe('restricted');
  });
  it('floor operator blocked at 48h', () => {
    const r = canEdit({ markedAt: hoursAgo(48), role: 'floor_operator', now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.window).toBe('restricted');
  });
  it('owner allowed at 48h', () => {
    const r = canEdit({ markedAt: hoursAgo(48), role: 'owner', now: NOW });
    expect(r.allowed).toBe(true);
  });
  it('mill_manager allowed at 168h boundary', () => {
    const r = canEdit({ markedAt: hoursAgo(168), role: 'mill_manager', now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.window).toBe('restricted');
  });
});

describe('canEdit — locked window (> 168h)', () => {
  it('owner cannot edit a record marked 200h ago', () => {
    const r = canEdit({ markedAt: hoursAgo(200), role: 'owner', now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.window).toBe('locked');
  });
});

describe('canEdit — edge cases', () => {
  it('future markedAt clamps hoursElapsed to 0 and stays free', () => {
    const r = canEdit({ markedAt: hoursAgo(-5), role: 'floor_operator', now: NOW });
    expect(r.hoursElapsed).toBe(0);
    expect(r.window).toBe('free');
  });
  it('invalid date is locked, fail-safe', () => {
    const r = canEdit({ markedAt: 'not-a-date', role: 'owner', now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.window).toBe('locked');
  });
});
