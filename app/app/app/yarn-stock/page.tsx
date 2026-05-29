'use client';
import { YarnPurchaseLog } from '@/app/components/yarn-purchase-log';

export default function YarnStockPage() {
  return (
    <YarnPurchaseLog
      yarnKind="yarn"
      title="Yarn Stock"
      subtitle="Purchase log of warp / normal yarn. Lot code, total and reports update automatically."
    />
  );
}
