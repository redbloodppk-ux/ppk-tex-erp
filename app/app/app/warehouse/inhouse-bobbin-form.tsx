'use client';
/**
 * In-house bobbin opening stock form — multi-item.
 *
 * Mirrors the Job Work → Bobbin given form layout: shared
 * date/reference/notes once at the top, then a list of line items
 * (Bobbin from master + Qty in pieces + editable M/pc + Total m).
 * One Save inserts N opening_stock rows in a single batch.
 *
 * Each line writes:
 *   bucket            = 'bobbin'
 *   mode              = 'inhouse'
 *   bobbin_id         = picked bobbin master id
 *   ends_per_bobbin   = ends from the bobbin master
 *   quantity          = pcs × m/pc  (stored in METRES, matching the
 *                       in-house bobbin pivot column unit)
 *   unit              = 'm'
 *
 * Below the form, existing opening entries (for bucket='bobbin',
 * mode='inhouse', status='active') are listed with a Delete button.
 * Delete is a soft-delete (status='deleted').
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X, Trash2, Pencil, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { ExistingOpeningRow, BobbinEndsOpt } from './opening-stock-form';

export interface InhouseBobbinMasterOpt {
  id: number;
  code: string;
  ends_per_bobbin: number;
  bobbin_metre: number | null;
  is_lurex: boolean;
}

interface Props {
  /** Active bobbin master rows filtered to production_mode='inhouse'.
   *  Drives the per-line Bobbin dropdown so the operator picks from a
   *  known catalog instead of typing ends + metres. */
  bobbins: InhouseBobbinMasterOpt[];
  /** Existing opening entries for bucket='bobbin', mode='inhouse'.
   *  Rendered inline below the form with a delete button per row. */
  existing?: ExistingOpeningRow[];
}

/** Inline-edit state for an existing opening_stock row. The bobbin
 *  itself is locked (changing it would change the row's identity);
 *  the operator can correct date / quantity / reference / notes. */
interface EditForm {
  open_date: string;
  quantity: string;
  reference_no: string;
  notes: string;
}

interface AddItem {
  bobbin_id: string;
  qty_pcs: string;
  /** Per-piece metres; prefills from the picked bobbin master but is
   *  editable so partial bobbins / short pieces can be entered. The
   *  bobbin master row's m/pc is NOT changed by this field. */
  metre_per_pc: string;
  /** Total metres. Auto-fills from qty_pcs × metre_per_pc whenever
   *  both are entered, but is fully editable — the operator can type
   *  total metres directly (e.g. for a partial bobbin where neither
   *  pcs nor m/pc is clean) and that value is what gets stored. */
  total_metre: string;
  /** True once the user has manually typed total_metre. Prevents
   *  the auto-fill from clobbering their value if they later edit
   *  qty / m/pc. */
  total_metre_dirty: boolean;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeEmptyItem(): AddItem {
  return { bobbin_id: '', qty_pcs: '', metre_per_pc: '', total_metre: '', total_metre_dirty: false };
}

/** Recompute the auto-filled total_metre when qty or m/pc changes,
 *  unless the operator has typed total_metre by hand. */
function recomputeTotal(it: AddItem): AddItem {
  if (it.total_metre_dirty) return it;
  const q = Number(it.qty_pcs);
  const m = Number(it.metre_per_pc);
  if (q > 0 && m > 0) {
    const t = Math.round(q * m * 100) / 100;
    return { ...it, total_metre: String(t) };
  }
  return { ...it, total_metre: '' };
}

function fmtQty(qty: number | string | null, unit: string | null): string {
  const n = Number(qty ?? 0);
  if (!Number.isFinite(n)) return '0';
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit ?? ''}`.trim();
}

export function InhouseBobbinOpeningStockForm({
  bobbins,
  existing = [],
}: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    open_date: '',
    quantity: '',
    reference_no: '',
    notes: '',
  });
  const [savingEditId, setSavingEditId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const [form, setForm] = useState<{
    open_date: string;
    reference_no: string;
    notes: string;
    items: AddItem[];
  }>({
    open_date: todayISO(),
    reference_no: '',
    notes: '',
    items: [makeEmptyItem()],
  });

  function reset(): void {
    setForm({
      open_date: todayISO(),
      reference_no: '',
      notes: '',
      items: [makeEmptyItem()],
    });
  }

  function addItemRow(): void {
    setForm((f) => ({ ...f, items: [...f.items, makeEmptyItem()] }));
  }
  function removeItemRow(idx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items,
    }));
  }
  function patchItem(idx: number, patch: Partial<AddItem>): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? recomputeTotal({ ...it, ...patch }) : it)),
    }));
  }
  /** When the operator types total_metre by hand, set the dirty flag
   *  so subsequent qty / m/pc edits don't overwrite the typed value. */
  function setTotalMetre(idx: number, val: string): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) =>
        i === idx ? { ...it, total_metre: val, total_metre_dirty: true } : it,
      ),
    }));
  }
  /** When the operator picks a bobbin, prefill metre_per_pc from the
   *  bobbin master. They can still override the prefilled value. */
  function pickBobbinForItem(idx: number, bobbinId: string): void {
    const bm = bobbinId === '' ? null : bobbins.find((b) => b.id === Number(bobbinId)) ?? null;
    const prefill = bm?.bobbin_metre != null ? String(bm.bobbin_metre) : '';
    patchItem(idx, { bobbin_id: bobbinId, metre_per_pc: prefill });
  }

  async function save(): Promise<void> {
    if (!form.open_date) { window.alert('Open date is required.'); return; }
    // A line is valid when a bobbin is picked AND total_metre resolves
    // to a positive number (either typed directly or auto-computed
    // from qty × m/pc).
    const validItems = form.items.filter(
      (it) => it.bobbin_id !== '' && Number(it.total_metre) > 0,
    );
    if (validItems.length === 0) {
      window.alert('Pick a bobbin and enter total metres (or qty + m/pc) > 0 for at least one line.');
      return;
    }
    // Catch half-filled lines so the operator doesn't silently lose
    // typed data.
    const badIdx = form.items.findIndex(
      (it) => it.bobbin_id !== '' && !(Number(it.total_metre) > 0),
    );
    if (badIdx !== -1) {
      window.alert(`Line ${badIdx + 1}: enter total metres directly, or enter qty (pcs) and m/pc so total metres > 0.`);
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payloads = validItems.map((it) => {
      const bm = bobbins.find((b) => b.id === Number(it.bobbin_id));
      const totalMetres = Math.round(Number(it.total_metre) * 100) / 100;
      return {
        bucket: 'bobbin',
        mode: 'inhouse',
        bobbin_id: Number(it.bobbin_id),
        ends_per_bobbin: bm?.ends_per_bobbin ?? null,
        // opening_stock stores the in-house bobbin balance in METRES
        // because the warehouse pivot uses metres as the column unit.
        quantity: totalMetres,
        unit: 'm',
        open_date: form.open_date,
        reference_no: form.reference_no.trim() || null,
        notes: form.notes.trim() || null,
        status: 'active',
        warp_ends: null,
        yarn_count_id: null,
        fabric_quality_id: null,
      };
    });
    const { error } = await sb.from('opening_stock').insert(payloads);
    setBusy(false);
    if (error) { window.alert('Save failed: ' + error.message); return; }
    reset();
    setOpen(false);
    startTransition(() => router.refresh());
  }

  function startEdit(row: ExistingOpeningRow): void {
    setEditingId(row.id);
    setEditForm({
      open_date:    row.open_date ?? '',
      quantity:     row.quantity == null ? '' : String(row.quantity),
      reference_no: row.reference_no ?? '',
      notes:        row.notes ?? '',
    });
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditForm({ open_date: '', quantity: '', reference_no: '', notes: '' });
  }

  async function saveEdit(id: number): Promise<void> {
    const qty = Number(editForm.quantity);
    if (!editForm.open_date) { window.alert('Open date is required.'); return; }
    if (!(qty > 0)) { window.alert('Quantity (m) must be greater than 0.'); return; }
    setSavingEditId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb
      .from('opening_stock')
      .update({
        open_date:    editForm.open_date,
        quantity:     Math.round(qty * 100) / 100,
        reference_no: editForm.reference_no.trim() || null,
        notes:        editForm.notes.trim() || null,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', id);
    setSavingEditId(null);
    if (error) { window.alert('Save failed: ' + error.message); return; }
    cancelEdit();
    startTransition(() => router.refresh());
  }

  async function remove(id: number, label: string): Promise<void> {
    if (!window.confirm(`Delete opening stock entry "${label}"?\n\nThis removes it from the warehouse pivot. The row stays in the database as status='deleted' for audit.`)) {
      return;
    }
    setDeletingId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb
      .from('opening_stock')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('id', id);
    setDeletingId(null);
    if (error) { window.alert('Delete failed: ' + error.message); return; }
    startTransition(() => router.refresh());
  }

  const bobbinById = new Map(bobbins.map((b) => [b.id, b]));

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-mute">
          In-house bobbin stock grouped by ends per bobbin. Each line below becomes one opening stock entry.
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-primary text-xs"
        >
          {open ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {open ? 'Cancel' : 'Add opening stock'}
        </button>
      </div>

      {open && (
        <div className="card p-3 mt-2 space-y-3">
          {/* Top section — shared across every line in this submission */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label text-xs">Open date *</label>
              <input
                type="date"
                className="input h-9 text-sm"
                value={form.open_date}
                onChange={(e) => setForm({ ...form, open_date: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <label className="label text-xs">Reference (optional)</label>
              <input
                className="input h-9 text-sm"
                placeholder="e.g. opening 1 Apr 2026"
                value={form.reference_no}
                onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
              />
            </div>
            <div className="md:col-span-4">
              <label className="label text-xs">Notes</label>
              <input
                className="input h-9 text-sm"
                placeholder="(applies to every line below)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="border border-line/40 rounded-md overflow-hidden">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-12" />
              </colgroup>
              <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Bobbin *</th>
                  <th className="px-2 py-2 text-right">Qty (pcs) *</th>
                  <th className="px-2 py-2 text-right">M/pc</th>
                  <th className="px-2 py-2 text-right">Total m</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, idx) => {
                  const bm = it.bobbin_id === '' ? null : bobbinById.get(Number(it.bobbin_id)) ?? null;
                  return (
                    <tr key={idx} className="border-t border-line/40 align-middle">
                      <td className="px-2 py-1.5 text-ink-mute">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <select
                          className="input h-8 text-xs w-full"
                          value={it.bobbin_id}
                          onChange={(e) => pickBobbinForItem(idx, e.target.value)}
                        >
                          <option value="">--- pick ---</option>
                          {bobbins.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.code} ({b.ends_per_bobbin} ends{b.is_lurex ? ' · lurex' : ''})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={1}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.qty_pcs}
                          onChange={(e) => patchItem(idx, { qty_pcs: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.metre_per_pc}
                          placeholder={bm?.bobbin_metre != null ? String(bm.bobbin_metre) : ''}
                          onChange={(e) => patchItem(idx, { metre_per_pc: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className={
                            'input num h-8 text-xs w-full text-right font-semibold ' +
                            (it.total_metre_dirty ? 'bg-amber-50' : '')
                          }
                          value={it.total_metre}
                          placeholder="auto"
                          onChange={(e) => setTotalMetre(idx, e.target.value)}
                          title={
                            it.total_metre_dirty
                              ? 'Typed by hand — qty / m/pc edits will not overwrite this'
                              : 'Auto = qty × m/pc. Type a value to override.'
                          }
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          disabled={form.items.length === 1}
                          title="Remove line"
                          className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-cloud/30 border-t border-line/40">
                <tr>
                  <td colSpan={4} className="px-2 py-2">
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="text-xs text-indigo-700 inline-flex items-center gap-1 hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add line
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right num text-xs font-semibold">
                    {(() => {
                      const grand = form.items.reduce((s, it) => {
                        const t = Number(it.total_metre || 0);
                        return s + (t > 0 ? t : 0);
                      }, 0);
                      return grand > 0 ? grand.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' m' : '—';
                    })()}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-[10px] text-ink-mute">
            Bobbins are managed in Settings &rarr; Bobbin Master (only in-house bobbins shown here). M/pc prefills from the bobbin master when you pick a bobbin, but you can override it for partial bobbins or short pieces — the master value is not changed.
            Total m auto-fills from Qty &times; M/pc; type a value to override (cell turns amber) for partial bobbins or short pieces where neither qty nor m/pc is clean. The Total m value is what gets saved to opening stock.
          </p>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="btn-primary text-xs"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Save all
            </button>
          </div>
        </div>
      )}

      {/* Existing entries (with delete) */}
      {existing.length > 0 && (
        <div className="card mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-2">Date</th>
                <th className="text-left  px-3 py-2">Bobbin</th>
                <th className="text-right px-3 py-2">Quantity (m)</th>
                <th className="text-left  px-3 py-2">Reference</th>
                <th className="text-left  px-3 py-2">Notes</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {existing.map((r) => {
                const bm = r.bobbin_id != null ? bobbinById.get(r.bobbin_id) : null;
                const ends = r.ends_per_bobbin ?? (bm?.ends_per_bobbin ?? null);
                const label = bm
                  ? `${bm.code} (${ends ?? bm.ends_per_bobbin} ends)`
                  : ends != null
                    ? `${ends} ends/bobbin`
                    : '(no bobbin link)';
                const isDeleting = deletingId === r.id;
                const isEditing  = editingId === r.id;
                const isSaving   = savingEditId === r.id;
                if (isEditing) {
                  return (
                    <tr key={r.id} className="border-t border-line/40 bg-amber-50/40">
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          className="input h-8 text-xs"
                          value={editForm.open_date}
                          onChange={(e) => setEditForm({ ...editForm, open_date: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-ink-soft">
                        {label}
                        <div className="text-[10px] text-ink-mute">bobbin locked</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="input num h-8 text-xs text-right w-28 inline-block"
                          value={editForm.quantity}
                          onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                        />
                        <span className="text-[10px] text-ink-mute ml-1">m</span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="input h-8 text-xs w-full"
                          value={editForm.reference_no}
                          onChange={(e) => setEditForm({ ...editForm, reference_no: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="input h-8 text-xs w-full"
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => saveEdit(r.id)}
                          disabled={isSaving}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          title="Save changes"
                        >
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-ink-soft hover:bg-haze ml-1 disabled:opacity-50"
                          title="Discard changes"
                        >
                          <X className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{r.open_date ?? '—'}</td>
                    <td className="px-3 py-2 font-medium">{label}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtQty(r.quantity, r.unit)}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.reference_no ?? ''}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.notes ?? ''}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        disabled={editingId !== null || isDeleting}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-indigo-700 hover:bg-indigo-50 disabled:opacity-30"
                        title="Edit opening entry"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r.id, label)}
                        disabled={isDeleting || editingId !== null}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-rose-600 hover:bg-rose-50 ml-1 disabled:opacity-50"
                        title="Delete opening entry"
                      >
                        {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-ink-mute px-3 py-2 border-t border-line/40">
            Edit updates the row in place (date, quantity, reference, notes). The bobbin itself is locked once saved — delete and re-add if you picked the wrong bobbin. Delete soft-deletes the row (status=&apos;deleted&apos;) so the audit history stays intact but the pivot drops it.
          </p>
        </div>
      )}
    </div>
  );
}

// Silence the unused-import warning when consumers don't pass
// BobbinEndsOpt (the form doesn't need it directly).
export type { BobbinEndsOpt };
