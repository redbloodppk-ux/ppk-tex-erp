// lib/formulas/weightedAverage.ts (CORR-F4 + CORR-T1)
// ----------------------------------------------------------------------------
// Weighted-average rate update:
//   newRate = (oldKg * oldRate + newKg * newRate) / (oldKg + newKg)
//
// Used by yarn_lot to maintain weighted_avg_rate as new purchases arrive.
// Per Build Guide T-B23 (worked example: 100kg @ ₹200 + 50kg @ ₹215 = ₹205).
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, add, mul, div } from '../money';

export interface WeightedAverageArgs {
  oldKg: MoneyInput;
  oldRate: MoneyInput;
  newKg: MoneyInput;
  newRate: MoneyInput;
}

export function weightedAverage(args: WeightedAverageArgs): Decimal {
  const totalKg = add(args.oldKg, args.newKg);
  if (money(totalKg).isZero()) return new Decimal(0);
  const totalCost = add(mul(args.oldKg, args.oldRate), mul(args.newKg, args.newRate));
  return div(totalCost, totalKg);
}
