// lib/formulas/bobbinConsumption.ts (CORR-F4 + CORR-T3)
// ----------------------------------------------------------------------------
// Bobbin pieces consumed = totalMetres / bobbinMetre
//
// Stored as DECIMAL (e.g. 0.835 pieces) — never rounded. Per
// Porvai_Bobbin_ERP_Integration_Spec_v2.1 §7.2.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div } from '../money';

export function bobbinConsumption(args: { totalMetres: MoneyInput; bobbinMetre: MoneyInput }): Decimal {
  const m = money(args.bobbinMetre);
  if (m.isZero()) return new Decimal(0);
  return div(money(args.totalMetres), m);
}

/** Split a decimal piece count into { whole, partial }. */
export function bobbinPiecesSplit(pieces: MoneyInput): { whole: Decimal; partial: Decimal } {
  const d = money(pieces);
  const whole = d.floor();
  return { whole, partial: d.minus(whole) };
}
