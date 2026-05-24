// lib/formulas/index.ts (CORR-F4)
// ----------------------------------------------------------------------------
// Single import surface for the costing formula library. Every business
// formula from FabricCosting_FrozenSpec_v1.1 §A.2 is a pure TypeScript
// function returning a Decimal (decimal.js), unit-tested via Vitest.
//
//   import { warpCost, weftCost, quotedCost } from '@/lib/formulas';
// ----------------------------------------------------------------------------
export { warpMetre } from './warpMetre';
export type { WarpMetreArgs } from './warpMetre';

export { weftMetre } from './weftMetre';
export type { WeftMetreArgs } from './weftMetre';

export { warpCost } from './warpCost';
export type { WarpCostArgs } from './warpCost';

export { weftCost } from './weftCost';
export type { WeftCostArgs } from './weftCost';

export { pickCost } from './pickCost';
export type { PickCostArgs } from './pickCost';

export { bobbinCost } from './bobbinCost';
export type { BobbinCostArgs } from './bobbinCost';

export { porvaiNeC } from './porvaiNeC';

export { porvaiWeftMetre } from './porvaiWeftMetre';
export type { PorvaiWeftMetreArgs } from './porvaiWeftMetre';

export { porvaiCost } from './porvaiCost';
export type { PorvaiCostArgs } from './porvaiCost';

export { quotedCost } from './quotedCost';
export type { QuotedCostArgs } from './quotedCost';

export { trueCostInHouse } from './trueCostInHouse';
export type { TrueCostInHouseArgs } from './trueCostInHouse';

export { trueCostVendor } from './trueCostVendor';
export type { TrueCostVendorArgs } from './trueCostVendor';

export { bobbinConsumption, bobbinPiecesSplit } from './bobbinConsumption';

export { bobbinIssueToVendor } from './bobbinIssueToVendor';

export { weightedAverage } from './weightedAverage';
export type { WeightedAverageArgs } from './weightedAverage';
