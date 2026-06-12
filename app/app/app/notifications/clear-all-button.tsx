'use client';
/**
 * "Clear all" for the notifications page. POSTs the clear marker and
 * refreshes the server-rendered list. Items reappear only when a NEW
 * event happens (new bill, new pending costing).
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

export function ClearAllButton({ disabled = false }: { disabled?: boolean }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<boolean>(false);

  async function clearAll(): Promise<void> {
    if (!window.confirm('Clear all current notifications? New events will appear again as they happen.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/notifications/clear', { method: 'POST' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void clearAll()}
      disabled={disabled || busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60 disabled:opacity-50"
      title="Hide everything currently listed. New events will appear again."
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      Clear all
    </button>
  );
}
