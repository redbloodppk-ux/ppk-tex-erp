'use client';
// Approval-status select used in the Recent Decisions table on the
// /app/costing/approvals page. Owners can change a costing's approval
// status freely (pending / approved / rejected). RLS is the real gate;
// non-owners will see the change fail silently.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

type Status = 'pending' | 'approved' | 'rejected';

interface ApprovalStatusSelectProps {
  costingId: number;
  initial: Status;
}

export function ApprovalStatusSelect({ costingId, initial }: ApprovalStatusSelectProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const [value, setValue] = useState<Status>(initial);
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function onChange(next: Status): Promise<void> {
    if (next === value) return;
    setErr(null);
    const prev = value;
    setValue(next);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: { user } } = await sb.auth.getUser();
    const patch: Record<string, unknown> = { approval_status: next };
    if (next === 'approved') {
      patch.approved_by = user?.id ?? null;
      patch.approved_at = new Date().toISOString();
    } else if (next === 'pending') {
      patch.approved_by = null;
      patch.approved_at = null;
    }
    const { error } = await sb.from('costing_master').update(patch).eq('id', costingId);
    setBusy(false);
    if (error) {
      setValue(prev);
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  const cls = value === 'approved'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : value === 'rejected'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <div className="inline-flex items-center gap-1.5" title={err ?? undefined}>
      <select
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value as Status)}
        className={'input h-9 text-sm px-2 pr-7 min-w-[120px] font-medium capitalize ' + cls}
      >
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-mute shrink-0" />}
    </div>
  );
}
