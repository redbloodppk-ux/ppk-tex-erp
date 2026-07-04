/**
 * Read-only listing of every beam given to jobwork parties (mirrors
 * /app/jobwork → Warp beam given), shown on Pavu Master's Jobwork tab.
 * Unlike In-house/Outsource, jobwork beams aren't routed here — most
 * are entered directly on the Jobwork page and never touch a pavu row
 * at all, so this table is display-only. Editing (add/edit/split/
 * delete) still happens on /app/jobwork.
 */
import Link from 'next/link';

export interface JobworkBeamRow {
  id: number;
  given_date: string;
  party_name: string;
  quality_name: string | null;
  warp_count_display: string | null;
  total_ends: number | null;
  beam_count: number;
  metres: number;
  /** Pavu code(s) this beam is linked to, if any — empty for manual
   *  entries (the common case; jobwork entries don't pick from Pavu). */
  pavu_codes: string[];
  /** Current status of the linked pavu row ('in_stock' | 'on_loom' | 'finished' | 'damaged' | 'scrapped'), or null if no pavu is linked (legacy manual entries). */
  pavu_status: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  on_loom:  'bg-indigo-50 text-indigo-700',
  finished: 'bg-slate-100 text-slate-600',
  damaged:  'bg-rose-50 text-rose-700',
  scrapped: 'bg-rose-50 text-rose-700',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function JobworkBeamsTable({ rows }: { rows: ReadonlyArray<JobworkBeamRow> }): React.ReactElement {
  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center text-ink-soft text-sm">
        No beams given to jobwork parties yet. Add one from{' '}
        <Link href="/app/jobwork" className="text-indigo underline">Job Work → Warp beam given</Link>.
      </div>
    );
  }

  const totalBeams = rows.reduce((s, r) => s + Number(r.beam_count ?? 0), 0);
  const totalMetres = rows.reduce((s, r) => s + Number(r.metres ?? 0), 0);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left  px-4 py-3">ID</th>
            <th className="text-left  px-4 py-3">Date</th>
            <th className="text-left  px-4 py-3">Jobwork Party</th>
            <th className="text-left  px-4 py-3 hidden md:table-cell">Quality</th>
            <th className="text-left  px-4 py-3 hidden lg:table-cell">Warp count</th>
            <th className="text-right px-4 py-3">Ends</th>
            <th className="text-right px-4 py-3">Beams</th>
            <th className="text-right px-4 py-3">Metres</th>
                <th className="text-left px-4 py-3">Status</th>
            <th className="text-left  px-4 py-3">Pavu Code</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60 align-middle">
              <td className="px-4 py-2 font-mono text-xs text-ink-mute">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
              <td className="px-4 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
              <td className="px-4 py-2">{r.party_name}</td>
              <td className="px-4 py-2 hidden md:table-cell text-ink-soft">{r.quality_name ?? '—'}</td>
              <td className="px-4 py-2 hidden lg:table-cell text-ink-soft">{r.warp_count_display ?? '—'}</td>
              <td className="px-4 py-2 text-right num">{r.total_ends ?? '—'}</td>
              <td className="px-4 py-2 text-right num font-semibold">{r.beam_count}</td>
              <td className="px-4 py-2 text-right num text-indigo-700 font-semibold">{r.metres.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
              <td className="px-4 py-3">
                    {r.pavu_status ? (
                      <span className={`pill ${STATUS_STYLE[r.pavu_status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {r.pavu_status.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </td>
              <td className="px-4 py-2 font-mono text-xs">
                {r.pavu_codes.length === 0 ? <span className="text-ink-mute">—</span> : r.pavu_codes.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
          <tr>
            <td colSpan={6} className="px-4 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
            <td className="px-4 py-3 text-right num font-bold">{totalBeams.toLocaleString('en-IN')} beams</td>
            <td className="px-4 py-3 text-right num font-bold text-indigo-700">{totalMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</td>
            <td />
                <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
