/**
 * Read EVERY matching row, not just the first page.
 *
 * THE PROBLEM THIS EXISTS FOR
 * PostgREST caps an un-ranged select at 1000 rows and says nothing about
 * it. No error, no flag, no truncation warning — just a shorter array than
 * you asked for. Code downstream sums it, averages it, pays wages from it,
 * and looks entirely healthy while being wrong.
 *
 * Found 2026-08-26 on the Bonus page, which read 16 months of attendance
 * (about 2,000 rows), got the oldest 1,000, and showed ASHOK 3 presents
 * against 40 actual. Changing the date range appeared to do nothing,
 * because the extra rows fell off the same cap.
 *
 * It had bitten at least once before: reports/shed-running carries a
 * comment about recent shifts showing "idle" once the table passed 1000.
 * A comment did not stop it happening again, which is why this helper and
 * the guard in scripts/check-large-table-reads.mjs both exist.
 *
 * WHEN A TABLE STARTS TO BITE
 * It is not about total size, it is about how fast rows accumulate against
 * the range being queried. Measured 2026-08-26:
 *
 *   production_shift_log_weaver  ~1,229 rows / 30 days  -> breaks past ~24 days
 *   attendance_entry               ~657 rows / 30 days  -> breaks past ~46 days
 *   production_shift_log           ~654 rows / 30 days  -> breaks past ~46 days
 *
 * Those windows shrink every month the mill runs. Treat any query whose
 * range is chosen by the operator as unbounded.
 *
 * USAGE
 *   const { rows, error } = await fetchAll<AttRow>((lo, hi) =>
 *     sb.from('attendance_entry')
 *       .select('id, employee_id, status')
 *       .gte('day.attendance_date', from)
 *       .order('id', { ascending: true })   // REQUIRED, see below
 *       .range(lo, hi));
 *
 * ORDER IS NOT OPTIONAL. Without a stable sort, Postgres may return rows
 * in a different order between pages, so paging would silently duplicate
 * some rows and skip others — a subtler version of the bug this fixes.
 * Order by the primary key unless you have a better unique key.
 */

/** One page of a PostgREST select. */
export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface FetchAllResult<T> {
  rows: T[];
  error: string | null;
  /** Pages fetched. 1 means the result fit comfortably; more means the
   *  cap WOULD have truncated a plain select. Useful in tests. */
  pages: number;
}

/** PostgREST's default cap. Pages are requested at exactly this size so a
 *  short page reliably means "that was the last one". */
export const PAGE_SIZE = 1000;

/**
 * Page through a select until a short page arrives.
 *
 * @param build Called with an inclusive row range; must apply `.range(lo, hi)`
 *              and a stable `.order(...)`.
 * @param maxPages Safety stop. 200 pages is 200,000 rows — far past anything
 *              this mill will ask for in one screen, and it prevents an
 *              endless loop if a caller forgets `.range()` and every page
 *              comes back full.
 */
export async function fetchAll<T>(
  build: (lo: number, hi: number) => PromiseLike<PageResult<T>>,
  maxPages = 200,
): Promise<FetchAllResult<T>> {
  const rows: T[] = [];
  let pages = 0;
  for (let lo = 0; pages < maxPages; lo += PAGE_SIZE) {
    const { data, error } = await build(lo, lo + PAGE_SIZE - 1);
    pages += 1;
    if (error) return { rows: [], error: error.message, pages };
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return { rows, error: null, pages };
  }
  return {
    rows: [],
    error:
      `Read more than ${maxPages * PAGE_SIZE} rows without reaching the end. ` +
      'The query is probably missing .range() — check the builder passed to fetchAll.',
    pages,
  };
}
