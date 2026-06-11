'use client';
import { WarpBeamPurchaseLog } from '@/app/components/warp-beam-purchase-log';
import { InhouseStockTabs } from '@/app/components/inhouse-stock-tabs';

export default function WarpBeamPage(): React.ReactElement {
  return (
    <>
      <InhouseStockTabs />
      <WarpBeamPurchaseLog />
    </>
  );
}
