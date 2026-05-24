// lib/formulas/trueCostVendor.ts (CORR-F4)
// ----------------------------------------------------------------------------
// True cost (outsourced to weaver) = yarn + bobbin + porvai + sizing + auto +
// VENDOR pick paise rate (not market) + commissions.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { MoneyInput, sum } from '../money';

export interface TrueCostVendorArgs {
  warpCost: MoneyInput;
  weftCost: MoneyInput;
  porvaiCost?: MoneyInput;
  bobbin1Cost?: MoneyInput;
  bobbin2Cost?: MoneyInput;
  /** Pick cost computed with vendor's negotiated pickPaise rate. */
  pickCostVendor: MoneyInput;
  sizingCostPerM?: MoneyInput;
  autoCostPerM?: MoneyInput;
  warpCommissionPerM?: MoneyInput;
  fabricCommissionPerM?: MoneyInput;
}

export function trueCostVendor(args: TrueCostVendorArgs): Decimal {
  return sum(
    args.warpCost, args.weftCost, args.porvaiCost,
    args.bobbin1Cost, args.bobbin2Cost,
    args.pickCostVendor,
    args.sizingCostPerM, args.autoCostPerM,
    args.warpCommissionPerM, args.fabricCommissionPerM,
  );
}
