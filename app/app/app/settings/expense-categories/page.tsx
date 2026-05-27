'use client';
/**
 * Expense Categories — manage the category list used on the Expenses page.
 *
 * Add a new category, rename an existing one, or toggle is_active so it
 * disappears from the expense entry dropdown without deleting historical
 * rows. Hard delete is offered for categories that have never been used.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, Trash2 } from 'lucide-react';

interface ExpenseCategory {
  id: number;
  name: string;
  is_active: boolean;
}

export default function ExpenseCategoriesPage(): React.ReactElement {
  const supabase = createClient();

  const [rows, setRows] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: dbErr } = await (supabase as any)
      .from('expense_category')
      .select('id, name, is_active')
      .order('name');
    if (dbErr) setError(dbErr.message);
    else setRows((data ?? []) as unknown as ExpenseCategory[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(): Promise<void> {
    const name = newName.trim();
    if (!name) {
      setError('Category name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbErr } = await (supabase as any)
      .from('expense_category')
      .insert([{ name } as never]);
    setBusy(false);
    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    setNewName('');
    void load();
  }

  async function rename(id: number, name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbErr } = await (supabase as any)
      .from('expense_category')
      .update({ name: clean } as never)
      .eq('id', id);
    if (dbErr) setError(dbErr.message);
    void load();
  }

  async function toggleActive(id: number, next: boolean): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbErr } = await (supabase as any)
      .from('expense_category')
      .update({ is_active: next } as never)
      .eq('id', id);
    if (dbErr) setError(dbErr.message);
    void load();
  }

  async function hardDelete(id: number, name: string): Promise<void> {
    const ok = window.confirm(
      `Delete category "${name}"? This only works if it has never been used in an expense entry.`,
    );
    if (!ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbErr } = await (supabase as any)
      .from('expense_category')
      .delete()
      .eq('id', id);
    if (dbErr) {
      setError(
        dbErr.message.includes('foreign key') || dbErr.message.includes('still referenced')
          ? 'This category is used by existing expenses — set Inactive instead.'
          : dbErr.message,
      );
      return;
    }
    void load();
  }

  return (
    <div>
      <PageHeader
        title="Expense Categories"
        subtitle="Categories used on the Expenses page. Add new ones, rename existing ones, or mark inactive to hide from the entry form without losing history."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Expense Categories' }]}
      />

      <div className="card p-4 max-w-xl mb-6">
        <label className="label" htmlFor="newCategory">Add new category</label>
        <div className="flex gap-2">
          <input
            id="newCategory"
            className="input flex-1"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Welding, Painting, Transport"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleAdd()}
            disabled={busy}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
        {error && <p className="text-sm text-err mt-2">{error}</p>}
      </div>

      <div className="card overflow-hidden max-w-xl">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Active</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-ink-mute">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-ink-mute">
                  No categories yet. Add one above.
                </td>
              </tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40">
                <td className="px-4 py-2">
                  <input
                    className="input"
                    defaultValue={r.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== r.name) {
                        void rename(r.id, e.target.value);
                      }
                    }}
                  />
                </td>
                <td className="px-4 py-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.is_active}
                      onChange={(e) => void toggleActive(r.id, e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span className="text-xs text-ink-soft">
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void hardDelete(r.id, r.name)}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    title="Permanently delete (only if never used)"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
