// lib/formulas/warpCost.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Warp cost per metre = (1 / warpMetre) / 1000 * ratePerKg * (1 + wastagePct)
//
// Convert metres-per-gram → grams-per-metre → kg-per-metre → ₹/m.
// Add wastage allowance (default 2%, may be overridden per quality).
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, mul, add } from '../money';
import { warpMetre, WarpMetreArgs } from './warpMetre';

export interface WarpCostArgs extends WarpMetreArgs {
  /** Yarn rate ₹/kg from yarn_lot.weighted_avg or live purchase rate. */
  ratePerKg: MoneyInput;
  /** Wastage % expressed as decimal (0.02 = 2%). Default 0.02. */
  wastagePct?: MoneyInput;
}

export function warpCost(args: WarpCostArgs): Decimal {
  const mPerGram = warpMetre(args);
  if (mPerGram.isZero()) return new Decimal(0);
  const rate = money(args.ratePerKg);
  const wastage = args.wastagePct === undefined ? new Decimal(0.02) : money(args.wastagePct);
  // grams per metre:
  const gramsPerMetre = div(1, mPerGram);
  // ₹ per metre at given rate, with wastage:
  return mul(mul(div(gramsPerMetre, 1000), rate), add(1, wastage));
}
