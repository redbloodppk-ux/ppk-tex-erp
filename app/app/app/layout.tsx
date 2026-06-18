import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/app/components/app-shell';

export default async function AppShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/app/dashboard');

  // Look up the role from app_user (RLS policy allows self-read).
  // Match by id — app_user.id is FK to auth.users(id), so it's the canonical link.
  const { data: profile } = await supabase
    .from('app_user')
    .select('full_name, role, status')
    .eq('id', user.id)
    .maybeSingle();

  // If we can't find a profile (or it's disabled), don't silently downgrade to
  // floor_operator — that hides bugs. Bounce them to login with an error.
  if (!profile || profile.status !== 'active') {
    redirect('/login?error=' + encodeURIComponent(
      !profile
        ? 'No app_user row for this account. Contact the owner.'
        : `Account status: ${profile.status}. Contact the owner.`
    ));
  }

  const role = profile.role as
    | 'owner' | 'mill_manager' | 'sales_manager' | 'accounts' | 'floor_operator' | 'auditor';

  return (
    <AppShell role={role} fullName={profile?.full_name ?? user.email ?? 'User'}>
      {children}
    </AppShell>
  );
}
