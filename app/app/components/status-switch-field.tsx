'use client';
/**
 * StatusSwitchField — an on/off switch that stands in for a
 * <select name="status"> inside a FormData-based form.
 *
 * On  -> onValue  (default 'active')
 * Off -> offValue (default 'archived' — record_status has no 'inactive')
 *
 * Renders a hidden <input name={name}> so the surrounding form reads it
 * exactly as it read the old select.
 */
import { useState } from 'react';
import { ToggleSwitch } from '@/app/components/toggle-switch';

interface StatusSwitchFieldProps {
  name?: string;
  defaultValue: string;
  onValue?: string;
  offValue?: string;
  onLabel?: string;
  offLabel?: string;
}

export function StatusSwitchField({
  name = 'status',
  defaultValue,
  onValue = 'active',
  offValue = 'archived',
  onLabel = 'Active',
  offLabel = 'Inactive',
}: StatusSwitchFieldProps): React.ReactElement {
  // Keep an existing non-active value (e.g. 'discontinued') when the
  // switch is left off, instead of silently rewriting it.
  const initialOff = defaultValue !== onValue ? defaultValue : offValue;
  const [value, setValue] = useState<string>(defaultValue || onValue);
  const [offVal] = useState<string>(initialOff || offValue);
  const on = value === onValue;
  return (
    <div className="flex items-center min-h-[42px]">
      <input type="hidden" name={name} value={value} />
      <ToggleSwitch
        size="md"
        checked={on}
        onChange={(next) => setValue(next ? onValue : offVal)}
        onLabel={onLabel}
        offLabel={offLabel}
      />
    </div>
  );
}
