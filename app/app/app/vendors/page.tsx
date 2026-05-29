/**
 * Vendor master is deprecated - the Ledgers master replaces it.
 * Any link still pointing to /app/vendors lands here and is redirected.
 */
import { redirect } from 'next/navigation';

export default function DeprecatedVendorsPage(): never {
  redirect('/app/ledgers');
}
