/**
 * Outsource Weaving — list page (CORR-P5)
 *
 * Lists outsource_order rows with vendor, quality, issued metres, delivered
 * metres and status. Clicking an order opens the detail page where the user
 * can mark fabric received — that flow inserts a production_batch row with
 * the vendor's pick paise frozen, so True Cost / profit rollups include
 * outsourced metres automatically.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus } from 'lucide-react';
import { formatRupee } from '@/lib/utils';

export const metadata = { title: 'Outsource Weaving' };
export const dynamic = 'force-dynamic';

type OWStatus = 'open' | 'partial' | 'complete' | 'cancelled';

interface OWRow {
  id: number;
  ow_number: string;
  issued_date: string;
  promised_date: string | null;
  expected_metres: number;
  delivered_metres: number;
  pick_paise_agreed: number;
  status: OWStatus;
  vendor: { name: string; code: string | null } | null;
  costing: { quality_code: string; quality_name: string } | null;
}

const STATUS_PILL: Record<OWStatus, string> = {
  open:      'bg-sky-50 text-sky-700',
  partial:   'bg-amber-50 text-amber-700',
  complete:  'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default async function OutsourceListPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('outsource_order')
    .select(`
      id, ow_number, issued_date, promised_date,
      expected_metres, delivered_metres, pick_paise_agreed, status,
      vendor:ledger_id ( name, code ),
      costing:costing_id ( quality_code, quality_name )
    `)
    .order('issued_date', { ascending: false })
    .limit(200);

  const rows = (data as unknown as OWRow[]) ?? [];

  const totalExpected  = rows.reduce((a, r) => a + Number(r.expected_metres  || 0), 0);
  const totalDelivered = rows.reduce((a, r) => a + Number(r.delivered_metres || 0), 0);
  const openCount      = rows.filter(r => r.status === 'open' || r.status === 'partial').length;

  return (
    <div>
      <PageHeader
        title="Outsource Weaving"
        subtitle="Yarn issued to weaving vendors. When fabric is received back the system creates a matching production batch — vendor pick paise becomes the actual loom cost, so True Cost includes outsourced metres."
        actions={
          <Link href="/app/outsource/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Outsource Order
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load outsource orders: {error.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Orders shown</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Open / partial</div>
          <div className="num text-xl font-bold">{openCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Expected (m)</div>
          <div className="num text-xl font-bold">{totalExpected.toFixed(0)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Delivered (m)</div>
          <div className="num text-xl font-bold">{totalDelivered.toFixed(0)}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">OW #</th>
              <th className="text-left px-4 py-3">Vendor</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Quality</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Issued</th>
              <th className="text-right px-4 py-3">Expected m</th>
              <th className="text-right px-4 py-3">Delivered m</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Pick ₹</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">
                  <Link href={`/app/outsource/${r.id}`} className="text-indigo font-semibold">
                    {r.ow_number}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.vendor?.name ?? '—'}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{r.vendor?.code ?? ''}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-xs">
                  <div className="font-mono">{r.costing?.quality_code ?? '—'}</div>
                  <div className="text-ink-mute">{r.costing?.quality_name ?? ''}</div>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell num text-xs text-ink-soft">
                  {r.issued_date}
                </td>
                <td className="px-4 py-3 text-right num">{Number(r.expected_metres).toFixed(0)}</td>
                <td className="px-4 py-3 text-right num font-semibold">{Number(r.delivered_metres).toFixed(0)}</td>
                <td className="px-4 py-3 hidden md:table-cell text-right num text-xs">
                  {formatRupee(Number(r.pick_paise_agreed))}
                </td>
                <td className="px-4 py-3">
                  <span className={`pill ${STATUS_PILL[r.status]}`}>{r.status}</span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No outsource orders yet.{' '}
                  <Link href="/app/outsource/new" className="text-indigo font-semibold">
                    Issue the first one →
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
