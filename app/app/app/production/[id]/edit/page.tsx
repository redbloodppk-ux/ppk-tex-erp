'use client';
/**
 * Edit Production Batch — same simplified form as the New page, prefilled
 * from the existing batch row. On save it UPDATEs the production_batch
 * row, wipes any stock_ledger rows tied to this batch
 * (source_kind='production_batch', source_id=batch.id) and reposts a
 * fresh set per the New flow's rules.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { ProductionBatchForm, type InitialBatch } from '../../production-batch-form';

export default function EditProductionBatchPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const supabase = createClient();

  const [batch, setBatch] = useState<InitialBatch | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const idStr = params?.id;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) {
      setError('Invalid batch id.');
      setLoading(false);
      return;
    }
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error: qErr } = await sb
        .from('production_batch')
        .select('id, batch_code, costing_id, pavu_assign_id, loom_id, warp_lot_id, produced_m, rejected_m, start_date, end_date, notes')
        .eq('id', id)
        .maybeSingle();
      if (qErr) {
        setError(qErr.message);
        setLoading(false);
        return;
      }
      if (!data) {
        setError('Batch not found.');
        setLoading(false);
        return;
      }
      setBatch(data as InitialBatch);
      setLoading(false);
    })();
  }, [params, supabase]);

  return (
    <div>
      <PageHeader
        title={batch ? `Edit Batch ${batch.batch_code}` : 'Edit Production Batch'}
        subtitle="Update batch details. Stock ledger rows for this batch will be rebuilt on save."
        crumbs={[
          { label: 'Production', href: '/app/production' },
          { label: batch?.batch_code ?? 'Edit' },
        ]}
        actions={
          <Link href="/app/production" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        }
      />
      {loading ? (
        <div className="card p-10 text-center text-ink-soft text-sm">
          <Loader2 className="w-5 h-5 inline animate-spin mr-2" /> Loading batch…
        </div>
      ) : error ? (
        <div className="card p-4 text-sm text-err">{error}</div>
      ) : batch ? (
        <ProductionBatchForm mode="edit" initial={batch} />
      ) : null}
    </div>
  );
}
