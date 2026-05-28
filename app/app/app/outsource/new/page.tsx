'use client';
/**
 * New Outsource Order (CORR-P5)
 *
 * Records yarn issued to a weaving vendor. Vendor will return fabric later,
 * recorded via /app/outsource/[id] which creates the matching production_batch.
 *
 * Auto-generates ow_number as OW-YYYY-NNN (year + next sequence).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface Vendor {
  id: number;
  code: string | null;
  name: string;
}

interface Costing {
  id: number;
  quality_code: string;
  quality_name: string;
  approval_status: string;
}

interface YarnLot {
  id: number;
  lot_code: string;
  current_kg: number;
  cost_per_kg: number;
}

interface Bobbin {
  id: number;
  code: string;
  description: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export default function NewOutsourceOrderPage(): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [vendors, setVendors]   = useState<Vendor[]>([]);
  const [costings, setCostings] = useState<Costing[]>([]);
  const [lots, setLots]         = useState<YarnLot[]>([]);
  const [bobbins, setBobbins]   = useState<Bobbin[]>([]);
  const [loading, setLoading]   = useState(true);

  const [vendorId, setVendorId]   = useState('');
  const [costingId, setCostingId] = useState('');
  const [warpLotId, setWarpLotId] = useState('');
  const [weftLotId, setWeftLotId] = useState('');
  const [porvaiLotId, setPorvaiLotId] = useState('');
  const [bobbin1Id, setBobbin1Id] = useState('');
  const [bobbin1Pcs, setBobbin1Pcs] = useState('0');
  const [expectedM, setExpectedM] = useState('');
  const [pickPaise, setPickPaise] = useState('');
  const [issuedDate, setIssuedDate] = useState(today());
  const [promisedDate, setPromisedDate] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [v, c, y, b] = await Promise.all([
        supabase.from('vendor').select('id, code, name').order('name'),
        supabase
          .from('costing_master')
          .select('id, quality_code, quality_name, approval_status')
          .eq('approval_status', 'approved')
          .order('quality_code'),
        supabase
          .from('yarn_lot')
          .select('id, lot_code, current_kg, cost_per_kg')
          .gt('current_kg', 0)
          .order('received_date', { ascending: false })
          .limit(200),
        supabase
          .from('bobbin')
          .select('id, code, description')
          .eq('status', 'active')
          .order('code'),
      ]);
      setVendors((v.data as Vendor[]) ?? []);
      setCostings((c.data as Costing[]) ?? []);
      setLots((y.data as YarnLot[]) ?? []);
      setBobbins((b.data as Bobbin[]) ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  async function nextOwNumber(): Promise<string> {
    const year = new Date().getFullYear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('outsource_order')
      .select('ow_number')
      .ilike('ow_number', `OW-${year}-%`)
      .order('id', { ascending: false })
      .limit(1);
    const last = (data as { ow_number: string }[] | null)?.[0]?.ow_number;
    const lastN = last ? Number(last.split('-')[2] ?? '0') : 0;
    const next = String((lastN || 0) + 1).padStart(3, '0');
    return `OW-${year}-${next}`;
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!vendorId)  { setError('Pick a vendor.'); return; }
    if (!costingId) { setError('Pick the quality being woven.'); return; }
    if (!expectedM || Number(expectedM) <= 0) { setError('Expected metres must be > 0.'); return; }
    if (!pickPaise || Number(pickPaise) <= 0) { setError('Vendor pick paise rate must be > 0.'); return; }

    setBusy(true);
    try {
      const ow_number = await nextOwNumber();
      const payload = {
        ow_number,
        vendor_id: Number(vendorId),
        costing_id: Number(costingId),
        warp_lot_id: warpLotId ? Number(warpLotId) : null,
        weft_lot_id: weftLotId ? Number(weftLotId) : null,
        porvai_lot_id: porvaiLotId ? Number(porvaiLotId) : null,
        bobbin_1_id: bobbin1Id ? Number(bobbin1Id) : null,
        bobbin_1_pcs_issued: Number(bobbin1Pcs || 0),
        expected_metres: Number(expectedM),
        pick_paise_agreed: Number(pickPaise),
        issued_date: issuedDate,
        promised_date: promisedDate || null,
        notes: notes || null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insErr } = await (supabase as any).from('outsource_order').insert(payload);
      if (insErr) { setError(insErr.message); setBusy(false); return; }
      router.push('/app/outsource');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save outsource order.');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="New Outsource Order" subtitle="Issue yarn to a weaving vendor." />
        <div className="card p-10 text-center text-ink-soft text-sm">
          <Loader2 className="w-5 h-5 inline animate-spin mr-2" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="New Outsource Order"
        subtitle="Issue yarn to a weaving vendor. Fabric received back will create a production batch with the vendor pick paise frozen as the loom cost."
        actions={
          <Link href="/app/outsource" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        }
      />

      <form onSubmit={onSubmit} className="space-y-4 max-w-3xl">
        <section className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">1. Vendor &amp; quality</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Vendor *</label>
              <select required value={vendorId} onChange={e => setVendorId(e.target.value)} className="input">
                <option value="" disabled>Select vendor…</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}{v.code ? ` (${v.code})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Costing (approved) *</label>
              <select required value={costingId} onChange={e => setCostingId(e.target.value)} className="input">
                <option value="" disabled>Select quality…</option>
                {costings.map(c => (
                  <option key={c.id} value={c.id}>{c.quality_code} — {c.quality_name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">2. Yarn issued</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Warp yarn lot</label>
              <select value={warpLotId} onChange={e => setWarpLotId(e.target.value)} className="input">
                <option value="">— Not set —</option>
                {lots.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.lot_code} · ₹{Number(l.cost_per_kg).toFixed(2)}/kg · {Number(l.current_kg).toFixed(1)} kg
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Weft yarn lot</label>
              <select value={weftLotId} onChange={e => setWeftLotId(e.target.value)} className="input">
                <option value="">— Not set —</option>
                {lots.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.lot_code} · ₹{Number(l.cost_per_kg).toFixed(2)}/kg
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Porvai yarn lot</label>
              <select value={porvaiLotId} onChange={e => setPorvaiLotId(e.target.value)} className="input">
                <option value="">— Not set —</option>
                {lots.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.lot_code} · ₹{Number(l.cost_per_kg).toFixed(2)}/kg
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Bobbin 1</label>
              <select value={bobbin1Id} onChange={e => setBobbin1Id(e.target.value)} className="input">
                <option value="">— Not set —</option>
                {bobbins.map(b => (
                  <option key={b.id} value={b.id}>{b.code} — {b.description}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Bobbin 1 pcs issued</label>
              <input type="number" min="0" step="0.01" value={bobbin1Pcs}
                     onChange={e => setBobbin1Pcs(e.target.value)} className="input num" />
            </div>
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">3. Commercial terms</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Expected metres *</label>
              <input type="number" min="0" step="0.01" required
                     value={expectedM} onChange={e => setExpectedM(e.target.value)}
                     className="input num" />
            </div>
            <div>
              <label className="label">Pick paise (₹ per metre) *</label>
              <input type="number" min="0" step="0.0001" required
                     value={pickPaise} onChange={e => setPickPaise(e.target.value)}
                     className="input num" placeholder="e.g. 6.50" />
              <div className="text-xs text-ink-mute mt-1">
                Vendor's rate per metre — frozen on each fabric receipt as the actual loom cost.
              </div>
            </div>
            <div>
              <label className="label">Issued date *</label>
              <input type="date" required value={issuedDate}
                     onChange={e => setIssuedDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Promised date</label>
              <input type="date" value={promisedDate}
                     onChange={e => setPromisedDate(e.target.value)} className="input" />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      rows={2} className="input"
                      placeholder="Vendor specific notes, special pricing, etc." />
          </div>
        </section>

        {error && (
          <div className="card p-3 text-sm text-err bg-red-50/40 border-red-100">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Link href="/app/outsource" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : 'Create outsource order'}
          </button>
        </div>
      </form>
    </div>
  );
}
