'use client';
/**
 * Vendor Master — catalogues every service vendor: sizing, weaving,
 * folding, bobbin suppliers, yarn brokers and so on. Vendor type drives
 * which extras are relevant (e.g. default pick paise is only meaningful
 * for weaving vendors).
 *
 * Existing vendor_type values found in DB: sizing / weaving / folding.
 * Extras for the build guide's other types (yarn, fabric, bobbin) are
 * accepted as well — vendor_type is a plain text column with no enum.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2 } from 'lucide-react';

type RecordStatus = 'active' | 'inactive' | 'archived';

interface Vendor {
  id: number;
  code: string;
  name: string;
  vendor_type: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  default_pick_paise: number | null;
  brokerage_per_bag: number | null;
  payment_terms_days: number;
  status: RecordStatus;
  notes: string | null;
}

interface NewVendor {
  code: string;
  name: string;
  vendor_type: string;
  contact_person: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  default_pick_paise: string;
  brokerage_per_bag: string;
  payment_terms_days: string;
  notes: string;
}

const VENDOR_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'sizing', label: 'Sizing vendor' },
  { value: 'weaving', label: 'Weaving vendor' },
  { value: 'folding', label: 'Folding vendor' },
  { value: 'broker', label: 'Yarn broker' },
  { value: 'yarn', label: 'Yarn supplier' },
  { value: 'fabric', label: 'Fabric supplier' },
  { value: 'bobbin', label: 'Bobbin supplier' },
  { value: 'other', label: 'Other' },
];

const EMPTY_NEW: NewVendor = {
  code: '',
  name: '',
  vendor_type: 'weaving',
  contact_person: '',
  phone: '',
  email: '',
  gstin: '',
  address: '',
  default_pick_paise: '',
  brokerage_per_bag: '',
  payment_terms_days: '30',
  notes: '',
};

function nullIfBlank(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

function toIntOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function nextVendorCode(existing: Vendor[], type: string): string {
  const prefix =
    type === 'sizing'   ? 'SZ-' :
    type === 'weaving'  ? 'WV-' :
    type === 'folding'  ? 'FD-' :
    type === 'yarn'     ? 'YS-' :
    type === 'fabric'   ? 'FS-' :
    type === 'bobbin'   ? 'BS-' :
                          'VN-';
  const re = new RegExp('^' + prefix + '(\\d{4})$');
  const used: number[] = existing
    .map((v) => re.exec(v.code)?.[1])
    .filter((s): s is string => s != null)
    .map((s) => Number(s));
  const max = used.length === 0 ? 0 : Math.max(...used);
  return prefix + String(max + 1).padStart(4, '0');
}

function vendorTypeLabel(t: string): string {
  return VENDOR_TYPES.find((x) => x.value === t)?.label ?? t;
}

export default function VendorsPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [neu, setNeu] = useState<NewVendor>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('vendor')
      .select(
        'id, code, name, vendor_type, contact_person, phone, email, gstin, address, default_pick_paise, brokerage_per_bag, payment_terms_days, status, notes',
      )
      .neq('status', 'archived')
      .order('vendor_type')
      .order('code');
    if (err) {
      setError(err.message);
    } else {
      setRows((data ?? []) as unknown as Vendor[]);
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
      setError('Enter a vendor name.');
      return;
    }
    const code = neu.code.trim() === '' ? nextVendorCode(rows, neu.vendor_type) : neu.code.trim();
    if (rows.some((m) => m.code.toLowerCase() === code.toLowerCase())) {
      setError(`Vendor code "${code}" already exists.`);
      return;
    }

    const pickPaise = toIntOrNull(neu.default_pick_paise);
    const paymentDays = toIntOrNull(neu.payment_terms_days) ?? 30;

    setAdding(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('vendor').insert({
      code,
      name,
      vendor_type: neu.vendor_type,
      contact_person: nullIfBlank(neu.contact_person),
      phone: nullIfBlank(neu.phone),
      email: nullIfBlank(neu.email),
      gstin: nullIfBlank(neu.gstin),
      address: nullIfBlank(neu.address),
      default_pick_paise: pickPaise,
      brokerage_per_bag: (function () {
        const t = neu.brokerage_per_bag.trim();
        if (t === '') return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      })(),
      payment_terms_days: paymentDays,
      notes: nullIfBlank(neu.notes),
      status: 'active',
    });
    setAdding(false);

    if (err) {
      setError(err.message);
      return;
    }
    setNeu(EMPTY_NEW);
    setSavedMsg(`Added vendor ${code}.`);
    await load();
  }

  async function updateRow(id: number, patch: Partial<Vendor>) {
    setError(null);
    setSavedMsg(null);
    setBusyId(id);

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('vendor')
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

  const visible = filterType === '' ? rows : rows.filter((r) => r.vendor_type === filterType);

  const isWeavingType = neu.vendor_type === 'weaving';
  const isBrokerType = neu.vendor_type === 'broker';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        subtitle="Sizing, weaving, folding and other service vendors. Vendor type drives which extras matter (e.g. pick paise for weaving)."
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-base">Add a vendor</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="nv-type">Vendor type *</label>
            <select
              id="nv-type"
              className="input w-full"
              value={neu.vendor_type}
              onChange={(e) => setNeu((n) => ({ ...n, vendor_type: e.target.value }))}
            >
              {VENDOR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nv-code">Code</label>
            <input
              id="nv-code"
              type="text"
              className="input w-full"
              placeholder="(auto)"
              value={neu.code}
              onChange={(e) => setNeu((n) => ({ ...n, code: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nv-name">Vendor name *</label>
            <input
              id="nv-name"
              type="text"
              className="input w-full"
              value={neu.name}
              onChange={(e) => setNeu((n) => ({ ...n, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nv-cp">Contact person</label>
            <input
              id="nv-cp"
              type="text"
              className="input w-full"
              value={neu.contact_person}
              onChange={(e) => setNeu((n) => ({ ...n, contact_person: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nv-phone">Phone</label>
            <input
              id="nv-phone"
              type="text"
              className="input w-full"
              value={neu.phone}
              onChange={(e) => setNeu((n) => ({ ...n, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nv-email">Email</label>
            <input
              id="nv-email"
              type="email"
              className="input w-full"
              value={neu.email}
              onChange={(e) => setNeu((n) => ({ ...n, email: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nv-gstin">GSTIN</label>
            <input
              id="nv-gstin"
              type="text"
              className="input w-full"
              value={neu.gstin}
              onChange={(e) => setNeu((n) => ({ ...n, gstin: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="nv-terms">Payment terms (days)</label>
            <input
              id="nv-terms"
              type="number"
              min={0}
              step="1"
              className="input num w-full"
              value={neu.payment_terms_days}
              onChange={(e) => setNeu((n) => ({ ...n, payment_terms_days: e.target.value }))}
            />
          </div>
          {isWeavingType && (
            <div>
              <label className="label" htmlFor="nv-pick">
                Default pick (paise)
              </label>
              <input
                id="nv-pick"
                type="number"
                min={0}
                step="1"
                className="input num w-full"
                placeholder="e.g. 35"
                value={neu.default_pick_paise}
                onChange={(e) => setNeu((n) => ({ ...n, default_pick_paise: e.target.value }))}
              />
            </div>
          )}
          {isBrokerType && (
            <div>
              <label className="label" htmlFor="nv-brk">
                Brokerage / bag (Rs)
              </label>
              <input
                id="nv-brk"
                type="number"
                min={0}
                step="0.01"
                className="input num w-full"
                placeholder="e.g. 25"
                value={neu.brokerage_per_bag}
                onChange={(e) => setNeu((n) => ({ ...n, brokerage_per_bag: e.target.value }))}
              />
            </div>
          )}
          <div className="md:col-span-3">
            <label className="label" htmlFor="nv-addr">Address</label>
            <input
              id="nv-addr"
              type="text"
              className="input w-full"
              value={neu.address}
              onChange={(e) => setNeu((n) => ({ ...n, address: e.target.value }))}
            />
          </div>
          <div className="md:col-span-3">
            <label className="label" htmlFor="nv-notes">Notes</label>
            <input
              id="nv-notes"
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
            Add vendor
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="label" htmlFor="vendor-filter">Filter type:</label>
        <select
          id="vendor-filter"
          className="input w-44"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All types</option>
          {VENDOR_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-mute">
          Showing {visible.length} of {rows.length}
        </span>
      </div>

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading vendors…
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          {rows.length === 0
            ? 'No vendors yet. Add your first one above.'
            : 'No vendors match this filter.'}
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-ink-mute">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Contact</th>
                  <th className="py-2 pr-3">Phone</th>
                  <th className="py-2 pr-3">GSTIN</th>
                  <th className="py-2 pr-3">Pick paise</th>
                  <th className="py-2 pr-3">Terms (d)</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => (
                  <tr key={v.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{v.code}</td>
                    <td className="py-2 pr-3">
                      <select
                        className="input w-32"
                        value={v.vendor_type}
                        onChange={(e) => updateRow(v.id, { vendor_type: e.target.value })}
                      >
                        {VENDOR_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                        {VENDOR_TYPES.every((t) => t.value !== v.vendor_type) && (
                          <option value={v.vendor_type}>
                            {vendorTypeLabel(v.vendor_type)}
                          </option>
                        )}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-56"
                        value={v.name}
                        onChange={(e) => updateRow(v.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-36"
                        value={v.contact_person ?? ''}
                        onChange={(e) =>
                          updateRow(v.id, { contact_person: nullIfBlank(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-32"
                        value={v.phone ?? ''}
                        onChange={(e) => updateRow(v.id, { phone: nullIfBlank(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input w-36"
                        value={v.gstin ?? ''}
                        onChange={(e) => updateRow(v.id, { gstin: nullIfBlank(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        className="input num w-20"
                        value={v.default_pick_paise ?? ''}
                        disabled={v.vendor_type !== 'weaving'}
                        onChange={(e) =>
                          updateRow(v.id, {
                            default_pick_paise:
                              e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        className="input num w-16"
                        value={v.payment_terms_days}
                        onChange={(e) =>
                          updateRow(v.id, {
                            payment_terms_days: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={v.status === 'active'}
                          onChange={(e) =>
                            updateRow(v.id, {
                              status: e.target.checked ? 'active' : 'inactive',
                            })
                          }
                        />
                        <span className="text-xs text-ink-soft">
                          {v.status === 'active' ? 'Yes' : 'No'}
                        </span>
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      {busyId === v.id && (
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
