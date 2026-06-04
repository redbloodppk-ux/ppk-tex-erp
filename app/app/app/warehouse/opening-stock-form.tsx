'use client';
/**
 * Inline form to add an opening stock entry for the in-house warehouse.
 * Shown above the pivot table on each inhouse tab. The bucket prop
 * picks which key field is required:
 *   - warp_beam   → fabric quality
 *   - weft_yarn / porvai_yarn → yarn count
 *   - bobbin      → ends_per_bobbin (+ optional bobbin master link)
 * Saves to public.opening_stock with mode='inhouse'.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Bucket = 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin';

interface QualityOpt { id: number; code: string | null; name: string }
interface CountOpt   { id: number; code: string;        display_name: string | null }
interface BobbinMasterOpt { id: number; code: string; ends_per_bobbin: number | null }

interface Props {
  bucket: Bucket;
  qualities: QualityOpt[];
  counts: CountOpt[];
  bobbinMasters: BobbinMasterOpt[];
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function OpeningStockForm({ bucket, qualities, counts, bobbinMasters }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
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

  function reset(): void {
    setForm({
      fabric_quality_id: '', yarn_count_id: '', bobbin_id: '', ends_per_bobbin: '',
      quantity: '', open_date: todayISO(), reference_no: '', notes: '',
    });
  }

  async function save(): Promise<void> {
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) { window.alert('Enter a positive quantity.'); return; }
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
      mode: 'inhouse',
      fabric_quality_id: bucket === 'warp_beam' && form.fabric_quality_id !== '' ? Number(form.fabric_quality_id) : null,
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

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-mute">
          {bucket === 'warp_beam'  && 'In-house warp metre stock grouped by fabric quality. Opening balances flow as inflows into the pivot.'}
          {bucket === 'weft_yarn'  && 'In-house weft yarn stock grouped by yarn count.'}
          {bucket === 'porvai_yarn'&& 'In-house porvai yarn stock grouped by yarn count.'}
          {bucket === 'bobbin'     && 'In-house bobbin stock grouped by ends per bobbin.'}
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
              <label className="label text-xs">Fabric Quality *</label>
              <select
                className="input h-9 text-sm"
                value={form.fabric_quality_id}
                onChange={(e) => setForm({ ...form, fabric_quality_id: e.target.value })}
              >
                <option value="">--- select ---</option>
                {qualities.map((q) => (
                  <option key={q.id} value={q.id}>{q.code ?? '?'} - {q.name}</option>
                ))}
              </select>
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
    </div>
  );
}
