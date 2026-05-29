'use client';
/**
 * Reusable single-name master (id, code, name, active, notes) with
 * inline add + edit + delete. Used by ledger_type, ledger_group, and
 * any future master with the same shape.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2 } from 'lucide-react';

interface NameRow {
  id: number;
  code: string;
  name: string;
  active: boolean;
  notes: string | null;
}

export interface SimpleNameMasterProps {
  tableName: string;
  title: string;
  subtitle: string;
  itemLabel: string;
  codePlaceholder: string;
  crumbs?: Array<{ label: string; href?: string }>;
}

export function SimpleNameMaster({
  tableName, title, subtitle, itemLabel, codePlaceholder, crumbs,
}: SimpleNameMasterProps) {
  const supabase = createClient();

  const [rows, setRows] = useState<NameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from(tableName)
      .select('id, code, name, active, notes')
      .order('name');
    if (err) setError(err.message);
    else { setRows((data ?? []) as unknown as NameRow[]); setError(null); }
    setLoading(false);
  }, [supabase, tableName]);

  useEffect(() => { void load(); }, [load]);

  async function handleAdd() {
    setError(null); setSavedMsg(null);
    const name = newName.trim();
    if (name === '') { setError('Enter a ' + itemLabel + ' name.'); return; }
    if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      setError(itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1) + ' "' + name + '" already exists.');
      return;
    }
    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from(tableName).insert({
      name, active: true, notes: newNotes.trim() === '' ? null : newNotes.trim(),
    });
    setAdding(false);
    if (err) { setError(err.message); return; }
    setNewName(''); setNewNotes('');
    setSavedMsg('Added ' + name + '.');
    await load();
  }

  async function updateRow(id: number, patch: Partial<NameRow>) {
    setError(null); setSavedMsg(null); setBusyId(id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from(tableName).update(patch).eq('id', id);
    setBusyId(null);
    if (err) { setError(err.message); await load(); return; }
    setSavedMsg('Saved.');
  }

  async function deleteRow(id: number, name: string) {
    const ok = window.confirm('Delete ' + itemLabel + ' "' + name + '"?\n\nIf any ledger uses this, the database will block the delete.');
    if (ok === false) return;
    setError(null); setSavedMsg(null); setBusyId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from(tableName).delete().eq('id', id);
    setBusyId(null);
    if (err) {
      const archiveOk = window.confirm('Hard delete failed (' + err.message + ').\n\nMark inactive instead?');
      if (archiveOk) {
        await updateRow(id, { active: false });
        setSavedMsg('Marked inactive.');
      } else { setError(err.message); }
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + name + '.');
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} crumbs={crumbs} />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" /> {savedMsg}
        </p>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a {itemLabel}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Code</label>
            <div className="input num w-32 bg-cloud/40 text-ink-mute select-none">{codePlaceholder}</div>
          </div>
          <div className="min-w-[16rem] flex-1">
            <label className="label">Name *</label>
            <input className="input w-full" value={newName}
              onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[16rem]">
            <label className="label">Notes</label>
            <input className="input w-full" placeholder="(optional)" value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)} />
          </div>
          <button type="button" className="btn-primary flex items-center gap-1.5"
            onClick={handleAdd} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No {itemLabel}s yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3 w-32">Code</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3 w-24">Active</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-mono text-xs">{r.code}</td>
                    <td className="py-2 pr-3">
                      <input className="input w-full" value={r.name}
                        onChange={(e) => updateRow(r.id, { name: e.target.value })} />
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={r.active}
                          onChange={(e) => updateRow(r.id, { active: e.target.checked })} />
                        <span className="text-xs text-ink-soft">{r.active ? 'Yes' : 'No'}</span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <input className="input w-full" value={r.notes ?? ''}
                        onChange={(e) => updateRow(r.id, { notes: e.target.value === '' ? null : e.target.value })} />
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {busyId === r.id && <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />}
                        <button type="button" className="p-1 rounded hover:bg-red-50 text-red-600"
                          title="Delete" onClick={() => deleteRow(r.id, r.name)}
                          disabled={busyId === r.id}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
