'use client';
/**
 * New Sizing Job — matches the real Shri Nithiya report.
 *
 * Header captures: sizing vendor, yarn mill, warp count, avg count (optional),
 * yarn source (warehouse lot or purchase_direct), yarn sent/used, rate + GST.
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
interface Mill        { id: number; code: string; name: string }
interface YarnCount   { id: number; code: string; display_name: string }
interface YarnLot     { id: number; lot_code: string; current_kg: number;
                        yarn_count_id: number; mill_id: number }

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
  const [mills, setMills]   = useState<Mill[]>([]);
  const [counts, setCounts] = useState<YarnCount[]>([]);
  const [lots,   setLots]   = useState<YarnLot[]>([]);
  const [loading, setLoading] = useState(true);

  // ── header form state ─────────────────────────────────────────────────────
  const [setNo,     setSetNo]     = useState('');
  const [sizingVendorId, setSizingVendorId] = useState('');
  const [yarnMillId,     setYarnMillId]     = useState('');
  const [warpCountId,    setWarpCountId]    = useState('');
  const [avgCount,       setAvgCount]       = useState('');

  // yarn source
  const [yarnSource, setYarnSource] = useState<'warehouse' | 'purchase_direct'>('warehouse');
  const [yarnLotId,  setYarnLotId]  = useState('');

  // quantities + rate
  const [yarnSentKg, setYarnSentKg] = useState('');
  const [yarnUsedKg, setYarnUsedKg] = useState('');
  const [rate,    setRate]    = useState('26');
  const [gstPct,  setGstPct]  = useState('5');

  // dates / status
  const [dateSent,     setDateSent]     = useState('');
  const [dateReceived, setDateReceived] = useState('');
  const [status,       setStatus]       = useState<'draft'|'sent'|'in_process'|'received'>('received');
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
      const [sv, wv, m, c, l] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('ledger')
          .select('id, code, name, ledger_type:type_id\!inner(name)')
          .eq('active', true).eq('ledger_type.name', 'SIZING(VENDOR)').order('name'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('ledger')
          .select('id, code, name, ledger_type:type_id\!inner(name)')
          .eq('active', true).eq('ledger_type.name', 'WEAVING(VENDOR)').order('name'),
        supabase.from('mill').select('id, code, name').eq('status', 'active').order('name'),
        supabase.from('yarn_count').select('id, code, display_name')
          .eq('yarn_type', 'cotton').eq('status', 'active').order('code'),
        supabase.from('yarn_lot').select('id, lot_code, current_kg, yarn_count_id, mill_id')
          .gt('current_kg', 0).order('received_date', { ascending: false }).limit(200),
      ]);
      setSizingVendors(sv.data ?? []);
      setWeavingVendors(wv.data ?? []);
      setMills(m.data ?? []);
      setCounts(c.data ?? []);
      setLots(l.data ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  // Filter lots to matching count + mill — keeps the dropdown short.
  const matchingLots = useMemo(() => {
    if (!warpCountId || !yarnMillId) return lots;
    return lots.filter(l =>
      l.yarn_count_id === Number(warpCountId) &&
      l.mill_id       === Number(yarnMillId)
    );
  }, [lots, warpCountId, yarnMillId]);

  // ── billing math ──────────────────────────────────────────────────────────
  const billing = useMemo(() => {
    const kg = Number(yarnSentKg) || 0;
    const r  = Number(rate) || 0;
    const g  = Number(gstPct) || 0;
    const charges = kg * r;
    const total   = +(charges * (1 + g / 100)).toFixed(2);
    return { charges: +charges.toFixed(2), total };
  }, [yarnSentKg, rate, gstPct]);

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
    if (yarnSource === 'warehouse' && !yarnLotId) {
      return setError('Pick a yarn lot, or switch source to "Direct from purchase".');
    }

    setBusy(true);

    // 1. Insert the job header
    const headerPayload = {
      set_no:           setNo.trim() || null,
      sizing_ledger_id: Number(sizingVendorId),
      yarn_mill_id:     Number(yarnMillId),
      warp_count_id:    Number(warpCountId),
      avg_count:        avgCount ? Number(avgCount) : null,
      yarn_source:      yarnSource,
      yarn_lot_id:      yarnSource === 'warehouse' ? Number(yarnLotId) : null,
      yarn_sent_kg:     Number(yarnSentKg) || 0,
      yarn_used_kg:     Number(yarnUsedKg) || 0,
      no_of_paavu:      beams.length,
      sizing_rate_per_kg: Number(rate) || 0,
      charges_amount:   billing.charges,
      gst_pct:          Number(gstPct) || 0,
      total_amount:     billing.total,
      default_production_mode: defaultMode === 'mixed' ? null : defaultMode,
      default_outsource_ledger_id:
        defaultMode === 'outsource' && defaultOutsourceVendorId
          ? Number(defaultOutsourceVendorId) : null,
      status,
      date_sent:        dateSent     || null,
      date_received:    dateReceived || null,
      notes:            notes.trim() || null,
    };

    const { data: job, error: jobErr } = await supabase
      .from('sizing_job')
      .insert(headerPayload as SizingJobInsert)
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
                <label className="label">Yarn Mill (brand) *</label>
                <select required value={yarnMillId} onChange={e => setYarnMillId(e.target.value)} className="input">
                  <option value="" disabled>Select yarn mill…</option>
                  {mills.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
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
                <label className={`card p-3 cursor-pointer ${yarnSource === 'warehouse' ? 'ring-2 ring-indigo' : ''}`}>
                  <input type="radio" name="src" checked={yarnSource==='warehouse'} onChange={() => setYarnSource('warehouse')} className="mr-2" />
                  <span className="font-semibold">From our warehouse</span>
                  <p className="text-xs text-ink-mute mt-1">Pick a yarn lot we have in stock.</p>
                </label>
                <label className={`card p-3 cursor-pointer ${yarnSource === 'purchase_direct' ? 'ring-2 ring-indigo' : ''}`}>
                  <input type="radio" name="src" checked={yarnSource==='purchase_direct'} onChange={() => setYarnSource('purchase_direct')} className="mr-2" />
                  <span className="font-semibold">Direct from purchase</span>
                  <p className="text-xs text-ink-mute mt-1">Yarn was delivered straight to the sizing mill.</p>
                </label>
              </div>
            </div>

            {yarnSource === 'warehouse' && (
              <div>
                <label className="label">Yarn Lot *</label>
                <select required value={yarnLotId} onChange={e => setYarnLotId(e.target.value)} className="input">
                  <option value="" disabled>
                    {matchingLots.length ? 'Select a lot…' : 'No matching lots — change count/mill or switch source'}
                  </option>
                  {matchingLots.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.lot_code} — {Number(l.current_kg).toFixed(1)} kg in stock
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-ink-mute mt-1">
                  Filtered by the count and mill you picked above.
                </p>
              </div>
            )}

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

          {/* ─── Billing ───────────────────────────────────────────────── */}
          <div className="card p-6 space-y-3">
            <h3 className="text-sm font-bold text-ink">Sizing charges</h3>
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
          </div>

          {/* ─── Flow ──────────────────────────────────────────────────── */}
          <div className="card p-6 space-y-3">
            <h3 className="text-sm font-bold text-ink">Status & dates</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Status</label>
                <select value={status} onChange={e => setStatus(e.target.value as any)} className="input">
                  <option value="draft">Draft</option>
                  <option value="sent">Sent to vendor</option>
                  <option value="in_process">In process</option>
                  <option value="received">Received</option>
                </select>
              </div>
              <div>
                <label className="label">Date Sent</label>
                <input type="date" value={dateSent} onChange={e => setDateSent(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Date Received</label>
                <input type="date" value={dateReceived} onChange={e => setDateReceived(e.target.value)} className="input" />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
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
