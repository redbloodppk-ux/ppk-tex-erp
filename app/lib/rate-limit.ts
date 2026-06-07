/**
 * Token-bucket rate limiter — CORR-H4.
 *
 * Why a token bucket: it lets the operator burst (e.g. quickly tap
 * "Save" on a few rows in a row) without being rejected, while still
 * preventing runaway loops. Each key has a bucket; tokens refill at
 * a steady rate; one token is consumed per write request.
 *
 * Scope: per-process in-memory map (Map<key, TokenBucket>). Vercel
 * serverless functions are short-lived and may run on different
 * instances, so the effective limit is N_instances × limit. For a
 * single-tenant ERP like PPK TEX with a handful of users that's
 * acceptable — the goal is "stop a runaway loop from hammering us",
 * not "absolute global enforcement". If we ever need exact limits
 * across instances, swap the Map for Upstash Redis behind the same
 * `consume()` signature.
 *
 * The bucket is also self-pruning: any key that hasn't been touched
 * in 2× the refill window is evicted on the next access so the Map
 * doesn't grow unbounded.
 *
 * Public API:
 *   consume(key, opts?) → { ok, remaining, retryAfterSec, limit, burst }
 *   getConfig()        → { writesPerMin, burst }
 *
 * Pure-ish: the only side effect is mutating the in-process map.
 * Unit-tested in lib/rate-limit.test.ts.
 */

export interface RateLimitConfig {
  writesPerMin: number;
  burst: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
  burst: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

/** Default config; overridable via env. Read once at module-load time. */
const DEFAULT_WRITES_PER_MIN = 120;
const DEFAULT_BURST = 30;

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

let CONFIG: RateLimitConfig = {
  writesPerMin: readEnvInt('RATE_LIMIT_WRITES_PER_MIN', DEFAULT_WRITES_PER_MIN),
  burst:        readEnvInt('RATE_LIMIT_BURST',          DEFAULT_BURST),
};

export function getConfig(): RateLimitConfig {
  return { ...CONFIG };
}

/** Test-only escape hatch — lets the unit tests override env without
 *  forking the module. Production code should NOT call this. */
export function __setConfigForTests(c: RateLimitConfig): void {
  CONFIG = c;
}

/** Test-only escape hatch — wipes the bucket map between tests so they
 *  don't bleed state into each other. */
export function __resetForTests(): void {
  buckets.clear();
}

/** Attempt to consume one token for `key`. Returns whether the request
 *  should be allowed plus a Retry-After hint when rejected. */
export function consume(
  key: string,
  opts: { now?: number; config?: RateLimitConfig } = {},
): RateLimitResult {
  const cfg = opts.config ?? CONFIG;
  const now = opts.now ?? Date.now();
  const burst = cfg.burst;
  // Convert per-minute rate to per-millisecond drip.
  const dripPerMs = cfg.writesPerMin / 60_000;

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: burst, lastRefillMs: now };
    buckets.set(key, b);
  } else {
    // Refill since last touch.
    const elapsed = Math.max(0, now - b.lastRefillMs);
    if (elapsed > 0) {
      b.tokens = Math.min(burst, b.tokens + elapsed * dripPerMs);
      b.lastRefillMs = now;
    }
  }

  // Self-prune: if this bucket is fully refilled AND hasn't been seen in
  // 2× the refill window, we could delete it. We do the deletion on the
  // NEXT access (i.e. now, before computing) to bound the map size in
  // the warm-state case.
  pruneStale(now);

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return {
      ok: true,
      remaining: Math.floor(b.tokens),
      retryAfterSec: 0,
      limit: cfg.writesPerMin,
      burst,
    };
  }

  // How long until ONE token is back? Solve: tokensNeeded / dripPerMs.
  const msUntilOneToken = Math.ceil((1 - b.tokens) / dripPerMs);
  const retryAfterSec = Math.max(1, Math.ceil(msUntilOneToken / 1000));
  return {
    ok: false,
    remaining: 0,
    retryAfterSec,
    limit: cfg.writesPerMin,
    burst,
  };
}

/** Drop buckets that are at full capacity AND haven't been touched in
 *  120 seconds. Keeps the in-memory map bounded under traffic spikes. */
function pruneStale(now: number): void {
  if (buckets.size < 200) return; // cheap fast-path
  const cutoff = now - 120_000;
  for (const [k, b] of buckets) {
    if (b.lastRefillMs < cutoff && b.tokens >= CONFIG.burst) {
      buckets.delete(k);
    }
  }
}
