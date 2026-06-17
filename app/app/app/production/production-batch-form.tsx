'use client';
/**
 * Shared Production Batch form — used by both the New and Edit pages.
 *
 * Simplified flow (rework, mid-2026):
 *   1. Pick the costing (fabric quality being woven).
 *   2. Pick the pavu_assign — drives loom_id + warp_lot_id automatically.
 *      No manual override controls; if you need outsourced beam handling,
 *      use the jobwork fabric receipt flow.
 *   3. Produced m, Rejected m, Start/End dates, Notes.
 *   4. Optional: "Convert to towel pieces" toggle with length per towel
 *      (default 1.7 m). When ON, the produced fabric ledger row writes
 *      pieces (produced_m / length) instead of metres.
 *
 * On submit:
 *   - Insert / update production_batch (snapshot triggers fill actual_*
 *     cost columns).
 *   - Best-effort write to stock_ledger:
 *        warp_beam     out  produced_m              (m)
 *        weft_yarn     out  weft_kg_per_m * m       (kg, if > 0)
 *        porvai_yarn   out  porvai_kg_per_m * m     (kg, if > 0)
 *        bobbin        out  produced_m / metres     (pcs, per costing row)
 *        production_fabric in produced_m or pcs      (m or pcs)
 *
 *   On edit, old ledger rows (source_kind='production_batch',
 *   source_id=batch.id) are deleted first, then reinserted.
 *
 *   Ledger write failures are surfaced but do not roll back the batch.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type ProductionBatchInsert = Database['public']['Tables']['production_batch']['Insert'];

interface Costing {
  id: number;
  quality_code: string;
  quality_name: string;
  approval_status: string;
}

interface ActivePavuAssign {
  id: number;
  loom_id: number;
  status: string;
  start_date: string | null;
  loom: { id: number; loom_code: string } | null;
  pavu: {
    id: number;
    pavu_code: string;
    beam_no: string;
    meters: number;
    sizing_job: {
      id: number;
      job_code: string;
      sizing_rate_per_kg: number;
      yarn_lot_id: number | null;
    } | null;
  } | null;
}

interface CostingPreview {
  quoted_cost_per_m: number | null;
  true_cost_per_m: number | null;
  sizing_cost_per_m: number | null;
  warp_cost_per_m: number | null;
  weft_cost_per_m: number | null;
}

interface CostingForLedger {
  weft_kg_per_m: number | null;
  porvai_kg_per_m: number | null;
  warp_count_id: number | null;
  weft_count_id: number | null;
  porvai_count_id: number | null;
}

interface CostingBobbinRow {
  bobbin_id: number;
  metres: number | null;
}

export interface InitialBatch {
  id: number;
  costing_id: number;
  pavu_assign_id: number | null;
  loom_id: number | null;
  warp_lot_id: number | null;
  produced_m: number;
  rejected_m: number;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  batch_code: string;
}

interface ProductionBatchFormProps {
  mode: 'new' | 'edit';
  initial?: InitialBatch;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export function ProductionBatchForm({ mode, initial }: ProductionBatchFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  // ── master data ───────────────────────────────────────────────────────────
  const [costings, setCostings] = useState<Costing[]>([]);
  const [assigns, setAssigns] = useState<ActivePavuAssign[]>([]);
  const [loading, setLoading] = useState(true);

  // ── form state ────────────────────────────────────────────────────────────
  const [costingId, setCostingId] = useState(initial ? String(initial.costing_id) : '');
  const [pavuAssignId, setPavuAssignId] = useState(initial?.pavu_assign_id != null ? String(initial.pavu_assign_id) : '');
  const [loomId, setLoomId] = useState(initial?.loom_id != null ? String(initial.loom_id) : '');
  const [warpLotId, setWarpLotId] = useState(initial?.warp_lot_id != null ? String(initial.warp_lot_id) : '');

  const [startDate, setStartDate] = useState(initial?.start_date ?? '');
  const [endDate, setEndDate] = useState(initial?.end_date ?? (initial ? '' : today()));
  const [producedM, setProducedM] = useState(initial ? String(initial.produced_m) : '');
  const [rejectedM, setRejectedM] = useState(initial ? String(initial.rejected_m) : '0');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const [convertToTowel, setConvertToTowel] = useState(false);
  const [towelLength, setTowelLength] = useState('1.7');

  const [preview, setPreview] = useState<CostingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledgerWarning, setLedgerWarning] = useState<string | null>(null);

  // ── load master data ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [costingsRes, a] = await Promise.all([
        (async () => {
          const [fqRes, cmRes] = await Promise.all([
            sb.from('fabric_quality')
              .select('id, code, name, costing_id, active')
              .eq('active', true)
              .not('costing_id', 'is', null)
              .order('code'),
            sb.from('costing_master')
              .select('id, approval_status')
              .eq('approval_status', 'approved'),
          ]);
          const cms = new Map<number, { approval_status: string }>();
          for (const c of (cmRes.data ?? []) as Array<{ id: number; approval_status: string }>) {
            cms.set(c.id, c);
          }
          const merged = ((fqRes.data ?? []) as Array<{ id: number; code: string; name: string; costing_id: number | null }>)
            .map((f) => {
              const cm = f.costing_id != null ? cms.get(f.costing_id) : null;
              if (!cm) return null;
              return {
                id: f.costing_id as number,
                quality_code: f.code,
                quality_name: f.name,
                approval_status: cm.approval_status,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          return { data: merged };
        })(),
        supabase
          .from('pavu_assign')
          .select(`
            id, loom_id, status, start_date,
            loom:loom_id ( id, loom_code ),
            pavu:pavu_id (
              id, pavu_code, beam_no, meters,
              sizing_job:sizing_job_id ( id, job_code, sizing_rate_per_kg, yarn_lot_id )
            )
          `)
          .in('status', ['mounted', 'running', 'completed'])
          .order('start_date', { ascending: false })
          .limit(50),
      ]);

      setCostings(costingsRes.data ?? []);
      setAssigns((a.data as unknown as ActivePavuAssign[]) ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  // ── load cost preview whenever costing changes ────────────────────────────
  useEffect(() => {
    if (!costingId) {
      setPreview(null);
      return;
    }
    (async () => {
      const { data, error: pErr } = await supabase
        .from('v_costing_two_cost')
        .select('quoted_cost_per_m, true_cost_per_m, sizing_cost_per_m, warp_cost_per_m, weft_cost_per_m')
        .eq('id', Number(costingId))
        .maybeSingle();
      if (pErr) {
        setPreview(null);
        return;
      }
      setPreview(data as unknown as CostingPreview);
    })();
  }, [supabase, costingId]);

  // ── react to pavu_assign selection: auto-fill loom + warp_lot ─────────────
  useEffect(() => {
    if (!pavuAssignId) return;
    const pa = assigns.find(x => String(x.id) === pavuAssignId);
    if (!pa) return;
    if (pa.loom?.id) setLoomId(String(pa.loom.id));
    if (pa.pavu?.sizing_job?.yarn_lot_id) {
      setWarpLotId(String(pa.pavu.sizing_job.yarn_lot_id));
    }
    if (!startDate && pa.start_date) setStartDate(pa.start_date);
  }, [pavuAssignId, assigns, startDate]);

  // ── ledger writer ─────────────────────────────────────────────────────────
  async function writeStockLedger(batchId: number, batchCode: string, producedMetres: number): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Pull the costing's per-metre consumption and yarn counts.
    const { data: costingRow, error: cErr } = await sb
      .from('costing_master')
      .select('weft_kg_per_m, porvai_kg_per_m, warp_count_id, weft_count_id, porvai_count_id')
      .eq('id', Number(costingId))
      .maybeSingle();
    if (cErr) {
      return `Failed to load costing for ledger: ${cErr.message}`;
    }
    const costing = (costingRow ?? {}) as CostingForLedger;

    // Lookup the fabric_quality.id whose costing_id == this costing.
    // If none exists, write the rows anyway with fabric_quality_id = null.
    let linkedFqId: number | null = null;
    const { data: fqRow } = await sb
      .from('fabric_quality')
      .select('id')
      .eq('costing_id', Number(costingId))
      .limit(1)
      .maybeSingle();
    if (fqRow && typeof fqRow.id === 'number') linkedFqId = fqRow.id;

    // Pull bobbin children for this costing.
    const { data: bobbinRows } = await sb
      .from('costing_master_bobbin')
      .select('bobbin_id, metres')
      .eq('costing_id', Number(costingId));
    const bobbins = ((bobbinRows ?? []) as CostingBobbinRow[]);

    const evt = endDate || startDate || today();
    const src = {
      source_kind: 'production_batch' as const,
      source_id: batchId,
      event_date: evt,
      reference_no: batchCode,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ledgerRows: any[] = [];

    // Warp metre outflow — 1:1 with produced metres.
    ledgerRows.push({
      bucket: 'warp_beam',
      direction: 'out',
      fabric_quality_id: linkedFqId,
      yarn_count_id: costing.warp_count_id ?? null,
      quantity: producedMetres,
      unit: 'm',
      ...src,
      notes: 'Consumed by production batch',
    });

    const weftKgPerM = Number(costing.weft_kg_per_m ?? 0);
    const weftKg = weftKgPerM * producedMetres;
    if (weftKg > 0) {
      ledgerRows.push({
        bucket: 'weft_yarn',
        direction: 'out',
        fabric_quality_id: linkedFqId,
        yarn_count_id: costing.weft_count_id ?? null,
        quantity: weftKg,
        unit: 'kg',
        ...src,
        notes: 'Consumed by production batch',
      });
    }

    const porvaiKgPerM = Number(costing.porvai_kg_per_m ?? 0);
    const porvaiKg = porvaiKgPerM * producedMetres;
    if (porvaiKg > 0) {
      ledgerRows.push({
        bucket: 'porvai_yarn',
        direction: 'out',
        fabric_quality_id: linkedFqId,
        yarn_count_id: costing.porvai_count_id ?? null,
        quantity: porvaiKg,
        unit: 'kg',
        ...src,
        notes: 'Consumed by production batch',
      });
    }

    for (const b of bobbins) {
      const metres = Number(b.metres ?? 0);
      if (!(metres > 0)) continue;
      const pieces = producedMetres / metres;
      ledgerRows.push({
        bucket: 'bobbin',
        direction: 'out',
        fabric_quality_id: linkedFqId,
        bobbin_id: b.bobbin_id,
        quantity: pieces,
        unit: 'pcs',
        ...src,
        notes: 'Consumed by production batch',
      });
    }

    // Production fabric INFLOW
    const towelLenNum = Number(towelLength);
    const towelMode = convertToTowel === true && towelLenNum > 0;
    ledgerRows.push({
      bucket: 'production_fabric',
      direction: 'in',
      fabric_quality_id: linkedFqId,
      quantity: towelMode ? producedMetres / towelLenNum : producedMetres,
      unit: towelMode ? 'pcs' : 'm',
      ...src,
      notes: towelMode ? `Produced as towel (${towelLenNum} m/pc)` : 'Produced fabric stock',
    });

    const { error: insErr } = await sb.from('stock_ledger').insert(ledgerRows);
    if (insErr) {
      return `Stock ledger write failed (batch was saved): ${insErr.message}`;
    }
    return null;
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLedgerWarning(null);

    if (!costingId) {
      setError('Pick the quality being woven.');
      return;
    }
    const producedNum = Number(producedM);
    if (!producedM || !(producedNum > 0)) {
      setError('Produced metres must be > 0.');
      return;
    }
    if (convertToTowel && !(Number(towelLength) > 0)) {
      setError('Length per towel must be > 0 when towel conversion is on.');
      return;
    }

    setBusy(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    let batchId: number;
    let batchCode: string;

    if (mode === 'edit' && initial) {
      // UPDATE existing row.
      const updatePayload = {
        costing_id: Number(costingId),
        pavu_assign_id: pavuAssignId ? Number(pavuAssignId) : null,
        loom_id: loomId ? Number(loomId) : null,
        warp_lot_id: warpLotId ? Number(warpLotId) : null,
        start_date: startDate || null,
        end_date: endDate || null,
        produced_m: producedNum,
        rejected_m: Number(rejectedM || 0),
        notes: notes || null,
      };
      const { data: updated, error: updErr } = await sb
        .from('production_batch')
        .update(updatePayload)
        .eq('id', initial.id)
        .select('id, batch_code')
        .maybeSingle();
      if (updErr || !updated) {
        setBusy(false);
        setError(updErr?.message ?? 'Failed to update batch.');
        return;
      }
      batchId = updated.id;
      batchCode = updated.batch_code;

      // Delete previous ledger rows for this batch.
      const { error: delErr } = await sb
        .from('stock_ledger')
        .delete()
        .eq('source_kind', 'production_batch')
        .eq('source_id', batchId);
      if (delErr) {
        setBusy(false);
        setLedgerWarning(`Could not clear old ledger rows: ${delErr.message}. Batch was updated; ledger not reset.`);
        return;
      }
    } else {
      // INSERT new row. batch_code auto-generated by trigger (migration 008).
      const payload: ProductionBatchInsert = {
        batch_code: '',
        costing_id: Number(costingId),
        so_line_id: null,
        pavu_assign_id: pavuAssignId ? Number(pavuAssignId) : null,
        loom_id: loomId ? Number(loomId) : null,
        warp_lot_id: warpLotId ? Number(warpLotId) : null,
        weft_lot_id: null,
        porvai_lot_id: null,
        bobbin_1_id: null,
        bobbin_2_id: null,
        start_date: startDate || null,
        end_date: endDate || null,
        produced_m: producedNum,
        rejected_m: Number(rejectedM || 0),
        notes: notes || null,
      };
      const { data: inserted, error: insErr } = await sb
        .from('production_batch')
        .insert(payload)
        .select('id, batch_code')
        .maybeSingle();
      if (insErr || !inserted) {
        setBusy(false);
        setError(insErr?.message ?? 'Failed to save batch.');
        return;
      }
      batchId = inserted.id;
      batchCode = inserted.batch_code;
    }

    // Best-effort ledger write — surface error but don't roll back the batch.
    const ledgerErr = await writeStockLedger(batchId, batchCode, producedNum);
    setBusy(false);

    if (ledgerErr) {
      setLedgerWarning(ledgerErr);
      return;
    }

    router.push('/app/production');
    router.refresh();
  }

  if (loading) {
    return (
      <div className="card p-10 text-center text-ink-soft text-sm">
        <Loader2 className="w-5 h-5 inline animate-spin mr-2" /> Loading masters…
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-3xl">
      {/* ─── Section 1: Quality ────────────────────────────────────────── */}
      <section className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">
          1. Quality being woven
        </h3>
        <div>
          <label className="label">Fabric Quality *</label>
          <select
            required
            value={costingId}
            onChange={e => setCostingId(e.target.value)}
            className="input"
          >
            <option value="" disabled>Select quality…</option>
            {costings.map(c => (
              <option key={c.id} value={c.id}>
                {c.quality_code} — {c.quality_name}
              </option>
            ))}
          </select>
          {costings.length === 0 && (
            <div className="text-xs text-amber-700 mt-1">
              No fabric qualities with an approved costing. Set up one in Fabric Quality master + approve its costing first.
            </div>
          )}
        </div>

        {preview && (
          <div className="rounded-lg bg-cloud/60 border border-line/60 p-3 text-xs space-y-1">
            <div className="font-semibold text-ink-soft">Costing snapshot will freeze:</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 num">
              <div>Warp: <span className="font-semibold">₹{Number(preview.warp_cost_per_m ?? 0).toFixed(2)}</span></div>
              <div>Weft: <span className="font-semibold">₹{Number(preview.weft_cost_per_m ?? 0).toFixed(2)}</span></div>
              <div>Sizing: <span className="font-semibold">₹{Number(preview.sizing_cost_per_m ?? 0).toFixed(2)}</span></div>
              <div>Quoted: <span className="font-semibold">₹{Number(preview.quoted_cost_per_m ?? 0).toFixed(2)}</span></div>
              <div>True: <span className="font-semibold text-indigo">₹{Number(preview.true_cost_per_m ?? 0).toFixed(2)}</span></div>
            </div>
          </div>
        )}
      </section>

      {/* ─── Section 2: Warp (pavu_assign) ─────────────────────────────── */}
      <section className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">
          2. Pavu assignment
        </h3>
        <div>
          <label className="label">Pavu assignment (drives loom + warp lot)</label>
          <select
            value={pavuAssignId}
            onChange={e => setPavuAssignId(e.target.value)}
            className="input"
          >
            <option value="">— None —</option>
            {assigns.map(a => (
              <option key={a.id} value={a.id}>
                {a.loom?.loom_code ?? '?'} ·{' '}
                {a.pavu?.pavu_code ?? '?'} (Beam {a.pavu?.beam_no ?? '?'}) ·{' '}
                Sizing {a.pavu?.sizing_job?.job_code ?? '?'}{' '}
                · {Number(a.pavu?.meters ?? 0).toFixed(0)} m
              </option>
            ))}
          </select>
          <div className="text-xs text-ink-mute mt-1">
            Picking a pavu auto-fills the loom + warp lot and snapshots the actual sizing ₹/kg.
          </div>
        </div>
      </section>

      {/* ─── Section 3: Production data ────────────────────────────────── */}
      <section className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">
          3. Production
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Produced (m) *</label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={producedM}
              onChange={e => setProducedM(e.target.value)}
              className="input num"
            />
          </div>
          <div>
            <label className="label">Rejected (m)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={rejectedM}
              onChange={e => setRejectedM(e.target.value)}
              className="input num"
            />
          </div>
        </div>

        {/* Convert to towel pieces toggle */}
        <div className="rounded-lg border border-line/60 bg-cloud/30 p-3 space-y-2">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={convertToTowel}
              onChange={e => setConvertToTowel(e.target.checked)}
            />
            <span className="font-semibold">Convert to towel pieces</span>
            <span className="text-ink-mute text-xs">— produced fabric will be recorded as pieces, not metres.</span>
          </label>
          {convertToTowel && (
            <div className="max-w-xs">
              <label className="label">Length per towel (m)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={towelLength}
                onChange={e => setTowelLength(e.target.value)}
                className="input num"
              />
            </div>
          )}
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="input"
            placeholder="Anything the floor or accounts should know about this batch."
          />
        </div>
      </section>

      {error && (
        <div className="card p-3 text-sm text-err bg-red-50/40 border-red-100">{error}</div>
      )}
      {ledgerWarning && (
        <div className="card p-3 text-sm text-amber-800 bg-amber-50/60 border-amber-200">
          {ledgerWarning}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/app/production')}
          className="btn-ghost"
        >
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy || !costingId || !producedM}>
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </>
          ) : mode === 'edit' ? (
            'Save changes'
          ) : (
            'Record batch'
          )}
        </button>
      </div>
    </form>
  );
}
