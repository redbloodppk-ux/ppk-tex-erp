// lib/money.ts (CORR-F2 / CORR-F3 / CORR-F4)
// ----------------------------------------------------------------------------
// Money math wrapper around decimal.js. Per Correction Guide v1.1 R5:
// "Every money calculation in TypeScript uses decimal.js. Never JavaScript
// Number arithmetic for currency."
//
// Why decimal.js: JavaScript Number cannot represent 0.1 + 0.2 = 0.3 (it
// returns 0.30000000000000004). For currency this introduces rounding
// errors that accumulate over thousands of invoices.
//
// Every function here returns either a Decimal (for chaining / further
// math) or a formatted string (for display). Never a raw Number.
// ----------------------------------------------------------------------------
import Decimal from 'decimal.js';

// Configure decimal.js for currency: banker's rounding, 30 sig figs of
// internal precision (display rounding is separate).
Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_EVEN, // banker's rounding for fairness
});

export type MoneyInput = number | string | Decimal | null | undefined;

/**
 * Coerce any input to a Decimal. null/undefined/empty/NaN → Decimal(0).
 * Use this at the boundary where untyped data (URL params, JSON, DB
 * numeric strings) enters the money pipeline.
 */
export function money(value: MoneyInput): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** Sum of any number of money inputs. */
export function sum(...values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

/** a + b */
export function add(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).plus(money(b));
}

/** a - b */
export function sub(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

/** a * b */
export function mul(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).times(money(b));
}

/** a / b. Returns 0 if b is zero, never throws — caller decides. */
export function div(a: MoneyInput, b: MoneyInput): Decimal {
  const bd = money(b);
  if (bd.isZero()) return new Decimal(0);
  return money(a).dividedBy(bd);
}

/** Round to 2 decimals using banker's rounding. Used before display/persistence. */
export function round2(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

/**
 * Format a Decimal (or coercible value) as Indian rupees:
 *   12345.67 → "₹12,345.67"
 *      99999 → "₹99,999.00"
 *     150000 → "₹1,50,000.00"
 *
 * Per Correction Guide v1.1 §1.5: ₹ symbol, Indian comma grouping, 2 decimals.
 * Pass `compact: true` to render large numbers as "₹1.50 L" / "₹1.50 Cr".
 */
export function formatINR(
  value: MoneyInput,
  opts: { decimals?: number; compact?: boolean } = {}
): string {
  const d = money(value);
  if (!d.isFinite()) return '—';
  const n = d.toNumber();
  if (opts.compact && Math.abs(n) >= 100_000) {
    if (Math.abs(n) >= 10_000_000) {
      return `₹${(n / 10_000_000).toFixed(2)} Cr`;
    }
    return `₹${(n / 100_000).toFixed(2)} L`;
  }
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  });
}

/** Convert paise to rupees as a Decimal. 12345 paise → Decimal(123.45) */
export function paiseToRupees(paise: MoneyInput): Decimal {
  return div(paise, 100);
}

/** Convert rupees to paise as a Decimal (rounded to integer). */
export function rupeesToPaise(rupees: MoneyInput): Decimal {
  return round2(mul(rupees, 100)).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
}

// Re-export Decimal so callers don't have to import the dependency directly.
export { Decimal };
