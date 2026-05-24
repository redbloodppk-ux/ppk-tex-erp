// lib/formulas/pickCost.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Pick cost ₹/m = (pickPaise * pickPpi * fabricWidthIn) / 100
//
// pickPaise is what the weaver charges per pick per inch (typical 0.25 to
// 0.60 paise). Divide by 100 to convert paise → rupees.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, mul } from '../money';

export interface PickCostArgs {
  pickPaise: MoneyInput;
  pickPpi: MoneyInput;
  fabricWidthIn: MoneyInput;
}

export function pickCost(args: PickCostArgs): Decimal {
  const p = money(args.pickPaise);
  const ppi = money(args.pickPpi);
  const w = money(args.fabricWidthIn);
  if (p.isZero() || ppi.isZero() || w.isZero()) return new Decimal(0);
  return div(mul(mul(p, ppi), w), 100);
}
