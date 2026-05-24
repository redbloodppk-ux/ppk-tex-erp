'use client';
/**
 * DecideButtons - owner-only Approve / Reject controls for a single
 * pending costing row (T-B11).
 *
 * RLS already blocks the UPDATE for non-owners, but we hide the buttons
 * for the wrong role too so non-owners don't see a dead control.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Check, X, Loader2 } from 'lucide-react';

interface Props {
  costingId: number;
  qualityCode: string;
}

export function DecideButtons({ costingId, qualityCode }: Props) {
  const router   = useRouter();
  const supabase = createClient();
  const [busy, setBusy]   = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(next: 'approved' | 'rejected') {
    setError(null);
    if (next === 'rejected') {
      const ok = confirm(
        `Reject costing ${qualityCode}? Sales Orders cannot price against it ` +
        `until it's edited and re-submitted for approval.`
      );
      if (!ok) return;
    }
    setBusy(next === 'approved' ? 'approve' : 'reject');

    const { data: { user } } = await supabase.auth.getUser();
    // NOTE: TS2345 on .update() is the same untyped-SupabaseClient limitation
    // that affects every client-side mutation in this repo (looms-calibration,
    // costing/new, customers/new, etc.). It clears once task #66 lands the
    // typed Database generic. A local cast just trades one error for another.
    const { error: upErr } = await supabase
      .from('costing_master')
      .update({
        approval_status: next,
        approved_by:     user?.id ?? null,
        approved_at:     new Date().toISOString(),
      })
      .eq('id', costingId);

    setBusy(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => decide('rejected')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
        >
          {busy === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          Reject
        </button>
        <button
          type="button"
          onClick={() => decide('approved')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Approve
        </button>
      </div>
      {error && <div className="text-[11px] text-red-600 font-semibold max-w-xs text-right">{error}</div>}
    </div>
  );
}
