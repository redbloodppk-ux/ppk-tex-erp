/**
 * Settings → Company page.
 *
 * Loads the singleton company_profile row and hands it to the client
 * form. First-time setup (no row exists) renders an empty form that
 * the operator fills in — verifying the GSTIN once auto-populates
 * legal name, display name, PAN and the full address.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CompanyForm } from './company-form';

export const metadata = { title: 'Settings → Company' };
export const dynamic = 'force-dynamic';

export default async function CompanyProfilePage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data, error } = await sb
    .from('company_profile')
    .select('id, legal_name, display_name, gstin, pan, address_line1, address_line2, city, state, pincode, phone, email, website, fy_start_month, base_currency, gstin_verified_at')
    .limit(1)
    .maybeSingle();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Company Profile"
        subtitle="Master record of the legal entity behind the mill. Verifying the GSTIN auto-fills name, PAN and address."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Company' }]}
      />
      {error && (
        <div className="card p-3 mb-4 text-err text-sm">
          Could not load company profile: {error.message}
        </div>
      )}
      <CompanyForm initial={data ?? null} />
    </div>
  );
}
