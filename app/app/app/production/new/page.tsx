'use client';
/**
 * New Production Batch — simplified rework.
 *
 * Keeps only the fields the floor actually needs:
 *   • Costing pick (drives the snapshot triggers).
 *   • Pavu assignment (drives loom + warp lot).
 *   • Produced m, Rejected m, Start date, End date, Notes.
 *   • Optional "convert to towel pieces" toggle for finished-goods sizing.
 *
 * Removed (vs the old form): SO line link, manual warp source override,
 * weft / porvai lot pickers, bobbin pickers. Yarn / bobbin consumption
 * is now derived from the costing master at save time and posted to
 * stock_ledger, so the operator no longer has to click through them on
 * every batch.
 *
 * The actual cost columns on production_batch are still filled by
 * the cost-snapshot triggers (migrations 005-007) — this form leaves
 * them NULL on the payload so the trigger owns them.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/app/components/page-header';
import { ProductionBatchForm } from '../production-batch-form';

export default function NewProductionBatchPage(): React.ReactElement {
  return (
    <div>
      <PageHeader
        title="New Production Batch"
        subtitle="Record a finished batch. Cost columns are snapshotted automatically from costing + sizing_job; raw material consumption and produced fabric are posted to the stock ledger."
        actions={
          <Link href="/app/production" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        }
      />
      <ProductionBatchForm mode="new" />
    </div>
  );
}
