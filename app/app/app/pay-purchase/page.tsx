// Old Purchase Payments stub — redirects to the unified /app/payments
// page on the outbound (paid) tab.
import { redirect } from 'next/navigation';

export const metadata = { title: 'Purchase Payments (moved)' };

export default function PayPurchaseRedirectPage(): never {
  redirect('/app/payments?direction=out');
}
