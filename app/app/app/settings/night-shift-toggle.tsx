'use client';
/**
 * NightShiftToggle — Settings → Shift settings.
 *
 * A single on/off switch that controls whether the Shift Production Log
 * offers a Night shift in addition to Day. Reads / writes the JSONB row in
 * `system_config` under the key `shift_log_night_enabled`:
 *
 *   { "enabled": false }   ← day-only (default)
 *   { "enabled": true  }   ← Day + Night buttons shown on the Shift Log
 *
 * Owner-only: when `canEdit` is false the switch is shown read-only. The
 * Settings page decides `canEdit` from the signed-in user's role.
 */
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Moon, CheckCircle2, Loader2 } from 'lucide-react';

const CONFIG_KEY = 'shift_log_night_enabled';

interface NightShiftToggleProps {
  initialEnabled: boolean;
  canEdit: boolean;
}

export function NightShiftToggle({ initialEnabled, canEdit }: NightShiftToggleProps) {
  const supabase = createClient();
  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    if (!canEdit || saving) return;
    const next = !enabled;

    setError(null);
    setSavedMsg(null);
    setSaving(true);
    setEnabled(next); // optimistic

    const { data: { user } } = await supabase.auth.getUser();
    const { error: upErr } = await supabase
      .from('system_config')
      .update({
        value: { enabled: next },
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('key', CONFIG_KEY);

    setSaving(false);

    if (upErr) {
      setEnabled(!next); // revert
      setError(upErr.message);
      return;
    }
    setSavedMsg(next ? 'Night shift enabled.' : 'Night shift disabled.');
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
            <Moon className="w-5 h-5" />
          </div>
          <div>
            <div className="font-semibold">Enable night shift in Shift Log</div>
            <div className="text-xs text-ink-soft">
              When off, the Shift Log records the day shift only. Turn this on if you
              also run a night shift — the Day / Night buttons then appear on the
              Shift Log. Past entries are never changed.
            </div>
            {!canEdit && (
              <div className="text-[11px] text-ink-mute mt-1">
                Only the owner can change this setting.
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable night shift in Shift Log"
          onClick={toggle}
          disabled={!canEdit || saving}
          className={
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ' +
            (enabled ? 'bg-indigo-600' : 'bg-slate-300') +
            (!canEdit || saving ? ' opacity-60 cursor-not-allowed' : ' cursor-pointer')
          }
        >
          <span
            className={
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition ' +
              (enabled ? 'translate-x-5' : 'translate-x-0.5')
            }
          />
        </button>
      </div>

      {saving && (
        <p className="flex items-center gap-1.5 text-xs text-ink-mute">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving…
        </p>
      )}
      {savedMsg && !saving && (
        <p className="flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {savedMsg}
        </p>
      )}
      {error && <p className="text-xs text-err">{error}</p>}
    </div>
  );
}
