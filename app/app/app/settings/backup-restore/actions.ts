'use server';
/**
 * Server actions for Settings → Backup & Restore.
 *
 * Owner-only. Wraps the fn_backup_export() / fn_backup_restore(payload)
 * Postgres functions (migration: backup_restore_functions). Both DB
 * functions are SECURITY DEFINER and service_role-only — this file is the
 * only place in the app allowed to call them, and every entry point
 * re-checks requireOwner() first so a stolen service-role key alone isn't
 * enough; you also need an authenticated owner session.
 *
 * Flow:
 *   - createBackupAction():   returns the full JSON snapshot for the
 *                              browser to download.
 *   - restoreBackupAction():  takes the JSON the owner uploaded, exports a
 *                              fresh "safety" snapshot of current data
 *                              FIRST (also returned, so the browser can
 *                              force a second download before anything is
 *                              overwritten), then calls fn_backup_restore.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';

export interface BackupPayload {
  meta: { version: number; app: string; created_at: string };
  tables: Record<string, unknown[]>;
}

export interface CreateBackupResult {
  ok: boolean;
  error?: string;
  backup?: BackupPayload;
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
  safetyBackup?: BackupPayload;
  restored?: Record<string, number>;
}

/** Export the whole ERP (all business tables + login accounts) as one JSON object. */
export async function createBackupAction(): Promise<CreateBackupResult> {
  try {
    const supabase = await createClient();
    await requireOwner(supabase);

    const admin = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).rpc('fn_backup_export');
    if (error) return { ok: false, error: error.message };

    return { ok: true, backup: data as BackupPayload };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}

function isBackupPayload(v: unknown): v is BackupPayload {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.tables === 'object' && obj.tables !== null;
}

/**
 * Restore the ERP from an uploaded backup file. Always takes a fresh
 * "before" snapshot first so the owner has a way back even if the
 * uploaded file turns out to be the wrong one.
 */
export async function restoreBackupAction(payload: unknown): Promise<RestoreResult> {
  try {
    const supabase = await createClient();
    await requireOwner(supabase);

    if (!isBackupPayload(payload)) {
      return { ok: false, error: 'That file does not look like a PPK TEX ERP backup (missing "tables" object).' };
    }

    const admin = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAny = admin as any;

    // Safety net: snapshot current data before we touch anything.
    const { data: safetyData, error: safetyErr } = await adminAny.rpc('fn_backup_export');
    if (safetyErr) return { ok: false, error: `Could not take a safety backup before restoring, aborted: ${safetyErr.message}` };

    const { data: restoreData, error: restoreErr } = await adminAny.rpc('fn_backup_restore', { payload });
    if (restoreErr) {
      return {
        ok: false,
        error: `Restore failed and was rolled back automatically, no data was changed: ${restoreErr.message}`,
        safetyBackup: safetyData as BackupPayload,
      };
    }

    return {
      ok: true,
      safetyBackup: safetyData as BackupPayload,
      restored: (restoreData as { restored: Record<string, number> })?.restored ?? {},
    };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}
