// The standalone Mills master is gone. Yarn suppliers now live in the
// unified Parties table under the "Mill / Yarn Supplier" party type
// (see migration 098). This stub redirects any bookmarked /app/mills
// URLs to the right place so nothing 404s.
import { redirect } from 'next/navigation';

export const metadata = { title: 'Mills (moved)' };

export default function MillsRedirectPage(): never {
  redirect('/app/parties?type=Mill+%2F+Yarn+Supplier');
}
