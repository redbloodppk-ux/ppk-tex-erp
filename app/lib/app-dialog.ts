/**
 * appConfirm / appAlert — in-app replacements for window.confirm/alert.
 *
 * The browser's own boxes are plain, can't mark a dangerous action in red,
 * and on phones show the site address as the title. These open the app's
 * DialogHost instead (mounted once in app/layout.tsx) and resolve when the
 * user answers:
 *
 *   if (!(await appConfirm('Delete this bill?', { danger: true }))) return;
 *   await appAlert('Saved.');
 *
 * If the host is not mounted (e.g. a unit test), they fall back to the
 * browser's own dialogs so nothing silently auto-confirms.
 */

export interface DialogOptions {
  title?: string;
  /** Red confirm button — deleting, cancelling, reversing stock. */
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface DialogRequest extends DialogOptions {
  kind: 'confirm' | 'alert';
  message: string;
  resolve: (ok: boolean) => void;
}

type Listener = (req: DialogRequest) => void;
let listener: Listener | null = null;

/** Called by DialogHost on mount. Returns an unsubscribe. */
export function registerDialogHost(fn: Listener): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

const DANGER_WORDS = /\b(delete|remove|cancel|reverse|void|discard|archive|clear|reset|undo|overwrite|unlink)\b/i;

export function appConfirm(message: string, opts: DialogOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (!listener) return Promise.resolve(window.confirm(message));
  const danger = opts.danger ?? DANGER_WORDS.test(message);
  return new Promise<boolean>((resolve) => listener?.({ kind: 'confirm', message, resolve, ...opts, danger }));
}

export function appAlert(message: string, opts: DialogOptions = {}): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!listener) { window.alert(message); return Promise.resolve(); }
  return new Promise<void>((resolve) => listener?.({ kind: 'alert', message, resolve: () => resolve(), ...opts }));
}
