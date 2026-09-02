/**
 * The earliest and latest dates the books actually contain.
 *
 * WHY
 * PPK, 2026-09-02: "in bonus page, don't show date range that beyond the
 * record date", then "apply same for all reports".
 *
 * The Bonus page opened on 02-04-2025 → 02-09-2026 because FROM defaulted
 * to "a year ago". The books begin on 25-05-2026, so eleven of those
 * seventeen months held nothing. Those are not zero months — they are
 * months that never happened, and a total spanning them reads as a real
 * figure. Every report with a date range had the same shape of default.
 *
 * ONE IMPLEMENTATION, DELIBERATELY
 * Ten reports needing the same rule is exactly how a rule ends up written
 * ten slightly different ways — the fitter wage read Rs 2,400 on screen and
 * Rs 4,000 in the export for precisely that reason, and TDS read three ways
 * across four screens. So the query lives here and every caller passes only
 * which tables it draws on.
 *
 * Works with the server client and the browser client alike: both expose
 * the same query-builder surface, as ledger-view-query already relies on.
 */

export interface DateSource {
  table: string;
  column: string;
}

export interface RecordBounds {
  /** ISO date of the earliest record across the given sources. */
  min: string;
  /** ISO date of the latest. */
  max: string;
}

/** Named source sets, so a report says what it reads rather than
 *  re-typing table names that can silently go stale. */
export const SOURCES = {
  sales:      [{ table: 'invoice', column: 'invoice_date' }],
  purchases:  [
    { table: 'yarn_lot',        column: 'received_date' },
    { table: 'bobbin_purchase', column: 'purchase_date' },
    { table: 'fabric_purchase', column: 'received_date' },
    { table: 'sizing_job',      column: 'bill_date' },
  ],
  sizing:     [{ table: 'sizing_job', column: 'bill_date' }],
  attendance: [{ table: 'attendance_day', column: 'attendance_date' }],
  wages:      [
    { table: 'attendance_day', column: 'attendance_date' },
    { table: 'wage_entry',     column: 'pay_date' },
  ],
  production: [{ table: 'production_shift_log', column: 'log_date' }],
  beams:      [{ table: 'pavu_assign', column: 'start_date' }],
  money:      [
    { table: 'payment',    column: 'payment_date' },
    { table: 'bank_entry', column: 'entry_date' },
  ],
  delivery:   [{ table: 'delivery_challan', column: 'dc_date' }],
} as const satisfies Record<string, readonly DateSource[]>;

/** Everything above, for reports that span the whole business. */
export const ALL_SOURCES: DateSource[] = Array.from(
  new Map(
    Object.values(SOURCES).flat().map((s) => [`${s.table}.${s.column}`, s as DateSource]),
  ).values(),
);

/**
 * Reads min and max across `sources`. Returns null when NOTHING is found —
 * an empty database must leave the pickers open rather than lock them onto
 * a date that does not exist.
 *
 * Two cheap indexed reads per source (first ascending, first descending)
 * rather than an aggregate, because PostgREST has no min()/max() and
 * pulling every row to find the ends would be absurd.
 *
 * A source that errors — a renamed table, a view without permission — is
 * skipped rather than thrown. A report that cannot determine its bounds
 * should still render with open pickers; it should not 500.
 */
export async function recordDateBounds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  sources: readonly DateSource[],
): Promise<RecordBounds | null> {
  const ends = await Promise.all(
    sources.flatMap((s) => [
      sb.from(s.table).select(s.column).not(s.column, 'is', null)
        .order(s.column, { ascending: true }).limit(1).maybeSingle(),
      sb.from(s.table).select(s.column).not(s.column, 'is', null)
        .order(s.column, { ascending: false }).limit(1).maybeSingle(),
    ]),
  );

  const dates: string[] = [];
  ends.forEach((res, i) => {
    const src = sources[Math.floor(i / 2)];
    if (!src || res?.error) return;
    const v = res?.data?.[src.column];
    // Timestamps are trimmed to their date part so a date input can use it.
    if (typeof v === 'string' && v.length >= 10) dates.push(v.slice(0, 10));
  });

  if (dates.length === 0) return null;
  return {
    min: dates.reduce((a, b) => (a < b ? a : b)),
    max: dates.reduce((a, b) => (a > b ? a : b)),
  };
}

/** Pulls a date into [min, max]. Used to fix a stored or defaulted range
 *  that predates the books. Leaves anything already inside untouched. */
export function clampDate(d: string, b: RecordBounds | null): string {
  if (!b || !d) return d;
  if (d < b.min) return b.min;
  if (d > b.max) return b.max;
  return d;
}
