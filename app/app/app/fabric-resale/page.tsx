'use client';
/**
 * Fabric Resale stock page — `/app/fabric-resale`.
 *
 * Summary view of every fabric_purchase batch grouped by quality
 * (free-text `quality_text` for supplier-purchase rows, or the
 * fabric_quality master name for customer-adjustment rows).
 *
 * Each row shows: total bought, total sold (purchased - current),
 * current stock, weighted-average rate, total purchase value, and
 * the supplier(s) it came from.
 *
 * Operators use this page to answer "how much SAREE 80*80 do I have
 * left to resell?" without leaving the warehouse view.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { InhouseStockTabs } from '@/app/components/inhouse-stock-tabs';
import { Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { CardFilter } from '@/app/components/card-filter';

interface FabricRow {
  id: number;
  code: string;
  fabric_quality_id: number | null;
  quality_text: string | null;
  supplier_party_id: number | null;
  received_date: string;
  received_metres: number | string | null;
  received_pieces: number | null;
  current_metres: number | string | null;
  rate_unit: 'm' | 'pcs';
  rate: number | string;
  gst_pct: number | string;
  total_amount: number | string | null;
  invoice_no: string | null;
}

interface QualityOpt { id: number; code: string | null; name: string }
interface PartyOpt   { id: number; code: string; name: string }

interface GroupedRow {
  label: string;
  /** Either `quality:{id}` (master row) or `text:{name}` (free form). */
  key: string;
  /** Source rows in this group, newest first. */
  rows: FabricRow[];
  bought_metres: number;
  current_metres: number;
  sold_metres:   number;
  bought_pieces: number;
  current_pieces: number;
  total_value:   number;
  /** Weighted average rate per metre (or per piece if any rows are
   *  pcs-based). For mixed-unit groups we fall back to the metre rate
   *  since the dominant unit in textile resale is metres. */
  avg_rate:      number;
  unit:          'm' | 'pcs' | 'mixed';
  suppliers:     string[];
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
}
function fmtMetres(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n));
}

export default function FabricResalePage(): React.ReactElement {
  const supabase = createClient();
  const [rows, setRows] = useState<FabricRow[]>([]);
  const [qualities, setQualities] = useState<QualityOpt[]>([]);
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [rRes, qRes, pRes] = await Promise.all([
      sb.from('fabric_purchase')
        .select('id, code, fabric_quality_id, quality_text, supplier_party_id, received_date, received_metres, received_pieces, current_metres, rate_unit, rate, gst_pct, total_amount, invoice_no')
        .eq('status', 'active')
        .order('received_date', { ascending: false })
        .order('id', { ascending: false }),
      sb.from('fabric_quality').select('id, code, name').eq('active', true),
      sb.from('party').select('id, code, name').eq('status', 'active'),
    ]);
    if (rRes.error)      { setError(rRes.error.message); setLoading(false); return; }
    if (qRes.error)      { setError(qRes.error.message); setLoading(false); return; }
    if (pRes.error)      { setError(pRes.error.message); setLoading(false); return; }
    setRows((rRes.data ?? []) as FabricRow[]);
    setQualities((qRes.data ?? []) as QualityOpt[]);
    setParties((pRes.data ?? []) as PartyOpt[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // ── Group fabric_purchase rows by quality ────────────────────────
  const groups = useMemo<GroupedRow[]>(() => {
    const map = new Map<string, GroupedRow>();
    for (const r of rows) {
      // Quality identity: prefer FK master row, otherwise quality_text.
      let key: string, label: string;
      if (r.fabric_quality_id !== null) {
        const q = qualities.find((x) => x.id === r.fabric_quality_id);
        key   = `quality:${r.fabric_quality_id}`;
        label = q ? q.name : `#${r.fabric_quality_id}`;
      } else if (r.quality_text !== null && r.quality_text.trim() !== '') {
        const norm = r.quality_text.trim().toUpperCase();
        key   = `text:${norm}`;
        label = norm;
      } else {
        key   = 'unknown';
        label = '(unspecified)';
      }

      let g = map.get(key);
      if (!g) {
        g = {
          key, label,
          rows: [],
          bought_metres: 0, current_metres: 0, sold_metres: 0,
          bought_pieces: 0, current_pieces: 0,
          total_value: 0,
          avg_rate: 0,
          unit: 'm',
          suppliers: [],
        };
        map.set(key, g);
      }
      g.rows.push(r);
      const bM = Number(r.received_metres ?? 0);
      const cM = Number(r.current_metres ?? 0);
      const bP = Number(r.received_pieces ?? 0);
      const value = Number(r.total_amount ?? 0);
      g.bought_metres  += bM;
      g.current_metres += cM;
      g.bought_pieces  += bP;
      g.total_value    += value;
      if (r.supplier_party_id !== null) {
        const party = parties.find((x) => x.id === r.supplier_party_id);
        const name = party ? party.name : `#${r.supplier_party_id}`;
        if (!g.suppliers.includes(name)) g.suppliers.push(name);
      }
      // Unit: if all rows of this group are metres, unit='m'; all pcs,
      // unit='pcs'; otherwise 'mixed'.
      if (g.rows.length === 1) g.unit = r.rate_unit;
      else if (g.unit !== r.rate_unit && g.unit !== 'mixed') g.unit = 'mixed';
    }
    // Compute derived columns: sold and weighted-average rate.
    const list = Array.from(map.values()).map((g) => {
      g.sold_metres = Math.max(0, g.bought_metres - g.current_metres);
      // Weighted average rate = sum(metres * rate) / sum(metres),
      // computed per row and weighted by the bought quantity.
      let num = 0, den = 0;
      for (const r of g.rows) {
        const bM = Number(r.received_metres ?? 0);
        const rate = Number(r.rate ?? 0);
        if (r.rate_unit === 'm' && bM > 0) {
          num += bM * rate; den += bM;
        }
      }
      g.avg_rate = den > 0 ? num / den : 0;
      g.current_pieces = g.bought_pieces; // best-effort; pieces stock isn't tracked
      return g;
    });
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [rows, qualities, parties]);

  const totals = useMemo(() => {
    let bM = 0, cM = 0, sM = 0, val = 0;
    for (const g of groups) {
      bM  += g.bought_metres;
      cM  += g.current_metres;
      sM  += g.sold_metres;
      val += g.total_value;
    }
    return { bM, cM, sM, val };
  }, [groups]);

  if (loading) {
    return (
      <>
        <InhouseStockTabs />
        <div className="card p-6 flex items-center gap-2 text-ink-mute text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading resale stock…
        </div>
      </>
    );
  }

  return (
    <>
      <InhouseStockTabs />
      <PageHeader
        title="Fabric Resale Stock"
        subtitle="Summary of every fabric batch bought for resale, grouped by quality. Includes both supplier purchases (typed quality name) and customer adjustments (in-house quality)."
      />

      {error && <div className="card p-3 text-sm text-err mb-3">{error}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Bought (metres)</div>
          <div className="num text-xl font-bold">{fmtMetres(totals.bM)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Sold (metres)</div>
          <div className="num text-xl font-bold text-rose-700">{fmtMetres(totals.sM)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">In stock (metres)</div>
          <div className="num text-xl font-bold text-emerald-700">{fmtMetres(totals.cM)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total purchase value</div>
          <div className="num text-xl font-bold">Rs {fmtMoney(totals.val)}</div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No resale fabric stock yet. Bought batches appear here once you save them on the{' '}
          <Link href="/app/fabric-stock" className="text-indigo-600 hover:underline">Fabric Stock</Link> page.
        </div>
      ) : (
        <>
        {/* Mobile / PWA: card view. The resale table is wide; below md we
            render each quality group as a tap-friendly card. The table is
            hidden on mobile. */}
        <CardFilter placeholder="Search resale stock…">
          {groups.map((g) => (
            <div key={g.key} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-ink break-words">{g.label}</div>
                  <div className="text-xs text-ink-soft mt-0.5">
                    {g.suppliers.length === 0
                      ? '—'
                      : g.suppliers.length <= 2
                        ? g.suppliers.join(', ')
                        : `${g.suppliers.slice(0, 2).join(', ')} +${g.suppliers.length - 2}`}
                  </div>
                </div>
                <Link
                  href="/app/fabric-stock"
                  className="text-indigo-600 hover:underline text-xs inline-flex items-center gap-1 shrink-0"
                  title="Open Fabric Stock page"
                >
                  {g.rows.length} <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              <div className="text-xs mt-2">
                <span className="text-ink-mute">Bought: </span>
                <span className="num">{fmtMetres(g.bought_metres)} {g.unit === 'pcs' ? 'pcs' : g.unit === 'mixed' ? '(mixed)' : 'm'}</span>
                {' · '}<span className="text-ink-mute">Sold: </span><span className="num text-rose-700">{fmtMetres(g.sold_metres)}</span>
              </div>
              <div className="text-xs mt-1">
                <span className="text-ink-mute">In stock: </span><span className="num text-emerald-700">{fmtMetres(g.current_metres)}</span>
                {' · '}<span className="text-ink-mute">Avg rate: </span><span className="num">{g.avg_rate > 0 ? `₹${fmtMoney(g.avg_rate)}/m` : '-'}</span>
              </div>

              <div className="flex items-end justify-end mt-2 pt-2 border-t border-line/40">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total value</div>
                  <div className="num font-semibold">₹{fmtMoney(g.total_value)}</div>
                </div>
              </div>
            </div>
          ))}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Quality</th>
                <th className="text-left  px-3 py-3">Suppliers</th>
                <th className="text-right px-3 py-3">Bought</th>
                <th className="text-right px-3 py-3">Sold</th>
                <th className="text-right px-3 py-3">In stock</th>
                <th className="text-right px-3 py-3">Avg rate (₹/m)</th>
                <th className="text-right px-3 py-3">Total value (₹)</th>
                <th className="text-right px-3 py-3">Batches</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3 font-semibold">{g.label}</td>
                  <td className="px-3 py-3 text-xs text-ink-soft">
                    {g.suppliers.length === 0
                      ? '—'
                      : g.suppliers.length <= 2
                        ? g.suppliers.join(', ')
                        : `${g.suppliers.slice(0, 2).join(', ')} +${g.suppliers.length - 2}`}
                  </td>
                  <td className="px-3 py-3 text-right num">
                    {fmtMetres(g.bought_metres)} {g.unit === 'pcs' ? 'pcs' : g.unit === 'mixed' ? '(mixed)' : 'm'}
                  </td>
                  <td className="px-3 py-3 text-right num text-rose-700">{fmtMetres(g.sold_metres)}</td>
                  <td className="px-3 py-3 text-right num text-emerald-700">{fmtMetres(g.current_metres)}</td>
                  <td className="px-3 py-3 text-right num">{g.avg_rate > 0 ? fmtMoney(g.avg_rate) : '-'}</td>
                  <td className="px-3 py-3 text-right num font-semibold">{fmtMoney(g.total_value)}</td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href="/app/fabric-stock"
                      className="text-indigo-600 hover:underline text-xs inline-flex items-center gap-1"
                      title="Open Fabric Stock page"
                    >
                      {g.rows.length} <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line/60 bg-cloud/30 font-bold">
                <td className="px-3 py-3" colSpan={2}>Totals</td>
                <td className="px-3 py-3 text-right num">{fmtMetres(totals.bM)}</td>
                <td className="px-3 py-3 text-right num text-rose-700">{fmtMetres(totals.sM)}</td>
                <td className="px-3 py-3 text-right num text-emerald-700">{fmtMetres(totals.cM)}</td>
                <td />
                <td className="px-3 py-3 text-right num">{fmtMoney(totals.val)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}
    </>
  );
}
