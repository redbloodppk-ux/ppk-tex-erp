// lib/formulas/porvaiNeC.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Polyester denier → NeC: NeC = 5315 / denier
// Per Build Guide §1.4 and FabricCosting_FrozenSpec_v1.1 §2.6.
// E.g. 150D polyester → 5315 / 150 ≈ 35.43 NeC.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div } from '../money';

const POLY_CONSTANT = new Decimal(5315);

export function porvaiNeC(denier: MoneyInput): Decimal {
  const d = money(denier);
  if (d.isZero() || d.isNegative()) return new Decimal(0);
  return div(POLY_CONSTANT, d);
}
