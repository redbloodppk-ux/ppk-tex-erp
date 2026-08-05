'use client';
/**
 * Settings → Backup & Restore — client UI.
 *
 * Two independent flows:
 *   - Create Backup: one click, downloads a single JSON file to the
 *     browser's default download folder (owner then moves/syncs it to
 *     Dropbox etc. themselves — we don't integrate with any cloud API).
 *   - Restore from Backup: pick a previously downloaded JSON file, see a
 *     preview (when it was made, how many tables/rows), type RESTORE to
 *     confirm, then run it. A fresh safety backup of current data is
 *     taken automatically and downloaded right before anything is
 *     overwritten, so a bad restore is always recoverable.
 *
 * Owner-only — the page wrapper already gates this, but every server
 * action re-checks requireOwner() too.
 */
import { useRef, useState } from 'react';
import { Download, Upload, ShieldAlert, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { createBackupAction, restoreBackupAction, type BackupPayload } from './actions';

const CONFIRM_PHRASE = 'RESTORE';

function downloadJson(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function summarize(backup: BackupPayload): { tableCount: number; rowCount: number } {
  const tableNames = Object.keys(backup.tables ?? {});
  const rowCount = tableNames.reduce((sum, t) => sum + (Array.isArray(backup.tables[t]) ? backup.tables[t].length : 0), 0);
  return { tableCount: tableNames.length, rowCount };
}

export function BackupRestoreClient() {
  // --- Create Backup ---
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdMsg, setCreatedMsg] = useState<string | null>(null);

  async function handleCreateBackup(): Promise<void> {
    setCreating(true);
    setCreateError(null);
    setCreatedMsg(null);
    const res = await createBackupAction();
    setCreating(false);
    if (!res.ok || !res.backup) {
      setCreateError(res.error ?? 'Backup failed.');
      return;
    }
    const { tableCount, rowCount } = summarize(res.backup);
    downloadJson(res.backup, `ppk-tex-erp-backup-${stamp()}.json`);
    setCreatedMsg(`Downloaded — ${tableCount} tables, ${rowCount} rows.`);
  }

  // --- Restore from Backup ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedBackup, setParsedBackup] = useState<BackupPayload | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState<{ tableCount: number; rowCount: number } | null>(null);

  function resetRestoreState(): void {
    setFileName(null);
    setParsedBackup(null);
    setParseError(null);
    setConfirmText('');
    setRestoreError(null);
    setRestoreDone(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    resetRestoreState();
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const json = JSON.parse(text) as BackupPayload;
        if (!json || typeof json !== 'object' || !json.tables) {
          setParseError('This file does not look like a PPK TEX ERP backup (missing "tables").');
          return;
        }
        setParsedBackup(json);
      } catch {
        setParseError('Could not read this file as JSON. Pick the exact file downloaded from "Create Backup".');
      }
    };
    reader.onerror = () => setParseError('Could not read this file.');
    reader.readAsText(file);
  }

  async function handleRestore(): Promise<void> {
    if (!parsedBackup || confirmText !== CONFIRM_PHRASE) return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreDone(null);

    const res = await restoreBackupAction(parsedBackup);
    setRestoring(false);

    if (res.safetyBackup) {
      downloadJson(res.safetyBackup, `ppk-tex-erp-safety-backup-before-restore-${stamp()}.json`);
    }

    if (!res.ok) {
      setRestoreError(res.error ?? 'Restore failed.');
      return;
    }

    const restored = res.restored ?? {};
    const tableCount = Object.keys(restored).length;
    const rowCount = Object.values(restored).reduce((s, n) => s + n, 0);
    setRestoreDone({ tableCount, rowCount });
    resetFileInput();
  }

  function resetFileInput(): void {
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileName(null);
    setParsedBackup(null);
    setConfirmText('');
  }

  const preview = parsedBackup ? summarize(parsedBackup) : null;

  return (
    <div className="space-y-6">
      {/* Create Backup */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-1">Create Backup</h2>
        <p className="text-xs text-ink-soft mb-3">
          Downloads one JSON file with every table in the ERP — sales, purchases, production, payments,
          ledgers, settings, and login accounts. Save it to Dropbox (or copy it to your desktop) so you have
          a copy off this device.
        </p>
        <button
          type="button"
          onClick={handleCreateBackup}
          disabled={creating}
          className="btn-primary"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {creating ? 'Preparing backup…' : 'Download Backup'}
        </button>
        {createdMsg && (
          <p className="flex items-center gap-1.5 text-xs text-green-600 mt-2">
            <CheckCircle2 className="h-3.5 w-3.5" /> {createdMsg}
          </p>
        )}
        {createError && <p className="text-xs text-err mt-2">{createError}</p>}
      </div>

      {/* Restore from Backup */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-1">Restore from Backup</h2>
        <p className="text-xs text-ink-soft mb-3">
          Replaces all current ERP data with the contents of a backup file. Use this only to recover from a
          serious mistake or data loss. A safety backup of what&apos;s in the system right now downloads
          automatically the moment you confirm, before anything is changed.
        </p>

        <div className="rounded-lg border border-l-4 border-l-amber-500 bg-amber-50/40 p-3 text-xs text-amber-800 flex items-start gap-2 mb-4">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            This overwrites every table, including today&apos;s invoices and payments if they were entered
            after the backup was made. Only restore a file you trust.
          </span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          className="block w-full text-xs text-ink-soft file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
        />

        {parseError && (
          <p className="flex items-center gap-1.5 text-xs text-err mt-2">
            <AlertTriangle className="h-3.5 w-3.5" /> {parseError}
          </p>
        )}

        {preview && fileName && (
          <div className="mt-3 rounded-lg border border-line p-3 text-sm space-y-1">
            <div><span className="text-ink-soft">File:</span> <span className="font-semibold">{fileName}</span></div>
            <div><span className="text-ink-soft">Backup made:</span>{' '}
              <span className="font-semibold">
                {parsedBackup?.meta?.created_at ? new Date(parsedBackup.meta.created_at).toLocaleString('en-IN') : 'Unknown'}
              </span>
            </div>
            <div><span className="text-ink-soft">Contains:</span>{' '}
              <span className="font-semibold num">{preview.tableCount} tables, {preview.rowCount} rows</span>
            </div>

            <div className="pt-3 mt-2 border-t border-line/60">
              <label className="block text-xs text-ink-soft mb-1">
                Type <span className="font-mono font-bold text-ink">{CONFIRM_PHRASE}</span> to confirm you want to overwrite current data:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="input h-9 text-sm w-48"
                placeholder={CONFIRM_PHRASE}
                autoComplete="off"
              />
            </div>

            <button
              type="button"
              onClick={handleRestore}
              disabled={restoring || confirmText !== CONFIRM_PHRASE}
              className="btn-primary mt-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-300"
            >
              {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {restoring ? 'Restoring…' : 'Restore Now'}
            </button>
          </div>
        )}

        {restoreError && (
          <p className="flex items-center gap-1.5 text-xs text-err mt-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {restoreError}
          </p>
        )}
        {restoreDone && (
          <div className="mt-3 rounded-lg border border-l-4 border-l-emerald-500 bg-emerald-50/40 p-3 text-xs text-emerald-800">
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" /> Restore complete — {restoreDone.tableCount} tables, {restoreDone.rowCount} rows.
            </div>
            <div className="mt-1">
              A safety backup of the data you had before this restore was also downloaded. Please sign out
              and sign back in, then refresh the app to make sure every screen shows the restored data.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
