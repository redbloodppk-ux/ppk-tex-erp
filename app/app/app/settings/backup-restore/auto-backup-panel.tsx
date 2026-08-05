'use client';
/**
 * Settings → Backup & Restore — Automatic Backups panel.
 *
 * Shows the snapshots pg_cron has taken automatically (daily, 02:00 IST,
 * 7-day retention — see migration auto_backup_schedule / fn_auto_backup_run).
 * Each row can be downloaded as JSON (same format as a manual backup) or
 * restored from directly, reusing the same restoreBackupAction() the manual
 * flow uses, with the same type-to-confirm friction and automatic
 * pre-restore safety backup.
 */
import { useEffect, useState } from 'react';
import { Download, History, Loader2, PlayCircle, RotateCcw, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { listAutoBackupsAction, getAutoBackupAction, runAutoBackupNowAction, type AutoBackupListItem } from './auto-backup-actions';
import { restoreBackupAction, type BackupPayload } from './actions';

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

function stamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function AutoBackupPanel() {
  const [items, setItems] = useState<AutoBackupListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // Restore-from-automatic-backup mini flow, keyed by the selected row's id.
  const [restoreTargetId, setRestoreTargetId] = useState<number | null>(null);
  const [restoreTargetBackup, setRestoreTargetBackup] = useState<BackupPayload | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState<{ tableCount: number; rowCount: number } | null>(null);

  async function loadList(): Promise<void> {
    setLoading(true);
    setListError(null);
    const res = await listAutoBackupsAction();
    setLoading(false);
    if (!res.ok || !res.items) {
      setListError(res.error ?? 'Could not load automatic backups.');
      return;
    }
    setItems(res.items);
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRunNow(): Promise<void> {
    setRunning(true);
    setRunMsg(null);
    setRunError(null);
    const res = await runAutoBackupNowAction();
    setRunning(false);
    if (!res.ok) {
      setRunError(res.error ?? 'Backup failed.');
      return;
    }
    setRunMsg('Backup taken just now.');
    await loadList();
  }

  async function handleDownload(id: number): Promise<void> {
    setDownloadingId(id);
    const res = await getAutoBackupAction(id);
    setDownloadingId(null);
    if (!res.ok || !res.backup) {
      setListError(res.error ?? 'Could not download this backup.');
      return;
    }
    downloadJson(res.backup, `ppk-tex-erp-auto-backup-${stamp(res.backup.meta?.created_at ?? new Date().toISOString())}.json`);
  }

  function cancelRestoreTarget(): void {
    setRestoreTargetId(null);
    setRestoreTargetBackup(null);
    setConfirmText('');
    setRestoreError(null);
    setRestoreDone(null);
  }

  async function startRestoreTarget(id: number): Promise<void> {
    cancelRestoreTarget();
    setRestoreTargetId(id);
    setLoadingTarget(true);
    const res = await getAutoBackupAction(id);
    setLoadingTarget(false);
    if (!res.ok || !res.backup) {
      setRestoreError(res.error ?? 'Could not load this backup.');
      return;
    }
    setRestoreTargetBackup(res.backup);
  }

  async function handleRestore(): Promise<void> {
    if (!restoreTargetBackup || confirmText !== CONFIRM_PHRASE) return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreDone(null);

    const res = await restoreBackupAction(restoreTargetBackup);
    setRestoring(false);

    if (res.safetyBackup) {
      downloadJson(res.safetyBackup, `ppk-tex-erp-safety-backup-before-restore-${stamp(new Date().toISOString())}.json`);
    }

    if (!res.ok) {
      setRestoreError(res.error ?? 'Restore failed.');
      return;
    }

    const restored = res.restored ?? {};
    const tableCount = Object.keys(restored).length;
    const rowCount = Object.values(restored).reduce((s, n) => s + n, 0);
    setRestoreDone({ tableCount, rowCount });
    setConfirmText('');
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="font-display font-bold text-base flex items-center gap-1.5">
          <History className="w-4 h-4" /> Automatic Backups
        </h2>
        <button type="button" onClick={handleRunNow} disabled={running} className="btn-secondary text-xs">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
          {running ? 'Running…' : 'Run backup now'}
        </button>
      </div>
      <p className="text-xs text-ink-soft mb-3">
        Runs automatically every night at 2:00 AM (India time) and keeps the last 7 days — no need to remember to
        do this yourself. Stored securely in the database, not on this device.
      </p>

      {runMsg && (
        <p className="flex items-center gap-1.5 text-xs text-green-600 mb-2">
          <CheckCircle2 className="h-3.5 w-3.5" /> {runMsg}
        </p>
      )}
      {runError && <p className="text-xs text-err mb-2">{runError}</p>}

      {loading && (
        <p className="flex items-center gap-1.5 text-xs text-ink-mute">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}
      {listError && !loading && <p className="text-xs text-err">{listError}</p>}

      {!loading && items && items.length === 0 && (
        <p className="text-xs text-ink-mute">
          No automatic backups yet — the first one will be taken tonight at 2:00 AM, or click &quot;Run backup
          now&quot; above.
        </p>
      )}

      {!loading && items && items.length > 0 && (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-ink-soft">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Taken</th>
                <th className="text-left font-semibold px-3 py-2">Contains</th>
                <th className="text-right font-semibold px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-line/60">
                  <td className="px-3 py-2 font-semibold">{new Date(item.created_at).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2 text-ink-soft num">{item.tableCount} tables, {item.rowCount} rows</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownload(item.id)}
                        disabled={downloadingId === item.id}
                        className="btn-secondary !py-1 !px-2 text-[11px]"
                      >
                        {downloadingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => startRestoreTarget(item.id)}
                        className="btn-secondary !py-1 !px-2 text-[11px] text-red-700"
                      >
                        <RotateCcw className="w-3 h-3" /> Restore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoreTargetId !== null && (
        <div className="mt-4 rounded-lg border border-line p-3 text-sm space-y-2">
          <div className="rounded-lg border border-l-4 border-l-amber-500 bg-amber-50/40 p-3 text-xs text-amber-800 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              This will overwrite every table with the contents of this automatic backup. A safety backup of what&apos;s
              in the system right now downloads automatically the moment you confirm.
            </span>
          </div>

          {loadingTarget && (
            <p className="flex items-center gap-1.5 text-xs text-ink-mute">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading backup…
            </p>
          )}

          {restoreTargetBackup && !restoreDone && (
            <>
              <label className="block text-xs text-ink-soft">
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
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoring || confirmText !== CONFIRM_PHRASE}
                  className="btn-primary bg-red-600 hover:bg-red-700 disabled:bg-slate-300"
                >
                  {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  {restoring ? 'Restoring…' : 'Restore Now'}
                </button>
                <button type="button" onClick={cancelRestoreTarget} disabled={restoring} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </>
          )}

          {restoreError && (
            <p className="flex items-center gap-1.5 text-xs text-err">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {restoreError}
            </p>
          )}
          {restoreDone && (
            <div className="rounded-lg border border-l-4 border-l-emerald-500 bg-emerald-50/40 p-3 text-xs text-emerald-800">
              <div className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" /> Restore complete — {restoreDone.tableCount} tables, {restoreDone.rowCount} rows.
              </div>
              <div className="mt-1">
                A safety backup of the data you had before this restore was also downloaded. Please sign out and
                sign back in, then refresh the app.
              </div>
              <button type="button" onClick={cancelRestoreTarget} className="btn-secondary mt-2 !py-1 !px-2 text-[11px]">
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
