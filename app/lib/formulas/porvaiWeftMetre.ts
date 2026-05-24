// lib/formulas/porvaiWeftMetre.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Porvai (polyester selvedge) metres-per-gram:
//   ( 1690 * neC / pickPpi ) / ( slevageLengthM + 3 )
// Per FabricCosting_FrozenSpec_v1.1 §2.6.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, mul, add } from '../money';

export interface PorvaiWeftMetreArgs {
  neC: MoneyInput;
  pickPpi: MoneyInput;
  slevageLengthM: MoneyInput;
}

const PORVAI_CONSTANT = new Decimal(1690);

export function porvaiWeftMetre(args: PorvaiWeftMetreArgs): Decimal {
  const neC = money(args.neC);
  const pick = money(args.pickPpi);
  const slev = money(args.slevageLengthM);
  if (neC.isZero() || pick.isZero()) return new Decimal(0);
  return div(div(mul(PORVAI_CONSTANT, neC), pick), add(slev, 3));
}
