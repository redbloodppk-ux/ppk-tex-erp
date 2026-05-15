import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Audit Log' };

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('audit_log')
    .select('id, table_name, action, row_id, changed_at, changed_by_email')
    .order('changed_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Every change to costing, orders, invoices, payments and master data." />
      {!rows?.length ? (
        <ComingSoon note="Audit entries will appear here once data starts changing." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Who</th>
                <th className="text-left px-4 py-3">Table</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Row ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-line/40">
                  <td className="px-4 py-3 text-xs text-ink-soft">{formatDate(r.changed_at, 'long')}</td>
                  <td className="px-4 py-3 text-xs">{r.changed_by_email ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.table_name}</td>
                  <td className="px-4 py-3 text-xs uppercase">{r.action}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-ink-mute">{r.row_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
