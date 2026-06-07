/**
 * Unit tests for the token-bucket rate limiter — CORR-H4.
 *
 * Verifies the four invariants the limiter has to uphold:
 *   1. The first burst-N requests are allowed instantly.
 *   2. Once burst is empty, the next request is rejected with a
 *      meaningful Retry-After.
 *   3. After waiting one full drip-window, a single token is back and
 *      the next request succeeds.
 *   4. Different keys have independent buckets.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  consume,
  __setConfigForTests,
  __resetForTests,
  getConfig,
} from './rate-limit';

describe('rate-limit consume()', () => {
  beforeEach(() => {
    __resetForTests();
    // Predictable test config: 60 writes/min = 1/sec, burst of 5.
    __setConfigForTests({ writesPerMin: 60, burst: 5 });
  });

  it('allows the first burst of requests instantly', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      const r = consume('user:a', { now: t0 });
      expect(r.ok).toBe(true);
      expect(r.remaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects the 6th request in a row with retryAfterSec >= 1', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) consume('user:a', { now: t0 });
    const r = consume('user:a', { now: t0 });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(r.remaining).toBe(0);
  });

  it('allows one more request after a full drip-window passes', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) consume('user:a', { now: t0 });
    // One token at 60/min = one per 1000ms; wait 1100ms to be safe.
    const r = consume('user:a', { now: t0 + 1100 });
    expect(r.ok).toBe(true);
  });

  it('treats different keys independently', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) consume('user:a', { now: t0 });
    // user:a is depleted; user:b should still have a full burst.
    const r = consume('user:b', { now: t0 });
    expect(r.ok).toBe(true);
  });

  it('refills proportionally — half-window gives ~half token back', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) consume('user:a', { now: t0 });
    // 500ms later we should still be below 1 full token.
    const r = consume('user:a', { now: t0 + 500 });
    expect(r.ok).toBe(false);
    // Retry-after should now be ~1s (we have ~0.5 token, need 0.5 more).
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('caps the bucket at burst — long idle does not stockpile', () => {
    const t0 = 1_000_000;
    consume('user:a', { now: t0 });           // 1 used, 4 left
    // Idle for an hour — bucket should refill to burst (5), not 5+lots.
    const t1 = t0 + 60 * 60 * 1000;
    // Drain again; should get exactly 5 immediate successes, then fail.
    for (let i = 0; i < 5; i += 1) {
      const r = consume('user:a', { now: t1 });
      expect(r.ok).toBe(true);
    }
    const overflow = consume('user:a', { now: t1 });
    expect(overflow.ok).toBe(false);
  });
});

describe('getConfig()', () => {
  beforeEach(() => {
    __setConfigForTests({ writesPerMin: 60, burst: 5 });
  });

  it('returns a defensive copy', () => {
    const c1 = getConfig();
    c1.writesPerMin = 9999;
    const c2 = getConfig();
    expect(c2.writesPerMin).toBe(60);
  });
});
