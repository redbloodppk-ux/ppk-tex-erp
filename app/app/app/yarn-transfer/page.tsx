'use client';
/**
 * Yarn Transfer — move weft yarn between the Sizing warehouse, the
 * In-house warehouse and an Outsource / Job-work weaver (migration 313).
 *
 * A transfer is not a purchase: no supplier, invoice, GST or payable.
 * The cost per kg travels with the yarn. Yarn given to a weaver becomes
 * a weft bag for that weaver, so their fabric receipts consume it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { SmartSelect } from '@/app/components/smart-select';
import { appAlert, appConfirm } from '@/lib/app-dialog';
import { formatDay, todayIST } from '@/lib/utils';
import { measureYarnAt, deleteYarnTransfer, type YarnLoc } from '@/lib/yarn-transfer';
import { ArrowRight, Loader2, Printer, Trash2 } from 'lucide-react';

interface Count { id: number; code: string; display_name: string | null }
interface Party { id: number; name: string; kind: string | null }
interface PurchaseLot {
  id: number; lot_code: string; invoice_no: string | null; received_date: string;
  received_kg: number; bag_count: number; yarn_count_id: number; delivery_destination: string;
  supplier: { name: string } | null;
}
interface Transfer {
  id: number; transfer_code: string | null; transfer_date: string; yarn_count_id: number;
  kg: number; bag_count: number; from_loc: YarnLoc; to_loc: YarnLoc;
  from_party_id: number | null; to_party_id: number | null; cost_per_kg: number | null; notes: string | null;
}

/** Location select value: 'sizing' | 'in_house' | 'p:<party id>'. */
function parseLoc(v: string): { loc: YarnLoc; party: number | null } | null {
  if (v === 'sizing' || v === 'in_house') return { loc: v, party: null };
  const m = /^p:(\d+)$/.exec(v);
  return m ? { loc: 'outsource', party: Number(m[1]) } : null;
}

const kgFmt = (v: number): string => `${v.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg`;

export default function YarnTransferPage(): React.ReactElement {
  const sb = useMemo(() => createClient() as any, []);
  const router = useRouter();
  const [counts, setCounts] = useState<Count[]>([]);
  const [lots, setLots] = useState<PurchaseLot[]>([]);
  const [lotId, setLotId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [parties, setParties] = useState<Party[]>([]);
  const [rows, setRows] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(todayIST());
  const [from, setFrom] = useState('sizing');
  const [to, setTo] = useState('in_house');
  const [countId, setCountId] = useState('');
  const [kg, setKg] = useState('');
  const [bags, setBags] = useState('');
  const [notes, setNotes] = useState('');
  const [avail, setAvail] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, p, t, l] = await Promise.all([
      sb.from('yarn_count').select('id, code, display_name').order('code'),
      sb.from('jobwork_party').select('id, name, kind').eq('status', 'active').order('name'),
      sb.from('yarn_transfer').select('*').order('transfer_date', { ascending: false }).order('id', { ascending: false }).limit(200),
      sb.from('yarn_lot')
        .select('id, lot_code, invoice_no, received_date, received_kg, bag_count, yarn_count_id, delivery_destination, supplier:supplier_party_id ( name )')
        .is('transfer_id', null).eq('yarn_kind', 'yarn')
        .order('received_date', { ascending: false }).order('id', { ascending: false }).limit(300),
    ]);
    setLots((l.data ?? []) as PurchaseLot[]);
    setCounts((c.data ?? []) as Count[]);
    setParties((p.data ?? []) as Party[]);
    setRows((t.data ?? []) as Transfer[]);
    setLoading(false);
  }, [sb]);
  useEffect(() => { void load(); }, [load]);

  // Live balance at the "from" place for the chosen count.
  useEffect(() => {
    const f = parseLoc(from);
    if (!f || !countId) { setAvail(null); return; }
    let alive = true;
    setAvail(null);
    measureYarnAt(sb, f.loc, Number(countId), f.party).then((v) => { if (alive) setAvail(v); });
    return () => { alive = false; };
  }, [sb, from, countId, rows]);

  // Purchase lot printed on the transport copy (purchase date + invoice
  // no). Default: the latest purchase of this count at the source place.
  const lotsForCount = useMemo(() => lots.filter((l) => String(l.yarn_count_id) === countId), [lots, countId]);
  useEffect(() => {
    const f = parseLoc(from);
    const pick = lotsForCount.find((l) => f && f.loc !== 'outsource' && l.delivery_destination === f.loc) ?? lotsForCount[0];
    setLotId(pick ? String(pick.id) : '');
  }, [lotsForCount, from]);
  const chosenLot = lotsForCount.find((l) => String(l.id) === lotId) ?? null;
  const kgPerBag = chosenLot && chosenLot.bag_count > 0 ? Number(chosenLot.received_kg) / chosenLot.bag_count : null;

  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts]);
  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const placeName = (loc: YarnLoc, party: number | null): string =>
    loc === 'sizing' ? 'Sizing warehouse' : loc === 'in_house' ? 'In-house warehouse' : (partyById.get(party ?? -1)?.name ?? `Weaver #${party}`);

  const outsource = parties.filter((p) => p.kind === 'outsource');
  const jobwork = parties.filter((p) => p.kind !== 'outsource');
  const locOptions = (
    <>
      <option value="sizing">Sizing warehouse</option>
      <option value="in_house">In-house warehouse</option>
      {outsource.map((p) => <option key={p.id} value={`p:${p.id}`}>Outsource weaver: {p.name}</option>)}
      {jobwork.map((p) => <option key={p.id} value={`p:${p.id}`}>Job work: {p.name}</option>)}
    </>
  );

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const f = parseLoc(from); const t = parseLoc(to);
    const q = Number(kg);
    if (!f || !t) { setError('Pick where the yarn moves from and to.'); return; }
    if (from === to) { setError('From and To must be different places.'); return; }
    if (!countId) { setError('Pick the yarn count.'); return; }
    if (!(q > 0)) { setError('Enter the kg moved.'); return; }
    if (avail != null && q > avail + 0.001) {
      const ok = await appConfirm(
        `Only ${kgFmt(Math.max(0, avail))} of this count is showing at ${placeName(f.loc, f.party)}. Moving ${kgFmt(q)} will take that balance negative.\n\nSave anyway?`,
        { title: 'Not enough stock' },
      );
      if (!ok) return;
    }
    setBusy(true);
    const { data: newId, error: err } = await sb.rpc('fn_yarn_transfer_create', {
      p_date: date, p_count: Number(countId), p_kg: q, p_bags: Number(bags || 0),
      p_from: f.loc, p_to: t.loc, p_from_party: f.party, p_to_party: t.party, p_notes: notes,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    await sb.from('yarn_transfer')
      .update({ vehicle_no: vehicle.trim().toUpperCase() || null, purchase_lot_id: lotId ? Number(lotId) : null })
      .eq('id', newId);
    setKg(''); setBags(''); setNotes(''); setVehicle('');
    // Straight to the transport copy — Print / Download PDF live there.
    router.push(`/app/yarn-transfer/${newId}/print`);
  }

  async function onDelete(r: Transfer): Promise<void> {
    const ok = await appConfirm(
      `Delete ${r.transfer_code}? ${kgFmt(Number(r.kg))} goes back to ${placeName(r.from_loc, r.from_party_id)}.`,
      { title: 'Delete transfer' },
    );
    if (!ok) return;
    const msg = await deleteYarnTransfer(sb, r.id);
    if (msg) { await appAlert(msg, { title: 'Cannot delete' }); return; }
    void load();
  }

  const swap = (): void => { setFrom(to); setTo(from); };

  return (
    <div>
      <PageHeader
        title="Yarn Transfer"
        subtitle="Move weft yarn between Sizing warehouse, In-house warehouse and outsource / job-work weavers. Not a purchase — no bill, GST or payment."
      />

      <form onSubmit={onSubmit} className="card p-4 space-y-3 mb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <div>
            <label className="label">From *</label>
            <SmartSelect value={from} onChange={(e) => setFrom(e.target.value)} className="input w-full">{locOptions}</SmartSelect>
          </div>
          <button type="button" onClick={swap} className="btn-ghost text-xs hidden lg:inline-flex items-center gap-1 mb-1" title="Swap From and To">
            <ArrowRight className="w-4 h-4" />
          </button>
          <div>
            <label className="label">To *</label>
            <SmartSelect value={to} onChange={(e) => setTo(e.target.value)} className="input w-full">{locOptions}</SmartSelect>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Date *</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Yarn count *</label>
            <SmartSelect value={countId} onChange={(e) => setCountId(e.target.value)} className="input w-full">
              <option value="">— pick —</option>
              {counts.map((c) => <option key={c.id} value={c.id}>{c.code}{c.display_name ? ` · ${c.display_name}` : ''}</option>)}
            </SmartSelect>
            {countId && (
              <div className="text-xs mt-1 text-ink-mute">
                Available at source: {avail == null ? '…' : <b className={avail < 0 ? 'text-rose-600' : 'text-ink'}>{kgFmt(avail)}</b>}
              </div>
            )}
          </div>
          <div>
            <label className="label">Kg moved *</label>
            <input inputMode="decimal" type="number" min="0" step="0.001" required value={kg} onChange={(e) => setKg(e.target.value)} className="input num" />
          </div>
          <div>
            <label className="label">Bags</label>
            <input inputMode="numeric" type="number" min="0" step="1" value={bags} onChange={(e) => setBags(e.target.value)} className="input num" />
            {kgPerBag != null && Number(kg) > 0 && (
              <div className="text-xs mt-1 text-ink-mute">≈ {(Number(kg) / kgPerBag).toFixed(1)} bags at {kgPerBag.toFixed(1)} kg/bag</div>
            )}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Purchase bill (shown on transport copy)</label>
            <SmartSelect value={lotId} onChange={(e) => setLotId(e.target.value)} className="input w-full">
              <option value="">— none —</option>
              {lotsForCount.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.invoice_no ? `Inv ${l.invoice_no}` : l.lot_code} · {formatDay(l.received_date)} · {l.supplier?.name ?? ''}
                </option>
              ))}
            </SmartSelect>
          </div>
          <div>
            <label className="label">Vehicle no</label>
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="input w-full uppercase" placeholder="e.g. TN 33 AB 1234" />
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" placeholder="e.g. Weft for loom shed B" />
        </div>
        {error && <div className="text-sm text-rose-600">{error}</div>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save &amp; print transport copy
          </button>
        </div>
      </form>

      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide mb-2">Transfers</h2>
      {loading ? (
        <div className="card p-4 text-sm text-ink-mute">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-4 text-sm text-ink-mute">No transfers yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-ink-mute border-b">
                <th className="p-2">Date</th><th className="p-2">No</th><th className="p-2">Count</th>
                <th className="p-2 text-right">Kg</th><th className="p-2 text-right">Bags</th>
                <th className="p-2">From → To</th><th className="p-2 text-right">₹/kg</th><th className="p-2">Notes</th><th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{formatDay(r.transfer_date)}</td>
                  <td className="p-2 whitespace-nowrap">{r.transfer_code}</td>
                  <td className="p-2">{countById.get(r.yarn_count_id)?.code ?? r.yarn_count_id}</td>
                  <td className="p-2 text-right num">{Number(r.kg).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                  <td className="p-2 text-right num">{r.bag_count || ''}</td>
                  <td className="p-2">{placeName(r.from_loc, r.from_party_id)} → {placeName(r.to_loc, r.to_party_id)}</td>
                  <td className="p-2 text-right num">{r.cost_per_kg != null ? Number(r.cost_per_kg).toFixed(2) : ''}</td>
                  <td className="p-2 text-ink-mute">{r.notes}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Link href={`/app/yarn-transfer/${r.id}/print`} className="inline-block mr-3 text-indigo hover:text-indigo/80" title="Transport copy — print / PDF">
                      <Printer className="w-4 h-4" />
                    </Link>
                    <button type="button" onClick={() => void onDelete(r)} className="text-rose-600 hover:text-rose-700" title="Delete transfer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
