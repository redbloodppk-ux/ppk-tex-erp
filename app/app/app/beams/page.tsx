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
import { loadBeamPosition, BEAM_KIND_LABEL, type BeamKind, type BeamMove, type BeamPosition } from '@/lib/beams';
import { Loader2, Printer, Trash2 } from 'lucide-react';

interface Party { id: number; name: string }

export default function BeamsPage(): React.ReactElement {
  const sb = useMemo(() => createClient() as any, []);
  const router = useRouter();
  const [pos, setPos] = useState<BeamPosition | null>(null);
  const [moves, setMoves] = useState<BeamMove[]>([]);
  const [mills, setMills] = useState<Party[]>([]);

  // opening form
  const [opTotal, setOpTotal] = useState('');
  const [opAtSizing, setOpAtSizing] = useState('');
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
    const [{ pos: p, moves: m }, jobs] = await Promise.all([
      loadBeamPosition(sb),
      sb.from('sizing_job').select('date_sent, party:party_id ( id, name )').not('party_id', 'is', null).order('date_sent', { ascending: false }),
    ]);
    setPos(p); setMoves(m);
    const seen = new Map<number, Party>();
    for (const j of (jobs.data ?? []) as any[]) if (j.party && !seen.has(j.party.id)) seen.set(j.party.id, j.party);
    const list = Array.from(seen.values());
    setMills(list);
    setMillId((cur) => cur || (list[0] ? String(list[0].id) : ''));
  }, [sb]);
  useEffect(() => { void load(); }, [load]);

  const millName = (id: number | null): string => mills.find((m) => m.id === id)?.name ?? '';
  const needsMill = kind === 'sent_to_sizing' || kind === 'returned_from_sizing';

  async function saveOpening(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    const t = Math.round(Number(opTotal)); const s = Math.round(Number(opAtSizing || 0));
    if (!(t > 0)) { setError('Enter how many beams you own in total.'); return; }
    setBusy(true);
    const { error: err } = await sb.from('beam_movement').insert({
      move_date: todayIST(), kind: 'opening', qty: t, at_sizing_qty: s,
      party_id: millId ? Number(millId) : null, notes: 'Opening beam count',
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
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
      ) : !pos.hasOpening ? (
        <form onSubmit={saveOpening} className="card p-4 space-y-3 mb-6 max-w-2xl">
          <h2 className="font-semibold">Start beam tracking — count your beams once</h2>
          <p className="text-sm text-ink-soft">
            From the paavu records the app already knows <b>{pos.inStock}</b> beams are sized paavu in stock and <b>{pos.onLoom}</b> are on looms.
            Enter the rest below; from now on every paavu received from sizing, mounted or finished updates the count by itself.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Total beams you own *</label>
              <input type="number" min="1" step="1" required value={opTotal} onChange={(e) => setOpTotal(e.target.value)} className="input num" />
            </div>
            <div>
              <label className="label">Empty beams at sizing mill now</label>
              <input type="number" min="0" step="1" value={opAtSizing} onChange={(e) => setOpAtSizing(e.target.value)} className="input num" />
            </div>
          </div>
          {Number(opTotal) > 0 && (
            <div className="text-sm">
              Empty in godown will be: <b className="num">{Math.round(Number(opTotal)) - Math.round(Number(opAtSizing || 0)) - pos.inStock - pos.onLoom}</b>
            </div>
          )}
          {error && <div className="text-sm text-rose-600">{error}</div>}
          <button type="submit" disabled={busy} className="btn-primary">Save opening count</button>
        </form>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {card('Total beams', pos.total, 'owned by PPK TEX')}
            {card('Empty in godown', pos.godown, 'ready to send for sizing', pos.godown < 0 ? 'ring-1 ring-rose-300' : '')}
            {card('At sizing mill', pos.atSizing, `sent ${pos.sent} · came back as paavu ${pos.receivedSized}`, pos.atSizing < 0 ? 'ring-1 ring-rose-300' : '')}
            {card('Sized paavu in stock', pos.inStock, 'waiting for a loom')}
            {card('On looms', pos.onLoom, 'paavu mounted')}
          </section>
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
              Paavus received from sizing are counted automatically when you enter them in the sizing job — do not enter those here.
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
                    <td className="p-2">{BEAM_KIND_LABEL[m.kind]}</td>
                    <td className="p-2 text-right num">
                      {m.kind === 'opening' ? `${m.qty} (at sizing ${m.at_sizing_qty})` : (m.kind === 'removed' ? `−${m.qty}` : m.qty)}
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
