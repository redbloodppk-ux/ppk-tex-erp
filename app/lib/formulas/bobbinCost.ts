// lib/formulas/bobbinCost.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Bobbin cost per metre = (bobbinPrice / bobbinMetre) + loadingPerMetre
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, add } from '../money';

export interface BobbinCostArgs {
  bobbinPrice: MoneyInput;   // ₹ per bobbin (whole piece)
  bobbinMetre: MoneyInput;   // metres of fabric one bobbin produces
  loadingPerMetre?: MoneyInput; // handling charge ₹/m, default 0.10
}

export function bobbinCost(args: BobbinCostArgs): Decimal {
  const price = money(args.bobbinPrice);
  const metre = money(args.bobbinMetre);
  const loading = args.loadingPerMetre === undefined ? new Decimal(0.10) : money(args.loadingPerMetre);
  if (metre.isZero()) return new Decimal(0);
  return add(div(price, metre), loading);
}
