import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';
import { InviteUserForm } from './invite-form';

export const metadata = { title: 'Invite user' };
export const dynamic = 'force-dynamic';

export default async function NewUserPage() {
  const supabase = await createClient();
  try {
    await requireOwner(supabase);
  } catch (e) {
    if (e instanceof NotOwnerError) redirect('/app/settings?notice=owner-only');
    throw e;
  }
  return (
    <div className="max-w-xl">
      <PageHeader
        title="Invite a new user"
        subtitle="They'll get an email with a magic link. On first sign-in they become active."
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Users & Roles', href: '/app/settings/users' },
          { label: 'Invite' },
        ]}
      />
      <InviteUserForm />
    </div>
  );
}
