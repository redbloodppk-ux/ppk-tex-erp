// The Mill master is retired (migration 098). There's no underlying
// mill row anymore; instead, every former mill is a party with
// party_type = 'Mill / Yarn Supplier'. Old /app/mills/[id] bookmarks
// redirect to the parties list filtered by that type.
import { redirect } from 'next/navigation';

export const metadata = { title: 'Mill (moved)' };

export default function EditMillRedirectPage(): never {
  redirect('/app/parties?type=Mill+%2F+Yarn+Supplier');
}
