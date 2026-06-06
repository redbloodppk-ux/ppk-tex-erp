'use client';
/**
 * New Sizing Job — matches the real Shri Nithiya report.
 *
 * Header captures: sizing vendor, yarn supplier, warp count, avg count
 * (optional), yarn source (in-house warehouse vs sizing warehouse — both
 * draw from a real yarn lot which gets decremented on save), yarn
 * sent/used, rate + GST. Status is no longer manual — it defaults to
 * 'received' on create and flips to 'assigned' via a DB trigger when
 * any pavu from this job is mounted on a loom.
 *
 * Beams (pavu) are entered as rows. Each beam has its own beam_no, ends and
 * metres — because the same job can have two different end counts on different
 * physical beams (see Shri Nithiya beam 5726 → Mark 33 vs the rest → Mark 31).
 *
 * Production routing is captured up-front so we don't lose track of which
 * beam goes in-house and which goes to an outsource weaver. "All in-house",
 * "All outsource" or "Decide per beam" — same UI either way.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Trash2 } from 'lucide-react';
import type { Database } from '@/lib/database.types';

// Insert types — the form builds payloads in plain shapes (string-coerced
// from <input>) and we cast at the .insert() call so the typed client is
// satisfied without forcing every state field to match the DB column type.
type SizingJobInsert = Database['public']['Tables']['sizing_job']['Insert'];
type PavuInsert      = Database['public']['Tables']['pavu']['Insert'];

interface Vendor      { id: number; code: string; name: string; vendor_type: string }
// "Supplier" is a yarn-supplying party (party_type = 'Mill / Yarn Supplier').
// Sourced from the unified party table — the old `mill` table is gone (098).
interface Supplier    { id: number; code: string; name: string }
interface YarnCount   { id: number; code: string; display_name: string }
interface YarnLot     { id: number; lot_code: string;
                        current_kg: number;
                        /** Original receipt quantity captured at yarn
                         *  purchase. Used to auto-fill "Yarn Sent to
                         *  Sizing (kg)" when the operator picks the
                         *  lot — the assumption is they're sending the
                         *  full received quantity to the sizing mill. */
                        received_kg: number;
                        yarn_count_id: number; supplier_party_id: number | null;
                        /** Which physical warehouse this lot was delivered to.
                         *  'in_house' = our own warehouse, 'sizing' = the
                         *  sizing mill's warehouse. Picked when the yarn was
                         *  purchased and stored on the lot. */
                        delivery_destination: 'in_house' | 'sizing' | null }

type ProdMode = 'in_house' | 'outsource';
type DefaultMode = ProdMode | 'mixed';

interface BeamRow {
  beam_no: string;
  ends: string;
  meters: string;
  production_mode: ProdMode;
  outsource_vendor_id: string;
}

const emptyBeam = (mode: ProdMode = 'in_house'): BeamRow => ({
  beam_no: '', ends: '', meters: '', production_mode: mode, outsource_vendor_id: '',
});

export default function NewSizingJobPage() {
  const router = useRouter();
  const supabase = createClient();

  // ── master data ───────────────────────────────────────────────────────────
  const [sizingVendors, setSizingVendors] = useState<Vendor[]>([]);
  const [weavingVendors, setWeavingVendors] = useState<Vendor[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [counts, setCounts] = useState<YarnCount[]>([]);
  const [lots,   setLots]   = useState<YarnLot[]>([]);
  const [loading, setLoading] = useState(true);

  // ── header form state ─────────────────────────────────────────────────────
  const [setNo,     setSetNo]     = useState('');
  const [sizingVendorId, setSizingVendorId] = useState('');
  // Renamed from yarnMillId after migration 098 — yarn suppliers now come
  // from the unified party table, not the dropped mill table.
  const [yarnSupplierId, setYarnSupplierId] = useState('');
  const [warpCountId,    setWarpCountId]    = useState('');
  const [avgCount,       setAvgCount]       = useState('');

  // yarn source = which physical warehouse the yarn is coming out of.
  // Maps directly to yarn_lot.delivery_destination so the picker can be
  // filtered to lots that actually live in that warehouse.
  const [yarnSource, setYarnSource] = useState<'in_house' | 'sizing'>('in_house');
  const [yarnLotId,  setYarnLotId]  = useState('');

  // quantities + rate
  const [yarnSentKg, setYarnSentKg] = useState('');
  const [yarnUsedKg, setYarnUsedKg] = useState('');
  const [rate,    setRate]    = useState('26');
  const [gstPct,  setGstPct]  = useState('5');
  // Sizing-mill invoice details — mandatory in the UI, captured at
  // job creation so the job itself acts as a sizing bill record.
  const [billNo,   setBillNo]   = useState('');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Free-text notes only. Status is auto-managed by a DB trigger:
  //   - created     → 'received'
  //   - pavu assigned → 'assigned'  (see migration 100)
  // The old "Status & dates" section was removed in favour of those
  // automatic transitions.
  const [notes,        setNotes]        = useState('');

  // production routing
  const [defaultMode, setDefaultMode] = useState<DefaultMode>('in_house');
  const [defaultOutsourceVendorId, setDefaultOutsourceVendorId] = useState('');

  // beams (one row per physical beam)
  const [beams, setBeams] = useState<BeamRow[]>([emptyBeam('in_house')]);

  // ui state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── load master data ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Resolve the "Mill / Yarn Supplier" party_type id once so we can
      // filter the party table to just yarn suppliers in the dropdown.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ptRes = await (supabase as any).from('party_type_master')
        .select('id')
        .eq('name', 'Mill / Yarn Supplier')
        .maybeSingle();
      const supplierTypeId = ptRes.data?.id as number | undefined;

      const [sv, wv, m, c, l] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('ledger')
          .select('id, code, name, ledger_type:type_id\!inner(name)')
          .eq('active', true).eq('ledger_type.name', 'SIZING(VENDOR)').order('name'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('ledger')
          .select('id, code, name, ledger_type:type_id\!inner(name)')
          .eq('active', true).eq('ledger_type.name', 'WEAVING(VENDOR)').order('name'),
        // Yarn suppliers come from the party table. We filter by
        // party_type_ids containing the "Mill / Yarn Supplier" id so a
        // single party that's both a Customer AND a Supplier still
        // shows up here. The query gracefully returns nothing if the
        // type id wasn't resolved.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supplierTypeId
          ? (supabase as any).from('party')
              .select('id, code, name')
              .contains('party_type_ids', [supplierTypeId])
              .eq('status', 'active')
              .order('name')
          : Promise.resolve({ data: [] as Supplier[] }),
        // Warp yarn count dropdown — show every active yarn count, not
        // just cotton. Mills run polyester / blended warps too and the
        // older `yarn_type='cotton'` filter was hiding valid options
        // from the operator.
        supabase.from('yarn_count').select('id, code, display_name')
          .eq('status', 'active').order('code'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('yarn_lot')
          .select('id, lot_code, current_kg, received_kg, yarn_count_id, supplier_party_id, delivery_destination')
          .gt('current_kg', 0).order('received_date', { ascending: false }).limit(200),
      ]);
      setSizingVendors(sv.data ?? []);
      setWeavingVendors(wv.data ?? []);
      setSuppliers((m.data ?? []) as Supplier[]);
      setCounts(c.data ?? []);
      setLots((l.data ?? []) as YarnLot[]);
      setLoading(false);
    })();
  }, [supabase]);

  // Filter lots to matching count + supplier + warehouse — keeps the
  // dropdown focused on what's actually pickable for this job. The
  // warehouse filter is the key one: switching the radio between
  // In-house / Sizing instantly changes the lot list to the right
  // physical bucket.
  const matchingLots = useMemo(() => {
    return lots.filter(l => {
      if (l.delivery_destination !== yarnSource) return false;
      if (warpCountId && l.yarn_count_id !== Number(warpCountId)) return false;
      if (yarnSupplierId && l.supplier_party_id !== Number(yarnSupplierId)) return false;
      return true;
    });
  }, [lots, warpCountId, yarnSupplierId, yarnSource]);

  // Lookup maps for enriching the Yarn Lot dropdown labels with the
  // yarn count code and supplier (mill) name. Computed once whenever
  // the master lists arrive.
  const countById = useMemo(() => {
    const m = new Map<number, YarnCount>();
    for (const c of counts) m.set(c.id, c);
    return m;
  }, [counts]);
  const supplierById = useMemo(() => {
    const m = new Map<number, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  // The Yarn Supplier dropdown only lists suppliers who actually
  // shipped yarn to the sizing warehouse — i.e. there's at least one
  // yarn_lot for them with delivery_destination = 'sizing' (still in
  // stock). Suppliers without sizing-warehouse stock would have no
  // pickable yarn lot downstream so they're filtered out up front.
  const sizingSupplierIds = useMemo(() => {
    const s = new Set<number>();
    for (const l of lots) {
      if (l.delivery_destination === 'sizing' && l.supplier_party_id != null) {
        s.add(l.supplier_party_id);
      }
    }
    return s;
  }, [lots]);
  const eligibleSuppliers = useMemo(() => {
    // When sizing mill is empty, we still narrow to suppliers with at
    // least one sizing-warehouse lot. The user explicitly asked for
    // this filter to apply once a sizing mill is in play; for the
    // initial page state where no mill is picked yet, showing the
    // narrowed list is the safer default — every visible supplier is
    // guaranteed to yield at least one pickable yarn lot below.
    return suppliers.filter((s) => sizingSupplierIds.has(s.id));
  }, [suppliers, sizingSupplierIds]);

  // When the warehouse choice changes, clear any stale yarn-lot selection
  // so the operator can't accidentally submit a lot from the wrong
  // warehouse (the dropdown now only shows valid options).
  useEffect(() => {
    setYarnLotId('');
  }, [yarnSource]);

  // When a yarn lot is picked, pre-fill "Yarn Sent to Sizing (kg)"
  // with the lot's received_kg. The operator can still override the
  // value — this is just a sensible default so the common "send the
  // whole lot" case is one click instead of a manual re-type.
  useEffect(() => {
    if (yarnLotId === '') return;
    const lot = lots.find((l) => l.id === Number(yarnLotId));
    if (lot && lot.received_kg != null) {
      setYarnSentKg(String(lot.received_kg));
    }
  }, [yarnLotId, lots]);

  // ── billing math ──────────────────────────────────────────────────────────
  // Sizing charges multiply against Yarn Used (kg), not Yarn Sent.
  // Mills bill for what they actually sized, not for what was handed
  // over — sent quantity stays as a stock-movement record only.
  const billing = useMemo(() => {
    const kg = Number(yarnUsedKg) || 0;
    const r  = Number(rate) || 0;
    const g  = Number(gstPct) || 0;
    const charges = kg * r;
    const total   = +(charges * (1 + g / 100)).toFixed(2);
    return { charges: +charges.toFixed(2), total };
  }, [yarnUsedKg, rate, gstPct]);

  const balance = useMemo(() => {
    return (Number(yarnSentKg) || 0) - (Number(yarnUsedKg) || 0);
  }, [yarnSentKg, yarnUsedKg]);

  // ── beam row helpers ──────────────────────────────────────────────────────
  function patchBeam(idx: number, patch: Partial<BeamRow>) {
    setBeams(prev => prev.map((b, i) => i === idx ? { ...b, ...patch } : b));
  }
  function addBeam() {
    const mode: ProdMode = defaultMode === 'outsource' ? 'outsource' : 'in_house';
    setBeams(prev => [...prev, emptyBeam(mode)]);
  }
  function removeBeam(idx: number) {
    setBeams(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  // When the user changes the "default routing", apply it to all rows
  // (unless they're already in mixed mode and have customised per beam).
  function applyDefaultMode(mode: DefaultMode) {
    setDefaultMode(mode);
    if (mode === 'mixed') return;
    setBeams(prev => prev.map(b => ({
      ...b,
      production_mode: mode,
      outsource_vendor_id: mode === 'outsource' ? (b.outsource_vendor_id || defaultOutsourceVendorId) : '',
    })));
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate beams
    for (const b of beams) {
      if (!b.beam_no.trim()) return setError('Every beam needs a beam number.');
      if (!Number(b.ends))   return setError('Every beam needs ends > 0.');
      if (!Number(b.meters)) return setError('Every beam needs metres > 0.');
      if (b.production_mode === 'outsource' && !b.outsource_vendor_id) {
        return setError(`Beam ${b.beam_no}: outsource vendor missing.`);
      }
    }
    if (!yarnLotId) {
      return setError('Pick a yarn lot. If no lots are listed, check the warehouse / count / supplier choices above.');
    }
    // Sizing-bill validation. Both fields are required by the new
    // sizing-bill workflow (migration 116).
    if (!billNo.trim()) {
      return setError('Enter the sizing mill\u2019s bill / invoice number.');
    }
    if (!billDate) {
      return setError('Enter the sizing bill / invoice date.');
    }

    // Find the lot we're drawing from so we can validate the kg balance
    // and decrement its current_kg after the job is saved.
    const sourceLot = lots.find(l => l.id === Number(yarnLotId));
    if (!sourceLot) {
      return setError('Selected yarn lot is no longer available — reload the page and try again.');
    }

    const sentKg = Number(yarnSentKg) || 0;
    if (sentKg > Number(sourceLot.current_kg)) {
      return setError(
        `Yarn sent (${sentKg.toFixed(3)} kg) is more than what's in lot ` +
        `${sourceLot.lot_code} (${Number(sourceLot.current_kg).toFixed(3)} kg available).`,
      );
    }

    setBusy(true);

    // 1. Insert the job header. yarn_source is stored as 'warehouse' for
    //    both options because both flow through a yarn lot — the choice
    //    of physical warehouse is captured by the lot's
    //    delivery_destination column, not by yarn_source.
    const headerPayload = {
      set_no:           setNo.trim() || null,
      sizing_ledger_id: Number(sizingVendorId),
      // Column renamed from yarn_mill_id to yarn_supplier_party_id by
      // migration 098 (yarn suppliers now live in the party table).
      yarn_supplier_party_id: Number(yarnSupplierId),
      warp_count_id:    Number(warpCountId),
      avg_count:        avgCount ? Number(avgCount) : null,
      yarn_source:      'warehouse',
      yarn_lot_id:      Number(yarnLotId),
      yarn_sent_kg:     sentKg,
      yarn_used_kg:     Number(yarnUsedKg) || 0,
      no_of_paavu:      beams.length,
      sizing_rate_per_kg: Number(rate) || 0,
      charges_amount:   billing.charges,
      gst_pct:          Number(gstPct) || 0,
      total_amount:     billing.total,
      // Sizing-bill fields (migration 116). Both mandatory in the UI.
      bill_no:          billNo.trim(),
      bill_date:        billDate,
      default_production_mode: defaultMode === 'mixed' ? null : defaultMode,
      default_outsource_ledger_id:
        defaultMode === 'outsource' && defaultOutsourceVendorId
          ? Number(defaultOutsourceVendorId) : null,
      // Status is auto-managed (migration 100): defaults to 'received'
      // on insert, then a trigger flips it to 'assigned' the moment a
      // pavu is assigned to a loom. date_sent is stamped to today since
      // the yarn leaves our warehouse the moment the job is created.
      status:           'received',
      date_sent:        new Date().toISOString().slice(0, 10),
      date_received:    new Date().toISOString().slice(0, 10),
      notes:            notes.trim() || null,
    };

    // Cast via unknown because the regenerated Supabase types haven't
    // caught up to the yarn_supplier_party_id rename (migration 098).
    const { data: job, error: jobErr } = await supabase
      .from('sizing_job')
      .insert(headerPayload as unknown as SizingJobInsert)
      .select('id')
      .single();

    if (jobErr || !job) {
      setBusy(false);
      return setError(jobErr?.message ?? 'Could not create job.');
    }

    // 2. Insert all beam rows
    const beamRows = beams.map(b => ({
      sizing_job_id:       job.id,
      beam_no:             b.beam_no.trim(),
      ends:                Number(b.ends),
      meters:              Number(b.meters),
      production_mode:     b.production_mode,
      outsource_ledger_id: b.production_mode === 'outsource' && b.outsource_vendor_id
                             ? Number(b.outsource_vendor_id) : null,
    }));
    const { error: beamErr } = await supabase.from('pavu').insert(beamRows as PavuInsert[]);
    if (beamErr) {
      setBusy(false);
      return setError(`Job created but beams failed: ${beamErr.message}`);
    }

    // 3. Decrement the source yarn lot's current_kg. The warehouse views
    //    read current_kg directly, so this makes the outflow visible
    //    immediately. We compute the new value client-side because
    //    there's no atomic decrement RPC for this column yet — race
    //    conditions are vanishingly rare given a single-operator workflow.
    const newKg = Math.max(0, Number(sourceLot.current_kg) - sentKg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: lotErr } = await (supabase as any)
      .from('yarn_lot')
      .update({ current_kg: newKg })
      .eq('id', sourceLot.id);
    if (lotErr) {
      setBusy(false);
      return setError(`Job ${job.id} created but yarn lot stock did not update: ${lotErr.message}`);
    }

    router.push('/app/sizing');
    router.refresh();
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New Sizing Job"
        crumbs={[{ label: 'Sizing', href: '/app/sizing' }, { label: 'New' }]}
        subtitle="Enter the job exactly as it appears on the sizing vendor's report."
      />

      {loading ? (
        <div className="card p-6 text-sm text-ink-soft">Loading vendors, mills & yarn counts…</div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {/* ─── Header ─────────────────────────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-ink">Job header</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Job Code</label>
                <div className="input num bg-cloud/60 text-ink-mute flex items-center cursor-not-allowed select-none">
                  Auto-generated (SZ-2026-NNNN)
                </div>
              </div>
              <div>
                <label className="label">Vendor SET NO</label>
                <input
                  value={setNo} onChange={e => setSetNo(e.target.value)}
                  className="input num" placeholder="e.g. 994"
                />
                <p className="text-[11px] text-ink-mute mt-1">As printed on their report. Optional.</p>
              </div>
              <div>
                <label className="label">Sizing Mill *</label>
                <select required value={sizingVendorId} onChange={e => setSizingVendorId(e.target.value)} className="input">
                  <option value="" disabled>Select sizing vendor…</option>
                  {sizingVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Yarn Supplier *</label>
                <select required value={yarnSupplierId} onChange={e => setYarnSupplierId(e.target.value)} className="input">
                  <option value="" disabled>Select yarn supplier…</option>
                  {eligibleSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <p className="text-[11px] text-ink-mute mt-1">
                  Showing only suppliers who have shipped yarn to the
                  sizing warehouse (delivery&nbsp;=&nbsp;sizing).
                  {eligibleSuppliers.length === 0 && (
                    <span className="block text-amber-700 mt-0.5">
                      No supplier has yarn in the sizing warehouse yet.
                      Record a yarn purchase with delivery destination
                      = sizing first.
                    </span>
                  )}
                </p>
              </div>
              <div>
                <label className="label">Warp Yarn Count *</label>
                <select required value={warpCountId} onChange={e => setWarpCountId(e.target.value)} className="input">
                  <option value="" disabled>Select count…</option>
                  {counts.map(c => <option key={c.id} value={c.id}>{c.code} — {c.display_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Ends Average Count</label>
                <input
                  type="number" step="0.01" min={0}
                  value={avgCount} onChange={e => setAvgCount(e.target.value)}
                  className="input num" placeholder="e.g. 53.18"
                />
                <p className="text-[11px] text-ink-mute mt-1">Optional. From the vendor's report.</p>
              </div>
            </div>
          </div>

          {/* ─── Yarn source + quantities ──────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-ink">Yarn</h3>
            <div>
              <label className="label">Where did the yarn come from?</label>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className={`card p-3 cursor-pointer ${yarnSource === 'in_house' ? 'ring-2 ring-indigo' : ''}`}>
                  <input type="radio" name="src" checked={yarnSource==='in_house'} onChange={() => setYarnSource('in_house')} className="mr-2" />
                  <span className="font-semibold">In-house warehouse</span>
                  <p className="text-xs text-ink-mute mt-1">Yarn lot sitting in our own warehouse will be reduced.</p>
                </label>
                <label className={`card p-3 cursor-pointer ${yarnSource === 'sizing' ? 'ring-2 ring-indigo' : ''}`}>
                  <input type="radio" name="src" checked={yarnSource==='sizing'} onChange={() => setYarnSource('sizing')} className="mr-2" />
                  <span className="font-semibold">Sizing warehouse</span>
                  <p className="text-xs text-ink-mute mt-1">Yarn lot already with the sizing mill will be reduced.</p>
                </label>
              </div>
            </div>

            <div>
              <label className="label">Yarn Lot *</label>
              <select required value={yarnLotId} onChange={e => setYarnLotId(e.target.value)} className="input">
                <option value="" disabled>
                  {matchingLots.length
                    ? 'Select a lot…'
                    : `No ${yarnSource === 'in_house' ? 'in-house' : 'sizing'} warehouse lots match — change the count, supplier, or switch warehouse`}
                </option>
                {matchingLots.map(l => {
                  // Append the yarn count + supplier (mill) name to the
                  // label so the operator can disambiguate lots at a
                  // glance — same lot code series across counts and
                  // mills is common.
                  const countLabel = countById.get(l.yarn_count_id)?.code ?? '';
                  const millLabel  = l.supplier_party_id != null
                    ? supplierById.get(l.supplier_party_id)?.name ?? ''
                    : '';
                  const suffixParts = [countLabel, millLabel].filter((s) => s !== '');
                  const suffix = suffixParts.length > 0 ? ` · ${suffixParts.join(' · ')}` : '';
                  return (
                    <option key={l.id} value={l.id}>
                      {l.lot_code}{suffix} — {Number(l.current_kg).toFixed(1)} kg in stock
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-ink-mute mt-1">
                Showing lots in the <b>{yarnSource === 'in_house' ? 'In-house' : 'Sizing'} warehouse</b> that match the chosen count and supplier.
                The lot&apos;s <b>current_kg</b> will be reduced by the yarn-sent amount on save.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Yarn Sent to Sizing (kg) *</label>
                <input
                  type="number" step="0.001" min={0} required
                  value={yarnSentKg} onChange={e => setYarnSentKg(e.target.value)}
                  className="input num"
                />
              </div>
              <div>
                <label className="label">Yarn Used (kg)</label>
                <input
                  type="number" step="0.001" min={0}
                  value={yarnUsedKg} onChange={e => setYarnUsedKg(e.target.value)}
                  className="input num"
                />
                <p className="text-[11px] text-ink-mute mt-1">Cumulative consumption so far.</p>
              </div>
              <div>
                <label className="label">Balance (kg)</label>
                <div className={`input num flex items-center font-bold ${
                  balance < 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {balance.toFixed(3)}
                </div>
              </div>
            </div>
          </div>

          {/* ─── Beams ─────────────────────────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-bold text-ink">Beams (Pavu)</h3>
              <button type="button" onClick={addBeam} className="btn-ghost text-xs">
                <Plus className="w-3.5 h-3.5" /> Add beam
              </button>
            </div>

            {/* Production routing chooser */}
            <div>
              <label className="label">Default production routing</label>
              <div className="grid sm:grid-cols-3 gap-2">
                {(['in_house','outsource','mixed'] as DefaultMode[]).map(m => (
                  <label key={m} className={`card p-2.5 cursor-pointer text-center text-sm ${
                    defaultMode === m ? 'ring-2 ring-indigo' : ''
                  }`}>
                    <input type="radio" name="defmode" checked={defaultMode===m}
                      onChange={() => applyDefaultMode(m)} className="mr-2" />
                    {m === 'in_house' ? 'All in-house' : m === 'outsource' ? 'All outsource' : 'Decide per beam'}
                  </label>
                ))}
              </div>
              {defaultMode === 'outsource' && (
                <div className="mt-3">
                  <label className="label">Outsource Weaver (applies to all beams)</label>
                  <select value={defaultOutsourceVendorId} onChange={e => {
                    setDefaultOutsourceVendorId(e.target.value);
                    setBeams(prev => prev.map(b => ({ ...b, outsource_vendor_id: e.target.value })));
                  }} className="input">
                    <option value="">— Choose later per beam —</option>
                    {weavingVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Beam rows */}
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
                      <label className="label">Beam No *</label>
                      <input value={b.beam_no} onChange={e => patchBeam(idx, { beam_no: e.target.value })}
                        className="input num" placeholder="e.g. 5715" />
                    </div>
                    <div>
                      <label className="label">Ends *</label>
                      <input type="number" min={1} value={b.ends}
                        onChange={e => patchBeam(idx, { ends: e.target.value })}
                        className="input num" placeholder="2400" />
                    </div>
                    <div>
                      <label className="label">Metres *</label>
                      <input type="number" step="0.01" min={0.01} value={b.meters}
                        onChange={e => patchBeam(idx, { meters: e.target.value })}
                        className="input num" placeholder="1240" />
                    </div>
                  </div>
                  {defaultMode === 'mixed' && (
                    <div className="grid sm:grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="label">Routing</label>
                        <select value={b.production_mode}
                          onChange={e => patchBeam(idx, {
                            production_mode: e.target.value as ProdMode,
                            outsource_vendor_id: e.target.value === 'outsource' ? b.outsource_vendor_id : '',
                          })}
                          className="input">
                          <option value="in_house">In-house</option>
                          <option value="outsource">Outsource</option>
                        </select>
                      </div>
                      {b.production_mode === 'outsource' && (
                        <div>
                          <label className="label">Outsource Weaver *</label>
                          <select value={b.outsource_vendor_id}
                            onChange={e => patchBeam(idx, { outsource_vendor_id: e.target.value })}
                            className="input">
                            <option value="">Select weaver…</option>
                            {weavingVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ─── Sizing Bill ───────────────────────────────────────────── */}
          {/* The whole sizing-charges section now doubles as the sizing
              bill record. Invoice no + date are mandatory, and charges
              multiply against Yarn Used (kg) — the quantity actually
              sized by the mill. */}
          <div className="card p-6 space-y-3">
            <h3 className="text-sm font-bold text-ink">Sizing Bill</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Bill / Invoice No *</label>
                <input
                  type="text" required value={billNo}
                  onChange={e => setBillNo(e.target.value)}
                  className="input" placeholder="e.g. SZ/26-27/0012"
                />
              </div>
              <div>
                <label className="label">Bill / Invoice Date *</label>
                <input
                  type="date" required value={billDate}
                  onChange={e => setBillDate(e.target.value)}
                  className="input"
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-4 gap-4">
              <div>
                <label className="label">Rate (₹/kg)</label>
                <input type="number" step="0.0001" min={0} value={rate}
                  onChange={e => setRate(e.target.value)} className="input num" />
              </div>
              <div>
                <label className="label">GST %</label>
                <input type="number" step="0.01" min={0} max={28} value={gstPct}
                  onChange={e => setGstPct(e.target.value)} className="input num" />
              </div>
              <div>
                <label className="label">Charges (₹)</label>
                <div className="input num bg-cloud/60 text-ink-soft flex items-center">
                  ₹ {billing.charges.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <label className="label">Total with GST (₹)</label>
                <div className="input num bg-indigo/5 text-indigo font-bold flex items-center">
                  ₹ {billing.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-ink-mute">
              Charges = Yarn Used (kg) × Rate. Update Yarn Used above to
              recalculate.
            </p>
          </div>

          {/* ─── Notes ─────────────────────────────────────────────────── */}
          <div className="card p-6 space-y-3">
            <h3 className="text-sm font-bold text-ink">Notes</h3>
            <p className="text-[11px] text-ink-mute">
              Status is set automatically: <b>Received</b> on create, then
              <b> Assigned</b> the moment any beam from this job is mounted
              on a loom.
            </p>
            <div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input" placeholder="Optional remarks" />
            </div>
          </div>

          {error && <div className="card p-3 bg-red-50 text-err text-sm">{error}</div>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => router.back()} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Saving…' : 'Create Sizing Job'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
