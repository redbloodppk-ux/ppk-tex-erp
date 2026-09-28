'use client';
// Active/inactive checkbox for a costing_master row. Flips status between
// 'active' and 'archived' via Supabase. Optimistic UI: updates immediately
// and rolls back on error.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ToggleSwitch } from '@/app/components/toggle-switch';

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
    <ToggleSwitch
      checked={active}
      onChange={() => void toggle()}
      busy={busy}
      error={!!err}
      title={err ?? undefined}
    />
  );
}
