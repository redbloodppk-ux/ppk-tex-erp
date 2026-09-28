'use client';
// On/off switch for an employee's status on the Employees list, so an
// employee can be made active or inactive without opening the Edit form.
// On = 'active', Off = 'inactive'. Optimistic: flips at once and rolls back
// if the save fails. 'resigned' is left to the Edit form.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ToggleSwitch } from '@/app/components/toggle-switch';

interface EmployeeActiveToggleProps {
  id: number;
  name: string;
  initialActive: boolean;
}

export function EmployeeActiveToggle({ id, name, initialActive }: EmployeeActiveToggleProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
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
      .from('employee')
      .update({ status: next ? 'active' : 'inactive' })
      .eq('id', id);
    setBusy(false);
    if (error) {
      setActive(!next);
      setErr(error.message);
      return;
    }
    // Refresh server data (counts, attendance/wage pickers) in the background.
    router.refresh();
  }

  return (
    <ToggleSwitch
      checked={active}
      onChange={() => void toggle()}
      busy={busy}
      error={!!err}
      title={err ?? `${name}: ${active ? 'active' : 'inactive'}`}
    />
  );
}
