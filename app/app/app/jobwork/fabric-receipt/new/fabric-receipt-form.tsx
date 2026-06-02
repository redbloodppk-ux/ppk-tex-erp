'use client';
/**
 * Fabric Receipt entry form. Modeled after the SMART NT12 "Fabric Receipt"
 * screen. Each row is one fabric quality from the source DC, with the
 * yarn / bobbin / ends info auto-fetched from the fabric_quality master.
 *
 *   QUALITY | ENDS | FD % | NO.OF PCS | RECEIVED METERS | WEFT COUNT |
 *           | WEFT CONS/MTR | CONSUMED WEIGHT | PRODUCT | QTY
 *
 * Each row has a MTR / PCS toggle for the received-metres column:
 *   MTR  - operator types metres directly.
 *   PCS  - operator types pieces + length-per-piece, the form computes
 *          received_mtr = pieces * length.
 *
 * Bottom of the form shows total consumption: weft kg, porvai kg, bobbin pcs.
 *
 * Phase 1 (this commit): captures the receipt + items in the DB, links
 * the originating DC, generates an FR/26-27/NNNN code.
 *
 * Phase 2 (next commit): apply the stock reductions on save:
 *   - pavu.meters     -= received_metres (FIFO, matched via warp_count)
 *   - yarn_lot.current_kg -= weft_consumed_kg  (FIFO, by yarn_count_id)
 *   - yarn_lot.current_kg -= porvai_consumed_kg (FIFO, kind='porvai')
 *   - bobbin.quantity -= ceil(consumed_pcs / pcs_per_bobbin)   (FIFO)
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, AlertTriangle, ArrowLeft } from 'lucide-react';

export interface DcInfo {
  id: number;
  code: string;
  dc_date: string;
  vehicle_no: string;
  party_id: number | null;
  party_name: string;
  party_code: string;
  total_metres: number;
  total_pieces: number;
  total_bundles: number;
}

export interface ReceiptItemSeed {
  dc_item_id: number;
  sno: number;
  fabric_quality_id: number | null;
  fabric_quality_code: string;
  fabric_quality_name: string;
  ends_id: number | null;
  ends_count: number | null;
  ends_code: string | null;
  weft_yarn_count_id: number | null;
  weft_yarn_count_code: string | null;
  weft_kg_per_m: number;
  porvai_kg_per_m: number;
  bobbin_pcs_per_m: number;
  dc_metres: number;
  dc_pieces: number;
  dc_bundles: number;
  hsn: string;
}

type EntryMode = 'mtr' | 'pcs';

interface ItemState {
  seed: ReceiptItemSeed;
  entry_mode: EntryMode;
  fd_pct: string;
  no_of_pieces: string;
  length_per_pc: string;
  received_metres: string; // typed directly in mtr mode
  product: string;
  qty: string;
}

interface FabricReceiptFormProps {
  dc: DcInfo;
  seeds: ReceiptItemSeed[];
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function fmtMoney(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Resolve received metres from the item state. In MTR mode use the typed
 *  value; in PCS mode compute as pieces × length-per-piece. */
function resolvedMetres(it: ItemState): number {
  if (it.entry_mode === 'pcs') {
    return round2(num(it.no_of_pieces) * num(it.length_per_pc));
  }
  return round2(num(it.received_metres));
}

export function FabricReceiptForm({ dc, seeds }: FabricReceiptFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  // Header state
  const [receiptDate, setReceiptDate] = useState<string>(todayISO());
  const [receiptType, setReceiptType] = useState<string>('weaving');
  const [transport, setTransport]     = useState<string>('');
  const [freight, setFreight]         = useState<string>('0');
  const [emptyBeams, setEmptyBeams]   = useState<string>('0');
  const [remarks, setRemarks]         = useState<string>('');

  // One row of state per DC item
  const [items, setItems] = useState<ItemState[]>(
    seeds.map((s) => ({
      seed: s,
      entry_mode: 'mtr',
      fd_pct: '100',
      no_of_pieces: String(s.dc_pieces || 0),
      length_per_pc: '',
      received_metres: String(s.dc_metres || 0),
      product: '',
      qty: '',
    })),
  );

  const [busy, setBusy]   = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function patch(idx: number, mut: Partial<ItemState>): void {
    setItems((arr) => arr.map((x, i) => i === idx ? { ...x, ...mut } : x));
  }

  // ── Aggregates ──────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let metres = 0;
    let pieces = 0;
    let weftKg = 0;
    let porvaiKg = 0;
    let bobbinPcs = 0;
    for (const it of items) {
      const m = resolvedMetres(it);
      metres += m;
      pieces += Math.round(num(it.no_of_pieces));
      weftKg   += m * it.seed.weft_kg_per_m;
      porvaiKg += m * it.seed.porvai_kg_per_m;
      bobbinPcs += m * it.seed.bobbin_pcs_per_m;
    }
    return {
      metres: round2(metres),
      pieces,
      weftKg: round2(weftKg),
      porvaiKg: round2(porvaiKg),
      bobbinPcs: round2(bobbinPcs),
    };
  }, [items]);

  async function handleSave(): Promise<void> {
    setError(null);
    if (totals.metres <= 0) {
      setError('Total received metres must be greater than zero.');
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const headerPayload = {
      receipt_date: receiptDate,
      receipt_type: receiptType,
      dc_id: dc.id,
      party_id: dc.party_id,
      party_dc_no: dc.code,
      transport_mode: transport || null,
      freight_charges: round2(num(freight)),
      empty_beams: Math.round(num(emptyBeams)),
      remarks: remarks || null,
      total_metres: totals.metres,
      total_pieces: totals.pieces,
      status: 'received',
    };

    const { data: hdr, error: hdrErr } = await sb
      .from('fabric_receipt')
      .insert(headerPayload)
      .select('id, code')
      .single();
    if (hdrErr || !hdr?.id) {
      setBusy(false);
      setError(hdrErr?.message ?? 'Failed to create fabric receipt.');
      return;
    }
    const receiptId = hdr.id as number;

    const itemPayload = items.map((it, idx) => {
      const m = resolvedMetres(it);
      const weftKg   = round2(m * it.seed.weft_kg_per_m);
      const porvaiKg = round2(m * it.seed.porvai_kg_per_m);
      const bobPcs   = round2(m * it.seed.bobbin_pcs_per_m);
      return {
        receipt_id: receiptId,
        sno: it.seed.sno || idx + 1,
        fabric_quality_id: it.seed.fabric_quality_id,
        ends_id: it.seed.ends_id,
        ends_count_snapshot: it.seed.ends_count,
        fd_pct: round2(num(it.fd_pct)),
        no_of_pieces: Math.round(num(it.no_of_pieces)),
        length_per_pc: it.entry_mode === 'pcs' ? round2(num(it.length_per_pc)) : null,
        received_metres: m,
        entry_mode: it.entry_mode,
        weft_yarn_count_id: it.seed.weft_yarn_count_id,
        weft_kg_per_m:    it.seed.weft_kg_per_m   > 0 ? it.seed.weft_kg_per_m   : null,
        weft_consumed_kg: weftKg > 0 ? weftKg : null,
        porvai_yarn_count_id: null,
        porvai_kg_per_m:    it.seed.porvai_kg_per_m   > 0 ? it.seed.porvai_kg_per_m   : null,
        porvai_consumed_kg: porvaiKg > 0 ? porvaiKg : null,
        bobbin_id: null,
        bobbin_pcs_per_m:    it.seed.bobbin_pcs_per_m   > 0 ? it.seed.bobbin_pcs_per_m   : null,
        bobbin_consumed_pcs: bobPcs > 0 ? bobPcs : null,
        product: it.product || null,
        qty: it.qty ? round2(num(it.qty)) : null,
      };
    });
    const { error: itemErr } = await sb.from('fabric_receipt_item').insert(itemPayload);
    if (itemErr) {
      setBusy(false);
      setError(`Receipt ${hdr.code} saved, but items failed: ${itemErr.message}`);
      return;
    }

    // Link the DC back to this receipt so the same DC can't be received twice.
    await sb.from('delivery_challan')
      .update({ fabric_receipt_id: receiptId })
      .eq('id', dc.id);

    // PHASE 2 TODO: apply stock reductions here.
    //   - pavu.meters     -= totals.metres  (FIFO; match by warp_count)
    //   - yarn_lot.current_kg -= weft kg     (FIFO; yarn_count_id = weft_yarn_count_id)
    //   - yarn_lot.current_kg -= porvai kg   (FIFO; yarn_kind='porvai')
    //   - bobbin.quantity -= bobbin pcs / bobbin_metre (FIFO)

    setBusy(false);
    router.push('/app/jobwork');
    router.refresh();
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* Header card */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label className="label">Receipt no</label>
            <div className="input bg-cloud/40 text-ink-mute">Auto (FR/26-27/NNNN)</div>
          </div>
          <div>
            <label className="label">Receipt date</label>
            <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="input" required />
          </div>
          <div>
            <label className="label">Receipt type</label>
            <select value={receiptType} onChange={(e) => setReceiptType(e.target.value)} className="input">
              <option value="weaving">Weaving</option>
              <option value="sizing">Sizing</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">Received from</label>
            <div className="input bg-cloud/40">{dc.party_name} <span className="text-ink-mute text-xs">({dc.party_code})</span></div>
          </div>
          <div>
            <label className="label">Party DC no</label>
            <div className="input bg-cloud/40 font-mono text-xs">{dc.code}</div>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
          <h2 className="font-display font-bold text-sm">Items</h2>
        </div>
        <table className="w-full text-sm min-w-[1200px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-2 py-2">SNo</th>
              <th className="text-left  px-2 py-2">Quality</th>
              <th className="text-right px-2 py-2">Ends</th>
              <th className="text-right px-2 py-2">FD %</th>
              <th className="text-right px-2 py-2">No. of pcs</th>
              <th className="text-right px-2 py-2">Received metres</th>
              <th className="text-left  px-2 py-2">Weft count</th>
              <th className="text-right px-2 py-2">Weft cons/m</th>
              <th className="text-right px-2 py-2">Consumed wt (kg)</th>
              <th className="text-left  px-2 py-2">Product</th>
              <th className="text-right px-2 py-2">Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const m = resolvedMetres(it);
              const consumed = round2(m * it.seed.weft_kg_per_m);
              return (
                <tr key={idx} className="border-t border-line/40 align-top">
                  <td className="px-2 py-2 text-xs text-ink-mute">{it.seed.sno || idx + 1}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-xs">{it.seed.fabric_quality_code || '-'}</div>
                    {it.seed.fabric_quality_name && (
                      <div className="text-[10px] text-ink-mute">{it.seed.fabric_quality_name}</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right num text-xs">
                    {it.seed.ends_count ?? <span className="text-ink-mute">nil</span>}
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" value={it.fd_pct}
                      onChange={(e) => patch(idx, { fd_pct: e.target.value })}
                      className="input h-8 text-xs num w-20 text-right" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="1" min="0" value={it.no_of_pieces}
                      onChange={(e) => patch(idx, { no_of_pieces: e.target.value })}
                      className="input h-8 text-xs num w-20 text-right" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1">
                        <button type="button"
                          onClick={() => patch(idx, { entry_mode: 'mtr' })}
                          className={'px-2 py-0.5 text-[10px] rounded border ' + (it.entry_mode === 'mtr' ? 'bg-indigo text-white border-indigo' : 'bg-white border-line text-ink-soft')}>
                          MTR
                        </button>
                        <button type="button"
                          onClick={() => patch(idx, { entry_mode: 'pcs' })}
                          className={'px-2 py-0.5 text-[10px] rounded border ' + (it.entry_mode === 'pcs' ? 'bg-indigo text-white border-indigo' : 'bg-white border-line text-ink-soft')}>
                          PCS &times; L
                        </button>
                      </div>
                      {it.entry_mode === 'mtr' ? (
                        <input type="number" step="0.01" min="0" value={it.received_metres}
                          onChange={(e) => patch(idx, { received_metres: e.target.value })}
                          className="input h-8 text-xs num w-28 text-right" placeholder="metres" />
                      ) : (
                        <div className="flex items-center gap-1">
                          <input type="number" step="0.01" min="0" value={it.length_per_pc}
                            onChange={(e) => patch(idx, { length_per_pc: e.target.value })}
                            className="input h-8 text-xs num w-20 text-right" placeholder="length / pc" />
                          <span className="text-[10px] text-ink-mute">= {fmtMoney(m)}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {it.seed.weft_yarn_count_code ?? <span className="text-ink-mute">nil</span>}
                  </td>
                  <td className="px-2 py-2 text-right num text-xs">
                    {it.seed.weft_kg_per_m > 0 ? fmtMoney(it.seed.weft_kg_per_m) : <span className="text-ink-mute">nil</span>}
                  </td>
                  <td className="px-2 py-2 text-right num text-xs font-semibold">
                    {consumed > 0 ? fmtMoney(consumed) : '-'}
                  </td>
                  <td className="px-2 py-2">
                    <input type="text" value={it.product}
                      onChange={(e) => patch(idx, { product: e.target.value })}
                      className="input h-8 text-xs w-32" placeholder="-" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" min="0" value={it.qty}
                      onChange={(e) => patch(idx, { qty: e.target.value })}
                      className="input h-8 text-xs num w-20 text-right" placeholder="-" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Transport / freight / beams / remarks */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="label">Transport</label>
          <input type="text" value={transport} onChange={(e) => setTransport(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Freight charges</label>
          <input type="number" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} className="input num text-right" />
        </div>
        <div>
          <label className="label">Empty beams</label>
          <input type="number" step="1" min="0" value={emptyBeams} onChange={(e) => setEmptyBeams(e.target.value)} className="input num text-right" />
        </div>
        <div className="md:col-span-4">
          <label className="label">Remarks</label>
          <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="input" />
        </div>
      </div>

      {/* Consumption summary */}
      <div className="card p-4">
        <h2 className="font-display font-bold text-sm mb-3">Consumption (against received metres)</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Received</div>
            <div className="num font-bold text-lg">{fmtMoney(totals.metres)} m</div>
            <div className="text-[10px] text-ink-mute">{totals.pieces} pcs</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Weft yarn</div>
            <div className="num font-bold text-lg">{fmtMoney(totals.weftKg)} kg</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Porvai yarn</div>
            <div className="num font-bold text-lg">
              {totals.porvaiKg > 0 ? fmtMoney(totals.porvaiKg) + ' kg' : <span className="text-ink-mute text-sm">nil</span>}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Bobbin</div>
            <div className="num font-bold text-lg">
              {totals.bobbinPcs > 0 ? fmtMoney(totals.bobbinPcs) + ' pcs' : <span className="text-ink-mute text-sm">nil</span>}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">DC totals</div>
            <div className="text-xs">{fmtMoney(dc.total_metres)} m &middot; {dc.total_pieces} pcs &middot; {dc.total_bundles} bdl</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-3 text-err text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save fabric receipt
        </button>
        <button type="button" onClick={() => router.push('/app/jobwork')} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" /> Cancel
        </button>
      </div>
    </form>
  );
}
