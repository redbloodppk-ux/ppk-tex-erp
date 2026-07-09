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
 *   - Best-effort write to stock_ledger (all modes):
 *        warp_beam     out  produced_m              (m)
 *        weft_yarn     out  weft_kg_per_m * m       (kg, if > 0)
 *        porvai_yarn   out  porvai_kg_per_m * m     (kg, if > 0)
 *        bobbin        out  produced_m              (m, per costing row — 1:1 with fabric)
 *   - Produced fabric destination depends on production_mode:
 *        inhouse              → stock_ledger 'production_fabric' in (m or pcs)
 *        jobwork / outsource  → a fabric_stock row (source_type
 *                               jobwork/outsourced, batch_id) so it shows on
 *                               the warehouse Job Work / Outsource fabric tab.
 *
 *   On edit, old ledger rows (source_kind='production_batch',
 *   source_id=batch.id) AND any fabric_stock row (batch_id) are deleted
 *   first, then reinserted per the current mode.
 *
 *   Ledger write failures are surfaced but do not roll back the batch.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type ProductionBatchInsert = Database['public']['Tables']['production_batch']['Insert'];

/** Weaving mode for a batch. Mirrors the DC form's three production modes. */
export type ProductionMode = 'inhouse' | 'jobwork' | 'outsource';

interface Costing {
  id: number;
  quality_code: string;
  quality_name: string;
  approval_status: string;
  /** Towel length (m per piece) from fabric_quality — null for running fabric. */
  meter_per_pc: number | null;
}

/** Party master option — filtered by party type for jobwork / outsource. */
interface PartyOpt {
  id: number;
  code: string;
  name: string;
  party_type_ids: number[] | null;
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
  // Production mode + weaver party (migration 222). Older rows pre-dating
  // the migration default to 'inhouse' with a null party.
  production_mode?: ProductionMode | null;
  party_id?: number | null;
  produced_m: number;
  rejected_m: number;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  batch_code: string;
  // Batch DC fields (migration 195). Older rows pre-dating the migration
  // may arrive without these set — we treat missing values as 'summary'
  // mode with an empty bundles list.
  entry_mode?: 'summary' | 'detailed' | null;
  total_pieces?: number | null;
  total_bundles?: number | null;
  bundles_detail?: BundleDetailRow[] | null;
}

/** Shape of one entry in production_batch.bundles_detail JSONB. */
interface BundleDetailRow {
  sno: number;
  pieces: number[];
}

/** UI-side bundle entry — piece metres held as controlled string inputs. */
interface BundleEntry {
  sno: number;
  pieces: string[];
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
  // Reusable placeholder costing for jobwork fabric with no real costing.
  // In jobwork the weaver is paid for weaving and does not own the material
  // cost, so a fabric costing is optional — we attach this row instead.
  const [exemptCostingId, setExemptCostingId] = useState<number | null>(null);
  const [assigns, setAssigns] = useState<ActivePavuAssign[]>([]);
  const [allParties, setAllParties] = useState<PartyOpt[]>([]);
  const [jobworkTypeId, setJobworkTypeId] = useState<number | null>(null);
  const [outsourceTypeId, setOutsourceTypeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // ── form state ────────────────────────────────────────────────────────────
  // Weaving mode + weaver party. inhouse leaves party empty; jobwork /
  // outsource require a party of the matching type.
  const [productionMode, setProductionMode] = useState<ProductionMode>(
    initial?.production_mode === 'jobwork' ? 'jobwork'
      : initial?.production_mode === 'outsource' ? 'outsource'
      : 'inhouse',
  );
  const [partyId, setPartyId] = useState(initial?.party_id != null ? String(initial.party_id) : '');
  const [costingId, setCostingId] = useState(initial ? String(initial.costing_id) : '');
  const [pavuAssignId, setPavuAssignId] = useState(initial?.pavu_assign_id != null ? String(initial.pavu_assign_id) : '');
  const [loomId, setLoomId] = useState(initial?.loom_id != null ? String(initial.loom_id) : '');
  const [warpLotId, setWarpLotId] = useState(initial?.warp_lot_id != null ? String(initial.warp_lot_id) : '');

  const [startDate, setStartDate] = useState(initial?.start_date ?? '');
  const [endDate, setEndDate] = useState(initial?.end_date ?? (initial ? '' : today()));
  const [producedM, setProducedM] = useState(initial ? String(initial.produced_m) : '');
  const [rejectedM, setRejectedM] = useState(initial ? String(initial.rejected_m) : '0');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  // ── Batch DC state (migration 195) ────────────────────────────────────────
  // Mirrors the DC form's bundle/piece UX. In summary mode the operator
  // types totals directly; in detailed mode each piece's metres are typed
  // and rolled up into produced_m.
  const [entryMode, setEntryMode] = useState<'summary' | 'detailed'>(
    initial?.entry_mode === 'detailed' ? 'detailed' : 'summary',
  );
  const [bundles, setBundles] = useState<BundleEntry[]>(() => {
    const src = initial?.bundles_detail;
    if (Array.isArray(src) && src.length > 0) {
      return src.map((b, i) => ({
        sno: Number(b?.sno) || i + 1,
        pieces: Array.isArray(b?.pieces) && b.pieces.length > 0
          ? b.pieces.map((p) => String(p))
          : [''],
      }));
    }
    return [{ sno: 1, pieces: [''] }];
  });
  const [summaryTotalBundles, setSummaryTotalBundles] = useState<string>(
    initial?.total_bundles != null ? String(initial.total_bundles) : '',
  );
  const [summaryTotalPieces, setSummaryTotalPieces] = useState<string>(
    initial?.total_pieces != null ? String(initial.total_pieces) : '',
  );
  const [summaryTotalMetres, setSummaryTotalMetres] = useState<string>(
    initial ? String(initial.produced_m) : '',
  );

  // Towel length starts BLANK — a blank length means "produced value is
  // metres, no pcs conversion". It is prefilled from the selected quality's
  // meter_per_pc (towel qualities only), so running fabric is never silently
  // multiplied by a default length. See the phantom-stock bug on batch
  // B-26-27-0005 (metres entered, ×1.7 applied → 3655 m of stock that
  // never existed).
  const [convertToTowel, setConvertToTowel] = useState(false);
  const [towelLength, setTowelLength] = useState('');

  const [preview, setPreview] = useState<CostingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledgerWarning, setLedgerWarning] = useState<string | null>(null);

  // ── load master data ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [costingsRes, a, ptRes, partyRes] = await Promise.all([
        (async () => {
          const [fqRes, cmRes] = await Promise.all([
            sb.from('fabric_quality')
              .select('id, code, name, costing_id, active, meter_per_pc')
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
          const merged = ((fqRes.data ?? []) as Array<{ id: number; code: string; name: string; costing_id: number | null; meter_per_pc: number | string | null }>)
            .map((f) => {
              const cm = f.costing_id != null ? cms.get(f.costing_id) : null;
              if (!cm) return null;
              return {
                id: f.costing_id as number,
                quality_code: f.code,
                quality_name: f.name,
                approval_status: cm.approval_status,
                meter_per_pc: f.meter_per_pc != null ? Number(f.meter_per_pc) : null,
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
        // Party types + active parties drive the jobwork / outsource
        // weaver dropdown. Same source the DC form uses so the two stay
        // in lockstep.
        sb.from('party_type_master').select('id, name').in('name', ['Jobwork Party', 'Outsource Weaver']),
        sb.from('party').select('id, code, name, party_type_ids').eq('status', 'active').order('name'),
      ]);

      setCostings(costingsRes.data ?? []);
      // Resolve the jobwork-exempt placeholder costing id once.
      const { data: exemptRow } = await sb
        .from('costing_master')
        .select('id')
        .eq('quality_code', 'JOBWORK-EXEMPT')
        .maybeSingle();
      setExemptCostingId(
        exemptRow && typeof exemptRow.id === 'number' ? exemptRow.id : null,
      );
      setAssigns((a.data as unknown as ActivePavuAssign[]) ?? []);
      const types = (ptRes.data ?? []) as Array<{ id: number; name: string }>;
      setJobworkTypeId(types.find((t) => t.name === 'Jobwork Party')?.id ?? null);
      setOutsourceTypeId(types.find((t) => t.name === 'Outsource Weaver')?.id ?? null);
      setAllParties((partyRes.data ?? []) as PartyOpt[]);
      setLoading(false);
    })();
  }, [supabase]);

  // ── Party dropdown filtered by mode ───────────────────────────────────────
  //   jobwork   → Jobwork Party
  //   outsource → Outsource Weaver
  // inhouse never shows the dropdown. If the party-type master row is
  // missing we fall back to showing every active party rather than an
  // empty list.
  const filteredParties = useMemo<PartyOpt[]>(() => {
    if (productionMode === 'jobwork') {
      return jobworkTypeId === null
        ? allParties
        : allParties.filter((p) => (p.party_type_ids ?? []).includes(jobworkTypeId));
    }
    if (productionMode === 'outsource') {
      return outsourceTypeId === null
        ? allParties
        : allParties.filter((p) => (p.party_type_ids ?? []).includes(outsourceTypeId));
    }
    return [];
  }, [allParties, productionMode, jobworkTypeId, outsourceTypeId]);

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

  // ── Batch DC computed totals ──────────────────────────────────────────────
  // Summary mode: trust the operator's typed values verbatim.
  // Detailed mode: walk every bundle/piece, ignore blank or non-positive
  // entries, and round metres to 2 dp to avoid drifting float noise.
  const dcTotals = useMemo(() => {
    if (entryMode === 'summary') {
      return {
        bundles: Number(summaryTotalBundles) || 0,
        pieces: Number(summaryTotalPieces) || 0,
        metres: Number(summaryTotalMetres) || 0,
      };
    }
    let bundleCount = 0;
    let pieceCount = 0;
    let metres = 0;
    for (const b of bundles) {
      bundleCount += 1;
      for (const p of b.pieces) {
        const v = Number(p);
        if (Number.isFinite(v) && v > 0) {
          pieceCount += 1;
          metres += v;
        }
      }
    }
    return {
      bundles: bundleCount,
      pieces: pieceCount,
      metres: Number(metres.toFixed(2)),
    };
  }, [entryMode, bundles, summaryTotalBundles, summaryTotalPieces, summaryTotalMetres]);

  // Keep the existing producedM in sync with the Batch DC roll-up so all
  // downstream code paths (validation, ledger writes, payload) stay
  // correct without a parallel state model.
  useEffect(() => {
    setProducedM(String(dcTotals.metres));
  }, [dcTotals.metres]);

  // ── Bundle helpers (detailed mode) ────────────────────────────────────────
  function addBundle(): void {
    setBundles((bs) => [...bs, { sno: bs.length + 1, pieces: [''] }]);
  }
  function removeBundle(idx: number): void {
    setBundles((bs) => {
      const next = bs.filter((_, i) => i !== idx).map((b, i) => ({ ...b, sno: i + 1 }));
      return next.length === 0 ? [{ sno: 1, pieces: [''] }] : next;
    });
  }
  function setBundlePieceCount(idx: number, count: number): void {
    setBundles((bs) =>
      bs.map((b, i) => {
        if (i !== idx) return b;
        const target = Math.max(1, Math.min(count, 200));
        const cur = b.pieces;
        let next: string[];
        if (target > cur.length) {
          const grow: string[] = [];
          for (let k = cur.length; k < target; k++) grow.push('');
          next = [...cur, ...grow];
        } else if (target < cur.length) {
          next = cur.slice(0, target);
        } else {
          next = cur;
        }
        return { ...b, pieces: next };
      }),
    );
  }
  function setPieceValue(bundleIdx: number, pieceIdx: number, value: string): void {
    setBundles((bs) =>
      bs.map((b, i) => {
        if (i !== bundleIdx) return b;
        return { ...b, pieces: b.pieces.map((p, k) => (k === pieceIdx ? value : p)) };
      }),
    );
  }

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
  async function writeStockLedger(
    batchId: number,
    batchCode: string,
    producedMetres: number,
    effectiveCostingId: number,
    exempt: boolean,
  ): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Pull the costing's per-metre consumption and yarn counts.
    const { data: costingRow, error: cErr } = await sb
      .from('costing_master')
      .select('weft_kg_per_m, porvai_kg_per_m, warp_count_id, weft_count_id, porvai_count_id')
      .eq('id', effectiveCostingId)
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
      .eq('costing_id', effectiveCostingId)
      .limit(1)
      .maybeSingle();
    if (fqRow && typeof fqRow.id === 'number') linkedFqId = fqRow.id;

    // Pull bobbin children for this costing.
    const { data: bobbinRows } = await sb
      .from('costing_master_bobbin')
      .select('bobbin_id, metres')
      .eq('costing_id', effectiveCostingId);
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

    // Unit semantics of the typed `producedMetres` value:
    //
    //   Convert to towel pieces TOGGLE ON  → value entered IN METRES
    //     warp/weft/porvai/bobbin: use as-is (metres)
    //     fabric stock: convert m → pcs via round(m / length)
    //
    //   Convert to towel pieces TOGGLE OFF → value entered IN PIECES
    //     warp/weft/porvai/bobbin: expand pcs × length → metres
    //     fabric stock: save pcs as-is (no conversion)
    //
    // When towel length is 0 / blank, fall back to "value is in metres"
    // and skip the pcs conversion entirely (non-towel qualities).
    const towelLenNum = Number(towelLength);
    const hasTowelLen = towelLenNum > 0;
    const entryInPieces = !convertToTowel && hasTowelLen;
    const actualMetres = entryInPieces
      ? producedMetres * towelLenNum   // pcs × length → metres
      : producedMetres;                // already metres

    // Raw-material outflows (warp / weft / porvai / bobbin) reflect yarn the
    // weaver consumed. A jobwork-exempt batch carries no costing, so there is
    // nothing to deplete — skip every consumption row and post only the
    // produced fabric below.
    if (!exempt) {
    // Warp metre outflow — uses TRUE metres consumed by the weaving.
    ledgerRows.push({
      bucket: 'warp_beam',
      direction: 'out',
      fabric_quality_id: linkedFqId,
      yarn_count_id: costing.warp_count_id ?? null,
      quantity: actualMetres,
      unit: 'm',
      ...src,
      notes: 'Consumed by production batch',
    });

    const weftKgPerM = Number(costing.weft_kg_per_m ?? 0);
    const weftKg = weftKgPerM * actualMetres;
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
    const porvaiKg = porvaiKgPerM * actualMetres;
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

    // Bobbin outflow — each bobbin physically runs the FULL fabric length,
    // so every bobbin attached to the costing records the full actualMetres.
    // A 2-bobbin quality (e.g. 48 ends + 120 ends) therefore produces two
    // ledger rows of the same fabric metres each — this is expected, not a
    // double-count. Bobbin spec `metres` (yield per spool) stays a
    // costing-only figure; the bobbin warehouse holds tape in metres.
    for (const b of bobbins) {
      ledgerRows.push({
        bucket: 'bobbin',
        direction: 'out',
        fabric_quality_id: linkedFqId,
        bobbin_id: b.bobbin_id,
        quantity: actualMetres,
        unit: 'm',
        ...src,
        notes: 'In-house bobbin consumption (1 m per fabric metre)',
      });
    }
    } // end if (!exempt) — jobwork-exempt batches skip all raw-material outflows

    // ── Produced fabric — destination depends on the weaving mode ──────────
    //
    //   inhouse              → stock_ledger bucket 'production_fabric'
    //                          (feeds the warehouse In-house "Production
    //                          Fabric (m)" pivot, unchanged).
    //   jobwork / outsource  → a fabric_stock row tagged with the matching
    //                          source_type + this batch_id, so the cloth
    //                          shows up in the warehouse Job Work / Outsource
    //                          "Fabric (m)" tab. We deliberately DO NOT also
    //                          post a production_fabric ledger row for these
    //                          modes — the produced fabric lives in exactly
    //                          one place.
    //
    // Raw-material outflows above are posted for every mode.
    if (productionMode === 'inhouse') {
      // Production fabric INFLOW — store the operator's entered value
      // as-is, no unit conversion (pcs when entered as towel pieces,
      // else metres).
      let inflowQty: number;
      let inflowUnit: 'pcs' | 'm';
      let inflowNote: string;
      if (entryInPieces) {
        inflowQty = Math.round(producedMetres);
        inflowUnit = 'pcs';
        inflowNote = `Produced as towel — entered in pcs (${towelLenNum} m/pc)`;
      } else if (hasTowelLen) {
        inflowQty = producedMetres;
        inflowUnit = 'm';
        inflowNote = `Produced as towel — entered in metres (${towelLenNum} m/pc)`;
      } else {
        inflowQty = producedMetres;
        inflowUnit = 'm';
        inflowNote = 'Produced fabric stock';
      }
      ledgerRows.push({
        bucket: 'production_fabric',
        direction: 'in',
        fabric_quality_id: linkedFqId,
        quantity: inflowQty,
        ...src,
        unit: inflowUnit,
        notes: inflowNote,
      });
    }

    // Exempt jobwork batches produce no ledger rows at all — skip the insert.
    if (ledgerRows.length > 0) {
      const { error: insErr } = await sb.from('stock_ledger').insert(ledgerRows);
      if (insErr) {
        return `Stock ledger write failed (batch was saved): ${insErr.message}`;
      }
    }

    // Job Work / Outsource: post the produced cloth into fabric_stock so it
    // lands on the matching warehouse fabric tab. fabric_stock is a
    // metre-based store (metres_available is generated as metres_in
    // - metres_out), so we always record the TRUE metres here, never pcs.
    if (productionMode !== 'inhouse') {
      // Freeze the per-metre cost from the costing's true cost so stock
      // valuation matches the in-house snapshot logic.
      let trueCost = 0;
      const { data: costRow } = await sb
        .from('v_costing_two_cost')
        .select('true_cost_per_m')
        .eq('id', effectiveCostingId)
        .maybeSingle();
      if (costRow && costRow.true_cost_per_m != null) {
        trueCost = Number(costRow.true_cost_per_m);
      }
      const { error: fsErr } = await sb.from('fabric_stock').insert({
        costing_id: effectiveCostingId,
        source_type: productionMode === 'jobwork' ? 'jobwork' : 'outsourced',
        batch_id: batchId,
        metres_in: actualMetres,
        metres_out: 0,
        cost_per_m_frozen: trueCost,
      });
      if (fsErr) {
        return `Fabric stock write failed (batch was saved): ${fsErr.message}`;
      }
    }

    return null;
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLedgerWarning(null);

    // Jobwork is exempt from costing — the weaver is paid for labour and does
    // not own the yarn cost, so a quality/costing is optional. Every other mode
    // still requires a real costing.
    const exempt = productionMode === 'jobwork' && !costingId;
    if (!costingId && productionMode !== 'jobwork') {
      setError('Pick the quality being woven.');
      return;
    }
    if (exempt && !exemptCostingId) {
      setError('Jobwork-exempt costing is not set up yet. Please reload and try again.');
      return;
    }
    const effectiveCostingId = costingId ? Number(costingId) : (exemptCostingId as number);
    if (productionMode !== 'inhouse' && !partyId) {
      setError(productionMode === 'jobwork'
        ? 'Pick the jobwork party for this batch.'
        : 'Pick the outsource weaver for this batch.');
      return;
    }
    const producedNum = Number(producedM);
    if (!producedM || !(producedNum > 0)) {
      setError('Enter the Batch DC bundle/piece data first.');
      return;
    }

    setBusy(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Snapshot the Batch DC data once so both insert/update use the same
    // shape. In summary mode we ship an empty bundles_detail array — the
    // print template uses that as the signal to skip the bundle grid.
    const bundlesDetailPayload = entryMode === 'detailed'
      ? bundles.map((b) => ({
          sno: b.sno,
          pieces: b.pieces
            .map((p) => Number(p))
            .filter((n) => Number.isFinite(n) && n > 0),
        }))
      : [];

    let batchId: number;
    let batchCode: string;

    if (mode === 'edit' && initial) {
      // UPDATE existing row.
      const updatePayload = {
        costing_id: effectiveCostingId,
        production_mode: productionMode,
        party_id: productionMode === 'inhouse' ? null : (partyId ? Number(partyId) : null),
        pavu_assign_id: pavuAssignId ? Number(pavuAssignId) : null,
        loom_id: loomId ? Number(loomId) : null,
        warp_lot_id: warpLotId ? Number(warpLotId) : null,
        start_date: startDate || null,
        end_date: endDate || null,
        produced_m: producedNum,
        rejected_m: Number(rejectedM || 0),
        notes: notes || null,
        entry_mode: entryMode,
        total_pieces: dcTotals.pieces,
        total_bundles: dcTotals.bundles,
        bundles_detail: bundlesDetailPayload,
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

      // Also wipe any fabric_stock row this batch posted (jobwork /
      // outsource). The mode may have changed since the last save, so we
      // clear both representations and let writeStockLedger repost the
      // correct one. Skipped silently if there was none.
      const { error: fsDelErr } = await sb
        .from('fabric_stock')
        .delete()
        .eq('batch_id', batchId);
      if (fsDelErr) {
        setBusy(false);
        setLedgerWarning(`Could not clear old fabric stock: ${fsDelErr.message}. Batch was updated; stock not reset.`);
        return;
      }
    } else {
      // INSERT new row. batch_code auto-generated by trigger (migration 008).
      // Payload is widened beyond ProductionBatchInsert because the
      // Batch DC columns (migration 195) aren't in the generated types
      // yet — they'll get folded in next time database.types.ts is regen'd.
      const payload: ProductionBatchInsert & {
        entry_mode: 'summary' | 'detailed';
        total_pieces: number;
        total_bundles: number;
        bundles_detail: BundleDetailRow[];
        production_mode: ProductionMode;
        party_id: number | null;
      } = {
        batch_code: '',
        costing_id: effectiveCostingId,
        production_mode: productionMode,
        party_id: productionMode === 'inhouse' ? null : (partyId ? Number(partyId) : null),
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
        entry_mode: entryMode,
        total_pieces: dcTotals.pieces,
        total_bundles: dcTotals.bundles,
        bundles_detail: bundlesDetailPayload,
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
    const ledgerErr = await writeStockLedger(batchId, batchCode, producedNum, effectiveCostingId, exempt);
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
      {/* ─── Production mode ───────────────────────────────────────────
          Pick who weaves this batch. inhouse keeps the original flow;
          jobwork / outsource also require a weaver party. Everything
          else on the form behaves identically across the three modes. */}
      <section className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">
          Production for
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {([
            { key: 'inhouse', label: 'In-house' },
            { key: 'jobwork', label: 'Job Work' },
            { key: 'outsource', label: 'Outsource Weaver' },
          ] as Array<{ key: ProductionMode; label: string }>).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setProductionMode(m.key);
                if (m.key === 'inhouse') setPartyId('');
              }}
              className={
                'px-3 py-1.5 rounded-lg text-xs font-semibold border ' +
                (productionMode === m.key
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')
              }
            >
              {m.label}
            </button>
          ))}
        </div>

        {productionMode !== 'inhouse' && (
          <div>
            <label className="label">
              {productionMode === 'jobwork' ? 'Jobwork Party *' : 'Outsource Weaver *'}
            </label>
            <select
              required
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="input"
            >
              <option value="" disabled>
                {productionMode === 'jobwork' ? 'Select jobwork party…' : 'Select outsource weaver…'}
              </option>
              {filteredParties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            {filteredParties.length === 0 && (
              <div className="text-xs text-amber-700 mt-1">
                No {productionMode === 'jobwork' ? 'jobwork parties' : 'outsource weavers'} found.
                Add one in the Party master with the matching party type first.
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── Section 1: Quality ────────────────────────────────────────── */}
      <section className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">
          1. Quality being woven
        </h3>
        <div>
          <label className="label">
            Fabric Quality {productionMode === 'jobwork' ? '(optional)' : '*'}
          </label>
          <select
            required={productionMode !== 'jobwork'}
            value={costingId}
            onChange={e => {
              setCostingId(e.target.value);
              // Prefill the towel length from the quality's own m/pc so
              // towel batches use the right length (1.65 vs 1.70 etc.) and
              // running-fabric batches stay blank (no pcs conversion).
              const picked = costings.find(c => String(c.id) === e.target.value);
              setTowelLength(picked?.meter_per_pc != null && picked.meter_per_pc > 0 ? String(picked.meter_per_pc) : '');
            }}
            className="input"
          >
            <option value="" disabled={productionMode !== 'jobwork'}>
              {productionMode === 'jobwork' ? 'No costing (jobwork — exempt)' : 'Select quality…'}
            </option>
            {costings.map(c => (
              <option key={c.id} value={c.id}>
                {c.quality_code} — {c.quality_name}
              </option>
            ))}
          </select>
          {productionMode === 'jobwork' && (
            <div className="text-xs text-ink-soft mt-1">
              Jobwork is paid for weaving labour only — no yarn cost is tracked, so a quality is optional.
            </div>
          )}
          {productionMode !== 'jobwork' && costings.length === 0 && (
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

      {/* Pavu assignment section removed per operator request — loom_id
          and warp_lot_id stay NULL on the batch row unless seeded
          elsewhere. The stock_ledger writes use the costing's
          warp_count_id, so the warp_metre outflow is still recorded. */}

      {/* ─── Batch DC ──────────────────────────────────────────────────
          Mirrors the delivery_challan_item bundle/piece capture UX.
          Whichever mode is active feeds dcTotals.metres, which is then
          mirrored into produced_m so the existing ledger / cost paths
          stay correct without a parallel state model. */}
      <section className="card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">
            2. Batch DC
          </h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setEntryMode('summary')}
              className={
                'px-3 py-1.5 rounded-lg text-xs font-semibold border ' +
                (entryMode === 'summary'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')
              }
            >
              Summary
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('detailed')}
              className={
                'px-3 py-1.5 rounded-lg text-xs font-semibold border ' +
                (entryMode === 'detailed'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')
              }
            >
              Detailed
            </button>
          </div>
        </div>
        <p className="text-[11px] text-ink-mute">
          {entryMode === 'summary'
            ? 'Type bundle / piece / metre totals directly.'
            : 'Capture every bundle and piece. Metres roll up automatically.'}
        </p>

        {entryMode === 'summary' ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Total bundles</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={summaryTotalBundles}
                onChange={(e) => setSummaryTotalBundles(e.target.value)}
                className="input num text-right"
              />
            </div>
            <div>
              <label className="label">Total pieces</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={summaryTotalPieces}
                onChange={(e) => setSummaryTotalPieces(e.target.value)}
                className="input num text-right"
              />
            </div>
            <div>
              <label className="label">Total metres *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={summaryTotalMetres}
                onChange={(e) => setSummaryTotalMetres(e.target.value)}
                className="input num text-right"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {bundles.map((b, bIdx) => {
              const bMetres = b.pieces.reduce((s, p) => {
                const v = Number(p);
                return Number.isFinite(v) && v > 0 ? s + v : s;
              }, 0);
              const bPieces = b.pieces.filter((p) => {
                const v = Number(p);
                return Number.isFinite(v) && v > 0;
              }).length;
              return (
                <div
                  key={bIdx}
                  className="rounded-lg border border-line bg-cloud/20 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-semibold text-ink-soft">
                      Bundle #{b.sno}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-ink-mute">
                        {bPieces} pcs / {bMetres.toFixed(2)} m
                      </span>
                      <label className="text-[10px] uppercase tracking-wide text-ink-mute">
                        No. of pieces
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        step={1}
                        className="input h-7 text-xs num w-16 text-right"
                        value={b.pieces.length}
                        onChange={(e) =>
                          setBundlePieceCount(bIdx, Number(e.target.value) || 1)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removeBundle(bIdx)}
                        className="text-rose-600 hover:bg-rose-50 text-[11px] px-2 py-0.5 rounded"
                        title="Remove bundle"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                    {b.pieces.map((p, pIdx) => (
                      <div key={pIdx} className="flex items-center gap-1">
                        <span className="text-[10px] text-ink-mute w-6 text-right">
                          {pIdx + 1}.
                        </span>
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          placeholder="metres"
                          data-piece-input
                          className="input h-8 text-xs num flex-1 text-right"
                          value={p}
                          onChange={(e) =>
                            setPieceValue(bIdx, pIdx, e.target.value)
                          }
                          onKeyDown={(e) => {
                            // Enter = jump straight to the next metre field
                            // (across bundles too) instead of submitting the
                            // form / landing on the Remove button.
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            const inputs = Array.from(
                              document.querySelectorAll<HTMLInputElement>('input[data-piece-input]')
                            );
                            const next = inputs[inputs.indexOf(e.currentTarget) + 1];
                            if (next) {
                              next.focus();
                              next.select();
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addBundle}
              className="w-full text-xs text-indigo-700 hover:bg-indigo-50 py-2 rounded border border-dashed border-line"
            >
              + Add bundle
            </button>
            <div className="border-t border-line/60 pt-2 text-right text-xs font-semibold text-ink-soft">
              Bundles: <span className="num text-indigo-700">{dcTotals.bundles}</span>
              {' · '}
              Pieces: <span className="num text-indigo-700">{dcTotals.pieces}</span>
              {' · '}
              Metres: <span className="num text-indigo-700">{dcTotals.metres.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Single source of truth for Produced metres — flows into
            produced_m via the dcTotals.metres useEffect above. */}
        <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2 text-xs font-semibold text-indigo-800">
          Produced: <span className="num">{dcTotals.metres.toFixed(2)}</span> m
          {' · '}
          <span className="num">{dcTotals.pieces}</span> pcs
          {' · '}
          <span className="num">{dcTotals.bundles}</span> bundles
          <span className="ml-2 font-normal text-indigo-700/70">(auto from Batch DC)</span>
        </div>
      </section>

      {/* ─── Section 2: Production data ────────────────────────────────── */}
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
            <label className="label">
              Produced (m) *
              <span className="text-[10px] text-ink-mute font-normal ml-2">(from Batch DC)</span>
            </label>
            <div className="input num bg-cloud/40 text-ink-soft cursor-not-allowed">
              {dcTotals.metres > 0 ? dcTotals.metres.toFixed(2) : '—'}
            </div>
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

        {/* Towel-pieces conversion. Toggle interpretation:
              ON  → operator entered METRES; we convert to pieces for
                    fabric stock (m / length), warp metre outflow uses
                    the metres as-is.
              OFF → operator entered PIECES; fabric stock saved as
                    pieces unchanged, warp metre outflow expands to
                    metres (pieces × length). Towel length input is
                    visible in BOTH modes whenever a length is needed. */}
        <div className="rounded-lg border border-line/60 bg-cloud/30 p-3 space-y-2">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={convertToTowel}
              onChange={e => setConvertToTowel(e.target.checked)}
            />
            <span className="font-semibold">Quantity entered in metres</span>
            <span className="text-ink-mute text-xs">— when off, the produced value is treated as towel pieces.</span>
          </label>
          {/* Length per towel only matters when the produced value is in
              PIECES (toggle OFF) — it expands pcs × length → metres for raw
              materials. When entering in metres the value is stored as-is,
              so the field is hidden. */}
          {!convertToTowel && (
            <div className="max-w-xs">
              <label className="label">Length per towel (m)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={towelLength}
                onChange={e => setTowelLength(e.target.value)}
                className="input num"
                placeholder="leave blank for non-towel"
              />
              <div className="text-[10px] text-ink-mute mt-0.5">
                {Number(towelLength) > 0
                  ? 'Pieces × length → metres for raw materials (warp / weft / bobbin).'
                  : 'No length set — produced value will be saved as metres on fabric stock.'}
              </div>
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
        <button type="submit" className="btn-primary" disabled={busy || (productionMode !== 'jobwork' && !costingId) || !(dcTotals.metres > 0)}>
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
