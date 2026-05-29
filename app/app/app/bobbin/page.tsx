'use client';
/**
 * Bobbin Master — catalogues every bobbin SKU (small warp beams) the
 * mill consumes. Code pattern is auto-suggested as `BB-{ends}-{metres}`
 * per the build guide; users can override if needed. vendor_id is a FK
 * to the mill table (legacy choice — the bobbin maker is registered as
 * a mill).
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2 } from 'lucide-react';

type RecordStatus = 'active' | 'inactive' | 'archived';

interface Bobbin {
  id: number;
  code: string;
  description: string;
  ends_per_bobbin: number;
  bobbin_metre: number;
  bobbin_price: number;
  loading_per_metre: number;
  reorder_pieces: number;
  is_lurex: boolean;
  vendor_id: number | null;
  status: RecordStatus;
  notes: string | null;
}

interface MillOption {
  id: number;
  code: string;
  name: string;
}

interface NewBobbin {
  code: string;
  description: string;
  ends_per_bobbin: string;
  bobbin_metre: string;
  bobbin_price: string;
  loading_per_metre: string;
  reorder_pieces: string;
  is_lurex: boolean;
  vendor_id: string;
  notes: string;
}

const EMPTY_NEW: NewBobbin = {
  code: '',
  description: '',
  ends_per_bobbin: '',
  bobbin_metre: '',
  bobbin_price: '0',
  loading_per_metre: '0',
  reorder_pieces: '0',
  is_lurex: false,
  vendor_id: '',
  notes: '',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function suggestBobbinCode(ends: number | null, metres: number | null): string {
  if (ends === null || metres === null) return '';
  return 'BB-' + String(ends) + '-' + String(metres);
}

export default function BobbinPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<Bobbin[]>([]);
  const [mills, setMills] = useState<MillOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewBobbin>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [bobbinRes, millRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('bobbin')
        .select(
          'id, code, description, ends_per_bobbin, bobbin_metre, bobbin_price, loading_per_metre, reorder_pieces, is_lurex, vendor_id, status, notes',
        )
        .neq('status', 'archived')
        .order('code'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('mill')
        .select('id, code, name')
        .neq('status', 'archived')
        .order('name'),
    ]);
    if (bobbinRes.error) {
      setError(bobbinRes.error.message);
    } else if (millRes.error) {
      setError(millRes.error.message);
    } else {
      setRows((bobbinRes.data ?? []) as unknown as Bobbin[]);
      setMills((millRes.data ?? []) as unknown as MillOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const codeSuggestion = useMemo<string>(() => {
    return suggestBobbinCode(toNumOrNull(neu.ends_per_bobbin), toNumOrNull(neu.bobbin_metre));
  }, [neu.ends_per_bobbin, neu.bobbin_metre]);

  async function handleAdd() {
    setError(null);
    setSavedMsg(null);

    const description = neu.description.trim();
    if (description === '') {
      setError('Enter a description (e.g. "60-ends x 200m cotton").');
      return;
    }
    const ends = toNumOrNull(neu.ends_per_bobbin);
    const metres = toNumOrNull(neu.bobbin_metre);
    if (ends === null || ends <= 0) {
      setError('Enter a positive ends-per-bobbin.');
      return;
    }
    if (metres === null || metres <= 0) {
      setError('Enter a positive bobbin length (metres).');
      return;
    }
    const code =
      neu.code.trim() === '' ? suggestBobbinCode(ends, metres) : neu.code.trim();
    if (rows.some((r) => r.code.toLowerCase() === code.toLowerCase())) {
      setError('Bobbin code "' + code + '" already exists.');
      return;
    }

    const price = toNumOrNull(neu.bobbin_price) ?? 0;
    const loading = toNumOrNull(neu.loading_per_metre) ?? 0;
    const reorder = toNumOrNull(neu.reorder_pieces) ?? 0;
    const vendorId = neu.vendor_id === '' ? null : Number(neu.vendor_id);

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('bobbin').insert({
      code,
      description,
      ends_per_bobbin: ends,
      bobbin_metre: metres,
      bobbin_price: price,
      loading_per_metre: loading,
      reorder_pieces: reorder,
      is_lurex: neu.is_lurex,
      vendor_id: vendorId,
      notes: neu.notes.trim() === '' ? null : neu.notes.trim(),
      status: 'active',
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg('Added bobbin ' + code + '.');
    await load();
  }

  async function updateRow(id: number, patch: Partial<Bobbin>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('bobbin')
      .update(patch)
      .eq('id', id);
    setBusyId(null);

    if (err) {
      setError(err.message);
      await load();
      return;
    }
    setSavedMsg('Saved.');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bobbin Stock"
        subtitle="Bobbins (small warp beams) tracked across main godown / at vendor / customer-owned. Code is auto-suggested as BB-{ends}-{metres}."
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a bobbin SKU</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="nb-ends">Ends per bobbin *</label>
            <input
              id="nb-ends"
              type="number"
              min={1}
              step="1"
              className="input num w-full"
              placeholder="60"
              value={neu.ends_per_bobbin}
              onChange={(e) => setNeu((n) => ({ ...n, ends_per_bobbin: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nb-metre">Length (m) *</label>
            <input
              id="nb-metre"
              type="number"
              min={0}
              step="0.01"
              className="input num w-full"
              placeholder="200"
              value={neu.bobbin_metre}
              onChange={(e) => setNeu((n) => ({ ...n, bobbin_metre: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nb-code">Code</label>
            <input
              id="nb-code"
              type="text"
              className="input w-full"
              placeholder={codeSuggestion || '(auto)'}
              value={neu.code}
              onChange={(e) => setNeu((n) => ({ ...n, code: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nb-price">Price (Rs/pc)</label>
            <input
              id="nb-price"
              type="number"
              min={0}
              step="0.01"
              className="input num w-full"
              value={neu.bobbin_price}
              onChange={(e) => setNeu((n) => ({ ...n, bobbin_price: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="nb-desc">Description *</label>
            <input
              id="nb-desc"
              type="text"
              className="input w-full"
              placeholder="60-ends x 200m cotton"
              value={neu.description}
              onChange={(e) => setNeu((n) => ({ ...n, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nb-load">Loading / m</label>
            <input
              id="nb-load"
              type="number"
              min={0}
              step="0.01"
              className="input num w-full"
              value={neu.loading_per_metre}
              onChange={(e) => setNeu((n) => ({ ...n, loading_per_metre: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nb-reorder">Reorder (pieces)</label>
            <input
              id="nb-reorder"
              type="number"
              min={0}
              step="1"
              className="input num w-full"
              value={neu.reorder_pieces}
              onChange={(e) => setNeu((n) => ({ ...n, reorder_pieces: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nb-vendor">Supplier (mill)</label>
            <select
              id="nb-vendor"
              className="input w-full"
              value={neu.vendor_id}
              onChange={(e) => setNeu((n) => ({ ...n, vendor_id: e.target.value }))}
            >
              <option value="">--- none ---</option>
              {mills.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.code} - {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={neu.is_lurex}
                onChange={(e) => setNeu((n) => ({ ...n, is_lurex: e.target.checked }))}
              />
              <span className="text-xs text-ink-soft">Lurex bobbin</span>
            </label>
          </div>
          <div className="md:col-span-3">
            <label className="label" htmlFor="nb-notes">Notes</label>
            <input
              id="nb-notes"
              type="text"
              className="input w-full"
              placeholder="(optional)"
              value={neu.notes}
              onChange={(e) => setNeu((n) => ({ ...n, notes: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={handleAdd}
            disabled={adding}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add bobbin
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading bobbins...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No bobbins yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Ends</th>
                  <th className="py-2 pr-3">Length (m)</th>
                  <th className="py-2 pr-3">Price Rs</th>
                  <th className="py-2 pr-3">Load/m</th>
                  <th className="py-2 pr-3">Reorder</th>
                  <th className="py-2 pr-3">Lurex</th>
                  <th className="py-2 pr-3">Supplier</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{b.code}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-56"
                        value={b.description}
                        onChange={(e) => updateRow(b.id, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={1}
                        step="1"
                        className="input num w-16"
                        value={b.ends_per_bobbin}
                        onChange={(e) =>
                          updateRow(b.id, { ends_per_bobbin: Number(e.target.value) || 1 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-20"
                        value={b.bobbin_metre}
                        onChange={(e) =>
                          updateRow(b.id, { bobbin_metre: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-20"
                        value={b.bobbin_price}
                        onChange={(e) =>
                          updateRow(b.id, { bobbin_price: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input num w-20"
                        value={b.loading_per_metre}
                        onChange={(e) =>
                          updateRow(b.id, { loading_per_metre: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        className="input num w-20"
                        value={b.reorder_pieces}
                        onChange={(e) =>
                          updateRow(b.id, { reorder_pieces: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={b.is_lurex}
                        onChange={(e) => updateRow(b.id, { is_lurex: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="input w-40"
                        value={b.vendor_id === null ? '' : String(b.vendor_id)}
                        onChange={(e) =>
                          updateRow(b.id, {
                            vendor_id: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      >
                        <option value="">--- none ---</option>
                        {mills.map((m) => (
                          <option key={m.id} value={String(m.id)}>
                            {m.code} - {m.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={b.status === 'active'}
                          onChange={(e) =>
                            updateRow(b.id, {
                              status: e.target.checked ? 'active' : 'inactive',
                            })
                          }
                        />
                        <span className="text-xs text-ink-soft">
                          {b.status === 'active' ? 'Yes' : 'No'}
                        </span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      {busyId === b.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
                      )}
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
