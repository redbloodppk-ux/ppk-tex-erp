'use client';
/**
 * /app/jobwork — Job Work command centre with four tabs.
 *
 * 1. Bobbin given : read-only list of bobbin rows tagged production_mode=jobwork
 * 2. Warp beam    : add + table of jobwork_warp_beam rows
 * 3. Weft bag     : add + table of jobwork_weft_bag rows
 * 4. Status       : three sub-reports (pivot, party balance, quality split)
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, Trash2 } from 'lucide-react';

type Tab = 'bobbin' | 'warp_beam' | 'weft_bag' | 'status';

interface PartyOpt { id: number; code: string; name: string; }
interface QualityOpt { id: number; code: string | null; name: string; }
interface CountOpt { id: number; code: string; display_name: string; }

interface BobbinRow {
  id: number; code: string; description: string;
  ends_per_bobbin: number; bobbin_metre: number; quantity: number;
  jobwork_party_id: number | null; purchase_date: string | null;
  invoice_no: string | null;
}
interface WarpBeamRow {
  id: number; jobwork_party_id: number;
  fabric_quality_id: number | null; warp_count_id: number | null;
  given_date: string; total_ends: number | null;
  tape_length_m: number | null; beam_count: number;
  total_metres: number | null; reference_no: string | null; notes: string | null;
}
interface WeftBagRow {
  id: number; jobwork_party_id: number;
  yarn_count_id: number | null; given_date: string;
  bag_count: number | null; total_kg: number | null;
  reference_no: string | null; notes: string | null;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

export default function JobworkPage(): React.ReactElement {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('bobbin');
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [qualities, setQualities] = useState<QualityOpt[]>([]);
  const [counts, setCounts] = useState<CountOpt[]>([]);
  const [bobbins, setBobbins] = useState<BobbinRow[]>([]);
  const [warpBeams, setWarpBeams] = useState<WarpBeamRow[]>([]);
  const [weftBags, setWeftBags] = useState<WeftBagRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [p, q, c, b, w, wb] = await Promise.all([
      sb.from('jobwork_party').select('id, code, name').eq('status', 'active').order('name'),
      sb.from('fabric_quality').select('id, code, name').eq('active', true).order('name'),
      sb.from('yarn_count').select('id, code, display_name').neq('status', 'archived').order('code'),
      sb.from('bobbin')
        .select('id, code, description, ends_per_bobbin, bobbin_metre, quantity, jobwork_party_id, purchase_date, invoice_no')
        .eq('production_mode', 'jobwork').neq('status', 'archived')
        .order('purchase_date', { ascending: false, nullsFirst: false }),
      sb.from('jobwork_warp_beam')
        .select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, tape_length_m, beam_count, total_metres, reference_no, notes')
        .eq('status', 'active').order('given_date', { ascending: false }),
      sb.from('jobwork_weft_bag')
        .select('id, jobwork_party_id, yarn_count_id, given_date, bag_count, total_kg, reference_no, notes')
        .eq('status', 'active').order('given_date', { ascending: false }),
    ]);
    if (p.error || q.error || c.error || b.error || w.error || wb.error) {
      setError((p.error || q.error || c.error || b.error || w.error || wb.error).message);
    } else {
      setParties((p.data ?? []) as PartyOpt[]);
      setQualities((q.data ?? []) as QualityOpt[]);
      setCounts((c.data ?? []) as CountOpt[]);
      setBobbins((b.data ?? []) as BobbinRow[]);
      setWarpBeams((w.data ?? []) as WarpBeamRow[]);
      setWeftBags((wb.data ?? []) as WeftBagRow[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const qualityById = useMemo(() => new Map(qualities.map((q) => [q.id, q])), [qualities]);
  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts]);

  return (
    <div>
      <PageHeader
        title="Job Work"
        subtitle="Track bobbin / warp beam / weft bag issued to each jobwork party and see who has what."
        actions={
          <Link href="/app/jobwork-parties" className="btn-ghost">
            Manage Parties
          </Link>
        }
      />

      <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
        <TabButton active={tab === 'bobbin'}    onClick={() => setTab('bobbin')}>Bobbin given</TabButton>
        <TabButton active={tab === 'warp_beam'} onClick={() => setTab('warp_beam')}>Warp beam given</TabButton>
        <TabButton active={tab === 'weft_bag'}  onClick={() => setTab('weft_bag')}>Weft bag given</TabButton>
        <TabButton active={tab === 'status'}    onClick={() => setTab('status')}>Status</TabButton>
      </div>

      {error && <div className="card p-3 mb-3 text-err text-sm">{error}</div>}
      {loading ? (
        <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : tab === 'bobbin' ? (
        <BobbinTab rows={bobbins} partyById={partyById} />
      ) : tab === 'warp_beam' ? (
        <WarpBeamTab
          rows={warpBeams} parties={parties} qualities={qualities} counts={counts}
          partyById={partyById} qualityById={qualityById} countById={countById}
          onChanged={load}
        />
      ) : tab === 'weft_bag' ? (
        <WeftBagTab
          rows={weftBags} parties={parties} counts={counts}
          partyById={partyById} countById={countById}
          onChanged={load}
        />
      ) : (
        <StatusTab
          parties={parties} qualities={qualities}
          bobbins={bobbins} warpBeams={warpBeams} weftBags={weftBags}
          partyById={partyById}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={'px-4 py-2 text-sm font-semibold border-b-2 -mb-px ' +
        (active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-ink-soft hover:text-ink')}>
      {children}
    </button>
  );
}

/* ----- Bobbin tab (read-only list) ----- */
function BobbinTab({ rows, partyById }: {
  rows: BobbinRow[]; partyById: Map<number, PartyOpt>;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">Bobbin purchases marked as jobwork. Add new entries on the Bobbin Stock page.</p>
        <Link href="/app/bobbin" className="btn-primary">
          <Plus className="w-4 h-4" /> Add Bobbin Stock
        </Link>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Code</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Description</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-right px-3 py-3">Qty</th>
              <th className="text-left px-3 py-3">Purchased</th>
              <th className="text-left px-3 py-3">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-soft">No jobwork bobbin entries yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40">
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2">{r.jobwork_party_id ? (partyById.get(r.jobwork_party_id)?.name ?? '-') : '-'}</td>
                <td className="px-3 py-2 text-ink-soft">{r.description}</td>
                <td className="px-3 py-2 text-right num">{r.ends_per_bobbin}</td>
                <td className="px-3 py-2 text-right num">{r.bobbin_metre}</td>
                <td className="px-3 py-2 text-right num font-semibold">{r.quantity}</td>
                <td className="px-3 py-2 text-ink-soft">{fmtDate(r.purchase_date)}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.invoice_no ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----- Warp Beam tab ----- */
function WarpBeamTab({ rows, parties, qualities, counts, partyById, qualityById, countById, onChanged }: {
  rows: WarpBeamRow[];
  parties: PartyOpt[]; qualities: QualityOpt[]; counts: CountOpt[];
  partyById: Map<number, PartyOpt>; qualityById: Map<number, QualityOpt>; countById: Map<number, CountOpt>;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(),
    jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
    total_ends: '', tape_length_m: '', beam_count: '1',
    total_metres: '', reference_no: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr('Pick a jobwork party.'); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
      warp_count_id: form.warp_count_id === '' ? null : Number(form.warp_count_id),
      given_date: form.given_date,
      total_ends: form.total_ends === '' ? null : Number(form.total_ends),
      tape_length_m: form.tape_length_m === '' ? null : Number(form.tape_length_m),
      beam_count: form.beam_count === '' ? 1 : Number(form.beam_count),
      total_metres: form.total_metres === '' ? null : Number(form.total_metres),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error } = await sb.from('jobwork_warp_beam').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({
      given_date: todayISO(),
      jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
      total_ends: '', tape_length_m: '', beam_count: '1',
      total_metres: '', reference_no: '', notes: '',
    });
    onChanged();
  }

  async function del(id: number) {
    if (!window.confirm('Delete this warp beam entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_warp_beam').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }

  return (
    <div>
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add warp beam</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="label text-xs">Date *</label>
            <input type="date" className="input" value={form.given_date}
              onChange={(e) => setForm({ ...form, given_date: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Party *</label>
            <select className="input" value={form.jobwork_party_id}
              onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}>
              <option value="">--- pick ---</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Fabric quality</label>
            <select className="input" value={form.fabric_quality_id}
              onChange={(e) => setForm({ ...form, fabric_quality_id: e.target.value })}>
              <option value="">---</option>
              {qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Warp count</label>
            <select className="input" value={form.warp_count_id}
              onChange={(e) => setForm({ ...form, warp_count_id: e.target.value })}>
              <option value="">---</option>
              {counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">No. of beams</label>
            <input type="number" min={1} className="input num" value={form.beam_count}
              onChange={(e) => setForm({ ...form, beam_count: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Total ends</label>
            <input type="number" className="input num" value={form.total_ends}
              onChange={(e) => setForm({ ...form, total_ends: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Tape length (m)</label>
            <input type="number" step={0.5} className="input num" value={form.tape_length_m}
              onChange={(e) => setForm({ ...form, tape_length_m: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Total metres</label>
            <input type="number" step={0.01} className="input num" value={form.total_metres}
              onChange={(e) => setForm({ ...form, total_metres: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Reference / DC no</label>
            <input className="input" value={form.reference_no}
              onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Notes</label>
            <input className="input" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        {err && <div className="mt-3 text-sm text-err">{err}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add warp beam
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Quality</th>
              <th className="text-left px-3 py-3">Warp count</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3">Tape (m)</th>
              <th className="text-right px-3 py-3">Beams</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-left px-3 py-3">DC #</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-soft">No warp beams issued yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40">
                <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                <td className="px-3 py-2">{r.fabric_quality_id ? qualityById.get(r.fabric_quality_id)?.name ?? '-' : '-'}</td>
                <td className="px-3 py-2">{r.warp_count_id ? countById.get(r.warp_count_id)?.display_name ?? '-' : '-'}</td>
                <td className="px-3 py-2 text-right num">{r.total_ends ?? '-'}</td>
                <td className="px-3 py-2 text-right num">{r.tape_length_m ?? '-'}</td>
                <td className="px-3 py-2 text-right num font-semibold">{r.beam_count}</td>
                <td className="px-3 py-2 text-right num">{r.total_metres ?? '-'}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.reference_no ?? '-'}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----- Weft Bag tab ----- */
function WeftBagTab({ rows, parties, counts, partyById, countById, onChanged }: {
  rows: WeftBagRow[]; parties: PartyOpt[]; counts: CountOpt[];
  partyById: Map<number, PartyOpt>; countById: Map<number, CountOpt>;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', yarn_count_id: '',
    bag_count: '', total_kg: '', reference_no: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr('Pick a jobwork party.'); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      yarn_count_id: form.yarn_count_id === '' ? null : Number(form.yarn_count_id),
      given_date: form.given_date,
      bag_count: form.bag_count === '' ? null : Number(form.bag_count),
      total_kg: form.total_kg === '' ? null : Number(form.total_kg),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error } = await sb.from('jobwork_weft_bag').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({
      given_date: todayISO(), jobwork_party_id: '', yarn_count_id: '',
      bag_count: '', total_kg: '', reference_no: '', notes: '',
    });
    onChanged();
  }

  async function del(id: number) {
    if (!window.confirm('Delete this weft bag entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_weft_bag').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }

  return (
    <div>
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add weft bag</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label text-xs">Date *</label>
            <input type="date" className="input" value={form.given_date}
              onChange={(e) => setForm({ ...form, given_date: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Party *</label>
            <select className="input" value={form.jobwork_party_id}
              onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}>
              <option value="">--- pick ---</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Yarn count</label>
            <select className="input" value={form.yarn_count_id}
              onChange={(e) => setForm({ ...form, yarn_count_id: e.target.value })}>
              <option value="">---</option>
              {counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Bag count</label>
            <input type="number" className="input num" value={form.bag_count}
              onChange={(e) => setForm({ ...form, bag_count: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Total kg</label>
            <input type="number" step={0.001} className="input num" value={form.total_kg}
              onChange={(e) => setForm({ ...form, total_kg: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Reference / DC no</label>
            <input className="input" value={form.reference_no}
              onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label text-xs">Notes</label>
            <input className="input" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        {err && <div className="mt-3 text-sm text-err">{err}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add weft bag
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Yarn count</th>
              <th className="text-right px-3 py-3">Bags</th>
              <th className="text-right px-3 py-3">Total kg</th>
              <th className="text-left px-3 py-3">DC #</th>
              <th className="text-left px-3 py-3">Notes</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-soft">No weft bags issued yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40">
                <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                <td className="px-3 py-2">{r.yarn_count_id ? countById.get(r.yarn_count_id)?.display_name ?? '-' : '-'}</td>
                <td className="px-3 py-2 text-right num">{r.bag_count ?? '-'}</td>
                <td className="px-3 py-2 text-right num font-semibold">{r.total_kg ?? '-'}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.reference_no ?? '-'}</td>
                <td className="px-3 py-2 text-ink-soft truncate max-w-[200px]">{r.notes ?? '-'}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----- Status tab ----- */
function StatusTab({ parties, qualities, bobbins, warpBeams, weftBags, partyById }: {
  parties: PartyOpt[]; qualities: QualityOpt[];
  bobbins: BobbinRow[]; warpBeams: WarpBeamRow[]; weftBags: WeftBagRow[];
  partyById: Map<number, PartyOpt>;
}) {
  const pivot = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const w of warpBeams) {
      if (w.fabric_quality_id == null) continue;
      const row = m.get(w.jobwork_party_id) ?? new Map<number, number>();
      const cur = row.get(w.fabric_quality_id) ?? 0;
      row.set(w.fabric_quality_id, cur + Number(w.total_metres ?? 0));
      m.set(w.jobwork_party_id, row);
    }
    return m;
  }, [warpBeams]);

  const balanceByParty = useMemo(() => {
    const out = new Map<number, {
      bobbinQty: number; warpBeams: number; warpMetres: number;
      weftBags: number; weftKg: number;
    }>();
    for (const p of parties) {
      out.set(p.id, { bobbinQty: 0, warpBeams: 0, warpMetres: 0, weftBags: 0, weftKg: 0 });
    }
    for (const b of bobbins) {
      if (b.jobwork_party_id == null) continue;
      const r = out.get(b.jobwork_party_id);
      if (r) r.bobbinQty += Number(b.quantity ?? 0);
    }
    for (const w of warpBeams) {
      const r = out.get(w.jobwork_party_id);
      if (r) {
        r.warpBeams += Number(w.beam_count ?? 0);
        r.warpMetres += Number(w.total_metres ?? 0);
      }
    }
    for (const wb of weftBags) {
      const r = out.get(wb.jobwork_party_id);
      if (r) {
        r.weftBags += Number(wb.bag_count ?? 0);
        r.weftKg += Number(wb.total_kg ?? 0);
      }
    }
    return out;
  }, [parties, bobbins, warpBeams, weftBags]);

  const byQuality = useMemo(() => {
    const m = new Map<number, { total: number; byParty: Map<number, number> }>();
    for (const w of warpBeams) {
      if (w.fabric_quality_id == null) continue;
      const q = m.get(w.fabric_quality_id) ?? { total: 0, byParty: new Map<number, number>() };
      const m2 = Number(w.total_metres ?? 0);
      q.total += m2;
      q.byParty.set(w.jobwork_party_id, (q.byParty.get(w.jobwork_party_id) ?? 0) + m2);
      m.set(w.fabric_quality_id, q);
    }
    return m;
  }, [warpBeams]);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-display font-bold text-base mb-2">Warp metres by Party x Quality</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">Party</th>
                {qualities.map((q) => (
                  <th key={q.id} className="text-right px-3 py-3">{q.name}</th>
                ))}
                <th className="text-right px-3 py-3 bg-indigo-50">Total</th>
              </tr>
            </thead>
            <tbody>
              {parties.length === 0 ? (
                <tr><td colSpan={qualities.length + 2} className="px-3 py-8 text-center text-ink-soft">No parties yet.</td></tr>
              ) : parties.map((p) => {
                const row = pivot.get(p.id);
                const partyTotal = row ? Array.from(row.values()).reduce((a, b) => a + b, 0) : 0;
                return (
                  <tr key={p.id} className="border-t border-line/40">
                    <td className="px-3 py-2 font-semibold">{p.name}</td>
                    {qualities.map((q) => {
                      const v = row?.get(q.id) ?? 0;
                      return <td key={q.id} className="px-3 py-2 text-right num">{v > 0 ? v.toFixed(0) : '-'}</td>;
                    })}
                    <td className="px-3 py-2 text-right num font-bold bg-indigo-50/40">{partyTotal > 0 ? partyTotal.toFixed(0) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-display font-bold text-base mb-2">Per-party balance</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">Party</th>
                <th className="text-right px-3 py-3">Bobbin qty</th>
                <th className="text-right px-3 py-3">Warp beams</th>
                <th className="text-right px-3 py-3">Warp metres</th>
                <th className="text-right px-3 py-3">Weft bags</th>
                <th className="text-right px-3 py-3">Weft kg</th>
              </tr>
            </thead>
            <tbody>
              {parties.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-soft">No parties yet.</td></tr>
              ) : parties.map((p) => {
                const b = balanceByParty.get(p.id);
                return (
                  <tr key={p.id} className="border-t border-line/40">
                    <td className="px-3 py-2 font-semibold">{p.name}</td>
                    <td className="px-3 py-2 text-right num">{b?.bobbinQty ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{b?.warpBeams ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{(b?.warpMetres ?? 0).toFixed(0)}</td>
                    <td className="px-3 py-2 text-right num">{b?.weftBags ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{(b?.weftKg ?? 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-display font-bold text-base mb-2">Per-quality warp metres split by party</h3>
        <div className="space-y-2">
          {qualities.length === 0 ? (
            <div className="card p-6 text-center text-sm text-ink-soft">No fabric qualities defined.</div>
          ) : qualities.map((q) => {
            const data = byQuality.get(q.id);
            if (!data || data.total === 0) return null;
            return (
              <div key={q.id} className="card p-4">
                <div className="flex justify-between items-baseline mb-2">
                  <h4 className="font-semibold">{q.name}</h4>
                  <div className="text-sm">
                    <span className="text-ink-mute">Total: </span>
                    <span className="num font-bold text-indigo-700">{data.total.toFixed(0)} m</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {Array.from(data.byParty.entries()).map(([partyId, metres]) => {
                    const p = partyById.get(partyId);
                    return (
                      <span key={partyId} className="pill bg-indigo-50 text-indigo-700">
                        {p?.name ?? '?'}: <span className="num font-bold">{metres.toFixed(0)} m</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
