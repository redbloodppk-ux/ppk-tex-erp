/**
 * Settings → Backup & Restore.
 *
 * Owner-only. Manual, self-service alternative/companion to Supabase's own
 * daily backups + PITR (see docs/RESTORE.md) — lets the owner pull a full
 * JSON snapshot on demand and, in an emergency, load one back in.
 */
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';
import { BackupRestoreClient } from './backup-restore-client';

export const metadata = { title: 'Settings → Backup & Restore' };
export const dynamic = 'force-dynamic';

export default async function BackupRestorePage() {
  const supabase = await createClient();

  try {
    await requireOwner(supabase);
  } catch (e) {
    if (e instanceof NotOwnerError) redirect('/app/settings?notice=owner-only');
    throw e;
  }

  return (
    <div>
      <PageHeader
        title="Backup & Restore"
        subtitle="Download a full copy of your ERP data any time, and restore from one if something goes seriously wrong."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Backup & Restore' }]}
      />
      <BackupRestoreClient />
    </div>
  );
}
