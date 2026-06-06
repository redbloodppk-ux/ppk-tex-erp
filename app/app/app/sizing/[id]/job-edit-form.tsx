'use client';
/**
 * Sizing Job edit form — full edit.
 *
 * Mirrors /app/sizing/new but pre-populated from the existing job
 * row. Every field is editable: sizing mill, yarn supplier, warp
 * count, yarn lot, kg sent / used, beams (with bulk Quick fill),
 * production routing, bill section, status, notes.
 *
 * Stock side-effects on save:
 *   - If yarn lot or yarn_sent_kg changed, the OLD lot is credited
 *     back by the original yarn_sent_kg and the NEW lot is debited
 *     by the new yarn_sent_kg (best-effort, sequential — single
 *     operator workflow makes race conditions vanishingly rare).
 *
 * Beam (pavu) sync:
 *   - The simplest correct approach is to DELETE all existing pavu
 *     rows for this job and INSERT the new set. Loom assignments on
 *     pavu rows that move are wiped, which is the expected behaviour
 *     when restructuring beams.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type PavuInsert = Database['public']['Tables']['pavu']['Insert'];

interface Vendor   { id: number; code?: string | null; name: string; vendor_type?: string }
interface Supplier { id: number; code: string; name: string }
interface YarnCount { id: number; code: string; display_name: string }
interface YarnLot  { id: number; lot_code: string; current_kg: number; received_kg: number;
                     yarn_count_id: number; supplier_party_id: number | null;
                     delivery_destination: 'in_house' | 'sizing' | null }

type ProdMode    = 'in_house' | 'outsource';
type DefaultMode = ProdMode | 'mixed';

interface BeamRow {
  pavu_id: number | null;           // null for newly-added rows
  beam_no: string;
  ends: string;
  meters: string;
  production_mode: ProdMode;
  outsource_vendor_id: string;
}

export interface JobEditSeed {
  id: number;
  job_code: string;
  set_no: string;
  status: string;
  notes: string;

  sizing_ledger_id: number | null;
  yarn_supplier_party_id: number | null;
  warp_count_id: number | null;
  avg_count: number | null;

  yarn_source: 'in_house' | 'sizing';
  yarn_lot_id: number | null;
  yarn_sent_kg: number;
  yarn_used_kg: number;

  default_production_mode: DefaultMode;
  default_outsource_ledger_id: number | null;

  bill_no: string;
  bill_date: string;
  sizing_rate_per_kg: number;
  gst_pct: number;

  beams: Array<{
    pavu_id: number;
    beam_no: string;
    ends: number;
    meters: number;
    production_mode: ProdMode;
    outsource_ledger_id: number | null;
  }>;
}

interface Masters {
  sizingVendors:  Vendor[];
  weavingVendors: Vendor[];
  suppliers:      Supplier[];
  counts:         YarnCount[];
  lots:           YarnLot[];
}

interface Props {
  seed:    JobEditSeed;
  masters: Masters;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyBeam(mode: ProdMode = 'in_house'): BeamRow {
  return {
    pavu_id: null,
    beam_no: '', ends: '', meters: '',
    production_mode: mode, outsource_vendor_id: '',
  };
}

export function JobEditForm({ seed, masters }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  // ── Header state ──
  const [setNo,            setSetNo]            = useState<string>(seed.set_no ?? '');
  const [sizingVendorId,   setSizingVendorId]   = useState<string>(seed.sizing_ledger_id != null ? String(seed.sizing_ledger_id) : '');
  const [yarnSupplierId,   setYarnSupplierId]   = useState<string>(seed.yarn_supplier_party_id != null ? String(seed.yarn_supplier_party_id) : '');
  const [warpCountId,      setWarpCountId]      = useState<string>(seed.warp_count_id != null ? String(seed.warp_count_id) : '');
  const [avgCount,         setAvgCount]         = useState<string>(seed.avg_count != null ? String(seed.avg_count) : '');

  // Yarn
  const [yarnSource,       setYarnSource]       = useState<'in_house' | 'sizing'>(seed.yarn_source);
  const [yarnLotId,        setYarnLotId]        = useState<string>(seed.yarn_lot_id != null ? String(seed.yarn_lot_id) : '');
  const [yarnSentKg,       setYarnSentKg]       = useState<string>(String(seed.yarn_sent_kg ?? 0));
  const [yarnUsedKg,       setYarnUsedKg]       = useState<string>(String(seed.yarn_used_kg ?? 0));

  // Bill
  const [billNo,           setBillNo]           = useState<string>(seed.bill_no ?? '');
  const [billDate,         setBillDate]         = useState<string>(seed.bill_date ?? todayISO());
  const [rate,             setRate]             = useState<string>(String(seed.sizing_rate_per_kg ?? 0));
  const [gstPct,           setGstPct]           = useState<string>(String(seed.gst_pct ?? 0));

  // Other
  const [status,           setStatus]           = useState<string>(seed.status ?? 'received');
  const [notes,            setNotes]            = useState<string>(seed.notes ?? '');

  // Production routing
  const [defaultMode,             setDefaultMode]             = useState<DefaultMode>(seed.default_production_mode ?? 'in_house');
  const [defaultOutsourceVendorId, setDefaultOutsourceVendorId] = useState<string>(
    seed.default_outsource_ledger_id != null ? String(seed.default_outsource_ledger_id) : '',
  );

  // Beams — initialised from seed. Quick-fill controls derive sensible
  // defaults from the seed (first beam number, count, common ends if
  // every beam shares the same ends value).
  const seedBeams: BeamRow[] = useMemo(() => {
    if (seed.beams.length === 0) return [emptyBeam(seed.default_production_mode === 'outsource' ? 'outsource' : 'in_house')];
    return seed.beams.map((b) => ({
      pavu_id: b.pavu_id,
      beam_no: b.beam_no,
      ends:    String(b.ends),
      meters:  String(b.meters),
      production_mode: b.production_mode,
      outsource_vendor_id: b.outsource_ledger_id != null ? String(b.outsource_ledger_id) : '',
    }));
  }, [seed.beams, seed.default_production_mode]);
  const [beams, setBeams] = useState<BeamRow[]>(seedBeams);

  // Quick-fill controls
  const seedFirstBeamNo = seed.beams.length > 0 ? seed.beams[0]!.beam_no : '1';
  const seedCount       = seed.beams.length > 0 ? String(seed.beams.length) : '1';
  const seedEnds        = seed.beams.length > 0
    && seed.beams.every((b) => b.ends === seed.beams[0]!.ends)
      ? String(seed.beams[0]!.ends)
      : '';
  const [firstBeamNo, setFirstBeamNo] = useState<string>(seedFirstBeamNo);
  const [beamCount,   setBeamCount]   = useState<string>(seedCount);
  const [commonEnds,  setCommonEnds]  = useState<string>(seedEnds);

  // UI
  const [busy,  setBusy]  = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derived data ──
  const supplierById = useMemo(() => {
    const m = new Map<number, Supplier>();
    for (const s of masters.suppliers) m.set(s.id, s);
    return m;
  }, [masters.suppliers]);
  const countById = useMemo(() => {
    const m = new Map<number, YarnCount>();
    for (const c of masters.counts) m.set(c.id, c);
    return m;
  }, [masters.counts]);

  // Suppliers limited to those with at least one lot in the sizing
  // warehouse — same rule as the new form. The selected supplier is
  // always kept in the list (even if it has no current sizing lots)
  // so the operator can see what's recorded on this job.
  const eligibleSuppliers = useMemo(() => {
    const sizingSupplierIds = new Set<number>();
    for (const l of masters.lots) {
      if (l.delivery_destination === 'sizing' && l.supplier_party_id != null) {
        sizingSupplierIds.add(l.supplier_party_id);
      }
    }
    const currentId = Number(yarnSupplierId) || -1;
    return masters.suppliers.filter((s) => sizingSupplierIds.has(s.id) || s.id === currentId);
  }, [masters.suppliers, masters.lots, yarnSupplierId]);

  // Warp Yarn Count dropdown is narrowed to the counts the selected
  // yarn supplier actually ships — derived from yarn_lot rows
  // restricted to that supplier. The currently-saved count is always
  // kept in the list so an edit screen never renders a blank
  // selection against a saved job.
  const eligibleCounts = useMemo(() => {
    if (yarnSupplierId === '') return masters.counts;
    const supplierId = Number(yarnSupplierId);
    const currentCountId = Number(warpCountId) || -1;
    const allowed = new Set<number>();
    for (const l of masters.lots) {
      if (l.supplier_party_id === supplierId) allowed.add(l.yarn_count_id);
    }
    return masters.counts.filter((c) => allowed.has(c.id) || c.id === currentCountId);
  }, [masters.counts, masters.lots, yarnSupplierId, warpCountId]);

  // Lots filtered by warehouse + warp count + supplier. The currently
  // selected lot is always present even if the filter excludes it,
  // so the dropdown never shows "empty selection" against a saved job.
  const matchingLots = useMemo(() => {
    const currentId = Number(yarnLotId) || -1;
    return masters.lots.filter((l) => {
      if (l.id === currentId) return true;
      if (l.delivery_destination !== yarnSource) return false;
      if (warpCountId    && l.yarn_count_id     !== Number(warpCountId))    return false;
      if (yarnSupplierId && l.supplier_party_id !== Number(yarnSupplierId)) return false;
      return true;
    });
  }, [masters.lots, warpCountId, yarnSupplierId, yarnSource, yarnLotId]);

  // Bulk-regenerate beams when first beam no / count / common ends
  // change. Existing per-beam state (metres, routing, pavu_id) is
  // preserved by index.
  useEffect(() => {
    const start = Math.max(0, Math.floor(Number(firstBeamNo) || 0));
    const count = Math.max(1, Math.floor(Number(beamCount)   || 1));
    setBeams((prev) => {
      const next: BeamRow[] = [];
      for (let i = 0; i < count; i++) {
        const existing = prev[i];
        const mode: ProdMode = defaultMode === 'outsource' ? 'outsource' : 'in_house';
        next.push({
          pavu_id: existing?.pavu_id ?? null,
          beam_no: String(start + i),
          ends:    commonEnds !== '' ? commonEnds : (existing?.ends ?? ''),
          meters:  existing?.meters ?? '',
          production_mode: existing?.production_mode ?? mode,
          outsource_vendor_id:
            existing?.outsource_vendor_id
            ?? (mode === 'outsource' ? defaultOutsourceVendorId : ''),
        });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstBeamNo, beamCount, commonEnds]);

  // ── billing math (rounded to whole rupees) ──
  const billing = useMemo(() => {
    const kg = Number(yarnUsedKg) || 0;
    const r  = Number(rate)       || 0;
    const g  = Number(gstPct)     || 0;
    const chargesRaw = kg * r;
    const totalRaw   = chargesRaw * (1 + g / 100);
    return {
      charges: Math.round(chargesRaw),
      total:   Math.round(totalRaw),
    };
  }, [yarnUsedKg, rate, gstPct]);

  const balance = useMemo(() => (Number(yarnSentKg) || 0) - (Number(yarnUsedKg) || 0), [yarnSentKg, yarnUsedKg]);

  // ── beam helpers ──
  function patchBeam(idx: number, patch: Partial<BeamRow>) {
    setBeams((prev) => prev.map((b, i) => i === idx ? { ...b, ...patch } : b));
  }
  function addBeam() {
    setBeamCount((c) => String((Math.floor(Number(c) || 0) || 0) + 1));
  }
  function removeBeam(idx: number) {
    void idx;
    setBeamCount((c) => String(Math.max(1, Math.floor(Number(c) || 1) - 1)));
  }
  function applyDefaultMode(mode: DefaultMode) {
    setDefaultMode(mode);
    if (mode === 'mixed') return;
    setBeams((prev) => prev.map((b) => ({
      ...b,
      production_mode: mode,
      outsource_vendor_id: mode === 'outsource' ? (b.outsource_vendor_id || defaultOutsourceVendorId) : '',
    })));
  }

  // ── submit ──
  async function handleSave(): Promise<void> {
    setError(null);

    // Header validation
    if (!sizingVendorId) return setError('Pick a sizing mill.');
    if (!yarnSupplierId) return setError('Pick a yarn supplier.');
    if (!warpCountId)    return setError('Pick a warp yarn count.');
    if (!yarnLotId)      return setError('Pick a yarn lot.');
    if (!billNo.trim())  return setError('Bill / invoice number is required.');
    if (!billDate)       return setError('Bill / invoice date is required.');

    // Beams validation
    for (const b of beams) {
      if (!b.beam_no.trim()) return setError('Every beam needs a beam number.');
      if (!Number(b.ends))   return setError('Every beam needs ends > 0.');
      if (!Number(b.meters)) return setError('Every beam needs metres > 0.');
      if (b.production_mode === 'outsource' && !b.outsource_vendor_id) {
        return setError(`Beam ${b.beam_no}: outsource vendor missing.`);
      }
    }

    const newLotId   = Number(yarnLotId);
    const newSentKg  = Number(yarnSentKg) || 0;
    const oldLotId   = seed.yarn_lot_id;
    const oldSentKg  = seed.yarn_sent_kg;

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // ── Stock adjustment ──
    // If the lot or kg changed, credit the old lot back by oldSentKg
    // and debit the new lot by newSentKg. Same lot, different kg:
    // single net adjustment. Best-effort — non-fatal if a lookup
    // misses (single-operator workflow).
    try {
      if (oldLotId !== newLotId) {
        if (oldLotId != null && oldSentKg > 0) {
          const { data: oldLot } = await sb.from('yarn_lot').select('current_kg').eq('id', oldLotId).maybeSingle();
          if (oldLot) {
            await sb.from('yarn_lot')
              .update({ current_kg: Number(oldLot.current_kg ?? 0) + oldSentKg })
              .eq('id', oldLotId);
          }
        }
        const { data: newLot } = await sb.from('yarn_lot').select('current_kg').eq('id', newLotId).maybeSingle();
        if (newLot) {
          const next = Math.max(0, Number(newLot.current_kg ?? 0) - newSentKg);
          await sb.from('yarn_lot').update({ current_kg: next }).eq('id', newLotId);
        }
      } else if (oldSentKg !== newSentKg) {
        const delta = newSentKg - oldSentKg; // positive = more debit needed
        const { data: lot } = await sb.from('yarn_lot').select('current_kg').eq('id', newLotId).maybeSingle();
        if (lot) {
          const next = Math.max(0, Number(lot.current_kg ?? 0) - delta);
          await sb.from('yarn_lot').update({ current_kg: next }).eq('id', newLotId);
        }
      }
    } catch (e: unknown) {
      // We deliberately keep going — stock adjustments are
      // best-effort and the operator can reconcile from the yarn-lot
      // detail screen if anything looks off.
      void e;
    }

    // ── Update job row ──
    const headerPayload = {
      set_no:                 setNo.trim() || null,
      sizing_ledger_id:       Number(sizingVendorId),
      yarn_supplier_party_id: Number(yarnSupplierId),
      warp_count_id:          Number(warpCountId),
      avg_count:              avgCount ? Number(avgCount) : null,
      yarn_source:            'warehouse',
      yarn_lot_id:            newLotId,
      yarn_sent_kg:           newSentKg,
      yarn_used_kg:           Number(yarnUsedKg) || 0,
      no_of_paavu:            beams.length,
      sizing_rate_per_kg:     Number(rate)   || 0,
      charges_amount:         billing.charges,
      gst_pct:                Number(gstPct) || 0,
      total_amount:           billing.total,
      bill_no:                billNo.trim(),
      bill_date:              billDate,
      default_production_mode: defaultMode === 'mixed' ? null : defaultMode,
      default_outsource_ledger_id:
        defaultMode === 'outsource' && defaultOutsourceVendorId
          ? Number(defaultOutsourceVendorId) : null,
      status,
      notes:                  notes.trim() || null,
    };
    const { error: updErr } = await sb.from('sizing_job').update(headerPayload).eq('id', seed.id);
    if (updErr) {
      setBusy(false);
      setError(updErr.message);
      return;
    }

    // ── Sync pavu rows ──
    // Drop everything, re-insert the new set. Loom assignments on
    // edited beams are intentionally cleared (changing a beam's
    // identity requires reassigning to a loom anyway).
    const { error: delErr } = await sb.from('pavu').delete().eq('sizing_job_id', seed.id);
    if (delErr) {
      setBusy(false);
      setError(`Job updated but beams failed to reset: ${delErr.message}`);
      return;
    }
    const beamRows = beams.map((b) => ({
      sizing_job_id:       seed.id,
      beam_no:             b.beam_no.trim(),
      ends:                Number(b.ends),
      meters:              Number(b.meters),
      production_mode:     b.production_mode,
      outsource_ledger_id: b.production_mode === 'outsource' && b.outsource_vendor_id
                             ? Number(b.outsource_vendor_id) : null,
    }));
    const { error: insErr } = await sb.from('pavu').insert(beamRows as PavuInsert[]);
    if (insErr) {
      setBusy(false);
      setError(`Job updated but beam re-insert failed: ${insErr.message}`);
      return;
    }

    router.push('/app/sizing?tab=jobs');
    router.refresh();
  }

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSave(); }} className="space-y-5">
      {/* ── Header ── */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-bold text-ink">Job header</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Job Code</label>
            <div className="input num bg-cloud/60 text-ink-mute flex items-center select-none">
              {seed.job_code}
            </div>
          </div>
          <div>
            <label className="label">Vendor SET NO</label>
            <input value={setNo} onChange={(e) => setSetNo(e.target.value)} className="input num" placeholder="e.g. 994" />
          </div>
          <div>
            <label className="label">Sizing Mill *</label>
            <select required value={sizingVendorId} onChange={(e) => setSizingVendorId(e.target.value)} className="input">
              <option value="" disabled>Select sizing vendor…</option>
              {masters.sizingVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Yarn Supplier *</label>
            <select required value={yarnSupplierId} onChange={(e) => setYarnSupplierId(e.target.value)} className="input">
              <option value="" disabled>Select yarn supplier…</option>
              {eligibleSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="text-[11px] text-ink-mute mt-1">
              Showing only suppliers who have shipped yarn to the sizing
              warehouse, plus the current selection.
            </p>
          </div>
          <div>
            <label className="label">Warp Yarn Count *</label>
            <select required value={warpCountId} onChange={(e) => setWarpCountId(e.target.value)} className="input">
              <option value="" disabled>
                {yarnSupplierId === ''
                  ? 'Pick a yarn supplier first…'
                  : eligibleCounts.length === 0
                    ? 'No counts on file for this supplier'
                    : 'Select count…'}
              </option>
              {eligibleCounts.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.display_name}</option>)}
            </select>
            <p className="text-[11px] text-ink-mute mt-1">
              Showing only counts the selected supplier has yarn for.
              The current selection is always kept available.
            </p>
          </div>
          <div>
            <label className="label">Ends Average Count</label>
            <input type="number" step="0.01" min={0} value={avgCount} onChange={(e) => setAvgCount(e.target.value)} className="input num" placeholder="e.g. 53.18" />
            <p className="text-[11px] text-ink-mute mt-1">Optional.</p>
          </div>
        </div>
      </div>

      {/* ── Yarn ── */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-bold text-ink">Yarn</h3>
        <div>
          <label className="label">Where did the yarn come from?</label>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className={`card p-3 cursor-pointer ${yarnSource === 'in_house' ? 'ring-2 ring-indigo' : ''}`}>
              <input type="radio" name="src" checked={yarnSource === 'in_house'} onChange={() => setYarnSource('in_house')} className="mr-2" />
              <span className="font-semibold">In-house warehouse</span>
            </label>
            <label className={`card p-3 cursor-pointer ${yarnSource === 'sizing' ? 'ring-2 ring-indigo' : ''}`}>
              <input type="radio" name="src" checked={yarnSource === 'sizing'} onChange={() => setYarnSource('sizing')} className="mr-2" />
              <span className="font-semibold">Sizing warehouse</span>
            </label>
          </div>
        </div>

        <div>
          <label className="label">Yarn Lot *</label>
          <select required value={yarnLotId} onChange={(e) => setYarnLotId(e.target.value)} className="input">
            <option value="" disabled>
              {matchingLots.length ? 'Select a lot…' : 'No matching lots — change count, supplier or warehouse'}
            </option>
            {matchingLots.map((l) => {
              const countLabel = countById.get(l.yarn_count_id)?.code ?? '';
              const millLabel  = l.supplier_party_id != null ? supplierById.get(l.supplier_party_id)?.name ?? '' : '';
              const suffix = [countLabel, millLabel].filter((s) => s !== '').join(' · ');
              return (
                <option key={l.id} value={l.id}>
                  {l.lot_code}{suffix ? ' · ' + suffix : ''} — {Number(l.current_kg).toFixed(1)} kg in stock
                </option>
              );
            })}
          </select>
          <p className="text-[11px] text-ink-mute mt-1">
            Changing the lot or yarn-sent qty will adjust both lots&rsquo;
            <b> current_kg</b> on save.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Yarn Sent to Sizing (kg) *</label>
            <input type="number" step="0.001" min={0} required value={yarnSentKg} onChange={(e) => setYarnSentKg(e.target.value)} className="input num" />
          </div>
          <div>
            <label className="label">Yarn Used (kg)</label>
            <input type="number" step="0.001" min={0} value={yarnUsedKg} onChange={(e) => setYarnUsedKg(e.target.value)} className="input num" />
            <p className="text-[11px] text-ink-mute mt-1">Drives bill charges.</p>
          </div>
          <div>
            <label className="label">Balance (kg)</label>
            <div className={`input num flex items-center font-bold ${balance < 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {balance.toFixed(3)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Beams ── */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-ink">Beams (Pavu)</h3>
          <button type="button" onClick={addBeam} className="btn-ghost text-xs">
            <Plus className="w-3.5 h-3.5" /> Add beam
          </button>
        </div>

        <div className="rounded-lg border border-line/60 bg-cloud/30 p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute mb-2">Quick fill</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">First Beam No</label>
              <input type="number" min={0} step={1} value={firstBeamNo} onChange={(e) => setFirstBeamNo(e.target.value)} className="input num" placeholder="5715" />
            </div>
            <div>
              <label className="label">No. of Beams</label>
              <input type="number" min={1} step={1} value={beamCount} onChange={(e) => setBeamCount(e.target.value)} className="input num" />
            </div>
            <div>
              <label className="label">Ends (applies to all)</label>
              <input type="number" min={0} step={1} value={commonEnds} onChange={(e) => setCommonEnds(e.target.value)} className="input num" placeholder="2400" />
            </div>
          </div>
          <p className="text-[11px] text-ink-mute mt-2">
            Beam numbers auto-increment from the first. Ends value copies to every beam.
          </p>
        </div>

        <div>
          <label className="label">Default production routing</label>
          <div className="grid sm:grid-cols-3 gap-2">
            {(['in_house','outsource','mixed'] as DefaultMode[]).map((m) => (
              <label key={m} className={`card p-2.5 cursor-pointer text-center text-sm ${defaultMode === m ? 'ring-2 ring-indigo' : ''}`}>
                <input type="radio" name="defmode" checked={defaultMode === m} onChange={() => applyDefaultMode(m)} className="mr-2" />
                {m === 'in_house' ? 'All in-house' : m === 'outsource' ? 'All outsource' : 'Decide per beam'}
              </label>
            ))}
          </div>
          {defaultMode === 'outsource' && (
            <div className="mt-3">
              <label className="label">Outsource Weaver (applies to all beams)</label>
              <select
                value={defaultOutsourceVendorId}
                onChange={(e) => {
                  setDefaultOutsourceVendorId(e.target.value);
                  setBeams((prev) => prev.map((b) => ({ ...b, outsource_vendor_id: e.target.value })));
                }}
                className="input"
              >
                <option value="">— Choose later per beam —</option>
                {masters.weavingVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {beams.map((b, idx) => (
            <div key={idx} className="rounded-lg border border-line/60 p-3 space-y-2 bg-cloud/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-soft">Beam #{idx + 1}</span>
                {beams.length > 1 && (
                  <button type="button" onClick={() => removeBeam(idx)} className="text-rose-600 hover:text-rose-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                <div>
                  <label className="label">Beam No</label>
                  <div className="input num bg-cloud/40 text-ink-mute select-none">{b.beam_no || '—'}</div>
                </div>
                <div>
                  <label className="label">Ends *</label>
                  {/* Auto-filled from Quick fill above, but editable
                      per beam — the operator can override a single
                      row when one beam has a different ends count.
                      Changing the Quick fill Ends afterwards will
                      overwrite all rows again. */}
                  <input
                    type="number" min={1}
                    value={b.ends}
                    onChange={(e) => patchBeam(idx, { ends: e.target.value })}
                    className="input num"
                    placeholder="2400"
                  />
                </div>
                <div>
                  <label className="label">Metres *</label>
                  <input type="number" step="0.01" min={0.01} value={b.meters} onChange={(e) => patchBeam(idx, { meters: e.target.value })} className="input num" placeholder="1240" />
                </div>
              </div>
              {defaultMode === 'mixed' && (
                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="label">Routing</label>
                    <select
                      value={b.production_mode}
                      onChange={(e) => patchBeam(idx, {
                        production_mode: e.target.value as ProdMode,
                        outsource_vendor_id: e.target.value === 'outsource' ? b.outsource_vendor_id : '',
                      })}
                      className="input"
                    >
                      <option value="in_house">In-house</option>
                      <option value="outsource">Outsource</option>
                    </select>
                  </div>
                  {b.production_mode === 'outsource' && (
                    <div>
                      <label className="label">Outsource Weaver *</label>
                      <select value={b.outsource_vendor_id} onChange={(e) => patchBeam(idx, { outsource_vendor_id: e.target.value })} className="input">
                        <option value="">Select weaver…</option>
                        {masters.weavingVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Status + notes ── */}
      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-bold text-ink">Status &amp; notes</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
              {['received','in_process','assigned','done','cancelled'].map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" placeholder="Optional remarks" />
        </div>
      </div>

      {/* ── Bill ── */}
      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-bold text-ink">Sizing Bill</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Bill / Invoice No *</label>
            <input type="text" required value={billNo} onChange={(e) => setBillNo(e.target.value)} className="input" placeholder="e.g. SZ/26-27/0012" />
          </div>
          <div>
            <label className="label">Bill / Invoice Date *</label>
            <input type="date" required value={billDate} onChange={(e) => setBillDate(e.target.value)} className="input" />
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-4">
          <div>
            <label className="label">Rate (₹/kg)</label>
            <input type="number" step="0.0001" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="input num" />
          </div>
          <div>
            <label className="label">GST %</label>
            <input type="number" step="0.01" min={0} max={28} value={gstPct} onChange={(e) => setGstPct(e.target.value)} className="input num" />
          </div>
          <div>
            <label className="label">Charges (₹)</label>
            <div className="input num bg-cloud/60 text-ink-soft flex items-center">
              ₹ {billing.charges.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div>
            <label className="label">Total with GST (₹)</label>
            <div className="input num bg-indigo/5 text-indigo font-bold flex items-center">
              ₹ {billing.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-ink-mute">
          Charges = Yarn Used (kg) × Rate. Bill totals rounded to whole rupees.
        </p>
      </div>

      {error && (
        <div className="card p-3 text-sm text-err bg-rose-50">{error}</div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => router.push('/app/sizing?tab=jobs')} className="btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save job
        </button>
      </div>
    </form>
  );
}
