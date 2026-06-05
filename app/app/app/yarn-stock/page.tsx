'use client';
import { YarnPurchaseLog } from '@/app/components/yarn-purchase-log';
import { InhouseStockTabs } from '@/app/components/inhouse-stock-tabs';

export default function YarnStockPage() {
  return (
    <>
      <InhouseStockTabs />
      <YarnPurchaseLog
        yarnKind="yarn"
        title="Yarn Stock"
        subtitle="Purchase log of warp / normal yarn. Lot code, total and reports update automatically."
      />
    </>
  );
}
