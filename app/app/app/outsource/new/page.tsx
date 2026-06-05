// The old "New Outsource Order" form is retired — the unified
// Outsource Weaving page (/app/outsource) is now a Job Work clone
// where every transaction (bobbin given, beam given, weft bag, etc.)
// is logged directly through its own tabbed form. Old bookmarks
// land on the main page.
import { redirect } from 'next/navigation';

export const metadata = { title: 'New Outsource Order (moved)' };

export default function NewOutsourceRedirectPage(): never {
  redirect('/app/outsource');
}
