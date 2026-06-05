// The old separate Customer Payments / Purchase Payments pages were
// retired in favour of a single unified /app/payments page that handles
// every party type and direction. This stub keeps old bookmarks alive
// by redirecting straight to the inbound (receipts) tab.
import { redirect } from 'next/navigation';

export const metadata = { title: 'Customer Payments (moved)' };

export default function PayCustomerRedirectPage(): never {
  redirect('/app/payments?direction=in');
}
