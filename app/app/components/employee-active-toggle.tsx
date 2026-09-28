'use client';
// On/off switch for an employee's status on the Employees list, so an
// employee can be made active or inactive without opening the Edit form.
// On = 'active', Off = 'inactive'. Optimistic: flips at once and rolls back
// if the save fails. 'resigned' is left to the Edit form.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${name}: ${active ? 'active' : 'inactive'}`}
      title={err ?? (active ? 'Active — tap to make inactive' : 'Inactive — tap to make active')}
      onClick={toggle}
      disabled={busy}
      className="inline-flex items-center gap-2 select-none disabled:opacity-60"
    >
      <span
        className={
          'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ' +
          (active ? 'bg-emerald-500' : 'bg-slate-300')
        }
      >
        <span
          className={
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ' +
            (active ? 'translate-x-[18px]' : 'translate-x-0.5')
          }
        />
      </span>
      <span className={'text-xs font-semibold ' + (err ? 'text-rose-600' : active ? 'text-emerald-700' : 'text-amber-700')}>
        {err ? 'Error' : active ? 'Active' : 'Inactive'}
      </span>
    </button>
  );
}
