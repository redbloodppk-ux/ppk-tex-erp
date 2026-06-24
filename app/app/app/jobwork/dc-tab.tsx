'use client';
/**
 * Jobwork DC tab — read-only list of every delivery_challan where
 * production_mode = 'jobwork'. Two filters at the top:
 *
 *   - Jobwork party  (uses the same party_id the DC was filed under)
 *   - Fabric quality (any DC where at least one item uses that quality)
 *
 * From here the user can jump to view / print each DC, edit it, or open
 * a new jobwork bill seeded with the picked DCs.
 */
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Pencil, Printer, Receipt, PackageCheck } from 'lucide-react';
import { CardFilter } from '@/app/components/card-filter';

interface PartyOpt { id: number; code: string; name: string }
interface QualityOpt { id: number; code: string | null; name: string }

interface DcRow {
  id: number;
  code: string;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  party_id: number | null;
  bill_to_name: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
  invoice_id: number | null;
  fabric_receipt_id: number | null;
  vehicle_no: string | null;
}

interface DcItemRow {
  dc_id: number;
  fabric_quality_id: number | null;
}

interface JobworkDcTabProps {
  /**
   * Ignored - kept for backwards compat with the parent jobwork page.
   * The parent passes parties from the legacy `jobwork_party` table, but
   * delivery_challan.party_id references the unified `party` master, so
   * the DC tab fetches its own jobwork-party list internally to avoid
   * id-space mismatch.
   */
  parties?: ReadonlyArray<PartyOpt>;
  qualities: ReadonlyArray<QualityOpt>;
  /** Page route this tab is being shown on. `outsource` flips the
   *  visible labels (DC / bill / party) but the underlying delivery
   *  challan + invoice tables stay the same. */
  kind?: 'jobwork' | 'outsource';
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function statusPill(s: DcRow['status']): { label: string; cls: string } {
  switch (s) {
    case 'draft':     return { label: 'Draft',     cls: 'bg-slate-100 text-slate-600' };
    case 'confirmed': return { label: 'Confirmed', cls: 'bg-amber-50 text-amber-700' };
    case 'invoiced':  return { label: 'Invoiced',  cls: 'bg-emerald-50 text-emerald-700' };
    case 'cancelled': return { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700' };
    default:          return { label: s,           cls: 'bg-slate-100 text-slate-600' };
  }
}

export function JobworkDcTab({ qualities, kind = 'jobwork' }: JobworkDcTabProps): React.ReactElement {
  // Display strings — swap "jobwork bill / DC / weaver" wording when
  // this tab is rendered inside /app/outsource.
  const billLabel: string = kind === 'outsource' ? 'weaving bill' : 'jobwork bill';
  const dcLabel:   string = kind === 'outsource' ? 'outsource weaving DC' : 'jobwork DC';
  const supabase = createClient();
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DcRow[]>([]);
  const [itemRows, setItemRows] = useState<DcItemRow[]>([]);
  const [parties, setParties] = useState<PartyOpt[]>([]);

  // Filters
  const [partyFilter, setPartyFilter]   = useState<string>('');
  const [qualityFilter, setQualityFilter] = useState<string>('');

  // Sort — DC No or Date, ascending / descending. Default: newest date first.
  const [sortKey, setSortKey] = useState<'dc' | 'date'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: 'dc' | 'date'): void => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;

      // Resolve the party-type id matching the active page (Jobwork
      // Party on /app/jobwork, Outsource Weaver on /app/outsource)
      // and use it to scope the party dropdown + the DC list.
      const partyTypeName = kind === 'outsource' ? 'Outsource Weaver' : 'Jobwork Party';
      const ptRes = await sb
        .from('party_type_master')
        .select('id')
        .eq('name', partyTypeName)
        .maybeSingle();
      const jobworkTypeId: number | null = ptRes.data?.id ?? null;

      // DC production_mode column stores 'jobwork' or 'outsource'.
      // Filter to the active page's mode so jobwork DCs never appear
      // on the outsource page and vice-versa.
      const dcProductionMode: 'jobwork' | 'outsource' = kind === 'outsource' ? 'outsource' : 'jobwork';

      const [hdrRes, itemRes, partyRes] = await Promise.all([
        sb.from('delivery_challan')
          .select('id, code, dc_date, status, party_id, bill_to_name, total_metres, total_pieces, total_bundles, invoice_id, fabric_receipt_id, vehicle_no')
          .eq('production_mode', dcProductionMode)
          .order('dc_date', { ascending: false })
          .order('id', { ascending: false }),
        sb.from('delivery_challan_item')
          .select('dc_id, fabric_quality_id'),
        sb.from('party')
          .select('id, code, name, party_type_ids, party_type_id')
          .eq('status', 'active')
          .order('name'),
      ]);
      if (cancelled) return;
      if (hdrRes.error) { setError(hdrRes.error.message); setLoading(false); return; }
      setRows((hdrRes.data ?? []) as DcRow[]);
      setItemRows((itemRes.data ?? []) as DcItemRow[]);

      const allActive = (partyRes.data ?? []) as Array<PartyOpt & { party_type_ids: Array<number | string> | null; party_type_id: number | null }>;
      const jobworkParties: PartyOpt[] = jobworkTypeId == null
        ? allActive
        : allActive.filter((p) => {
            const ids = Array.isArray(p.party_type_ids) ? p.party_type_ids.map((x) => Number(x)) : [];
            return ids.includes(jobworkTypeId) || Number(p.party_type_id) === jobworkTypeId;
          });
      setParties(jobworkParties.map((p) => ({ id: p.id, code: p.code, name: p.name })));
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [supabase, kind]);

  // Build a map of dc_id -> set of fabric_quality_ids it uses (for the
  // quality filter).
  const qualitiesByDc = useMemo<Map<number, Set<number>>>(() => {
    const m = new Map<number, Set<number>>();
    for (const r of itemRows) {
      if (r.fabric_quality_id == null) continue;
      let s = m.get(r.dc_id);
      if (!s) { s = new Set<number>(); m.set(r.dc_id, s); }
      s.add(r.fabric_quality_id);
    }
    return m;
  }, [itemRows]);

  const filtered = useMemo<DcRow[]>(() => {
    const pId = partyFilter ? Number(partyFilter) : null;
    const qId = qualityFilter ? Number(qualityFilter) : null;
    return rows.filter((r) => {
      if (pId != null && r.party_id !== pId) return false;
      if (qId != null) {
        const set = qualitiesByDc.get(r.id);
        if (!set || !set.has(qId)) return false;
      }
      return true;
    });
  }, [rows, partyFilter, qualityFilter, qualitiesByDc]);

  const total = filtered.reduce<{ m: number; p: number; b: number }>(
    (acc, r) => ({
      m: acc.m + Number(r.total_metres ?? 0),
      p: acc.p + (r.total_pieces ?? 0),
      b: acc.b + (r.total_bundles ?? 0),
    }),
    { m: 0, p: 0, b: 0 },
  );

  const partyById = useMemo<Map<number, PartyOpt>>(
    () => new Map(parties.map((p) => [p.id, p])),
    [parties],
  );

  const qualityById = useMemo<Map<number, QualityOpt>>(
    () => new Map(qualities.map((q) => [q.id, q])),
    [qualities],
  );

  // A DC may carry more than one fabric quality across its items — show
  // every distinct one, comma-separated (code preferred, else name).
  const qualityLabel = (dcId: number): string => {
    const set = qualitiesByDc.get(dcId);
    if (!set || set.size === 0) return '-';
    const names = Array.from(set)
      .map((id) => qualityById.get(id)?.code ?? qualityById.get(id)?.name ?? '')
      .filter((s) => s !== '');
    return names.length ? names.join(', ') : '-';
  };

  // Apply the chosen sort on top of the filtered rows. Date sort falls back
  // to id for a stable order within the same day; DC No uses numeric-aware
  // string compare so 0009 < 0010 etc.
  const sorted = useMemo<DcRow[]>(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'date') {
        cmp = a.dc_date.localeCompare(b.dc_date);
        if (cmp === 0) cmp = a.id - b.id;
      } else {
        cmp = a.code.localeCompare(b.code, undefined, { numeric: true });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const arrow = (key: 'dc' | 'date'): string => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <div className="space-y-4">
      {/* ───── Filter bar ───── */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="dc-party" className="text-[10px] uppercase tracking-wide text-ink-mute">Jobwork party</label>
          <select
            id="dc-party"
            value={partyFilter}
            onChange={(e) => setPartyFilter(e.target.value)}
            className="input py-1 text-xs min-w-[200px]"
          >
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label htmlFor="dc-quality" className="text-[10px] uppercase tracking-wide text-ink-mute">Fabric quality</label>
          <select
            id="dc-quality"
            value={qualityFilter}
            onChange={(e) => setQualityFilter(e.target.value)}
            className="input py-1 text-xs min-w-[200px]"
          >
            <option value="">All qualities</option>
            {qualities.map((q) => (
              <option key={q.id} value={q.id}>{q.code ?? q.name}</option>
            ))}
          </select>
        </div>

        {(partyFilter !== '' || qualityFilter !== '') && (
          <button
            type="button"
            onClick={() => { setPartyFilter(''); setQualityFilter(''); }}
            className="text-xs text-ink-mute hover:text-ink underline"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/app/invoices/new/jobwork-bill"
            className="btn-primary text-xs"
          >
            <Receipt className="w-3.5 h-3.5" /> New {kind === 'outsource' ? 'Weaving Bill' : 'Jobwork Bill'}
          </Link>
          <Link
            href="/app/delivery-challan/new"
            className="btn-secondary text-xs"
          >
            New DC
          </Link>
        </div>
      </div>

      {/* ───── KPIs ───── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">DCs shown</div>
          <div className="num text-xl font-bold">{filtered.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total metres</div>
          <div className="num text-xl font-bold">{total.m.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total pieces</div>
          <div className="num text-xl font-bold">{total.p}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total bundles</div>
          <div className="num text-xl font-bold">{total.b}</div>
        </div>
      </div>

      {/* ───── Table ───── */}
      {error && <div className="card p-3 text-err text-sm">{error}</div>}
      {loading ? (
        <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading DCs...
        </div>
      ) : (
        <>
        {/* Mobile / PWA: card view. The wide DC table forces horizontal
            scrolling on a phone, so below md we render each DC as a
            tap-friendly card. The table below is hidden on mobile. */}
        {/* Mobile sort controls — the desktop table sorts via clickable
            headers, but cards have none, so expose the same toggle here. */}
        <div className="md:hidden flex items-center gap-2 text-xs">
          <span className="text-ink-mute">Sort:</span>
          <button
            type="button"
            onClick={() => toggleSort('date')}
            className={`px-2.5 py-1 rounded-full border ${sortKey === 'date' ? 'border-indigo text-indigo font-semibold' : 'border-line text-ink-soft'}`}
          >
            Date{arrow('date')}
          </button>
          <button
            type="button"
            onClick={() => toggleSort('dc')}
            className={`px-2.5 py-1 rounded-full border ${sortKey === 'dc' ? 'border-indigo text-indigo font-semibold' : 'border-line text-ink-soft'}`}
          >
            DC No{arrow('dc')}
          </button>
        </div>

        <CardFilter placeholder="Search DCs…">
          {sorted.length ? sorted.map((r) => {
            const pill = statusPill(r.status);
            const party = r.party_id != null ? partyById.get(r.party_id) : null;
            return (
              <div key={r.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/app/delivery-challan/${r.id}`} className="font-mono text-xs font-semibold text-ink hover:text-indigo break-words">
                      {r.code}
                    </Link>
                    <div className="text-sm font-medium mt-0.5 break-words">{party?.name ?? r.bill_to_name ?? '-'}</div>
                  </div>
                  <span className={`pill ${pill.cls} text-xs uppercase tracking-wide shrink-0`}>{pill.label}</span>
                </div>

                <div className="text-xs text-ink-soft mt-1">
                  <span className="text-ink-mute">Date: </span>{fmtDate(r.dc_date)}
                  <span className="text-ink-mute"> · Quality: </span>{qualityLabel(r.id)}
                </div>
                <div className="text-xs text-ink-soft mt-1">
                  <span className="text-ink-mute">Metres: </span><span className="num">{Number(r.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  <span className="text-ink-mute"> · Pcs: </span><span className="num">{r.total_pieces ?? 0}</span>
                  <span className="text-ink-mute"> · Bundles: </span><span className="num">{r.total_bundles ?? 0}</span>
                </div>

                <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                  {r.fabric_receipt_id === null
                    && r.status !== 'invoiced'
                    && r.status !== 'cancelled' && (
                    <Link
                      href={`/app/jobwork/fabric-receipt/new?dc=${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-teal-700 font-semibold"
                      title="Receive fabric from this DC"
                    >
                      <PackageCheck className="w-3.5 h-3.5" /> Receive
                    </Link>
                  )}
                  {r.fabric_receipt_id !== null && (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold"
                      title="Fabric already received against this DC"
                    >
                      <PackageCheck className="w-3.5 h-3.5" /> Received
                    </span>
                  )}
                  <Link
                    href={`/app/delivery-challan/${r.id}/print`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold"
                    title="View / Print / PDF"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print
                  </Link>
                  <Link
                    href={`/app/delivery-challan/${r.id}`}
                    className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold"
                    title="Edit DC"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Link>
                </div>
              </div>
            );
          }) : (
            <div className="card p-6 text-center text-sm text-ink-soft">
              {rows.length === 0
                ? <>No {dcLabel}s yet. <Link href="/app/delivery-challan/new" className="text-indigo font-semibold">Create the first one &rarr;</Link></>
                : `No ${dcLabel}s match the current filters.`}
            </div>
          )}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">
                  <button type="button" onClick={() => toggleSort('dc')} className="uppercase tracking-wide hover:text-ink inline-flex items-center">
                    DC No{arrow('dc')}
                  </button>
                </th>
                <th className="text-left px-3 py-3">
                  <button type="button" onClick={() => toggleSort('date')} className="uppercase tracking-wide hover:text-ink inline-flex items-center">
                    Date{arrow('date')}
                  </button>
                </th>
                <th className="text-left px-3 py-3">Jobwork Party</th>
                <th className="text-left px-3 py-3">Fabric Quality</th>
                <th className="text-right px-3 py-3">Metres</th>
                <th className="text-right px-3 py-3">Pcs</th>
                <th className="text-right px-3 py-3">Bundles</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-ink-soft">
                    {rows.length === 0
                      ? <>No {dcLabel}s yet. <Link href="/app/delivery-challan/new" className="text-indigo font-semibold">Create the first one &rarr;</Link></>
                      : `No ${dcLabel}s match the current filters.`}
                  </td>
                </tr>
              ) : sorted.map((r) => {
                const pill = statusPill(r.status);
                const party = r.party_id != null ? partyById.get(r.party_id) : null;
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/app/delivery-challan/${r.id}`} className="text-indigo hover:underline">{r.code}</Link>
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{fmtDate(r.dc_date)}</td>
                    <td className="px-3 py-2 font-medium">{party?.name ?? r.bill_to_name ?? '-'}</td>
                    <td className="px-3 py-2 text-xs">{qualityLabel(r.id)}</td>
                    <td className="px-3 py-2 text-right num">{Number(r.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right num">{r.total_pieces ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{r.total_bundles ?? 0}</td>
                    <td className="px-3 py-2">
                      <span className={`pill ${pill.cls} text-xs uppercase tracking-wide`}>{pill.label}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {/* Fabric receipt icon shows for any active DC that
                          hasn't been receipted yet - draft included. Saving
                          the receipt auto-flips the DC status from draft
                          to confirmed via the workflow automation. */}
                      {r.fabric_receipt_id === null
                        && r.status !== 'invoiced'
                        && r.status !== 'cancelled' && (
                        <Link
                          href={`/app/jobwork/fabric-receipt/new?dc=${r.id}`}
                          className="p-1 rounded hover:bg-teal-50 text-teal-700 inline-flex mr-1"
                          title="Receive fabric from this DC"
                        >
                          <PackageCheck className="w-4 h-4" />
                        </Link>
                      )}
                      {r.fabric_receipt_id !== null && (
                        <span
                          className="p-1 rounded text-emerald-700 inline-flex mr-1"
                          title="Fabric already received against this DC"
                        >
                          <PackageCheck className="w-4 h-4" />
                        </span>
                      )}
                      <Link
                        href={`/app/delivery-challan/${r.id}/print`}
                        target="_blank"
                        className="p-1 rounded hover:bg-emerald-50 text-emerald-700 inline-flex mr-1"
                        title="View / Print / PDF"
                      >
                        <Printer className="w-4 h-4" />
                      </Link>
                      <Link
                        href={`/app/delivery-challan/${r.id}`}
                        className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex"
                        title="Edit DC"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
