/**
 * Settings → Backup & Restore.
 *
 * Owner-only. Two complementary flows, both companions to Supabase's own
 * daily backups + PITR (see docs/RESTORE.md):
 *   - Automatic: pg_cron runs fn_auto_backup_run() nightly at 2 AM IST,
 *     keeping the last 7 days in public.auto_backup (migration:
 *     auto_backup_schedule). No action needed from the owner.
 *   - Manual: pull a full JSON snapshot on demand and, in an emergency,
 *     load one back in.
 */
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';
import { BackupRestoreClient } from './backup-restore-client';
import { AutoBackupPanel } from './auto-backup-panel';

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
      <div className="space-y-6">
        <AutoBackupPanel />
        <BackupRestoreClient />
      </div>
    </div>
  );
}
