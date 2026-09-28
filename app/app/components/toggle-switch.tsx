'use client';
/**
 * ToggleSwitch — the app-wide on/off switch for "Active / Inactive" style
 * flags (employees, masters, categories, ledgers ...). One component so
 * every screen looks and behaves the same: green = on, grey = off, the
 * label beside it says which, and it is keyboard/screen-reader friendly
 * (role="switch").
 *
 * Purely presentational: the caller owns the state and the save.
 */
import { Loader2 } from 'lucide-react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Show a spinner in place of the label while a save is in flight. */
  busy?: boolean;
  onLabel?: string;
  offLabel?: string;
  /** Hide the text label (switch only). */
  hideLabel?: boolean;
  /** Tooltip / accessible name; defaults to the current label. */
  title?: string;
  size?: 'sm' | 'md';
  /** Show the label in red (e.g. the last save failed). */
  error?: boolean;
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  busy = false,
  onLabel = 'Active',
  offLabel = 'Inactive',
  hideLabel = false,
  title,
  size = 'sm',
  error = false,
}: ToggleSwitchProps): React.ReactElement {
  const label = checked ? onLabel : offLabel;
  const track = size === 'md' ? 'h-6 w-11' : 'h-5 w-9';
  const knob = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const onX = size === 'md' ? 'translate-x-[22px]' : 'translate-x-[18px]';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title ?? label}
      title={title ?? label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 select-none align-middle disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <span
        className={
          `relative inline-flex ${track} shrink-0 rounded-full transition-colors ` +
          (checked ? 'bg-emerald-500' : 'bg-slate-300')
        }
      >
        <span
          className={
            `absolute top-0.5 ${knob} rounded-full bg-white shadow transition-transform ` +
            (checked ? onX : 'translate-x-0.5')
          }
        />
      </span>
      {!hideLabel && (
        busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-mute" />
        ) : (
          <span
            className={
              (size === 'md' ? 'text-sm ' : 'text-xs ') + 'font-semibold ' +
              (error ? 'text-rose-600' : checked ? 'text-emerald-700' : 'text-ink-mute')
            }
          >
            {label}
          </span>
        )
      )}
    </button>
  );
}
