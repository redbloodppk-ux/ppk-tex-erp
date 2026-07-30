'use client';
/**
 * One row on the category management screen (/app/reminders/categories).
 * Inline rename (label only — key stays stable) and delete, both backed
 * by the server actions in app/app/reminders/categories/actions.ts.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check, Trash2, Pencil } from 'lucide-react';
import { renameCategory, deleteCategory } from '@/app/app/reminders/categories/actions';
import type { ReminderCategoryRow } from '@/lib/reminders/constants';

export function CategoryRowItem({ category }: { category: ReminderCategoryRow }): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<boolean>(false);
  const [label, setLabel] = useState<string>(category.label);
  const [err, setErr] = useState<string | null>(null);

  function handleSave(): void {
    setErr(null);
    startTransition(async () => {
      const res = await renameCategory(category.key, label);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function handleDelete(): void {
    setErr(null);
    const ok = window.confirm(`Delete category "${category.label}"?`);
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteCategory(category.key);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/60 bg-cloud/10 p-2.5">
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            className="input py-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
            disabled={pending}
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">{category.label}</span>
            {category.is_system && (
              <span className="pill bg-cloud/60 text-ink-mute border border-line">system</span>
            )}
            {!category.active && (
              <span className="pill bg-amber-50 text-amber-700 border border-amber-100">inactive</span>
            )}
          </div>
        )}
        {err && <p className="text-[10px] text-rose-600 mt-1">{err}</p>}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {editing ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-cloud/60"
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </button>
        )}
        {!category.is_system && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
