'use client';
/**
 * Beams — where our empty / paavu beams are right now (migration 314).
 *
 * Beams carry no number, so this is count based. The operator enters
 * only the movements the app cannot see (empties sent to / returned
 * from the sizing mill, new or scrapped beams). Paavus received from
 * sizing, mounted on looms and finished are picked up automatically
 * from the Paavu and loom records.
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
import { loadBeamPosition, physicalCountRows, BEAM_KIND_LABEL, type BeamKind, type BeamMove, type BeamPosition, type Mill } from '@/lib/beams';
import { Loader2, Printer, Trash2 } from 'lucide-react';


export default function BeamsPage(): React.ReactElement {
  const sb = useMemo(() => createClient() as any, []);
  const router = useRouter();
  const [pos, setPos] = useState<BeamPosition | null>(null);
  const [moves, setMoves] = useState<BeamMove[]>([]);
  const [mills, setMills] = useState<Mill[]>([]);

  // physical count form (opening, and later count checks)
  const [countOpen, setCountOpen] = useState(false);
  const [cGodown, setCGodown] = useState('');
  const [cLoom, setCLoom] = useState('');
  const [cStock, setCStock] = useState('');
  const [cMill, setCMill] = useState<Record<number, string>>({});
  // movement form
  const [date, setDate] = useState(todayIST());
  const [kind, setKind] = useState<Exclude<BeamKind, 'opening'>>('sent_to_sizing');
  const [qty, setQty] = useState('');
  const [millId, setMillId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { pos: p, moves: m, mills: list } = await loadBeamPosition(sb);
    setPos(p); setMoves(m); setMills(list);
  }, [sb]);
  useEffect(() => { void load(); }, [load]);

  const millName = (id: number | null): string => mills.find((m) => m.id === id)?.name ?? '';
  const needsMill = kind === 'sent_to_sizing' || kind === 'returned_from_sizing';

  function openCount(): void {
    if (!pos) return;
    setCGodown(pos.hasOpening ? String(pos.godown) : '');
    setCLoom(String(pos.onLoom)); setCStock(String(pos.inStock));
    const mc: Record<number, string> = {};
    for (const r of pos.byMill) mc[r.mill.id] = String(r.count);
    setCMill(mc);
    setCountOpen(true);
  }
  const intOf = (v: string): number => Math.max(0, Math.round(Number(v || 0)));
  const countTotal = intOf(cGodown) + intOf(cLoom) + intOf(cStock) + Object.values(cMill).reduce((a, v) => a + intOf(v), 0);

  async function saveCount(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    if (!pos) return;
    if (countTotal <= 0) { setError('Enter the beam counts.'); return; }
    const byMill = new Map<number, number>();
    for (const [k, v] of Object.entries(cMill)) if (intOf(v) > 0 || pos.byMill.some((r) => r.mill.id === Number(k))) byMill.set(Number(k), intOf(v));
    const rows = physicalCountRows(pos, { godown: intOf(cGodown), onLoom: intOf(cLoom), inStock: intOf(cStock), byMill }, todayIST());
    setBusy(true);
    const { error: err } = await sb.from('beam_movement').insert(rows);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setCountOpen(false);
    void load();
  }

  async function saveMove(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    const q = Math.round(Number(qty));
    if (!(q > 0)) { setError('Enter the number of beams.'); return; }
    if (needsMill && !millId) { setError('Pick the sizing mill.'); return; }
    if (kind === 'sent_to_sizing' && pos && q > pos.godown) {
      const ok = await appConfirm(`Only ${pos.godown} empty beams are showing in the godown. Send ${q} anyway?`, { title: 'Check count' });
      if (!ok) return;
    }
    if (kind === 'returned_from_sizing' && pos && q > pos.atSizing) {
      const ok = await appConfirm(`Only ${pos.atSizing} empty beams are showing at the sizing mill. Record ${q} returned anyway?`, { title: 'Check count' });
      if (!ok) return;
    }
    setBusy(true);
    const { data, error: err } = await sb.from('beam_movement').insert({
      move_date: date, kind, qty: q,
      party_id: needsMill ? Number(millId) : null,
      vehicle_no: vehicle.trim().toUpperCase() || null,
      notes: notes.trim() || null,
    }).select('id').single();
    setBusy(false);
    if (err) { setError(err.message); return; }
    setQty(''); setVehicle(''); setNotes('');
    if (needsMill) router.push(`/app/beams/${data.id}/print`);
    else void load();
  }

  async function onDelete(m: BeamMove): Promise<void> {
    if (!(await appConfirm(`Delete ${m.code} (${BEAM_KIND_LABEL[m.kind]}, ${m.qty} beams)?`, { title: 'Delete entry' }))) return;
    const { error: err } = await sb.from('beam_movement').delete().eq('id', m.id);
    if (err) { await appAlert(err.message, { title: 'Cannot delete' }); return; }
    void load();
  }

  const card = (label: string, value: number | string, note: string, tone = ''): React.ReactElement => (
    <div className={`card p-4 ${tone}`}>
      <div className="text-xs uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="num text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs text-ink-soft mt-0.5">{note}</div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Beams"
        subtitle="Where your beams are: empty in godown, at the sizing mill, as sized paavu in stock, or on looms."
      />

      {!pos ? (
        <div className="card p-4 text-sm text-ink-mute">Loading…</div>
      ) : (!pos.hasOpening || countOpen) ? (
        <form onSubmit={saveCount} className="card p-4 space-y-3 mb-6 max-w-3xl">
          <h2 className="font-semibold">{pos.hasOpening ? 'Physical count check' : 'Start beam tracking — count your beams once'}</h2>
          <p className="text-sm text-ink-soft">
            Count the beams where they really are. The app&apos;s paavu records show <b>{pos.appOnLoom}</b> on looms and <b>{pos.appInStock}</b> sized paavu in stock;
            any difference you enter is remembered, so the screen matches the floor. After this, sizing, loom and paavu entries keep the count up to date.
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className="label">Empty beams in godown</label><input type="number" min="0" step="1" value={cGodown} onChange={(e) => setCGodown(e.target.value)} className="input num" /></div>
            <div><label className="label">Looms with beam loaded</label><input type="number" min="0" step="1" value={cLoom} onChange={(e) => setCLoom(e.target.value)} className="input num" /></div>
            <div><label className="label">Sized paavu in stock</label><input type="number" min="0" step="1" value={cStock} onChange={(e) => setCStock(e.target.value)} className="input num" /></div>
          </div>
          <div>
            <div className="label mb-1">Empty beams at each sizing mill</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {mills.map((m) => (
                <div key={m.id}>
                  <label className="text-xs text-ink-soft">{m.name}</label>
                  <input type="number" min="0" step="1" value={cMill[m.id] ?? ''} onChange={(e) => setCMill((cur) => ({ ...cur, [m.id]: e.target.value }))} className="input num" />
                </div>
              ))}
            </div>
          </div>
          <div className="text-sm">Total beams: <b className="num">{countTotal}</b>{pos.hasOpening ? <> (app had {pos.total})</> : null}</div>
          {error && <div className="text-sm text-rose-600">{error}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">{pos.hasOpening ? 'Save count' : 'Save opening count'}</button>
            {pos.hasOpening && <button type="button" onClick={() => setCountOpen(false)} className="btn-ghost">Cancel</button>}
          </div>
        </form>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {card('Total beams', pos.total, 'owned by PPK TEX')}
            {card('Empty in godown', pos.godown, 'ready to send for sizing', pos.godown < 0 ? 'ring-1 ring-rose-300' : '')}
            {card('At sizing mills', pos.atSizing, pos.byMill.map((r) => `${r.mill.name.split(' ').slice(0, 2).join(' ')}: ${r.count}`).join(' · ') || 'none', pos.atSizing < 0 ? 'ring-1 ring-rose-300' : '')}
            {card('Sized paavu in stock', pos.inStock, 'waiting for a loom')}
            {card('On looms', pos.onLoom, 'paavu mounted')}
          </section>
          {pos.byMill.length > 0 && (
            <div className="card overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-ink-mute border-b">
                  <th className="p-2">Sizing mill</th><th className="p-2 text-right">Empty beams there</th><th className="p-2 text-right">Sent since opening</th><th className="p-2 text-right">Back as paavu</th>
                </tr></thead>
                <tbody>
                  {pos.byMill.map((r) => (
                    <tr key={r.mill.id} className="border-b last:border-0">
                      <td className="p-2">{r.mill.name}</td>
                      <td className={`p-2 text-right num font-semibold ${r.count < 0 ? 'text-rose-600' : ''}`}>{r.count}</td>
                      <td className="p-2 text-right num">{r.sent}</td>
                      <td className="p-2 text-right num">{r.received}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mb-4 flex justify-end">
            <button type="button" onClick={openCount} className="btn-ghost text-sm">Physical count check…</button>
          </div>
          {(pos.godown < 0 || pos.atSizing < 0) && (
            <div className="card p-3 mb-4 text-sm text-rose-700 bg-rose-50">
              A count has gone below zero — an entry is missing or the opening count was off. Check the list below or add a correction (New beams added / Beams scrapped).
            </div>
          )}

          <form onSubmit={saveMove} className="card p-4 space-y-3 mb-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="label">Entry *</label>
                <select value={kind} onChange={(e) => setKind(e.target.value as Exclude<BeamKind, 'opening'>)} className="input w-full">
                  <option value="sent_to_sizing">{BEAM_KIND_LABEL.sent_to_sizing}</option>
                  <option value="returned_from_sizing">{BEAM_KIND_LABEL.returned_from_sizing}</option>
                  <option value="added">{BEAM_KIND_LABEL.added}</option>
                  <option value="removed">{BEAM_KIND_LABEL.removed}</option>
                </select>
              </div>
              <div>
                <label className="label">Date *</label>
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">No. of beams *</label>
                <input type="number" min="1" step="1" required value={qty} onChange={(e) => setQty(e.target.value)} className="input num" />
              </div>
              {needsMill && (
                <div>
                  <label className="label">Sizing mill *</label>
                  <SmartSelect value={millId} onChange={(e) => setMillId(e.target.value)} className="input w-full">
                    <option value="">— pick —</option>
                    {mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </SmartSelect>
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {needsMill && (
                <div>
                  <label className="label">Vehicle no</label>
                  <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="input w-full uppercase" placeholder="e.g. TN 33 AB 1234" />
                </div>
              )}
              <div>
                <label className="label">Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" />
              </div>
            </div>
            <p className="text-xs text-ink-mute">
              Paavus received from sizing are counted automatically when you enter them (sizing job, or Job Work → warp beam given with the sizing mill) — do not enter those here.
              Use “returned from sizing” only for beams that come back <b>empty</b>.
            </p>
            {error && <div className="text-sm text-rose-600">{error}</div>}
            <div className="flex justify-end">
              <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {needsMill ? 'Save & print transport copy' : 'Save'}
              </button>
            </div>
          </form>
        </>
      )}

      {moves.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide mb-2">Beam entries</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-ink-mute border-b">
                  <th className="p-2">Date</th><th className="p-2">No</th><th className="p-2">Entry</th>
                  <th className="p-2 text-right">Beams</th><th className="p-2">Sizing mill</th><th className="p-2">Vehicle</th><th className="p-2">Notes</th><th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="p-2 whitespace-nowrap">{formatDay(m.move_date)}</td>
                    <td className="p-2 whitespace-nowrap">{m.code}</td>
                    <td className="p-2">{m.is_recount ? 'Physical count correction' : BEAM_KIND_LABEL[m.kind]}</td>
                    <td className="p-2 text-right num">
                      {m.kind === 'opening'
                        ? (m.qty > 0 ? `${m.qty} total` : '') + (m.at_sizing_qty ? ` · ${m.at_sizing_qty} at mill` : '')
                        : m.is_recount
                          ? [m.qty ? `${m.kind === 'removed' ? '−' : '+'}${m.qty} total` : '', m.sizing_adjust ? `${m.sizing_adjust > 0 ? '+' : ''}${m.sizing_adjust} at mill` : ''].filter(Boolean).join(' · ') || '0'
                          : (m.kind === 'removed' ? `−${m.qty}` : m.qty)}
                    </td>
                    <td className="p-2">{millName(m.party_id)}</td>
                    <td className="p-2">{m.vehicle_no}</td>
                    <td className="p-2 text-ink-mute">{m.notes}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {(m.kind === 'sent_to_sizing' || m.kind === 'returned_from_sizing') && (
                        <Link href={`/app/beams/${m.id}/print`} className="inline-block mr-3 text-indigo" title="Transport copy">
                          <Printer className="w-4 h-4" />
                        </Link>
                      )}
                      <button type="button" onClick={() => void onDelete(m)} className="text-rose-600" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
