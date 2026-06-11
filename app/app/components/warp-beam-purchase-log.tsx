/**
 * WarpBeamPurchaseLog - purchase log of in-house warp beam metres bought
 * from suppliers. Sits under Inhouse Stock → Warp Beam tab.
 *
 * Form fields: date, auto code, ends (dropdown from ends_master),
 * yarn count (dropdown from yarn_count), supplier (type-ahead over all
 * active parties), metres, rate per metre, GST % and an auto total
 * (metres × rate × (1 + GST/100)) that mirrors the DB GENERATED column.
 *
 * The form is hidden by default; "Add Purchase" reveals it, "Edit"
 * loads an existing row into it.
 */
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { SearchSelect } from '@/app/components/search-select';
import { Loader2, Plus, CheckCircle2, Trash2, Pencil, X, Save } from 'lucide-react';

interface BeamRow {
  id: number;
  code: string | null;
  purchase_date: string;
  ends_id: number | null;
  yarn_count_id: number | null;
  supplier_party_id: number | null;
  metres: number;
  rate_per_metre: number;
  gst_pct: number;
  total_amount: number;
  notes: string | null;
}

interface EndsOption { id: number; code: string; name: string; ends_count: number; }
interface CountOption { id: number; code: string; display_name: string; }
interface PartyOption { id: number; code: string; name: string; }

interface FormState {
  purchase_date:     string;
  ends_id:           string;
  yarn_count_id:     string;
  supplier_party_id: string;
  metres:            string;
  rate_per_metre:    string;
  gst_pct:           string;
  notes:             string;
}

const EMPTY: FormState = {
  purchase_date:     '',
  ends_id:           '',
  yarn_count_id:     '',
  supplier_party_id: '',
  metres:            '',
  rate_per_metre:    '',
  gst_pct:           '5',
  notes:             '',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

function fmtDate(s: string | null): string {
  if (s === null || s === '') return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear());
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function WarpBeamPurchaseLog(): React.ReactElement {
  const supabase = createClient();

  const [rows, setRows] = useState<BeamRow[]>([]);
  const [endsOpts, setEndsOpts] = useState<EndsOption[]>([]);
  const [countOpts, setCountOpts] = useState<CountOption[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [formOpen,  setFormOpen]  = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form,      setForm]      = useState<FormState>(EMPTY);
  const [busy,      setBusy]      = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const [rowsRes, eRes, cRes, pRes] = await Promise.all([
      sb.from('inhouse_warp_beam_purchase')
        .select('id, code, purchase_date, ends_id, yarn_count_id, supplier_party_id, metres, rate_per_metre, gst_pct, total_amount, notes')
        .eq('status', 'active')
        .order('purchase_date', { ascending: false })
        .order('id', { ascending: false }),
      sb.from('ends_master')
        .select('id, code, name, ends_count')
        .eq('active', true)
        .order('ends_count'),
      sb.from('yarn_count')
        .select('id, code, display_name')
        .eq('status', 'active')
        .order('display_name'),
      sb.from('party')
        .select('id, code, name')
        .eq('status', 'active')
        .order('name'),
    ]);
    if (rowsRes.error)   setError(rowsRes.error.message);
    else if (eRes.error) setError(eRes.error.message);
    else if (cRes.error) setError(cRes.error.message);
    else if (pRes.error) setError(pRes.error.message);
    else {
      setRows((rowsRes.data ?? []) as unknown as BeamRow[]);
      setEndsOpts((eRes.data ?? []) as unknown as EndsOption[]);
      setCountOpts((cRes.data ?? []) as unknown as CountOption[]);
      setParties((pRes.data ?? []) as unknown as PartyOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // Type-ahead options for the supplier picker (all active parties).
  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: String(p.id), label: p.code + ' - ' + p.name })),
    [parties],
  );

  // Total preview matches the DB GENERATED column:
  //   metres × rate × (1 + gst/100).
  const totalPreview = useMemo<number>(() => {
    const metres = toNumOrNull(form.metres) ?? 0;
    const rate   = toNumOrNull(form.rate_per_metre) ?? 0;
    const gst    = toNumOrNull(form.gst_pct) ?? 0;
    return Math.round(metres * rate * (1 + gst / 100) * 100) / 100;
  }, [form.metres, form.rate_per_metre, form.gst_pct]);

  function openNewForm(): void {
    setEditingId(null);
    setForm({ ...EMPTY, purchase_date: todayISO() });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function openEditForm(r: BeamRow): void {
    setEditingId(r.id);
    setForm({
      purchase_date:     r.purchase_date,
      ends_id:           r.ends_id === null ? '' : String(r.ends_id),
      yarn_count_id:     r.yarn_count_id === null ? '' : String(r.yarn_count_id),
      supplier_party_id: r.supplier_party_id === null ? '' : String(r.supplier_party_id),
      metres:            String(r.metres),
      rate_per_metre:    String(r.rate_per_metre),
      gst_pct:           String(r.gst_pct),
      notes:             r.notes ?? '',
    });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function closeForm(): void {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setSavedMsg(null);

    const endsId     = form.ends_id === '' ? null : Number(form.ends_id);
    const countId    = form.yarn_count_id === '' ? null : Number(form.yarn_count_id);
    const supplierId = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);
    const metres     = toNumOrNull(form.metres);
    const rate       = toNumOrNull(form.rate_per_metre);
    const gst        = toNumOrNull(form.gst_pct) ?? 0;

    if (form.purchase_date.trim() === '')  { setError('Date is required.'); return; }
    if (endsId === null)                   { setError('Ends is required.'); return; }
    if (countId === null)                  { setError('Yarn count is required.'); return; }
    if (supplierId === null)               { setError('Supplier is required.'); return; }
    if (metres === null || metres <= 0)    { setError('Metre must be greater than zero.'); return; }
    if (rate === null || rate < 0)         { setError('Rate per metre is required.'); return; }

    const payload = {
      purchase_date:     form.purchase_date,
      ends_id:           endsId,
      yarn_count_id:     countId,
      supplier_party_id: supplierId,
      metres,
      rate_per_metre:    rate,
      gst_pct:           gst,
      notes:             form.notes.trim() === '' ? null : form.notes.trim(),
    };

    setBusy(true);
    if (editingId === null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('inhouse_warp_beam_purchase').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Added warp beam purchase.');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('inhouse_warp_beam_purchase').update(payload).eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Updated.');
    }
    closeForm();
    await load();
  }

  async function deleteRow(id: number, code: string | null): Promise<void> {
    const label = code ?? '#' + String(id);
    const ok = window.confirm('Delete warp beam purchase ' + label + '?');
    if (ok === false) return;
    setError(null);
    setSavedMsg(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('inhouse_warp_beam_purchase').delete().eq('id', id);
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + label + '.');
  }

  function endsLabel(id: number | null): string {
    if (id === null) return '-';
    const e = endsOpts.find((x) => x.id === id);
    return e ? String(e.ends_count) + ' ends' : '#' + String(id);
  }
  function countLabel(id: number | null): string {
    if (id === null) return '-';
    const c = countOpts.find((x) => x.id === id);
    return c ? c.display_name : '#' + String(id);
  }
  function supplierLabel(id: number | null): string {
    if (id === null) return '-';
    const p = parties.find((x) => x.id === id);
    return p ? p.name : '#' + String(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warp Beam"
        subtitle="In-house warp metre purchase log. ID and total update automatically."
        actions={
          formOpen ? (
            <button type="button" className="btn-ghost" onClick={closeForm}>
              <X className="w-4 h-4" /> Close form
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={openNewForm}>
              <Plus className="w-4 h-4" /> Add Purchase
            </button>
          )
        }
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> {savedMsg}
        </p>
      )}

      {formOpen && (
        <div className="card p-5 space-y-3">
          <h2 className="font-display font-bold text-base">
            {editingId === null ? 'New warp beam purchase' : 'Edit warp beam purchase'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label" htmlFor="wb-date">Date *</label>
              <input id="wb-date" type="date" required className="input w-full"
                value={form.purchase_date}
                onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">ID (auto)</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">
                {editingId === null
                  ? 'Auto (WB/26-27/NNNN)'
                  : (rows.find((r) => r.id === editingId)?.code ?? '-')}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="wb-ends">Ends *</label>
              <select id="wb-ends" className="input w-full"
                value={form.ends_id}
                onChange={(e) => setForm((f) => ({ ...f, ends_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {endsOpts.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.ends_count} ends</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="wb-count">Yarn count *</label>
              <select id="wb-count" className="input w-full"
                value={form.yarn_count_id}
                onChange={(e) => setForm((f) => ({ ...f, yarn_count_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {countOpts.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.display_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Supplier *</label>
              <SearchSelect
                options={partyOptions}
                value={form.supplier_party_id}
                onChange={(v) => setForm((f) => ({ ...f, supplier_party_id: v }))}
                placeholder="Type supplier name…"
                required />
            </div>
            <div>
              <label className="label" htmlFor="wb-metres">Metre *</label>
              <input id="wb-metres" type="number" min={0} step="0.01" className="input num w-full"
                value={form.metres}
                onChange={(e) => setForm((f) => ({ ...f, metres: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="wb-rate">Rate / metre (Rs) *</label>
              <input id="wb-rate" type="number" min={0} step="0.01" className="input num w-full"
                value={form.rate_per_metre}
                onChange={(e) => setForm((f) => ({ ...f, rate_per_metre: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="wb-gst">GST %</label>
              <input id="wb-gst" type="number" min={0} step="0.01" className="input num w-full"
                value={form.gst_pct}
                onChange={(e) => setForm((f) => ({ ...f, gst_pct: e.target.value }))} />
            </div>

            <div>
              <label className="label">Total (auto)</label>
              <div className="input num bg-emerald-50 text-emerald-800 font-semibold select-none">
                {fmtMoney(totalPreview)}
              </div>
            </div>
            <div className="md:col-span-3">
              <label className="label" htmlFor="wb-notes">Notes</label>
              <input id="wb-notes" type="text" className="input w-full" placeholder="(optional)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={closeForm} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId === null ? 'Save Purchase' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading purchases...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No warp beam purchases recorded yet. Click <strong>Add Purchase</strong> to log the first one.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">ID</th>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Ends</th>
                <th className="text-left  px-3 py-3">Yarn count</th>
                <th className="text-left  px-3 py-3 hidden md:table-cell">Supplier</th>
                <th className="text-right px-3 py-3">Metre</th>
                <th className="text-right px-3 py-3">Rate / m (Rs)</th>
                <th className="text-right px-3 py-3">GST %</th>
                <th className="text-right px-3 py-3">Total Rs</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3 font-mono text-xs">{r.code ?? '-'}</td>
                  <td className="px-3 py-3 text-ink-soft">{fmtDate(r.purchase_date)}</td>
                  <td className="px-3 py-3 font-semibold">{endsLabel(r.ends_id)}</td>
                  <td className="px-3 py-3">{countLabel(r.yarn_count_id)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{supplierLabel(r.supplier_party_id)}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(Number(r.metres))}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(Number(r.rate_per_metre))}</td>
                  <td className="px-3 py-3 text-right num">{Number(r.gst_pct)}</td>
                  <td className="px-3 py-3 text-right num font-semibold text-emerald-700">{fmtMoney(Number(r.total_amount))}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" className="p-1 rounded hover:bg-indigo-50 text-indigo-600"
                        title="Edit" onClick={() => openEditForm(r)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" className="p-1 rounded hover:bg-rose-50 text-rose-600"
                        title="Delete" onClick={() => deleteRow(r.id, r.code)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
