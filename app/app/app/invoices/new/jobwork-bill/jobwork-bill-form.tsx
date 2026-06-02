'use client';
/**
 * Jobwork Bill creation form.
 *
 * Flow:
 *  1. Pick a jobwork party. Loads every confirmed, un-invoiced jobwork DC
 *     for that party.
 *  2. Tick the DCs to include on this bill.
 *  3. For every fabric quality that appears across the picked DCs, a
 *     locked invoice line is computed:
 *
 *       quantity (metres) = sum of metres from picked DCs of that quality
 *       pieces, bundles   = sums (display-only, not on the invoice line)
 *       rate              = fabric_quality.pick_cost_per_m  (locked)
 *       amount            = quantity * rate
 *
 *  4. GST % and bill date are the only editable header fields.
 *  5. Save → creates invoice (auto-numbered JB/26-27/NNNN), invoice_lines,
 *     and stamps invoice_id + status='invoiced' onto every picked DC.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, AlertTriangle } from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface PartyOpt {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  address: string | null;
  state: string | null;
  state_code: string | null;
}

interface DcRow {
  id: number;
  code: string;
  dc_date: string;
  party_id: number | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
}

interface DcItemRow {
  dc_id: number;
  fabric_quality_id: number | null;
  metres: number | string | null;
  pieces: number | null;
  bundles: number | null;
  hsn: string | null;
}

interface FabricQualityRow {
  id: number;
  code: string;
  name: string;
  hsn: string | null;
  pick_cost_per_m: number | string | null;
}

interface JobworkBillFormProps {
  parties: ReadonlyArray<PartyOpt>;
}

interface LineAgg {
  fq_id: number;
  fq_code: string;
  fq_name: string;
  hsn: string;
  rate: number;       // pick_cost_per_m (locked)
  metres: number;     // sum across selected DCs
  pieces: number;     // sum across selected DCs (display)
  bundles: number;    // sum across selected DCs (display)
  taxable: number;    // metres * rate
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const PPKTEX_STATE_CODE = '33'; // Tamil Nadu

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export function JobworkBillForm({ parties }: JobworkBillFormProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();

  // ── Form state ──
  const [partyId, setPartyId]   = useState<string>('');
  const [billDate, setBillDate] = useState<string>(todayISO());
  const [gstPct, setGstPct]     = useState<string>('5');
  const [notes, setNotes]       = useState<string>('');
  const [busy, setBusy]         = useState<boolean>(false);
  const [error, setError]       = useState<string | null>(null);

  // ── Data state ──
  const [dcs, setDcs]                 = useState<DcRow[]>([]);
  const [items, setItems]             = useState<DcItemRow[]>([]);
  const [qualityById, setQualityById] = useState<Map<number, FabricQualityRow>>(new Map());
  const [pickedDcIds, setPickedDcIds] = useState<Set<number>>(new Set());
  const [loadingDcs, setLoadingDcs]   = useState<boolean>(false);

  // Reload DCs whenever party changes.
  useEffect(() => {
    if (partyId === '') {
      setDcs([]);
      setItems([]);
      setPickedDcIds(new Set());
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoadingDcs(true);
      setError(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;

      // Confirmed jobwork DCs for this party that haven't been invoiced yet.
      const { data: hdrs, error: hdrErr } = await sb
        .from('delivery_challan')
        .select('id, code, dc_date, party_id, total_metres, total_pieces, total_bundles')
        .eq('production_mode', 'jobwork')
        .eq('party_id', Number(partyId))
        .eq('status', 'confirmed')
        .is('invoice_id', null)
        .order('dc_date', { ascending: false })
        .order('id', { ascending: false });
      if (cancelled) return;
      if (hdrErr) { setError(hdrErr.message); setLoadingDcs(false); return; }

      const dcList = (hdrs ?? []) as DcRow[];
      setDcs(dcList);
      setPickedDcIds(new Set());

      if (dcList.length === 0) {
        setItems([]);
        setLoadingDcs(false);
        return;
      }

      const dcIds = dcList.map((d) => d.id);
      const { data: itemRows } = await sb
        .from('delivery_challan_item')
        .select('dc_id, fabric_quality_id, metres, pieces, bundles, hsn')
        .in('dc_id', dcIds);
      if (cancelled) return;
      const itemList = (itemRows ?? []) as DcItemRow[];
      setItems(itemList);

      // Load fabric_quality master for the qualities that appear.
      const qIds = Array.from(new Set(
        itemList.map((r) => r.fabric_quality_id).filter((x): x is number => x != null),
      ));
      if (qIds.length > 0) {
        const { data: qRows } = await sb
          .from('fabric_quality')
          .select('id, code, name, hsn, pick_cost_per_m')
          .in('id', qIds);
        if (cancelled) return;
        const m = new Map<number, FabricQualityRow>();
        for (const q of (qRows ?? []) as FabricQualityRow[]) m.set(q.id, q);
        setQualityById(m);
      } else {
        setQualityById(new Map());
      }
      setLoadingDcs(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [partyId, supabase]);

  const party = useMemo<PartyOpt | null>(() => {
    if (partyId === '') return null;
    return parties.find((p) => p.id === Number(partyId)) ?? null;
  }, [partyId, parties]);

  // ── Aggregated lines, keyed by fabric_quality_id ──
  const lines = useMemo<LineAgg[]>(() => {
    if (pickedDcIds.size === 0) return [];
    const byFq = new Map<number, LineAgg>();
    for (const it of items) {
      if (!pickedDcIds.has(it.dc_id)) continue;
      if (it.fabric_quality_id == null) continue;
      const fq = qualityById.get(it.fabric_quality_id);
      if (!fq) continue;
      const rate = num(fq.pick_cost_per_m);
      const metres = num(it.metres);
      const existing = byFq.get(fq.id);
      if (existing) {
        existing.metres += metres;
        existing.pieces += it.pieces ?? 0;
        existing.bundles += it.bundles ?? 0;
        existing.taxable = round2(existing.metres * existing.rate);
      } else {
        byFq.set(fq.id, {
          fq_id: fq.id,
          fq_code: fq.code,
          fq_name: fq.name,
          hsn: it.hsn ?? fq.hsn ?? '',
          rate,
          metres,
          pieces: it.pieces ?? 0,
          bundles: it.bundles ?? 0,
          taxable: round2(metres * rate),
        });
      }
    }
    return Array.from(byFq.values()).sort((a, b) => a.fq_code.localeCompare(b.fq_code));
  }, [items, pickedDcIds, qualityById]);

  // ── Totals (header) ──
  const gst = num(gstPct);
  const isInterstate = (party?.state_code ?? '') !== '' && party?.state_code !== PPKTEX_STATE_CODE;
  const totals = useMemo(() => {
    const taxable = lines.reduce<number>((s, l) => s + l.taxable, 0);
    const cgst = isInterstate ? 0 : round2(taxable * gst / 200);
    const sgst = isInterstate ? 0 : round2(taxable * gst / 200);
    const igst = isInterstate ? round2(taxable * gst / 100) : 0;
    const grand = round2(taxable + cgst + sgst + igst);
    const metres = lines.reduce<number>((s, l) => s + l.metres, 0);
    const pieces = lines.reduce<number>((s, l) => s + l.pieces, 0);
    const bundles = lines.reduce<number>((s, l) => s + l.bundles, 0);
    return { taxable: round2(taxable), cgst, sgst, igst, grand, metres, pieces, bundles };
  }, [lines, gst, isInterstate]);

  // ── Pick / unpick handlers ──
  function toggleDc(dcId: number): void {
    setPickedDcIds((prev) => {
      const next = new Set(prev);
      if (next.has(dcId)) next.delete(dcId); else next.add(dcId);
      return next;
    });
  }
  function pickAll(): void {
    setPickedDcIds(new Set(dcs.map((d) => d.id)));
  }
  function clearAll(): void {
    setPickedDcIds(new Set());
  }

  // ── Pricing safety: any line with rate 0 means pick_cost_per_m wasn't set ──
  const missingRateQualities = useMemo<string[]>(
    () => lines.filter((l) => l.rate <= 0).map((l) => l.fq_code),
    [lines],
  );

  async function handleSave(): Promise<void> {
    setError(null);
    if (party === null) { setError('Pick a jobwork party.'); return; }
    if (pickedDcIds.size === 0) { setError('Pick at least one DC.'); return; }
    if (lines.length === 0) { setError('Selected DCs have no fabric quality lines.'); return; }
    if (missingRateQualities.length > 0) {
      setError(`Set pick_cost_per_m on: ${missingRateQualities.join(', ')}`);
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // ── 1. Insert invoice header ──
    const headerPayload = {
      doc_type: 'jobwork_invoice',
      source_kind: 'free',
      jobwork_party_id: party.id,
      customer_id: null,
      invoice_date: billDate,
      party_name: party.name,
      party_gstin: party.gstin,
      party_state: party.state,
      place_of_supply: party.state,
      is_interstate: isInterstate,
      subtotal: totals.taxable,
      gst_amount: round2(totals.cgst + totals.sgst + totals.igst),
      total: totals.grand,
      amount_paid: 0,
      taxable_value: totals.taxable,
      cgst_amount: totals.cgst,
      sgst_amount: totals.sgst,
      igst_amount: totals.igst,
      round_off: 0,
      status: 'draft',
      notes: notes || null,
    };

    const { data: invRow, error: invErr } = await sb
      .from('invoice')
      .insert(headerPayload)
      .select('id, invoice_no')
      .single();
    if (invErr || !invRow?.id) {
      setBusy(false);
      setError(invErr?.message ?? 'Failed to create invoice.');
      return;
    }
    const invoiceId = invRow.id as number;

    // ── 2. Insert invoice lines ──
    const linesPayload = lines.map((l) => {
      const taxable = l.taxable;
      const cgst = isInterstate ? 0 : round2(taxable * gst / 200);
      const sgst = isInterstate ? 0 : round2(taxable * gst / 200);
      const igst = isInterstate ? round2(taxable * gst / 100) : 0;
      const lineTotal = round2(taxable + cgst + sgst + igst);
      return {
        invoice_id: invoiceId,
        description: `Jobwork weaving - ${l.fq_code}${l.fq_name ? ' (' + l.fq_name + ')' : ''}`,
        quantity: l.metres,
        rate: l.rate,
        hsn_sac: l.hsn || null,
        uom: 'mtr',
        discount_pct: 0,
        discount_amount: 0,
        gst_rate_pct: gst,
        taxable_amount: taxable,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        total_amount: lineTotal,
      };
    });

    const { error: lineErr } = await sb.from('invoice_line').insert(linesPayload);
    if (lineErr) {
      setBusy(false);
      setError(`Invoice ${invRow.invoice_no} saved but lines failed: ${lineErr.message}`);
      return;
    }

    // ── 3. Stamp invoice_id + status='invoiced' onto each picked DC ──
    const dcIds = Array.from(pickedDcIds);
    const { error: dcErr } = await sb
      .from('delivery_challan')
      .update({ invoice_id: invoiceId, status: 'invoiced' })
      .in('id', dcIds);
    if (dcErr) {
      setBusy(false);
      setError(`Invoice ${invRow.invoice_no} saved, but linking DCs failed: ${dcErr.message}`);
      return;
    }

    setBusy(false);
    router.push('/app/invoices?type=jobwork_invoice');
    router.refresh();
  }

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────

  return (
    <form className="space-y-4 max-w-6xl" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* ───── Party + header ───── */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Jobwork Party *</label>
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="input"
              required
            >
              <option value="">Select party...</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Bill Date *</label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="input"
              required
            />
          </div>
          <div>
            <label className="label">GST %</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={gstPct}
              onChange={(e) => setGstPct(e.target.value)}
              className="input"
            />
          </div>
        </div>

        {party !== null && (
          <div className="text-xs text-ink-soft space-y-0.5">
            {party.gstin && <div><b>GSTIN:</b> {party.gstin}</div>}
            {party.address && <div><b>Address:</b> {party.address}</div>}
            {party.state && <div><b>State:</b> {party.state} ({party.state_code ?? '-'}) &nbsp; {isInterstate ? <span className="pill bg-amber-50 text-amber-700">Interstate (IGST)</span> : <span className="pill bg-emerald-50 text-emerald-700">Intrastate (CGST+SGST)</span>}</div>}
          </div>
        )}
      </div>

      {/* ───── DC picker ───── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line/60 bg-cloud/40 flex items-center justify-between">
          <h2 className="font-display font-bold text-sm">Pick DCs to bill</h2>
          {dcs.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={pickAll} className="text-indigo hover:underline">Pick all</button>
              <span className="text-ink-mute">·</span>
              <button type="button" onClick={clearAll} className="text-ink-soft hover:underline">Clear</button>
            </div>
          )}
        </div>
        {partyId === '' ? (
          <div className="p-6 text-center text-ink-mute text-sm">Pick a jobwork party first.</div>
        ) : loadingDcs ? (
          <div className="p-6 text-ink-mute text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading DCs...
          </div>
        ) : dcs.length === 0 ? (
          <div className="p-6 text-center text-ink-mute text-sm">
            No confirmed jobwork DCs waiting to be billed for this party.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2 w-10" />
                <th className="text-left px-3 py-2">DC No</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Metres</th>
                <th className="text-right px-3 py-2">Pcs</th>
                <th className="text-right px-3 py-2">Bundles</th>
              </tr>
            </thead>
            <tbody>
              {dcs.map((d) => {
                const picked = pickedDcIds.has(d.id);
                return (
                  <tr
                    key={d.id}
                    className={'border-t border-line/40 cursor-pointer ' + (picked ? 'bg-indigo/5' : 'hover:bg-haze/60')}
                    onClick={() => toggleDc(d.id)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => toggleDc(d.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{d.code}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{fmtDate(d.dc_date)}</td>
                    <td className="px-3 py-2 text-right num">{Number(d.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right num">{d.total_pieces ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{d.total_bundles ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ───── Auto-aggregated lines ───── */}
      {lines.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
            <h2 className="font-display font-bold text-sm">Bill lines (auto-calculated, not editable)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-2">Quality</th>
                <th className="text-left px-3 py-2">HSN</th>
                <th className="text-right px-3 py-2">Metres</th>
                <th className="text-right px-3 py-2">Pcs</th>
                <th className="text-right px-3 py-2">Bundles</th>
                <th className="text-right px-3 py-2">Rate (Rs/m)</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.fq_id} className="border-t border-line/40">
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.fq_code}</div>
                    {l.fq_name && <div className="text-[11px] text-ink-mute">{l.fq_name}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{l.hsn || '-'}</td>
                  <td className="px-3 py-2 text-right num">{fmtMoney(l.metres)}</td>
                  <td className="px-3 py-2 text-right num">{l.pieces}</td>
                  <td className="px-3 py-2 text-right num">{l.bundles}</td>
                  <td className="px-3 py-2 text-right num">
                    {l.rate > 0
                      ? fmtMoney(l.rate)
                      : <span className="text-rose-600 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> not set</span>}
                  </td>
                  <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(l.taxable)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-cloud/30 font-semibold">
              <tr>
                <td className="px-3 py-2.5" colSpan={2}>Totals</td>
                <td className="px-3 py-2.5 text-right num">{fmtMoney(totals.metres)}</td>
                <td className="px-3 py-2.5 text-right num">{totals.pieces}</td>
                <td className="px-3 py-2.5 text-right num">{totals.bundles}</td>
                <td className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5 text-right num">{fmtMoney(totals.taxable)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ───── Tax summary ───── */}
      {lines.length > 0 && (
        <div className="card p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Taxable</div>
              <div className="num font-bold">Rs {fmtMoney(totals.taxable)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">CGST ({gst / 2}%)</div>
              <div className="num font-bold">Rs {fmtMoney(totals.cgst)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">SGST ({gst / 2}%)</div>
              <div className="num font-bold">Rs {fmtMoney(totals.sgst)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">IGST ({gst}%)</div>
              <div className="num font-bold">Rs {fmtMoney(totals.igst)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Grand total</div>
              <div className="num font-bold text-emerald-700 text-lg">Rs {fmtMoney(totals.grand)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card p-4">
        <label className="label">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="input"
          placeholder="Anything to record on this bill"
        />
      </div>

      {error && (
        <div className="card p-3 text-err text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save jobwork bill
        </button>
        <button
          type="button"
          onClick={() => router.push('/app/invoices')}
          className="btn-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
