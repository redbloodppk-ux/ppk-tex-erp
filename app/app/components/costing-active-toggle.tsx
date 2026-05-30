'use client';
// Active/inactive checkbox for a costing_master row. Flips status between
// 'active' and 'archived' via Supabase. Optimistic UI: updates immediately
// and rolls back on error.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

interface CostingActiveToggleProps {
  id: number;
  initialActive: boolean;
}

export function CostingActiveToggle({ id, initialActive }: CostingActiveToggleProps): React.ReactElement {
  const supabase = createClient();
  const [active, setActive] = useState<boolean>(initialActive);
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    if (busy) return;
    setErr(null);
    const next = !active;
    setActive(next);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb
      .from('costing_master')
      .update({ status: next ? 'active' : 'archived' })
      .eq('id', id);
    setBusy(false);
    if (error) {
      // Roll back the optimistic update.
      setActive(!next);
      setErr(error.message);
    }
  }

  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title={err ?? 'Toggle active'}>
      <input
        type="checkbox"
        checked={active}
        onChange={toggle}
        disabled={busy}
        className="w-4 h-4 accent-emerald-600"
      />
      {busy ? (
        <Loader2 className="w-3 h-3 animate-spin text-ink-mute" />
      ) : (
        <span className={'text-xs font-medium ' + (active ? 'text-emerald-700' : 'text-ink-mute')}>
          {active ? 'Active' : 'Inactive'}
        </span>
      )}
    </label>
  );
}
