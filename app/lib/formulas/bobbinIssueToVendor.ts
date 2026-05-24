// lib/formulas/bobbinIssueToVendor.ts (CORR-F4 + CORR-T3)
// ----------------------------------------------------------------------------
// Bobbin pieces issued to a vendor = CEILING(consumption).
// We can only ship whole bobbins to the weaver — partial pieces stay in
// main godown. Per Porvai_Bobbin_ERP_Integration_Spec_v2.1 §7.2.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput } from '../money';

export function bobbinIssueToVendor(consumptionDecimalPieces: MoneyInput): Decimal {
  return money(consumptionDecimalPieces).ceil();
}
