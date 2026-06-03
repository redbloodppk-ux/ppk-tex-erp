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
import { applyFabricReceiptStockReductions, type ReceiptItemForReduction, type Shortfall } from '@/lib/fabric-receipt/stock-reductions';

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
  /** Current stock totals (before this receipt is applied). Used to
   *  render the Before / After Stock card. */
  stock: {
    pavu_m: number;
    weft_kg: number;
    porvai_kg: number;
    bobbin_m: number;
  };
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
  weft_count_ne: number | null;
  weft_kg_per_m: number;
  porvai_kg_per_m: number;
  bobbin_pcs_per_m: number;
  /** ends_per_bobbin from the bobbin master row assigned to this fabric
   *  quality (via calc_snapshot.bobbinId). Used by the item-row display. */
  bobbin_ends: number | null;
  /** Length per piece (towel length) auto-fetched from the fabric_quality
   *  master meter_per_pc column. When non-null the towel-length input
   *  pre-fills with this value and the operator just types the towel
   *  count in the received-metres column. */
  towel_length: number | null;
  dc_metres: number;
  dc_pieces: number;
  dc_bundles: number;
  hsn: string;
}

interface ItemState {
  seed: ReceiptItemSeed;
  /** Length of each towel in metres. When > 0 we treat received_metres
   *  as a towel COUNT and the effective metres = received_metres ×
   *  towel_length. When 0/blank, received_metres is the actual metres. */
  towel_length: string;
  received_metres: string;
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
/** 5-decimal formatter for per-metre yarn-consumption rates (e.g. 0.020027). */
function fmtRate(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Resolve effective received metres from the item state. If a towel
 *  length is set, the typed received_metres is treated as a towel count
 *  and the actual metres = count × towel_length. Otherwise the typed
 *  value is taken as actual metres. */
function resolvedMetres(it: ItemState): number {
  const m = num(it.received_metres);
  const t = num(it.towel_length);
  return round2(t > 0 ? m * t : m);
}

export function FabricReceiptForm({ dc, seeds }: FabricReceiptFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  // Header state
  const [receiptDate, setReceiptDate] = useState<string>(todayISO());

  // One row of state per DC item. The towel length is auto-fetched from
  // the fabric_quality master (meter_per_pc) when the quality is tagged
  // as a towel - operators don't need to type it in again. They can
  // still edit the value per receipt if a particular batch is different.
  const [items, setItems] = useState<ItemState[]>(
    seeds.map((s) => ({
      seed: s,
      towel_length: s.towel_length != null && s.towel_length > 0 ? String(s.towel_length) : '',
      received_metres: String(s.dc_metres || 0),
    })),
  );

  const [busy, setBusy]   = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);

  function patch(idx: number, mut: Partial<ItemState>): void {
    setItems((arr) => arr.map((x, i) => i === idx ? { ...x, ...mut } : x));
  }

  // ── Aggregates ──────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let metres = 0;
    let pieces = 0;
    let weftKg = 0;
    let porvaiKg = 0;
    let bobbinMtrs = 0;
    for (const it of items) {
      const m = resolvedMetres(it);
      metres += m;
      // When a towel length is set the typed received_metres is the
      // towel count - that's our piece count for the receipt.
      const towelLen = num(it.towel_length);
      pieces += towelLen > 0 ? Math.round(num(it.received_metres)) : 0;
      weftKg   += m * it.seed.weft_kg_per_m;
      porvaiKg += m * it.seed.porvai_kg_per_m;
      // Bobbin stock is reduced 1:1 in metres against the received fabric
      // metres - only counted when the quality actually uses a bobbin
      // (bobbin_pcs_per_m on the master is > 0). The "pcs_per_m" column
      // is treated as a 0/1 flag for "this quality has a bobbin assigned".
      if (it.seed.bobbin_pcs_per_m > 0) bobbinMtrs += m;
    }
    return {
      metres: round2(metres),
      pieces,
      weftKg: round2(weftKg),
      porvaiKg: round2(porvaiKg),
      bobbinMtrs: round2(bobbinMtrs),
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
      // Receipt type field removed from the UI - default to 'weaving'.
      receipt_type: 'weaving',
      dc_id: dc.id,
      party_id: dc.party_id,
      party_dc_no: dc.code,
      transport_mode: null,
      freight_charges: 0,
      empty_beams: 0,
      remarks: null,
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
      const hasBobbin = it.seed.bobbin_pcs_per_m > 0;
      const bobMtrs  = hasBobbin ? m : 0;
      // If towel length is set, the typed received_metres is the towel
      // count; otherwise it's actual metres and we save 0 as the count.
      const towelLen = round2(num(it.towel_length));
      const pieces   = towelLen > 0 ? Math.round(num(it.received_metres)) : 0;
      return {
        receipt_id: receiptId,
        sno: it.seed.sno || idx + 1,
        fabric_quality_id: it.seed.fabric_quality_id,
        ends_id: it.seed.ends_id,
        ends_count_snapshot: it.seed.ends_count,
        fd_pct: null,
        no_of_pieces: pieces,
        // Towel length is stored on the existing length_per_pc column so
        // we don't need a schema change. Detail page reads it back.
        length_per_pc: towelLen > 0 ? towelLen : null,
        received_metres: m,
        entry_mode: towelLen > 0 ? 'pcs' : 'mtr',
        weft_yarn_count_id: it.seed.weft_yarn_count_id,
        weft_kg_per_m:    it.seed.weft_kg_per_m   > 0 ? it.seed.weft_kg_per_m   : null,
        weft_consumed_kg: weftKg > 0 ? weftKg : null,
        porvai_yarn_count_id: null,
        porvai_kg_per_m:    it.seed.porvai_kg_per_m   > 0 ? it.seed.porvai_kg_per_m   : null,
        porvai_consumed_kg: porvaiKg > 0 ? porvaiKg : null,
        bobbin_id: null,
        bobbin_pcs_per_m:    hasBobbin ? 1 : null,
        bobbin_consumed_pcs: bobMtrs > 0 ? bobMtrs : null,
        product: null,
        qty: null,
      };
    });
    const { error: itemErr } = await sb.from('fabric_receipt_item').insert(itemPayload);
    if (itemErr) {
      setBusy(false);
      setError(`Receipt ${hdr.code} saved, but items failed: ${itemErr.message}`);
      return;
    }

    // Link the DC back to this receipt + advance its workflow status to
    // 'confirmed' so the next step (jobwork bill) can pick it up. The DC
    // status pipeline is automatic now: draft -> confirmed on receipt ->
    // invoiced when the jobwork bill is raised.
    await sb.from('delivery_challan')
      .update({ fabric_receipt_id: receiptId, status: 'confirmed' })
      .eq('id', dc.id);

    // Apply stock reductions FIFO across pavu / yarn_lot / bobbin. If any
    // bucket can't satisfy the full amount we still keep the receipt
    // saved and surface the shortfalls so the operator can investigate.
    const reductionItems: ReceiptItemForReduction[] = items.map((it) => {
      const m = resolvedMetres(it);
      return {
        fabric_quality_id: it.seed.fabric_quality_id,
        received_metres: m,
        weft_consumed_kg:   it.seed.weft_kg_per_m   > 0 ? round2(m * it.seed.weft_kg_per_m)   : null,
        porvai_consumed_kg: it.seed.porvai_kg_per_m > 0 ? round2(m * it.seed.porvai_kg_per_m) : null,
        // Bobbin row is resolved inside reduceBobbin via the fabric
        // quality's calc_snapshot.bobbinId. We just signal whether
        // bobbin reduction should run for this item.
        has_bobbin: it.seed.bobbin_pcs_per_m > 0,
      };
    });
    const reduction = await applyFabricReceiptStockReductions(sb, reductionItems);

    setBusy(false);
    if (reduction.shortfalls.length > 0) {
      setShortfalls(reduction.shortfalls);
      // Don't navigate away - let the operator read the warnings.
      return;
    }
    router.push('/app/jobwork');
    router.refresh();
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* Header card */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="label">Receipt no</label>
            <div className="input bg-cloud/40 text-ink-mute">Auto (FR/26-27/NNNN)</div>
          </div>
          <div>
            <label className="label">Receipt date</label>
            <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="input" required />
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
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-2 py-2">SNo</th>
              <th className="text-left  px-2 py-2">Quality</th>
              <th className="text-right px-2 py-2">Ends</th>
              <th className="text-right px-2 py-2">Towel length</th>
              <th className="text-right px-2 py-2">Received metres</th>
              <th className="text-left  px-2 py-2">Weft count</th>
              <th className="text-right px-2 py-2">Weft cons/m</th>
              <th className="text-right px-2 py-2">Consumed wt (kg)</th>
              <th className="text-right px-2 py-2">Bobbin ends</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const m = resolvedMetres(it);
              const consumed = round2(m * it.seed.weft_kg_per_m);
              const hasBobbin = it.seed.bobbin_pcs_per_m > 0;
              const bobbinMtrs = hasBobbin ? m : 0;
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
                    <input type="number" step="0.01" min="0" value={it.towel_length}
                      onChange={(e) => patch(idx, { towel_length: e.target.value })}
                      className="input h-8 text-xs num w-24 text-right" placeholder="m / towel" />
                    {it.seed.towel_length != null && it.seed.towel_length > 0 && (
                      <div className="text-[10px] text-ink-mute text-right mt-0.5">
                        auto: {fmtMoney(it.seed.towel_length)} m
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" min="0" value={it.received_metres}
                      onChange={(e) => patch(idx, { received_metres: e.target.value })}
                      className="input h-8 text-xs num w-28 text-right"
                      placeholder={num(it.towel_length) > 0 ? 'towel count' : 'metres'} />
                    {num(it.towel_length) > 0 && (
                      <div className="text-[10px] text-ink-mute text-right mt-0.5">
                        = {fmtMoney(m)} m
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {it.seed.weft_count_ne != null
                      ? <span className="font-semibold">{it.seed.weft_count_ne}</span>
                      : it.seed.weft_yarn_count_code
                        ? <span>{it.seed.weft_yarn_count_code}</span>
                        : <span className="text-ink-mute">nil</span>}
                  </td>
                  <td className="px-2 py-2 text-right num text-xs">
                    {it.seed.weft_kg_per_m > 0 ? fmtRate(it.seed.weft_kg_per_m) : <span className="text-ink-mute">nil</span>}
                  </td>
                  <td className="px-2 py-2 text-right num text-xs font-semibold">
                    {consumed > 0 ? fmtMoney(consumed) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right num text-xs">
                    {it.seed.bobbin_ends != null
                      ? <span className="font-semibold">{it.seed.bobbin_ends}</span>
                      : <span className="text-ink-mute">nil</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Consumption summary */}
      <div className="card p-4">
        <h2 className="font-display font-bold text-sm mb-3">Consumption (against received metres)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Bobbin metres</div>
            <div className="num font-bold text-lg">
              {totals.bobbinMtrs > 0 ? fmtMoney(totals.bobbinMtrs) + ' m' : <span className="text-ink-mute text-sm">nil</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Stock before / after this receipt */}
      <div className="card p-4">
        <h2 className="font-display font-bold text-sm mb-3">Stock impact</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-2 py-2">Bucket</th>
                <th className="text-right px-2 py-2">Before</th>
                <th className="text-right px-2 py-2">Consumed</th>
                <th className="text-right px-2 py-2">After</th>
              </tr>
            </thead>
            <tbody>
              {([
                { label: 'Warp beam metres',  before: dc.stock.pavu_m,   used: totals.metres,     unit: 'm'  },
                { label: 'Weft yarn',          before: dc.stock.weft_kg,  used: totals.weftKg,     unit: 'kg' },
                { label: 'Porvai yarn',        before: dc.stock.porvai_kg, used: totals.porvaiKg,  unit: 'kg' },
                { label: 'Bobbin metres',      before: dc.stock.bobbin_m, used: totals.bobbinMtrs, unit: 'm'  },
              ] as const).map((b) => {
                const after = round2(b.before - b.used);
                const short = after < 0;
                return (
                  <tr key={b.label} className="border-t border-line/40">
                    <td className="px-2 py-2 font-medium">{b.label}</td>
                    <td className="px-2 py-2 text-right num">{fmtMoney(b.before)} {b.unit}</td>
                    <td className="px-2 py-2 text-right num text-amber-700">
                      {b.used > 0 ? '\u2212 ' + fmtMoney(b.used) + ' ' + b.unit : '-'}
                    </td>
                    <td className={'px-2 py-2 text-right num font-semibold ' + (short ? 'text-rose-700' : 'text-emerald-700')}>
                      {fmtMoney(after)} {b.unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock-reduction shortfalls (receipt is still saved). */}
      {shortfalls.length > 0 && (
        <div className="card p-4 border-l-4 border-l-amber-500 bg-amber-50/40">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            <h2 className="font-display font-bold text-sm text-amber-800">
              Receipt saved, but some stock buckets fell short
            </h2>
          </div>
          <p className="text-xs text-ink-soft mb-3">
            The receipt is stored and the DC is marked received. The
            following stock movements could not be fully applied -
            please reconcile the affected master rows manually.
          </p>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-2 py-1">Bucket</th>
                <th className="text-right px-2 py-1">Needed</th>
                <th className="text-right px-2 py-1">Applied</th>
                <th className="text-right px-2 py-1">Short by</th>
                <th className="text-left  px-2 py-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {shortfalls.map((s, i) => {
                const shortBy = Math.max(0, s.needed - s.applied);
                return (
                  <tr key={i} className="border-t border-amber-200/60">
                    <td className="px-2 py-1 capitalize">{s.bucket.replace('_', ' ')}</td>
                    <td className="px-2 py-1 text-right num">{fmtMoney(s.needed)} {s.unit}</td>
                    <td className="px-2 py-1 text-right num">{fmtMoney(s.applied)} {s.unit}</td>
                    <td className="px-2 py-1 text-right num text-rose-700">{fmtMoney(shortBy)} {s.unit}</td>
                    <td className="px-2 py-1 text-ink-soft">{s.note ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => router.push('/app/jobwork')} className="btn-secondary text-xs">
              Back to Jobwork
            </button>
            <span className="text-xs text-ink-mute">
              Or stay here to copy the warnings before navigating away.
            </span>
          </div>
        </div>
      )}

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
