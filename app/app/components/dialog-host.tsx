'use client';
/**
 * DialogHost — renders appConfirm / appAlert requests (lib/app-dialog.ts)
 * as the app's own modal. Mounted once in app/layout.tsx.
 * Enter = confirm, Escape = cancel; the confirm button is red for
 * dangerous actions.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { registerDialogHost, type DialogRequest } from '@/lib/app-dialog';

export function DialogHost(): React.ReactElement | null {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const okRef = useRef<HTMLButtonElement | null>(null);
  const current = queue[0] ?? null;

  useEffect(() => registerDialogHost((req) => setQueue((q) => [...q, req])), []);

  function answer(ok: boolean): void {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  }

  useEffect(() => {
    if (!current) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); answer(current.kind === 'alert'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;
  const danger = current.kind === 'confirm' && current.danger;
  // First line of a multi-line message becomes the heading when no title
  // was given — most existing messages are written "Question?\n\nDetail".
  const lines = current.message.split('\n');
  const title = current.title ?? (lines.length > 1 ? lines[0] : null);
  const body = current.title ? current.message : (lines.length > 1 ? lines.slice(1).join('\n').trim() : current.message);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget && current.kind === 'confirm') answer(false); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className={
            'shrink-0 rounded-full p-2 ' +
            (danger ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600')
          }>
            {danger ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
          </span>
          <div className="min-w-0 space-y-1">
            {title && <h3 className="font-display font-bold text-ink">{title}</h3>}
            {body && <p className="text-sm text-ink-soft whitespace-pre-line break-words">{body}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {current.kind === 'confirm' && (
            <button type="button" className="btn-secondary min-h-[44px]" onClick={() => answer(false)}>
              {current.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => answer(true)}
            className={
              'min-h-[44px] ' +
              (danger
                ? 'inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700'
                : 'btn-primary')
            }
          >
            {current.confirmLabel ?? (current.kind === 'alert' ? 'OK' : danger ? 'Yes, go ahead' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
