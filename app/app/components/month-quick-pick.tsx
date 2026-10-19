'use client';
/**
 * Month filter for GET-form reports (e.g. Purchase Register / GSTR-2B,
 * which is filed month by month). Picking a month fills the form's
 * `from` / `to` date inputs with that month's first and last day (today
 * for the running month) and submits the form. It carries no `name`, so
 * the URL keeps using plain from/to and custom ranges still work.
 */
import { useRef } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string { return String(n).padStart(2, '0'); }
function lastDay(y: number, m1: number): number { return new Date(y, m1, 0).getDate(); }

interface Props {
  from: string;          // current applied from (YYYY-MM-DD)
  to: string;            // current applied to
  today: string;         // YYYY-MM-DD (IST)
  minDate?: string | null;  // earliest date with records
  className?: string;
}

export function MonthQuickPick({ from, to, today, minDate, className }: Props): React.ReactElement {
  const ref = useRef<HTMLSelectElement>(null);
  const [ty, tm] = today.split('-').map(Number) as [number, number];

  // Months from the earliest record (or 24 months back) up to this month.
  let [sy, sm] = (minDate ?? '').split('-').map(Number) as [number, number];
  if (!sy || !sm) { sy = ty; sm = tm - 23; while (sm < 1) { sm += 12; sy -= 1; } }
  const opts: Array<{ value: string; label: string; from: string; to: string }> = [];
  let y = ty, m = tm;
  while (y > sy || (y === sy && m >= sm)) {
    const f = `${y}-${pad(m)}-01`;
    const full = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
    const t = full > today ? today : full;
    opts.push({ value: `${y}-${pad(m)}`, label: `${MONTHS[m - 1]} ${y}`, from: f, to: t });
    m -= 1; if (m < 1) { m = 12; y -= 1; }
    if (opts.length > 120) break;
  }

  // Show the month when the applied range is exactly one whole month.
  const current = opts.find((o) => o.from === from
    && (o.to === to || to === `${o.value}-${pad(lastDay(Number(o.value.slice(0, 4)), Number(o.value.slice(5, 7))))}`));

  function onPick(v: string): void {
    const o = opts.find((x) => x.value === v);
    const form = ref.current?.form;
    if (!o || !form) return;
    const f = form.elements.namedItem('from') as HTMLInputElement | null;
    const t = form.elements.namedItem('to') as HTMLInputElement | null;
    // Stay inside the inputs' own min/max (the dates the books reach) so
    // the browser's validation doesn't silently block the submit.
    const clamp = (el: HTMLInputElement, v: string): string => {
      if (el.min && v < el.min) return el.min;
      if (el.max && v > el.max) return el.max;
      return v;
    };
    if (f) f.value = clamp(f, o.from);
    if (t) t.value = clamp(t, o.to);
    form.requestSubmit();
  }

  return (
    <select
      ref={ref}
      className={className ?? 'input'}
      value={current?.value ?? ''}
      onChange={(e) => onPick(e.target.value)}
      aria-label="Month"
    >
      <option value="">Custom dates</option>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
