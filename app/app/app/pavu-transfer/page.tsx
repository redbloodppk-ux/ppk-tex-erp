'use client';
/**
 * Paavu Transfer — move IN-STOCK sized paavu between our in-house stock,
 * an outsource weaver and a job-work party, in any direction (migration
 * 316). Saving opens a transport copy to print / download.
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
import { loadPavusAt, createPavuTransfer, deletePavuTransfer, type PavuOwner, type PartyOpt } from '@/lib/pavu-transfer';
import { ArrowRight, Loader2, Printer, Trash2 } from 'lucide-react';

interface Quality { id: number; code: string; name: string; is_merged: boolean | null; merged_name: string | null }

function parsePlace(v: string): { kind: PavuOwner; partyId: number | null } | null {
  if (v === 'in_house') return { kind: 'in_house', partyId: null };
  const m = /^(outsource|jobwork):(\d+)$/.exec(v);
  return m ? { kind: m[1] as PavuOwner, partyId: Number(m[2]) } : null;
}

export default function PavuTransferPage(): React.ReactElement {
  const sb = useMemo(() => createClient() as any, []);
  const router = useRouter();
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [qualities, setQualities] = useState<Quality[]>([]);
  const [rows, setRows] = useState<any[]>([]);

  const [date, setDate] = useState(todayIST());
  const [from, setFrom] = useState('in_house');
  const [to, setTo] = useState('');
  const [qualityId, setQualityId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes] = useState('');
  const [pavus, setPavus] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, q, t] = await Promise.all([
      sb.from('jobwork_party').select('id, name, kind, ledger_id').eq('status', 'active').order('name'),
      sb.from('fabric_quality').select('id, code, name, is_merged, merged_name').eq('active', true).order('code'),
      sb.from('pavu_transfer').select('*, items:pavu_transfer_item ( pavu_code, beam_no, metres )')
        .order('transfer_date', { ascending: false }).order('id', { ascending: false }).limit(100),
    ]);
    setParties((p.data ?? []) as PartyOpt[]);
    setQualities((q.data ?? []) as Quality[]);
    setRows((t.data ?? []) as any[]);
  }, [sb]);
  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const fromP = parsePlace(from); const toP = parsePlace(to);
  const placeName = (kind: string, pid: number | null): string =>
    kind === 'in_house' ? 'In-house stock' : `${kind === 'outsource' ? 'Outsource' : 'Job work'}: ${partyById.get(pid ?? -1)?.name ?? '?'}`;

  // Paavus in stock at the "from" place.
  useEffect(() => {
    if (!fromP || (fromP.kind !== 'in_house' && !partyById.get(fromP.partyId ?? -1))) { setPavus(null); return; }
    let alive = true;
    setPavus(null); setPicked(new Set());
    loadPavusAt(sb, fromP.kind, fromP.partyId != null ? partyById.get(fromP.partyId) ?? null : null)
      .then((r) => { if (alive) setPavus(r); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, from, partyById, rows]);

  // Default the fabric quality from the ticked paavus' current quality.
  useEffect(() => {
    if (qualityId || !pavus) return;
    const q = pavus.find((p) => picked.has(p.id) && p.wb?.fabric_quality_id)?.wb?.fabric_quality_id;
    if (q) setQualityId(String(q));
  }, [picked, pavus, qualityId]);

  const placeOptions = (
    <>
      <option value="in_house">In-house stock (our looms)</option>
      {parties.filter((p) => p.kind === 'outsource').map((p) => <option key={`o${p.id}`} value={`outsource:${p.id}`}>Outsource weaver: {p.name}</option>)}
      {parties.filter((p) => p.kind !== 'outsource').map((p) => <option key={`j${p.id}`} value={`jobwork:${p.id}`}>Job work party: {p.name}</option>)}
    </>
  );

  const pickedRows = (pavus ?? []).filter((p) => picked.has(p.id));
  const pickedMetres = pickedRows.reduce((a, p) => a + Number(p.meters ?? 0), 0);
  const toggle = (id: number): void => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    if (!fromP || !toP) { setError('Pick From and To.'); return; }
    if (from === to) { setError('From and To must be different.'); return; }
    if (picked.size === 0) { setError('Tick the paavu to move.'); return; }
    if (toP.kind !== 'in_house' && !qualityId) { setError('Pick the fabric quality this warp will weave at the party.'); return; }
    const ok = await appConfirm(
      `Move ${picked.size} paavu (${pickedMetres.toLocaleString('en-IN')} m)\nfrom ${placeName(fromP.kind, fromP.partyId)}\nto ${placeName(toP.kind, toP.partyId)}?`,
      { title: 'Confirm paavu transfer' },
    );
    if (!ok) return;
    setBusy(true);
    const res = await createPavuTransfer(sb, {
      date, fromKind: fromP.kind, fromParty: fromP.partyId != null ? partyById.get(fromP.partyId) ?? null : null,
      toKind: toP.kind, toParty: toP.partyId != null ? partyById.get(toP.partyId) ?? null : null,
      fabricQualityId: qualityId ? Number(qualityId) : null, vehicleNo: vehicle, notes,
      pavuIds: Array.from(picked),
    });
    setBusy(false);
    if (res.error) { setError(res.error); if (res.id) void load(); return; }
    setPicked(new Set()); setVehicle(''); setNotes('');
    router.push(`/app/pavu-transfer/${res.id}/print`);
  }

  async function onDelete(r: any): Promise<void> {
    if (!(await appConfirm(`Undo ${r.code}? The paavu go back to ${placeName(r.from_kind, r.from_party_id)}.`, { title: 'Undo transfer' }))) return;
    const msg = await deletePavuTransfer(sb, r.id);
    if (msg) { await appAlert(msg, { title: 'Cannot undo' }); return; }
    void load();
  }

  return (
    <div>
      <PageHeader title="Paavu Transfer" subtitle="Move in-stock paavu between in-house stock, outsource weavers and job-work parties. Warehouse and party warp stock update on save." />

      <form onSubmit={onSubmit} className="card p-4 space-y-3 mb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <div><label className="label">From *</label>
            <SmartSelect value={from} onChange={(e) => setFrom(e.target.value)} className="input w-full">{placeOptions}</SmartSelect></div>
          <ArrowRight className="hidden lg:block w-5 h-5 mb-2 text-ink-mute" />
          <div><label className="label">To *</label>
            <SmartSelect value={to} onChange={(e) => setTo(e.target.value)} className="input w-full">
              <option value="">— pick —</option>{placeOptions}</SmartSelect></div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div><label className="label">Date *</label><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" /></div>
          {toP && toP.kind !== 'in_house' && (
            <div className="lg:col-span-2"><label className="label">Fabric quality at the party *</label>
              <SmartSelect value={qualityId} onChange={(e) => setQualityId(e.target.value)} className="input w-full">
                <option value="">— pick —</option>
                {qualities.map((q) => <option key={q.id} value={q.id}>{q.code} - {q.name}{q.merged_name ? ` (${q.merged_name})` : ''}</option>)}
              </SmartSelect></div>
          )}
          <div><label className="label">Vehicle no</label><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="input w-full uppercase" /></div>
        </div>
        <div><label className="label">Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" /></div>

        <div>
          <div className="label mb-1">Paavu in stock at {fromP ? placeName(fromP.kind, fromP.partyId) : '—'}{picked.size > 0 && <> · <b>{picked.size} ticked, {pickedMetres.toLocaleString('en-IN')} m</b></>}</div>
          {pavus == null ? <div className="text-sm text-ink-mute">Loading…</div> : pavus.length === 0 ? (
            <div className="text-sm text-ink-mute">No paavu in stock here.</div>
          ) : (
            <div className="border border-line/60 rounded-md max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-cloud text-[11px] uppercase text-ink-mute">
                  <tr><th className="p-2 w-8" /><th className="p-2 text-left">Paavu</th><th className="p-2 text-left">Beam no</th><th className="p-2 text-right">Ends</th><th className="p-2 text-right">Metres</th><th className="p-2 text-left">Set / quality</th></tr>
                </thead>
                <tbody>
                  {pavus.map((p) => (
                    <tr key={p.id} className={`border-t border-line/40 cursor-pointer ${picked.has(p.id) ? 'bg-indigo-50/60' : ''}`} onClick={() => toggle(p.id)}>
                      <td className="p-2"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} /></td>
                      <td className="p-2 font-mono text-xs">{p.pavu_code}</td>
                      <td className="p-2">{p.beam_no}</td>
                      <td className="p-2 text-right num">{p.ends}</td>
                      <td className="p-2 text-right num">{Number(p.meters).toLocaleString('en-IN')}</td>
                      <td className="p-2 text-xs text-ink-soft">{p.sizing_set_no ?? p.sizing_job?.job_code ?? ''}{p.wb?.quality ? ` · ${p.wb.quality.is_merged && p.wb.quality.merged_name ? p.wb.quality.merged_name : p.wb.quality.code}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {error && <div className="text-sm text-rose-600">{error}</div>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save &amp; print transport copy
          </button>
        </div>
      </form>

      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide mb-2">Transfers</h2>
      {rows.length === 0 ? <div className="card p-4 text-sm text-ink-mute">No paavu transfers yet.</div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-ink-mute border-b">
              <th className="p-2">Date</th><th className="p-2">No</th><th className="p-2">From → To</th><th className="p-2 text-right">Paavu</th><th className="p-2 text-right">Metres</th><th className="p-2">Beams</th><th className="p-2" />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const its = (r.items ?? []) as any[];
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 whitespace-nowrap">{formatDay(r.transfer_date)}</td>
                    <td className="p-2 whitespace-nowrap">{r.code}</td>
                    <td className="p-2">{placeName(r.from_kind, r.from_party_id)} → {placeName(r.to_kind, r.to_party_id)}</td>
                    <td className="p-2 text-right num">{its.length}</td>
                    <td className="p-2 text-right num">{its.reduce((a, i) => a + Number(i.metres ?? 0), 0).toLocaleString('en-IN')}</td>
                    <td className="p-2 text-xs text-ink-soft">{its.map((i) => i.beam_no).join(', ')}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Link href={`/app/pavu-transfer/${r.id}/print`} className="inline-block mr-3 text-indigo" title="Transport copy"><Printer className="w-4 h-4" /></Link>
                      <button type="button" onClick={() => void onDelete(r)} className="text-rose-600" title="Undo"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
