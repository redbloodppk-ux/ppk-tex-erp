import { describe, it, expect } from 'vitest';
import { fetchAll, PAGE_SIZE, type PageResult } from './fetch-all';

/** A fake table of `total` rows that honours .range() like PostgREST does,
 *  including the 1000-row cap on any wider request. */
function fakeTable(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  const calls: Array<[number, number]> = [];
  const build = (lo: number, hi: number): Promise<PageResult<{ id: number }>> => {
    calls.push([lo, hi]);
    const width = Math.min(hi - lo + 1, PAGE_SIZE);
    return Promise.resolve({ data: all.slice(lo, lo + width), error: null });
  };
  return { build, calls };
}

describe('fetchAll', () => {
  it('returns everything when the table fits in one page', async () => {
    const { build, calls } = fakeTable(120);
    const r = await fetchAll(build);
    expect(r.rows).toHaveLength(120);
    expect(r.pages).toBe(1);
    expect(calls).toEqual([[0, 999]]);
  });

  it('keeps going past the 1000-row cap', async () => {
    // The real case: ~2,000 attendance rows. A plain select returns 1,000
    // and says nothing, which is how ASHOK showed 3 presents against 40.
    const { build } = fakeTable(2037);
    const r = await fetchAll(build);
    expect(r.rows).toHaveLength(2037);
    expect(r.pages).toBe(3);
  });

  it('loses no row and repeats none across page boundaries', async () => {
    const { build } = fakeTable(2500);
    const r = await fetchAll<{ id: number }>(build);
    const ids = r.rows.map((x) => x.id);
    expect(new Set(ids).size).toBe(2500);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(2500);
  });

  it('stops cleanly on an exact multiple of the page size', async () => {
    // 2000 rows: the second page is full, so it must ask for a third to
    // learn there is nothing left. Stopping at a full page would be a
    // guess, and guessing is what caused the bug.
    const { build } = fakeTable(2000);
    const r = await fetchAll(build);
    expect(r.rows).toHaveLength(2000);
    expect(r.pages).toBe(3);
  });

  it('surfaces an error instead of returning half the data', async () => {
    const build = (): Promise<PageResult<never>> =>
      Promise.resolve({ data: null, error: { message: 'permission denied' } });
    const r = await fetchAll(build);
    expect(r.error).toBe('permission denied');
    expect(r.rows).toEqual([]);
  });

  it('refuses to loop forever when .range() was forgotten', async () => {
    // A builder that ignores the range always returns a full page, so the
    // loop would never end. Better to fail loudly than hang the screen.
    const build = (): Promise<PageResult<{ id: number }>> => Promise.resolve({
      data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })),
      error: null,
    });
    const r = await fetchAll(build, 3);
    expect(r.rows).toEqual([]);
    expect(r.error).toContain('missing .range()');
    expect(r.pages).toBe(3);
  });

  it('handles an empty table', async () => {
    const { build } = fakeTable(0);
    const r = await fetchAll(build);
    expect(r.rows).toEqual([]);
    expect(r.error).toBeNull();
  });
});
