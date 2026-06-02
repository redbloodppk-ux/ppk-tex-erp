import { PageHeader } from '@/app/components/page-header';
import { DeliveryChallanForm } from '../dc-form';

export const metadata = { title: 'New Delivery Challan' };
export const dynamic = 'force-dynamic';

export default function NewDcPage() {
  return (
    <div>
      <PageHeader
        title="New Delivery Challan"
        crumbs={[
          { label: 'Delivery Challan', href: '/app/delivery-challan' },
          { label: 'New' },
        ]}
      />
      <DeliveryChallanForm />
    </div>
  );
}
