// The old Resale stub page is retired — fabric purchases for resale
// now live as the Fabric Stock tab inside In-house Stock
// (/app/fabric-stock). This redirect keeps any old bookmarks alive.
import { redirect } from 'next/navigation';

export const metadata = { title: 'Resale (moved)' };

export default function ResaleRedirectPage(): never {
  redirect('/app/fabric-stock');
}
