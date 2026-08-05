'use server';
/**
 * Server actions for Settings → Backup & Restore — automatic (scheduled) backups.
 *
 * Companion to actions.ts (the manual create/restore flow). A pg_cron job
 * (`ppk-tex-erp-daily-backup`, migration: auto_backup_schedule) calls
 * fn_auto_backup_run() once a day at 02:00 IST, which snapshots the ERP via
 * fn_backup_export() into public.auto_backup and prunes anything older than
 * 7 days. This file lets the owner view, download, manually trigger, and
 * restore from those snapshots — no separate storage/API integration
 * needed, it's all inside Postgres.
 *
 * Owner-only, same as actions.ts: every entry point re-checks requireOwner().
 */
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';
import type { BackupPayload } from './actions';

export interface AutoBackupListItem {
  id: number;
  created_at: string;
  tableCount: number;
  rowCount: number;
}

export interface ListAutoBackupsResult {
  ok: boolean;
  error?: string;
  items?: AutoBackupListItem[];
}

function summarizePayload(payload: BackupPayload): { tableCount: number; rowCount: number } {
  const tableNames = Object.keys(payload?.tables ?? {});
  const rowCount = tableNames.reduce(
    (sum, t) => sum + (Array.isArray(payload.tables[t]) ? payload.tables[t].length : 0),
    0
  );
  return { tableCount: tableNames.length, rowCount };
}

/** List the automatic snapshots currently retained (newest first), with lightweight summaries only. */
export async function listAutoBackupsAction(): Promise<ListAutoBackupsResult> {
  try {
    const supabase = await createClient();
    await requireOwner(supabase);

    const admin = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from('auto_backup')
      .select('id, created_at, payload')
      .order('created_at', { ascending: false });
    if (error) return { ok: false, error: error.message };

    const items: AutoBackupListItem[] = (data ?? []).map((row: { id: number; created_at: string; payload: BackupPayload }) => {
      const { tableCount, rowCount } = summarizePayload(row.payload);
      return { id: row.id, created_at: row.created_at, tableCount, rowCount };
    });

    return { ok: true, items };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}

export interface GetAutoBackupResult {
  ok: boolean;
  error?: string;
  backup?: BackupPayload;
}

/** Fetch the full payload for one automatic snapshot — used for both "Download" and "Restore". */
export async function getAutoBackupAction(id: number): Promise<GetAutoBackupResult> {
  try {
    const supabase = await createClient();
    await requireOwner(supabase);

    const admin = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from('auto_backup')
      .select('payload')
      .eq('id', id)
      .single();
    if (error) return { ok: false, error: error.message };

    return { ok: true, backup: data.payload as BackupPayload };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}

export interface RunAutoBackupNowResult {
  ok: boolean;
  error?: string;
}

/** Manually trigger the same snapshot pg_cron runs nightly — for "prove it works right now" peace of mind. */
export async function runAutoBackupNowAction(): Promise<RunAutoBackupNowResult> {
  try {
    const supabase = await createClient();
    await requireOwner(supabase);

    const admin = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).rpc('fn_auto_backup_run');
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}
