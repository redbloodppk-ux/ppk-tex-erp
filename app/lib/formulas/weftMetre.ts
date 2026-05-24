// lib/formulas/weftMetre.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Weft metres-per-gram = 1690 / (Ne * pickPpi * fabricWidthIn)
//
// Constant 1690 from FabricCosting_FrozenSpec_v1.1 §2.2.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, mul } from '../money';

export interface WeftMetreArgs {
  ne: MoneyInput;
  pickPpi: MoneyInput;
  fabricWidthIn: MoneyInput;
}

const WEFT_CONSTANT = new Decimal(1690);

export function weftMetre(args: WeftMetreArgs): Decimal {
  const ne = money(args.ne);
  const pick = money(args.pickPpi);
  const width = money(args.fabricWidthIn);
  if (ne.isZero() || pick.isZero() || width.isZero()) return new Decimal(0);
  return div(WEFT_CONSTANT, mul(mul(ne, pick), width));
}
