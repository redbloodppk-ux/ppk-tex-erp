'use client';
/**
 * CustomerFilter — type-ahead Customer picker for the Sales Register
 * filter strip, wrapping the shared SearchSelect component.
 *
 * The surrounding <form> on the page submits as a plain native GET
 * (see page.tsx), so this component keeps a hidden `customer_id` input
 * in sync with the SearchSelect's chosen value — the "Apply" button
 * still works exactly as before, no client-side submit logic needed.
 */
import { useState } from 'react';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';

interface CustomerFilterOption {
  id: number;
  code: string;
  name: string;
}

interface CustomerFilterProps {
  customers: CustomerFilterOption[];
  defaultValue: string;
}

export function CustomerFilter({
  customers,
  defaultValue,
}: CustomerFilterProps): React.ReactElement {
  const [value, setValue] = useState<string>(defaultValue);

  const options: SearchSelectOption[] = customers.map((c) => ({
    value: String(c.id),
    label: c.code ? `${c.code} — ${c.name}` : c.name,
  }));

  return (
    <>
      <input type="hidden" name="customer_id" value={value} />
      <SearchSelect
        options={options}
        value={value}
        onChange={setValue}
        placeholder="All customers"
        className="min-w-[220px]"
        noMatchText="No customer found"
      />
    </>
  );
}
