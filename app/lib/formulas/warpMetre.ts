// lib/formulas/warpMetre.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Warp metres-per-gram = 1848 / (Ne * reedCount * fabricWidthIn * (1 + shrinkagePct))
//
// Constant 1848 is from FabricCosting_FrozenSpec_v1.1 §2.1. It encodes the
// English Cotton Count (NeC) unit conversion from hanks-per-pound to
// metres-per-gram for warp yarn.
//
// Used by warpCost() and trueCostInHouse() / trueCostVendor().
//
// @example  120HT warp: Ne=80, reedCount=72, width=53in, shrinkage=2%
//           1848 / (80 * 72 * 53 * 1.02) ≈ 0.005932 m/g
//           Per kg: 1000 / 0.005932 ≈ 168.6 m
// ----------------------------------------------------------------------------
import { Decimal } from 'decimal.js';
import { money, MoneyInput, div, mul, add } from '../money';

export interface WarpMetreArgs {
  /** Yarn count in NeC (English cotton count). */
  ne: MoneyInput;
  /** Reed count (ends per inch / 2). */
  reedCount: MoneyInput;
  /** Fabric width in inches. */
  fabricWidthIn: MoneyInput;
  /** Shrinkage % expressed as decimal (0.02 = 2%). */
  shrinkagePct: MoneyInput;
}

const WARP_CONSTANT = new Decimal(1848);

/**
 * Compute warp metres-per-gram.
 * Returns Decimal(0) when any required input is zero — caller decides how
 * to surface the gap (usually as a validation error).
 */
export function warpMetre(args: WarpMetreArgs): Decimal {
  const ne = money(args.ne);
  const reedCount = money(args.reedCount);
  const width = money(args.fabricWidthIn);
  const shrink = money(args.shrinkagePct);

  if (ne.isZero() || reedCount.isZero() || width.isZero()) {
    return new Decimal(0);
  }

  const denom = mul(mul(mul(ne, reedCount), width), add(1, shrink));
  return div(WARP_CONSTANT, denom);
}
