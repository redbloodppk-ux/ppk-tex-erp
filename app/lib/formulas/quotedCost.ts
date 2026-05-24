// lib/formulas/quotedCost.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Quoted cost = sum of all per-metre components priced at MARKET pick rate.
// This is what the owner uses to quote a customer.
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { MoneyInput, sum } from '../money';

export interface QuotedCostArgs {
  warpCost: MoneyInput;
  weftCost: MoneyInput;
  porvaiCost?: MoneyInput;
  bobbin1Cost?: MoneyInput;
  bobbin2Cost?: MoneyInput;
  pickCostMarket: MoneyInput;
  sizingCostPerM?: MoneyInput;
  autoCostPerM?: MoneyInput;
  warpCommissionPerM?: MoneyInput;
  fabricCommissionPerM?: MoneyInput;
}

export function quotedCost(args: QuotedCostArgs): Decimal {
  return sum(
    args.warpCost, args.weftCost, args.porvaiCost,
    args.bobbin1Cost, args.bobbin2Cost,
    args.pickCostMarket,
    args.sizingCostPerM, args.autoCostPerM,
    args.warpCommissionPerM, args.fabricCommissionPerM,
  );
}
