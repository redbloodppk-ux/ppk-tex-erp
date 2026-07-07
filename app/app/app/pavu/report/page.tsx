'use client';
/**
 * Beam Stock Report
 *
 * Reconstructs the status of every pavu (beam) as of any chosen date, using
 * fn_pavu_stock_report(p_as_of). Lets the owner filter by ends and yarn
 * count, see loaded/finished metres and mounted/finished dates, plus a
 * summary rolled up by ends + yarn count.
 *
 * Note: damaged/scrapped status is always shown as of TODAY (that history
 * isn't date-stamped anywhere) — everything else is reconstructed correctly
 * for the chosen date.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { ArrowLeft, Loader2, RotateCw } from 'lucide-react';

interface StockRow {
  pavu_id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  yarn_count: string | null;
  set_no: string | null;
  loaded_metre: number;
  finished_metre: number;
  status_as_of: string;
  mounted_date: string | null;
  finished_date: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  on_loom:  'bg-indigo/10 text-indigo',
  in_stock: 'bg-slate-100 text-slate-600',
  finished: 'bg-emerald-50 text-emerald-700',
  damaged:  'bg-amber-50 text-amber-700',
  scrapped: 'bg-rose-50 text-rose-700',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PavuStockReportPage() {
  const supabase = createClient();
  const [asOf, setAsOf] = useState(todayStr());
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [endsFilter, setEndsFilter] = useState('');
  const [yarnFilter, setYarnFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async (date: string) => {
    setLoading(true); setError(null);
    const { data, error: err } = await supabase.rpc('fn_pavu_stock_report', { p_as_of: date });
    if (err) { setError(err.message); setRows([]); setLoading(false); return; }
    setRows((data as StockRow[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(asOf); }, [asOf, load]);

  const endsOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.ends))).sort((a, b) => a - b),
    [rows],
  );
  const yarnOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.yarn_count).filter((v): v is string => !!v))).sort(),
    [rows],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.status_as_of))).sort(),
    [rows],
  );

  const filtered = rows.filter(r =>
    (!endsFilter || String(r.ends) === endsFilter) &&
    (!yarnFilter || r.yarn_count === yarnFilter) &&
    (!statusFilter || r.status_as_of === statusFilter),
  );

  // Summary grouped by ends + yarn count.
  const summary = useMemo(() => {
    const m = new Map<string, {
      ends: number; yarn_count: string | null; count: number;
      loaded: number; finished: number;
    }>();
    for (const r of filtered) {
      const key = `${r.ends}__${r.yarn_count ?? ''}`;
      const cur = m.get(key) ?? { ends: r.ends, yarn_count: r.yarn_count, count: 0, loaded: 0, finished: 0 };
      cur.count += 1;
      cur.loaded += Number(r.loaded_metre);
      cur.finished += Number(r.finished_metre);
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.ends - b.ends || (a.yarn_count ?? '').localeCompare(b.yarn_count ?? ''));
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Beam Stock Report"
        subtitle="Status, loaded and finished metres for every beam, reconstructed as of any date."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/app/pavu" className="btn-ghost">
              <ArrowLeft className="w-4 h-4" /> Pavu Master
            </Link>
            <button onClick={() => load(asOf)} className="btn-ghost" disabled={loading}>
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">As of date</label>
          <input
            type="date"
            value={asOf}
            onChange={e => setAsOf(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Ends</label>
          <select value={endsFilter} onChange={e => setEndsFilter(e.target.value)} className="input">
            <option value="">All</option>
            {endsOptions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Yarn count</label>
          <select value={yarnFilter} onChange={e => setYarnFilter(e.target.value)} className="input">
            <option value="">All</option>
            {yarnOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input">
            <option value="">All</option>
            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">Could not load: {error}</div>
      )}

      {/* Summary rolled up by ends + yarn count */}
      {summary.length > 0 && (
        <div className="card p-4 mb-4 overflow-x-auto">
          <div className="text-xs uppercase tracking-wide text-ink-mute mb-2">Summary by ends &amp; yarn count</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-mute border-b border-line/60">
                <th className="py-1.5 pr-3">Ends</th>
                <th className="py-1.5 pr-3">Yarn count</th>
                <th className="py-1.5 pr-3 text-right">Beams</th>
                <th className="py-1.5 pr-3 text-right">Loaded m</th>
                <th className="py-1.5 pr-3 text-right">Finished m</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={`${s.ends}__${s.yarn_count}`} className="border-b border-line/30 last:border-0">
                  <td className="py-1.5 pr-3 num">{s.ends}</td>
                  <td className="py-1.5 pr-3">{s.yarn_count ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right num">{s.count}</td>
                  <td className="py-1.5 pr-3 text-right num">{s.loaded.toFixed(0)}</td>
                  <td className={`py-1.5 pr-3 text-right num ${s.finished < 0 ? 'text-rose-600' : ''}`}>
                    {s.finished.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-beam detail */}
      <div className="card p-4 overflow-x-auto">
        {loading && !rows.length ? (
          <div className="p-10 text-center text-ink-soft text-sm">
            <Loader2 className="w-5 h-5 inline animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-ink-mute text-sm">No beams match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-mute border-b border-line/60">
                <th className="py-1.5 pr-3">Beam</th>
                <th className="py-1.5 pr-3">Ends</th>
                <th className="py-1.5 pr-3">Yarn count</th>
                <th className="py-1.5 pr-3">Set</th>
                <th className="py-1.5 pr-3 text-right">Loaded m</th>
                <th className="py-1.5 pr-3 text-right">Finished m</th>
                <th className="py-1.5 pr-3">Status</th>
                <th className="py-1.5 pr-3">Mounted</th>
                <th className="py-1.5 pr-3">Finished</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.pavu_id} className="border-b border-line/30 last:border-0">
                  <td className="py-1.5 pr-3 font-mono">{r.pavu_code} <span className="text-ink-mute">/ {r.beam_no}</span></td>
                  <td className="py-1.5 pr-3 num">{r.ends}</td>
                  <td className="py-1.5 pr-3">{r.yarn_count ?? '—'}</td>
                  <td className="py-1.5 pr-3">{r.set_no ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right num">{Number(r.loaded_metre).toFixed(0)}</td>
                  <td className={`py-1.5 pr-3 text-right num ${Number(r.finished_metre) < 0 ? 'text-rose-600' : ''}`}>
                    {Number(r.finished_metre).toFixed(0)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className={`pill ${STATUS_STYLE[r.status_as_of] ?? 'bg-slate-100 text-slate-600'}`}>
                      {r.status_as_of}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">{r.mounted_date ?? '—'}</td>
                  <td className="py-1.5 pr-3">{r.finished_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
