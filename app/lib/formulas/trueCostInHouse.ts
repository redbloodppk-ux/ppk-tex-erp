// lib/formulas/trueCostInHouse.ts (CORR-F4)
// ----------------------------------------------------------------------------
// True cost (in-house production) = yarn + bobbin + porvai + sizing + auto +
// LOOMS overhead per metre (from CORR-T2 calibration) + commissions.
//
// Distinct from quotedCost in that it uses the LOOMS overhead (rent, wages,
// EB, interest amortised per metre) instead of a market pick rate. This is
// the cost we actually incurred to weave the fabric ourselves.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { MoneyInput, sum } from '../money';

export interface TrueCostInHouseArgs {
  warpCost: MoneyInput;
  weftCost: MoneyInput;
  porvaiCost?: MoneyInput;
  bobbin1Cost?: MoneyInput;
  bobbin2Cost?: MoneyInput;
  /** Per-metre LOOMS overhead from looms_calibration. */
  loomsOverheadPerM: MoneyInput;
  sizingCostPerM?: MoneyInput;
  autoCostPerM?: MoneyInput;
  warpCommissionPerM?: MoneyInput;
  fabricCommissionPerM?: MoneyInput;
}

export function trueCostInHouse(args: TrueCostInHouseArgs): Decimal {
  return sum(
    args.warpCost, args.weftCost, args.porvaiCost,
    args.bobbin1Cost, args.bobbin2Cost,
    args.loomsOverheadPerM,
    args.sizingCostPerM, args.autoCostPerM,
    args.warpCommissionPerM, args.fabricCommissionPerM,
  );
}
