'use client';
import { YarnPurchaseLog } from '@/app/components/yarn-purchase-log';
import { InhouseStockTabs } from '@/app/components/inhouse-stock-tabs';

export default function PorvaiYarnStockPage() {
  return (
    <>
      <InhouseStockTabs />
      <YarnPurchaseLog
        yarnKind="porvai"
        title="Porvai Yarn Stock"
        subtitle="Purchase log of selvedge (porvai) yarn. Lot code, total and reports update automatically."
      />
    </>
  );
}
