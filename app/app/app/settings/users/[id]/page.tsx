import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';
import { EditUserForm } from './edit-form';

export const metadata = { title: 'Edit user' };
export const dynamic = 'force-dynamic';

export default async function EditUserPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  let me: { userId: string } | null = null;
  try {
    me = await requireOwner(supabase);
  } catch (e) {
    if (e instanceof NotOwnerError) redirect('/app/settings?notice=owner-only');
    throw e;
  }

  const { id } = await params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data } = await sb
    .from('app_user')
    .select('id, email, full_name, phone, role, status, last_login, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();

  const isSelf = me.userId === id;

  return (
    <div className="max-w-xl">
      <PageHeader
        title={`Edit ${data.full_name}`}
        subtitle={isSelf
          ? "You're editing your own account — role and status are locked to prevent accidental lockout."
          : 'Change role, status, or contact details. Soft-delete (Archive) by setting status to Inactive.'}
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Users & Roles', href: '/app/settings/users' },
          { label: data.full_name },
        ]}
      />
      <EditUserForm initial={data} isSelf={isSelf} />
    </div>
  );
}
