'use client';
import { FabricPurchaseLog } from '@/app/components/fabric-purchase-log';
import { InhouseStockTabs } from '@/app/components/inhouse-stock-tabs';

export default function FabricStockPage(): React.ReactElement {
  return (
    <>
      <InhouseStockTabs />
      <FabricPurchaseLog />
    </>
  );
}
