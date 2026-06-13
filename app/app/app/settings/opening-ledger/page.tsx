'use client';
/**
 * Settings -> Opening Ledger
 *
 * Lets the operator capture historical (pre-ERP) outstanding invoices
 * / bills with every party so the day-zero balance is correct. Each
 * row carries the original invoice no, invoice date, direction
 * (receivable = party owes us, payable = we owe party), and the bill
 * amount. The Payments page lists these rows alongside live invoices
 * under "Unpaid bills" so they can be settled bill-by-bill.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
import { Loader2, Plus, Trash2, Pencil, Check, X } from 'lucide-react';

interface PartyOpt {
  id: number;
  code: string | null;
  name: string;
}

interface OpeningRow {
  id: number;
  party_id: number;
  invoice_no: string;
  invoice_date: string;
  direction: 'receivable' | 'payable';
  amount: number | string;
  amount_paid: number | string;
  balance: number | string;
  notes: string | null;
  status: 'active' | 'cancelled';
}

interface AddForm {
  party_id: string;
  invoice_no: string;
  invoice_date: string;
  direction: 'receivable' | 'payable';
  amount: string;
  notes: string;
}

interface EditForm {
  invoice_no: string;
  invoice_date: string;
  direction: 'receivable' | 'payable';
  amount: string;
  notes: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyAdd(): AddForm {
  return {
    party_id: '',
    invoice_no: '',
    invoice_date: todayISO(),
    direction: 'receivable',
    amount: '',
    notes: '',
  };
}

function fmtMoney(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PartyOpeningLedgerPage(): React.ReactElement {
  const supabase = createClient();
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [rows, setRows] = useState<OpeningRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [form, setForm] = useState<AddForm>(emptyAdd());
  const [busy, setBusy] = useState<boolean>(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    invoice_no: '', invoice_date: '', direction: 'receivable', amount: '', notes: '',
  });
  const [busyEditId, setBusyEditId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [pRes, oRes] = await Promise.all([
      sb.from('party')
        .select('id, code, name')
        .eq('status', 'active')
        .order('name'),
      sb.from('party_opening_ledger')
        .select('id, party_id, invoice_no, invoice_date, direction, amount, amount_paid, balance, notes, status')
        .eq('status', 'active')
        .order('invoice_date', { ascending: false })
        .order('id', { ascending: false }),
    ]);
    setLoading(false);
    if (pRes.error) { setError(pRes.error.message); return; }
    if (oRes.error) { setError(oRes.error.message); return; }
    setParties((pRes.data ?? []) as PartyOpt[]);
    setRows((oRes.data ?? []) as OpeningRow[]);
    setError(null);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo<Map<number, PartyOpt>>(() => {
    const m = new Map<number, PartyOpt>();
    parties.forEach((p) => m.set(p.id, p));
    return m;
  }, [parties]);

  // Type-ahead options for the party picker. Keeping the code in the
  // label string is what lets the user type "JWP-0001" or part of the
  // name (or a substring of either) and have it match.
  const partyOptions = useMemo<SearchSelectOption[]>(
    () => parties.map((p) => ({
      value: String(p.id),
      label: p.code ? `${p.code} — ${p.name}` : p.name,
    })),
    [parties],
  );

  async function handleAdd(): Promise<void> {
    setError(null);
    setSavedMsg(null);
    if (form.party_id === '') { setError('Pick a party.'); return; }
    if (form.invoice_no.trim() === '') { setError('Invoice number is required.'); return; }
    if (!form.invoice_date) { setError('Invoice date is required.'); return; }
    const amt = Number(form.amount);
    if (!(amt > 0)) { setError('Bill amount must be greater than 0.'); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('party_opening_ledger').insert({
      party_id:     Number(form.party_id),
      invoice_no:   form.invoice_no.trim(),
      invoice_date: form.invoice_date,
      direction:    form.direction,
      amount:       Math.round(amt * 100) / 100,
      notes:        form.notes.trim() || null,
      status:       'active',
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setForm(emptyAdd());
    setSavedMsg('Opening entry saved.');
    await load();
  }

  function startEdit(r: OpeningRow): void {
    setEditingId(r.id);
    setEditForm({
      invoice_no:   r.invoice_no,
      invoice_date: r.invoice_date,
      direction:    r.direction,
      amount:       String(r.amount),
      notes:        r.notes ?? '',
    });
    setError(null);
    setSavedMsg(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditForm({ invoice_no: '', invoice_date: '', direction: 'receivable', amount: '', notes: '' });
  }

  async function saveEdit(id: number): Promise<void> {
    const amt = Number(editForm.amount);
    if (editForm.invoice_no.trim() === '') { setError('Invoice number is required.'); return; }
    if (!editForm.invoice_date) { setError('Invoice date is required.'); return; }
    if (!(amt > 0)) { setError('Bill amount must be greater than 0.'); return; }
    setError(null);
    setSavedMsg(null);
    setBusyEditId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb
      .from('party_opening_ledger')
      .update({
        invoice_no:   editForm.invoice_no.trim(),
        invoice_date: editForm.invoice_date,
        direction:    editForm.direction,
        amount:       Math.round(amt * 100) / 100,
        notes:        editForm.notes.trim() || null,
      })
      .eq('id', id);
    setBusyEditId(null);
    if (err) { setError(err.message); return; }
    cancelEdit();
    setSavedMsg('Updated.');
    await load();
  }

  async function deleteRow(id: number, label: string): Promise<void> {
    if (!window.confirm(`Delete opening entry "${label}"?\n\nSoft-delete: row stays in the DB with status='cancelled' for audit.`)) return;
    setDeletingId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb
      .from('party_opening_ledger')
      .update({ status: 'cancelled' })
      .eq('id', id);
    setDeletingId(null);
    if (err) { setError(err.message); return; }
    await load();
  }

  // Grand totals strip.
  const totalReceivable = rows
    .filter((r) => r.direction === 'receivable')
    .reduce((s, r) => s + Number(r.balance ?? 0), 0);
  const totalPayable = rows
    .filter((r) => r.direction === 'payable')
    .reduce((s, r) => s + Number(r.balance ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Opening Ledger"
        subtitle="Per-party opening balances — historical invoices / bills outstanding when the ERP went live. These rows appear under Payments → Unpaid bills so receipts can be adjusted against them."
        crumbs={[
          { label: 'Settings', href: '/app/settings' },
          { label: 'Opening Ledger' },
        ]}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Receivable (party owes us)</div>
          <div className="num text-xl font-bold text-emerald-700">₹ {fmtMoney(totalReceivable)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Payable (we owe party)</div>
          <div className="num text-xl font-bold text-rose-700">₹ {fmtMoney(totalPayable)}</div>
        </div>
      </div>

      {/* Add form */}
      <div className="card p-4 mb-4">
        <h2 className="font-display font-bold text-sm mb-3">Add opening entry</h2>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="label text-xs">Party *</label>
            <SearchSelect
              options={partyOptions}
              value={form.party_id}
              onChange={(v) => setForm({ ...form, party_id: v })}
              placeholder="Type party code or name…"
              required
              noMatchText="No party matches"
            />
          </div>
          <div>
            <label className="label text-xs">Direction *</label>
            <select
              className="input h-9 text-sm"
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value as 'receivable' | 'payable' })}
              title="Receivable = party owes us · Payable = we owe party"
            >
              <option value="receivable">Receivable</option>
              <option value="payable">Payable</option>
            </select>
          </div>
          <div>
            <label className="label text-xs">Invoice no *</label>
            <input
              className="input h-9 text-sm font-mono"
              value={form.invoice_no}
              onChange={(e) => setForm({ ...form, invoice_no: e.target.value })}
              placeholder="e.g. INV-2024-001"
            />
          </div>
          <div>
            <label className="label text-xs">Invoice date *</label>
            <input
              type="date"
              className="input h-9 text-sm"
              value={form.invoice_date}
              onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">Bill amount (₹) *</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="input num h-9 text-sm text-right"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div className="md:col-span-6">
            <label className="label text-xs">Notes (optional)</label>
            <input
              className="input h-9 text-sm"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any context — purpose, period, internal remarks"
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          {error && <div className="text-xs text-rose-600">{error}</div>}
          {savedMsg && !error && <div className="text-xs text-emerald-700">{savedMsg}</div>}
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy}
            className="btn-primary text-xs ml-auto flex items-center gap-1"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add entry
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No opening entries yet. Add your first one above.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-2">Party</th>
                <th className="text-left  px-3 py-2">Direction</th>
                <th className="text-left  px-3 py-2">Invoice no</th>
                <th className="text-left  px-3 py-2">Invoice date</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-right px-3 py-2">Paid</th>
                <th className="text-right px-3 py-2">Balance</th>
                <th className="text-left  px-3 py-2">Notes</th>
                <th className="text-right px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = partyById.get(r.party_id);
                const partyLabel = p
                  ? `${p.code ? `${p.code} — ` : ''}${p.name}`
                  : `Party #${r.party_id}`;
                if (editingId === r.id) {
                  const isSaving = busyEditId === r.id;
                  return (
                    <tr key={r.id} className="border-t border-line/40 bg-amber-50/40">
                      <td className="px-3 py-2 font-medium text-ink-soft">
                        {partyLabel}
                        <div className="text-[10px] text-ink-mute">party locked</div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="input h-8 text-xs"
                          value={editForm.direction}
                          onChange={(e) => setEditForm({ ...editForm, direction: e.target.value as 'receivable' | 'payable' })}
                        >
                          <option value="receivable">Receivable</option>
                          <option value="payable">Payable</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="input h-8 text-xs font-mono"
                          value={editForm.invoice_no}
                          onChange={(e) => setEditForm({ ...editForm, invoice_no: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          className="input h-8 text-xs"
                          value={editForm.invoice_date}
                          onChange={(e) => setEditForm({ ...editForm, invoice_date: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="input num h-8 text-xs text-right w-28"
                          value={editForm.amount}
                          onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right num text-ink-mute">
                        {fmtMoney(r.amount_paid)}
                        <div className="text-[10px]">locked</div>
                      </td>
                      <td className="px-3 py-2 text-right num text-ink-mute">
                        {fmtMoney(r.balance)}
                        <div className="text-[10px]">auto</div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="input h-8 text-xs"
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
                          title="Save"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-ink-soft hover:bg-haze ml-1 disabled:opacity-50"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                }
                const dirCls = r.direction === 'receivable'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700';
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 font-medium">{partyLabel}</td>
                    <td className="px-3 py-2">
                      <span className={'inline-block px-2 py-0.5 rounded text-[10px] uppercase ' + dirCls}>
                        {r.direction === 'receivable' ? 'Receivable' : 'Payable'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.invoice_no}</td>
                    <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{r.invoice_date}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(r.amount)}</td>
                    <td className="px-3 py-2 text-right num text-ink-soft">{fmtMoney(r.amount_paid)}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(r.balance)}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{r.notes ?? ''}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        disabled={editingId !== null || deletingId === r.id}
                        className="p-1 rounded text-indigo-700 hover:bg-indigo-50 disabled:opacity-30"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRow(r.id, `${r.invoice_no} for ${partyLabel}`)}
                        disabled={deletingId === r.id || editingId !== null}
                        className="p-1 rounded text-rose-600 hover:bg-rose-50 ml-1 disabled:opacity-30"
                        title="Delete (soft)"
                      >
                        {deletingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-ink-mute px-3 py-2 border-t border-line/40">
            Delete soft-deletes the row (status=&apos;cancelled&apos;) so the audit trail stays intact. Rows already partially settled by payments keep their amount_paid value untouched.
          </p>
        </div>
      )}
    </div>
  );
}
