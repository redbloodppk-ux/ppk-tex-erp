'use client';
/**
 * RecordActiveToggle — list-row on/off switch for any master table.
 * Saves immediately (optimistic, rolls back on error) and refreshes the
 * page's server data. Works for both boolean flags and status enums:
 *
 *   <RecordActiveToggle table="ledger" id={r.id} column="active"
 *     initialOn={r.active} />                       // true / false
 *   <RecordActiveToggle table="party" id={r.id} column="status"
 *     initialOn={r.status === 'active'} onValue="active" offValue="archived" />
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ToggleSwitch } from '@/app/components/toggle-switch';

interface RecordActiveToggleProps {
  table: string;
  id: number | string;
  column?: string;
  initialOn: boolean;
  onValue?: string | boolean;
  offValue?: string | boolean;
  onLabel?: string;
  offLabel?: string;
  /** Ask before switching OFF (e.g. something other screens depend on). */
  confirmOff?: string;
}

export function RecordActiveToggle({
  table,
  id,
  column = 'active',
  initialOn,
  onValue = true,
  offValue = false,
  onLabel = 'Active',
  offLabel = 'Inactive',
  confirmOff,
}: RecordActiveToggleProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const [on, setOn] = useState<boolean>(initialOn);
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(next: boolean): Promise<void> {
    if (busy) return;
    if (!next && confirmOff && !window.confirm(confirmOff)) return;
    setErr(null);
    setOn(next);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb
      .from(table)
      .update({ [column]: next ? onValue : offValue })
      .eq('id', id);
    setBusy(false);
    if (error) {
      setOn(!next);
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <ToggleSwitch
      checked={on}
      onChange={(next) => void toggle(next)}
      busy={busy}
      error={!!err}
      title={err ?? undefined}
      onLabel={onLabel}
      offLabel={offLabel}
    />
  );
}
