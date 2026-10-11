'use client';
/**
 * Bobbin Transfer — move IN-STOCK bobbins between in-house stock, an
 * outsource weaver and a job-work party, either way (migration 317).
 * Saving opens a transport copy to print / download.
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
import type { PavuOwner, PartyOpt } from '@/lib/pavu-transfer';
import { bobbinBalances, createBobbinTransfer, deleteBobbinTransfer, type BobbinOpt } from '@/lib/bobbin-transfer';
import { ArrowRight, Loader2, Printer, Trash2 } from 'lucide-react';

function parsePlace(v: string): { kind: PavuOwner; partyId: number | null } | null {
  if (v === 'in_house') return { kind: 'in_house', partyId: null };
  const m = /^(outsource|jobwork):(\d+)$/.exec(v);
  return m ? { kind: m[1] as PavuOwner, partyId: Number(m[2]) } : null;
}
const fmt = (v: number, d = 0): string => v.toLocaleString('en-IN', { maximumFractionDigits: d });

export default function BobbinTransferPage(): React.ReactElement {
  const sb = useMemo(() => createClient() as any, []);
  const router = useRouter();
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [bobbins, setBobbins] = useState<BobbinOpt[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [date, setDate] = useState(todayIST());
  const [from, setFrom] = useState('in_house');
  const [to, setTo] = useState('');
  const [bobbinId, setBobbinId] = useState('');
  const [toBobbinId, setToBobbinId] = useState('');
  const [pieces, setPieces] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes] = useState('');
  const [bal, setBal] = useState<Map<number, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, b, t] = await Promise.all([
      sb.from('jobwork_party').select('id, name, kind, ledger_id').eq('status', 'active').order('name'),
      sb.from('bobbin').select('id, code, ends_per_bobbin, bobbin_metre, production_mode').neq('status', 'archived').order('ends_per_bobbin'),
      sb.from('bobbin_transfer').select('*').order('transfer_date', { ascending: false }).order('id', { ascending: false }).limit(100),
    ]);
    setParties((p.data ?? []) as PartyOpt[]);
    setBobbins(((b.data ?? []) as any[]).map((x) => ({ ...x, bobbin_metre: x.bobbin_metre == null ? null : Number(x.bobbin_metre) })));
    setRows((t.data ?? []) as any[]);
  }, [sb]);
  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const bobById = useMemo(() => new Map(bobbins.map((b) => [b.id, b])), [bobbins]);
  const fromP = parsePlace(from); const toP = parsePlace(to);
  const fromParty = fromP?.partyId != null ? partyById.get(fromP.partyId) ?? null : null;
  const toParty = toP?.partyId != null ? partyById.get(toP.partyId) ?? null : null;
  const placeName = (kind: string, pid: number | null): string =>
    kind === 'in_house' ? 'In-house stock' : `${kind === 'outsource' ? 'Outsource' : 'Job work'}: ${partyById.get(pid ?? -1)?.name ?? '?'}`;

  useEffect(() => {
    if (!fromP || bobbins.length === 0 || (fromP.kind !== 'in_house' && !fromParty)) { setBal(null); return; }
    let alive = true; setBal(null);
    bobbinBalances(sb, fromP.kind, fromParty, bobbins).then((m) => { if (alive) setBal(m); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, from, bobbins, fromParty, rows]);

  // Bobbins that exist at the source (balance > 0), in-house ones first.
  const srcBobbins = useMemo(() => bobbins.filter((b) => (bal?.get(b.id) ?? 0) > 0.01), [bobbins, bal]);
  const src = bobById.get(Number(bobbinId)) ?? null;
  const srcPcs = src && bal ? (bal.get(src.id) ?? 0) / (src.bobbin_metre || 1) : null;

  // Destination bobbin: in-house -> in-house bobbin master; party -> job-work
  // bobbin of the same ends if one exists, else the same bobbin.
  const destChoices = useMemo(() => bobbins.filter((b) => toP?.kind === 'in_house' ? b.production_mode === 'inhouse' : true), [bobbins, toP?.kind]);
  useEffect(() => {
    if (!src || !toP) { setToBobbinId(''); return; }
    const sameEnds = (b: BobbinOpt): boolean => b.ends_per_bobbin === src.ends_per_bobbin;
    const want = toP.kind === 'in_house' ? 'inhouse' : 'jobwork';
    const pick = bobbins.find((b) => b.production_mode === want && sameEnds(b) && b.bobbin_metre === src.bobbin_metre)
      ?? bobbins.find((b) => b.production_mode === want && sameEnds(b))
      ?? (toP.kind === 'in_house' ? null : src);
    setToBobbinId(pick ? String(pick.id) : '');
  }, [bobbinId, to, bobbins]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeOptions = (
    <>
      <option value="in_house">In-house stock</option>
      {parties.filter((p) => p.kind === 'outsource').map((p) => <option key={`o${p.id}`} value={`outsource:${p.id}`}>Outsource weaver: {p.name}</option>)}
      {parties.filter((p) => p.kind !== 'outsource').map((p) => <option key={`j${p.id}`} value={`jobwork:${p.id}`}>Job work party: {p.name}</option>)}
    </>
  );
  const bLabel = (b: BobbinOpt): string => `${b.code} · ${b.ends_per_bobbin ?? '?'} ends · ${fmt(b.bobbin_metre ?? 0)} m/pc`;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    if (!fromP || !toP) { setError('Pick From and To.'); return; }
    if (from === to) { setError('From and To must be different.'); return; }
    const dst = bobById.get(Number(toBobbinId));
    if (!src || !dst) { setError('Pick the bobbin (and the bobbin it becomes at the destination).'); return; }
    const pcs = Number(pieces);
    if (!(pcs > 0)) { setError('Enter the number of bobbins.'); return; }
    if (srcPcs != null && pcs > srcPcs + 0.001) {
      if (!(await appConfirm(`Only ${fmt(srcPcs, 1)} bobbins of ${src.code} show at ${placeName(fromP.kind, fromP.partyId)}. Move ${pcs} anyway?`, { title: 'Not enough stock' }))) return;
    }
    setBusy(true);
    const res = await createBobbinTransfer(sb, {
      date, fromKind: fromP.kind, fromParty, toKind: toP.kind, toParty,
      bobbin: src, toBobbin: dst, pieces: pcs, vehicleNo: vehicle, notes,
    });
    setBusy(false);
    if (res.error) { setError(res.error); if (res.id) void load(); return; }
    setPieces(''); setVehicle(''); setNotes('');
    router.push(`/app/bobbin-transfer/${res.id}/print`);
  }

  async function onDelete(r: any): Promise<void> {
    if (!(await appConfirm(`Undo ${r.code}? ${fmt(Number(r.pieces))} bobbins go back to ${placeName(r.from_kind, r.from_party_id)}.`, { title: 'Undo transfer' }))) return;
    const msg = await deleteBobbinTransfer(sb, r.id);
    if (msg) { await appAlert(msg, { title: 'Cannot undo' }); return; }
    void load();
  }

  return (
    <div>
      <PageHeader title="Bobbin Transfer" subtitle="Move in-stock bobbins between in-house stock, outsource weavers and job-work parties. Not a purchase or sale." />
      <form onSubmit={onSubmit} className="card p-4 space-y-3 mb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <div><label className="label">From *</label><SmartSelect value={from} onChange={(e) => { setFrom(e.target.value); setBobbinId(''); }} className="input w-full">{placeOptions}</SmartSelect></div>
          <ArrowRight className="hidden lg:block w-5 h-5 mb-2 text-ink-mute" />
          <div><label className="label">To *</label><SmartSelect value={to} onChange={(e) => setTo(e.target.value)} className="input w-full"><option value="">— pick —</option>{placeOptions}</SmartSelect></div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div><label className="label">Date *</label><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" /></div>
          <div className="lg:col-span-2"><label className="label">Bobbin *</label>
            <SmartSelect value={bobbinId} onChange={(e) => setBobbinId(e.target.value)} className="input w-full">
              <option value="">{bal == null ? 'Loading…' : srcBobbins.length === 0 ? 'No bobbins in stock here' : '— pick —'}</option>
              {srcBobbins.map((b) => <option key={b.id} value={b.id}>{bLabel(b)} — {fmt((bal?.get(b.id) ?? 0) / (b.bobbin_metre || 1), 1)} pcs in stock</option>)}
            </SmartSelect></div>
          <div><label className="label">No. of bobbins *</label><input type="number" min="0" step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} className="input num" />
            {srcPcs != null && <div className="text-xs text-ink-mute mt-1">In stock: <b>{fmt(srcPcs, 1)}</b> pcs</div>}</div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">Becomes at destination</label>
            <SmartSelect value={toBobbinId} onChange={(e) => setToBobbinId(e.target.value)} className="input w-full">
              <option value="">— pick —</option>
              {destChoices.map((b) => <option key={b.id} value={b.id}>{bLabel(b)}{b.production_mode ? ` (${b.production_mode})` : ''}</option>)}
            </SmartSelect></div>
          <div><label className="label">Vehicle no</label><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="input w-full uppercase" /></div>
        </div>
        <div><label className="label">Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" /></div>
        {error && <div className="text-sm text-rose-600">{error}</div>}
        <div className="flex justify-end"><button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Save &amp; print transport copy</button></div>
      </form>

      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide mb-2">Transfers</h2>
      {rows.length === 0 ? <div className="card p-4 text-sm text-ink-mute">No bobbin transfers yet.</div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-ink-mute border-b"><th className="p-2">Date</th><th className="p-2">No</th><th className="p-2">Bobbin</th><th className="p-2 text-right">Pcs</th><th className="p-2 text-right">Metres</th><th className="p-2">From → To</th><th className="p-2" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{formatDay(r.transfer_date)}</td>
                  <td className="p-2 whitespace-nowrap">{r.code}</td>
                  <td className="p-2">{bobById.get(r.bobbin_id)?.code ?? r.bobbin_id}{r.to_bobbin_id !== r.bobbin_id ? ` → ${bobById.get(r.to_bobbin_id)?.code ?? r.to_bobbin_id}` : ''}</td>
                  <td className="p-2 text-right num">{fmt(Number(r.pieces), 1)}</td>
                  <td className="p-2 text-right num">{fmt(Number(r.metres))}</td>
                  <td className="p-2">{placeName(r.from_kind, r.from_party_id)} → {placeName(r.to_kind, r.to_party_id)}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Link href={`/app/bobbin-transfer/${r.id}/print`} className="inline-block mr-3 text-indigo" title="Transport copy"><Printer className="w-4 h-4" /></Link>
                    <button type="button" onClick={() => void onDelete(r)} className="text-rose-600" title="Undo"><Trash2 className="w-4 h-4" /></button>
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
