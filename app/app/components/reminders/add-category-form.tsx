'use client';
/**
 * "Add category" form on the category management screen. Only the label
 * is entered — the server derives a stable `key` by slugifying it (see
 * createCategory in app/app/reminders/categories/actions.ts).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { createCategory } from '@/app/app/reminders/categories/actions';

export function AddCategoryForm(): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setErr(null);
    if (!label.trim()) {
      setErr('Enter a category name.');
      return;
    }
    startTransition(async () => {
      const res = await createCategory(label);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setLabel('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-2">
      <div className="flex-1">
        <input
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Loom maintenance, Yarn delivery"
          disabled={pending}
        />
        {err && <p className="text-[11px] text-rose-600 mt-1">{err}</p>}
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Add
      </button>
    </form>
  );
}
