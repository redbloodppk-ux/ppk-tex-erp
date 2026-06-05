// The Mill master is retired (migration 098). Creating a yarn supplier
// is now done from the Parties → New page, with party_type =
// "Mill / Yarn Supplier". Anyone hitting /app/mills/new gets sent there.
import { redirect } from 'next/navigation';

export const metadata = { title: 'New Mill (moved)' };

export default function NewMillRedirectPage(): never {
  redirect('/app/parties/new?type=Mill+%2F+Yarn+Supplier');
}
