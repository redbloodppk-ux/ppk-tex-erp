// lib/formulas/porvaiCost.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Porvai cost per metre = (1 / porvaiWeftMetre) / 1000 * ratePerKg * (1 + wastagePct)
// Mirrors warpCost/weftCost but uses the porvai weft formula.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, mul, add } from '../money';
import { porvaiWeftMetre, PorvaiWeftMetreArgs } from './porvaiWeftMetre';

export interface PorvaiCostArgs extends PorvaiWeftMetreArgs {
  ratePerKg: MoneyInput;
  wastagePct?: MoneyInput;
}

export function porvaiCost(args: PorvaiCostArgs): Decimal {
  const mPerGram = porvaiWeftMetre(args);
  if (mPerGram.isZero()) return new Decimal(0);
  const rate = money(args.ratePerKg);
  const wastage = args.wastagePct === undefined ? new Decimal(0.02) : money(args.wastagePct);
  const gramsPerMetre = div(1, mPerGram);
  return mul(mul(div(gramsPerMetre, 1000), rate), add(1, wastage));
}
