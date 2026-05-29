'use client';
/**
 * Mill Master — catalogues the spinning mills the business buys yarn
 * from. Auto-generates ML-{NNNN} codes when left blank. Backs the
 * yarn lots / counts screens via mill_id FK.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Star } from 'lucide-react';

interface Mill {
  id: number;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  is_preferred: boolean;
  status: 'active' | 'inactive' | 'archived';
  notes: string | null;
}

interface NewMill {
  code: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  gstin: string;
  city: string;
  state: string;
  notes: string;
}

const EMPTY_NEW: NewMill = {
  code: '',
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  gstin: '',
  city: '',
  state: '',
  notes: '',
};

function nextMillCode(existing: Mill[]): string {
  const used: number[] = existing
    .map((m) => /^ML-(\d{4})$/.exec(m.code)?.[1])
    .filter((s): s is string => s != null)
    .map((s) => Number(s));
  const max = used.length === 0 ? 0 : Math.max(...used);
  return 'ML-' + String(max + 1).padStart(4, '0');
}

function nullIfBlank(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

export default function MillsPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<Mill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewMill>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('mill')
      .select(
        'id, code, name, contact_person, phone, email, gstin, address, city, state, is_preferred, status, notes',
      )
      .neq('status', 'archived')
      .order('code');
    if (err) {
      setError(err.message);
    } else {
      setRows((data ?? []) as unknown as Mill[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    setError(null);
    setSavedMsg(null);

    const name = neu.name.trim();
    if (name === '') {
      setError('Enter a mill name.');
      return;
    }
    const code = neu.code.trim() === '' ? nextMillCode(rows) : neu.code.trim();
    if (rows.some((m) => m.code.toLowerCase() === code.toLowerCase())) {
      setError(`Mill code "${code}" already exists.`);
      return;
    }

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('mill').insert({
      code,
      name,
      contact_person: nullIfBlank(neu.contact_person),
      phone: nullIfBlank(neu.phone),
      email: nullIfBlank(neu.email),
      gstin: nullIfBlank(neu.gstin),
      city: nullIfBlank(neu.city),
      state: nullIfBlank(neu.state),
      notes: nullIfBlank(neu.notes),
      is_preferred: false,
      status: 'active',
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg(`Added mill ${code}.`);
    await load();
  }

  async function updateRow(id: number, patch: Partial<Mill>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('mill')
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
        title="Mills"
        subtitle="Spinning mills you buy yarn from. Code is auto-assigned (ML-NNNN) if left blank."
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a mill</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="nm-code">Code</label>
            <input
              id="nm-code"
              type="text"
              className="input w-full"
              placeholder="(auto)"
              value={neu.code}
              onChange={(e) => setNeu((n) => ({ ...n, code: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="nm-name">Mill name *</label>
            <input
              id="nm-name"
              type="text"
              className="input w-full"
              placeholder="Sri Ganapathi Mills Pvt Ltd"
              value={neu.name}
              onChange={(e) => setNeu((n) => ({ ...n, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nm-cp">Contact person</label>
            <input
              id="nm-cp"
              type="text"
              className="input w-full"
              value={neu.contact_person}
              onChange={(e) => setNeu((n) => ({ ...n, contact_person: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nm-phone">Phone</label>
            <input
              id="nm-phone"
              type="text"
              className="input w-full"
              placeholder="+91…"
              value={neu.phone}
              onChange={(e) => setNeu((n) => ({ ...n, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nm-email">Email</label>
            <input
              id="nm-email"
              type="email"
              className="input w-full"
              value={neu.email}
              onChange={(e) => setNeu((n) => ({ ...n, email: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nm-gstin">GSTIN</label>
            <input
              id="nm-gstin"
              type="text"
              className="input w-full"
              value={neu.gstin}
              onChange={(e) => setNeu((n) => ({ ...n, gstin: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nm-city">City</label>
            <input
              id="nm-city"
              type="text"
              className="input w-full"
              value={neu.city}
              onChange={(e) => setNeu((n) => ({ ...n, city: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nm-state">State</label>
            <input
              id="nm-state"
              type="text"
              className="input w-full"
              value={neu.state}
              onChange={(e) => setNeu((n) => ({ ...n, state: e.target.value }))}
            />
          </div>
          <div className="md:col-span-3">
            <label className="label" htmlFor="nm-notes">Notes</label>
            <input
              id="nm-notes"
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
            Add mill
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading mills…
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No mills yet. Add your first one above.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Contact</th>
                  <th className="py-2 pr-3">Phone</th>
                  <th className="py-2 pr-3">GSTIN</th>
                  <th className="py-2 pr-3">City</th>
                  <th className="py-2 pr-3">Preferred</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{m.code}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-56"
                        value={m.name}
                        onChange={(e) => updateRow(m.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-40"
                        value={m.contact_person ?? ''}
                        onChange={(e) =>
                          updateRow(m.id, { contact_person: nullIfBlank(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-32"
                        value={m.phone ?? ''}
                        onChange={(e) =>
                          updateRow(m.id, { phone: nullIfBlank(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-36"
                        value={m.gstin ?? ''}
                        onChange={(e) =>
                          updateRow(m.id, { gstin: nullIfBlank(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-28"
                        value={m.city ?? ''}
                        onChange={(e) =>
                          updateRow(m.id, { city: nullIfBlank(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs"
                        onClick={() => updateRow(m.id, { is_preferred: !m.is_preferred })}
                        title={m.is_preferred ? 'Preferred supplier' : 'Mark as preferred'}
                      >
                        <Star
                          className={
                            'h-4 w-4 ' +
                            (m.is_preferred ? 'fill-amber-400 text-amber-500' : 'text-ink-mute')
                          }
                        />
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={m.status === 'active'}
                          onChange={(e) =>
                            updateRow(m.id, { status: e.target.checked ? 'active' : 'inactive' })
                          }
                        />
                        <span className="text-xs text-ink-soft">
                          {m.status === 'active' ? 'Yes' : 'No'}
                        </span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      {busyId === m.id && (
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
