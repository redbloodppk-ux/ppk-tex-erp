'use client';
/**
 * Small confirm-then-delete button used in the loans list table.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { deleteEmployeeLoan } from './actions';

interface DeleteLoanButtonProps {
  id: number;
  label?: string;
}

export function DeleteLoanButton({ id, label }: DeleteLoanButtonProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClick(): void {
    setErr(null);
    const ok = window.confirm(
      `Delete this loan${label ? ` (${label})` : ''}? This cannot be undone.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteEmployeeLoan(id);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        title="Delete this loan"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Delete
      </button>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </div>
  );
}
