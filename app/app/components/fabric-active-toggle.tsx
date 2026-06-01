'use client';
// Active checkbox for a fabric_quality row. Flips fabric_quality.active
// between true/false via Supabase. Optimistic UI: updates immediately and
// rolls back on error.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

interface FabricActiveToggleProps {
  id: number;
  initialActive: boolean;
}

export function FabricActiveToggle({ id, initialActive }: FabricActiveToggleProps): React.ReactElement {
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
    const { error } = await sb.from('fabric_quality').update({ active: next }).eq('id', id);
    setBusy(false);
    if (error) {
      setActive(!next);
      setErr(error.message);
    }
  }

  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title={err ?? 'Toggle active'}>
      <input type="checkbox" checked={active} onChange={toggle} disabled={busy}
        className="w-4 h-4 accent-emerald-600" />
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
