// lib/formulas/weftCost.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Weft cost per metre = (1 / weftMetre) / 1000 * ratePerKg * (1 + wastagePct)
// Mirror of warpCost but driven by weftMetre.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, mul, add } from '../money';
import { weftMetre, WeftMetreArgs } from './weftMetre';

export interface WeftCostArgs extends WeftMetreArgs {
  ratePerKg: MoneyInput;
  wastagePct?: MoneyInput;
}

export function weftCost(args: WeftCostArgs): Decimal {
  const mPerGram = weftMetre(args);
  if (mPerGram.isZero()) return new Decimal(0);
  const rate = money(args.ratePerKg);
  const wastage = args.wastagePct === undefined ? new Decimal(0.02) : money(args.wastagePct);
  const gramsPerMetre = div(1, mPerGram);
  return mul(mul(div(gramsPerMetre, 1000), rate), add(1, wastage));
}
