'use client';
import { YarnPurchaseLog } from '@/app/components/yarn-purchase-log';

export default function PorvaiYarnStockPage() {
  return (
    <YarnPurchaseLog
      yarnKind="porvai"
      title="Porvai Yarn Stock"
      subtitle="Purchase log of selvedge (porvai) yarn. Lot code, total and reports update automatically."
    />
  );
}
