'use client';
/**
 * SmartSelect — a drop-in for <select> that turns into the type-to-search
 * box (SearchSelect) once the list is long enough to be worth searching.
 *
 * Swap `<select ...>` for `<SmartSelect ...>` and keep the same props and
 * <option> children. It reads the options from the children, so the screen
 * does not change how it builds its list or reads the answer:
 *   - onChange still receives an event-like object with target.value
 *     (and target.name), so `(e) => setX(e.target.value)` keeps working;
 *   - a `name` is kept via a hidden input, so FormData / GET forms still
 *     submit it;
 *   - `value` (controlled) and `defaultValue` (uncontrolled) both work.
 *
 * It stays a plain <select> when searching would not help or would change
 * behaviour: short lists (< searchThreshold real options), disabled,
 * multiple, <optgroup>, or options that are individually disabled.
 */
import { Children, isValidElement, useState } from 'react';
import type { ReactNode, SelectHTMLAttributes, ChangeEvent } from 'react';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';

interface ParsedOption extends SearchSelectOption {
  disabled: boolean;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Flatten <option>s (through fragments and arrays). null = cannot parse. */
function parseOptions(children: ReactNode): ParsedOption[] | null {
  const out: ParsedOption[] = [];
  let ok = true;
  const walk = (nodes: ReactNode): void => {
    Children.forEach(nodes, (child) => {
      if (!ok || child == null || typeof child === 'boolean') return;
      if (!isValidElement<{ children?: ReactNode; value?: unknown; disabled?: boolean }>(child)) {
        if (typeof child === 'string' && child.trim() === '') return;
        ok = false;
        return;
      }
      if (child.type === 'option') {
        const label = textOf(child.props.children).replace(/\s+/g, ' ').trim();
        const value = child.props.value !== undefined ? String(child.props.value) : label;
        out.push({ value, label, disabled: Boolean(child.props.disabled) });
        return;
      }
      // React.Fragment and friends: look inside.
      if (typeof child.type === 'symbol') { walk(child.props.children); return; }
      ok = false; // <optgroup> or a custom component — leave it native
    });
  };
  walk(children);
  return ok ? out : null;
}

/** Keep layout classes for the wrapper; SearchSelect styles its own input. */
function layoutOnly(className: string | undefined): string {
  if (!className) return '';
  return className
    .split(/\s+/)
    .filter((c) => /^(?:[a-z]+:)?(?:w-|min-w-|max-w-|flex-|grow|shrink|basis-|col-|row-|self-|m[trblxy]?-|order-)/.test(c))
    .join(' ');
}

type SmartSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Real options (not counting the blank placeholder) needed to switch to search. */
  searchThreshold?: number;
};

export function SmartSelect(props: SmartSelectProps): React.ReactElement {
  const {
    children, value, defaultValue, onChange, name, required, disabled,
    className, multiple, searchThreshold = 8,
  } = props;
  const controlled = value !== undefined;
  const [inner, setInner] = useState<string>(
    defaultValue == null ? '' : String(defaultValue),
  );

  const parsed = parseOptions(children);
  const realOptions = parsed?.filter((o) => o.value !== '') ?? [];
  const native =
    parsed == null || disabled || multiple ||
    realOptions.length < searchThreshold ||
    parsed.some((o) => o.disabled);

  if (native) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { searchThreshold: _t, ...selectProps } = props;
    return <select {...selectProps} />;
  }

  const current = controlled ? (value == null ? '' : String(value)) : inner;
  const placeholder = parsed.find((o) => o.value === '')?.label || 'Type to search…';

  function handle(next: string): void {
    if (!controlled) setInner(next);
    if (onChange) {
      const target = { value: next, name: name ?? '' };
      onChange({ target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>);
    }
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={current} />}
      <SearchSelect
        options={realOptions.map(({ value: v, label }) => ({ value: v, label }))}
        value={current}
        onChange={handle}
        placeholder={placeholder}
        required={Boolean(required)}
        className={layoutOnly(className)}
      />
    </>
  );
}
