'use client';
/**
 * Inline form to add (and now manage) opening stock entries for the
 * in-house warehouse or the sizing warehouse. Shown above the pivot
 * table on each tab.
 *
 * Bucket → key field:
 *   - warp_beam   → warp ends count (matches pavu.ends so opening
 *                   stock columns line up with pavu inflows)
 *   - weft_yarn / porvai_yarn → yarn count
 *   - bobbin      → ends_per_bobbin (+ optional bobbin master link)
 *
 * mode picks which warehouse the entry belongs to:
 *   - inhouse (default) → saves with mode='inhouse'
 *   - sizing            → saves with mode='sizing'
 *
 * Below the add form we now render a small list of existing opening
 * entries for the current bucket+mode, each with a delete button.
 * Delete is a soft delete (status='deleted') so audit history stays
 * intact while the pivot drops the row immediately on refresh.
 *
 * Both write to public.opening_stock. The Warehouse pivot loaders pick
 * the rows up via the (bucket, mode) index.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Bucket = 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin';

interface QualityOpt { id: number; code: string | null; name: string }
interface CountOpt   { id: number; code: string;        display_name: string | null }
interface BobbinMasterOpt { id: number; code: string; ends_per_bobbin: number | null }

export interface ExistingOpeningRow {
  id: number;
  bucket: Bucket;
  fabric_quality_id: number | null;
  yarn_count_id: number | null;
  bobbin_id: number | null;
  ends_per_bobbin: number | null;
  warp_ends: number | null;
  quantity: number | string | null;
  unit: string | null;
  open_date: string | null;
  reference_no: string | null;
  notes: string | null;
}

interface Props {
  bucket: Bucket;
  qualities: QualityOpt[];
  counts: CountOpt[];
  bobbinMasters: BobbinMasterOpt[];
  /** Existing opening entries for the current (bucket, mode). Rendered
   *  inline below the add form with a delete button per row. */
  existing?: ExistingOpeningRow[];
  /** 'inhouse' (default) or 'sizing'. The save payload's `mode` column
   *  is set from this value so the right warehouse loader picks up the
   *  row. Sizing warehouse uses bucket='weft_yarn' for yarn-by-count
   *  opening stock. */
  mode?: 'inhouse' | 'sizing';
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtQty(qty: number | string | null, unit: string | null): string {
  const n = Number(qty ?? 0);
  if (!Number.isFinite(n)) return '0';
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit ?? ''}`.trim();
}

function describeRow(
  r: ExistingOpeningRow,
  qualityById: Map<number, QualityOpt>,
  countById: Map<number, CountOpt>,
  bobbinById: Map<number, BobbinMasterOpt>,
): string {
  if (r.bucket === 'warp_beam') {
    if (r.warp_ends != null) return `${r.warp_ends} ends`;
    if (r.fabric_quality_id != null) {
      const q = qualityById.get(r.fabric_quality_id);
      return q ? `${q.code ?? '?'} · ${q.name}` : `Quality #${r.fabric_quality_id}`;
    }
    return '(no key)';
  }
  if (r.bucket === 'weft_yarn' || r.bucket === 'porvai_yarn') {
    if (r.yarn_count_id != null) {
      const c = countById.get(r.yarn_count_id);
      return c ? `${c.code} · ${c.display_name ?? ''}` : `Count #${r.yarn_count_id}`;
    }
    return '(no key)';
  }
  if (r.bucket === 'bobbin') {
    const ends = r.ends_per_bobbin
      ?? (r.bobbin_id != null ? (bobbinById.get(r.bobbin_id)?.ends_per_bobbin ?? null) : null);
    if (ends != null) return `${ends} ends/bobbin`;
    return '(no key)';
  }
  return '(no key)';
}

export function OpeningStockForm({
  bucket,
  qualities,
  counts,
  bobbinMasters,
  existing = [],
  mode = 'inhouse',
}: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    warp_ends: '',
    fabric_quality_id: '',
    yarn_count_id: '',
    bobbin_id: '',
    ends_per_bobbin: '',
    quantity: '',
    open_date: todayISO(),
    reference_no: '',
    notes: '',
  });

  const unit: 'm' | 'kg' | 'pcs' = bucket === 'warp_beam' ? 'm' : (bucket === 'bobbin' ? 'm' : 'kg');

  const qualityById = new Map(qualities.map((q) => [q.id, q]));
  const countById   = new Map(counts.map((c) => [c.id, c]));
  const bobbinById  = new Map(bobbinMasters.map((b) => [b.id, b]));

  function reset(): void {
    setForm({
      warp_ends: '', fabric_quality_id: '', yarn_count_id: '', bobbin_id: '', ends_per_bobbin: '',
      quantity: '', open_date: todayISO(), reference_no: '', notes: '',
    });
  }

  async function save(): Promise<void> {
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) { window.alert('Enter a positive quantity.'); return; }

    // Bucket-specific key validation.
    if (bucket === 'warp_beam') {
      const ends = Number(form.warp_ends);
      if (!Number.isFinite(ends) || ends <= 0) {
        window.alert('Enter a positive warp ends count (e.g. 2400, 3600, 5000).');
        return;
      }
    }
    if ((bucket === 'weft_yarn' || bucket === 'porvai_yarn') && form.yarn_count_id === '') {
      window.alert('Pick a yarn count.');
      return;
    }
    if (bucket === 'bobbin') {
      const ends = Number(form.ends_per_bobbin);
      if (!Number.isFinite(ends) || ends <= 0) {
        window.alert('Enter a positive ends-per-bobbin value.');
        return;
      }
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Resolve ends_per_bobbin from selected bobbin master if user didn't
    // type one explicitly.
    let endsPerBobbin: number | null = form.ends_per_bobbin === '' ? null : Number(form.ends_per_bobbin);
    if (bucket === 'bobbin' && endsPerBobbin === null && form.bobbin_id !== '') {
      const bm = bobbinMasters.find((b) => b.id === Number(form.bobbin_id));
      if (bm?.ends_per_bobbin != null) endsPerBobbin = bm.ends_per_bobbin;
    }
    const payload = {
      bucket,
      mode,
      // warp_beam now keys on warp_ends — fabric_quality_id is intentionally
      // left null for new entries so the pivot column lines up with pavu
      // inflows.
      warp_ends:         bucket === 'warp_beam' && form.warp_ends !== '' ? Number(form.warp_ends) : null,
      fabric_quality_id: null,
      yarn_count_id:     (bucket === 'weft_yarn' || bucket === 'porvai_yarn') && form.yarn_count_id !== '' ? Number(form.yarn_count_id) : null,
      bobbin_id:         bucket === 'bobbin' && form.bobbin_id !== '' ? Number(form.bobbin_id) : null,
      ends_per_bobbin:   bucket === 'bobbin' ? endsPerBobbin : null,
      quantity: qty,
      unit,
      open_date: form.open_date || todayISO(),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      status: 'active',
    };
    const { error } = await sb.from('opening_stock').insert(payload);
    setBusy(false);
    if (error) { window.alert('Save failed: ' + error.message); return; }
    reset();
    setOpen(false);
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

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-mute">
          {mode === 'sizing'
            ? 'Sizing warehouse yarn stock grouped by yarn count. Opening balances appear as inflows on the pivot.'
            : (
              <>
                {bucket === 'warp_beam'  && 'In-house warp metre stock grouped by warp ends. Opening balances flow as inflows into the pivot — same column as the matching pavu inflows.'}
                {bucket === 'weft_yarn'  && 'In-house weft yarn stock grouped by yarn count.'}
                {bucket === 'porvai_yarn'&& 'In-house porvai yarn stock grouped by yarn count.'}
                {bucket === 'bobbin'     && 'In-house bobbin stock grouped by ends per bobbin.'}
              </>
            )}
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
        <div className="card p-3 mt-2 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label text-xs">Open date *</label>
            <input
              type="date"
              className="input h-9 text-sm"
              value={form.open_date}
              onChange={(e) => setForm({ ...form, open_date: e.target.value })}
            />
          </div>

          {bucket === 'warp_beam' && (
            <div>
              <label className="label text-xs">Warp Ends *</label>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                placeholder="e.g. 2400"
                className="input num h-9 text-sm"
                value={form.warp_ends}
                onChange={(e) => setForm({ ...form, warp_ends: e.target.value })}
              />
              <p className="text-[10px] text-ink-mute mt-1">
                Matches pavu.ends so opening stock sits in the same column as pavu inflows.
              </p>
            </div>
          )}

          {(bucket === 'weft_yarn' || bucket === 'porvai_yarn') && (
            <div>
              <label className="label text-xs">Yarn Count *</label>
              <select
                className="input h-9 text-sm"
                value={form.yarn_count_id}
                onChange={(e) => setForm({ ...form, yarn_count_id: e.target.value })}
              >
                <option value="">--- select ---</option>
                {counts.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} - {c.display_name ?? ''}</option>
                ))}
              </select>
            </div>
          )}

          {bucket === 'bobbin' && (
            <>
              <div>
                <label className="label text-xs">Bobbin master</label>
                <select
                  className="input h-9 text-sm"
                  value={form.bobbin_id}
                  onChange={(e) => {
                    const bid = e.target.value;
                    setForm((f) => {
                      const next = { ...f, bobbin_id: bid };
                      const bm = bobbinMasters.find((b) => b.id === Number(bid));
                      if (bm?.ends_per_bobbin != null) next.ends_per_bobbin = String(bm.ends_per_bobbin);
                      return next;
                    });
                  }}
                >
                  <option value="">---</option>
                  {bobbinMasters.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} {b.ends_per_bobbin ? `· ${b.ends_per_bobbin} ends` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs">Ends per bobbin *</label>
                <input
                  type="number"
                  className="input num h-9 text-sm"
                  value={form.ends_per_bobbin}
                  onChange={(e) => setForm({ ...form, ends_per_bobbin: e.target.value })}
                />
              </div>
            </>
          )}

          <div>
            <label className="label text-xs">Quantity ({unit}) *</label>
            <input
              type="number"
              step={unit === 'kg' ? 0.001 : 0.01}
              className="input num h-9 text-sm"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>

          <div>
            <label className="label text-xs">Reference</label>
            <input
              className="input h-9 text-sm"
              value={form.reference_no}
              onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
              placeholder="e.g. opening 1 Apr 2026"
            />
          </div>

          <div className="md:col-span-2">
            <label className="label text-xs">Notes</label>
            <input
              className="input h-9 text-sm"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="md:col-span-4 flex justify-end gap-2">
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
              Save opening stock
            </button>
          </div>
        </div>
      )}

      {existing.length > 0 && (
        <div className="card mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-2">Date</th>
                <th className="text-left  px-3 py-2">Key</th>
                <th className="text-right px-3 py-2">Quantity</th>
                <th className="text-left  px-3 py-2">Reference</th>
                <th className="text-left  px-3 py-2">Notes</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {existing.map((r) => {
                const label = describeRow(r, qualityById, countById, bobbinById);
                const isDeleting = deletingId === r.id;
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{r.open_date ?? '—'}</td>
                    <td className="px-3 py-2 font-medium">{label}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtQty(r.quantity, r.unit)}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.reference_no ?? ''}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.notes ?? ''}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove(r.id, label)}
                        disabled={isDeleting}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-50"
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
            Delete soft-deletes the row (status=&apos;deleted&apos;) so the audit history stays intact but the pivot drops it.
          </p>
        </div>
      )}
    </div>
  );
}
