#!/usr/bin/env node
/**
 * Fails the build on an un-paged read of a table big enough to be
 * truncated.
 *
 * WHY A SCRIPT AND NOT A COMMENT
 * PostgREST caps an un-ranged select at 1000 rows silently — no error, no
 * warning, just a short array. Nothing downstream can tell. On 2026-08-26
 * that showed ASHOK 3 presents against 40 actual on the Bonus page, and
 * made its date pickers look broken.
 *
 * reports/shed-running already carried a comment warning about this exact
 * trap, written the first time it bit. The comment did not stop it
 * happening again, because nobody reads a comment in a file they are not
 * editing. A check that fails does.
 *
 * WHAT COUNTS AS SAFE
 *   .range(...)      paged, usually via lib/supabase/fetch-all.ts
 *   .limit(n)        deliberately capped
 *   .single()        exactly one row
 *   .maybeSingle()   zero or one row
 *   .csv()           streamed by PostgREST, not capped the same way
 *
 * Anything else against a table in LARGE_TABLES is an error.
 *
 * KEEPING THE LIST HONEST
 * Add a table here as soon as it can plausibly pass 1000 rows. Check with:
 *
 *   select relname, n_live_tup from pg_stat_user_tables
 *   where schemaname='public' order by n_live_tup desc limit 20;
 *
 * Size alone is not the test — what matters is rows per unit of the range
 * being queried. production_shift_log_weaver gains ~1,229 rows a month, so
 * any report spanning more than ~24 days truncates. That window shrinks
 * every month the mill runs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Already past 1000 rows: an un-paged read of these is WRONG TODAY at any
// realistic date range. Fails the check.
const TRUNCATING_NOW = new Set([
  'audit_log',                    // 4,835 rows on 2026-08-26
  'production_shift_log_weaver',  // 3,563 — ~1,229/month, breaks past ~24 days
  'attendance_entry',             // 2,037 —   ~657/month, breaks past ~46 days
  'production_shift_log',         // 1,897 —   ~654/month, breaks past ~46 days
]);

// Under 1000 but growing. Listed so the risk is visible and nobody has to
// rediscover it, but not failed on — turning 36 working call sites red
// would just teach everyone to bypass the check. Move a table up to
// TRUNCATING_NOW when it passes ~800 rows.
const GROWING = new Set([
  'stock_ledger',                 //   474 on 2026-08-26
  'wage_entry',                   //   429 on 2026-08-26
]);

const LARGE_TABLES = new Set([...TRUNCATING_NOW, ...GROWING]);

const SAFE = ['.range(', '.limit(', '.maybeSingle(', '.single(', '.csv('];
const ROOTS = ['app', 'lib'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'build']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  let files;
  try { files = walk(root); } catch { continue; }
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const re = /\.from\(\s*'([a-z_0-9]+)'\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const table = m[1];
      if (!LARGE_TABLES.has(table)) continue;
      // The chain runs until the statement clearly ends.
      const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 1200);
      const end = tail.search(/\n\s*(\]\)|\);|\}\);)/);
      const chain = end === -1 ? tail : tail.slice(0, end);
      if (!chain.includes('.select(')) continue;       // insert/update/delete
      if (SAFE.some((s) => chain.includes(s))) continue;
      problems.push({
        file: relative(process.cwd(), file),
        line: src.slice(0, m.index).split('\n').length,
        table,
        blocking: TRUNCATING_NOW.has(table),
      });
    }
  }
}

const blocking = problems.filter((p) => p.blocking);
const growing = problems.filter((p) => !p.blocking);

if (growing.length > 0) {
  console.log(
    `\nNote: ${growing.length} un-paged read(s) of a table that is growing ` +
    'but has not passed 1000 rows yet. Not a failure — page them before it does.',
  );
  for (const p of growing) console.log(`  ${p.file}:${p.line}  reads ${p.table}`);
}

if (blocking.length === 0) {
  console.log('\nOK — every read of an already-large table is paged or capped.');
  process.exit(0);
}

console.error(
  `\nFound ${blocking.length} un-paged read(s) of a table already past 1000 rows.\n` +
  'Each of these silently returns only the first 1000 rows — no error, no warning.\n',
);
for (const p of blocking) {
  console.error(`  ${p.file}:${p.line}  reads ${p.table}`);
}
console.error(
  '\nFix: page it with fetchAll() from lib/supabase/fetch-all.ts, adding a\n' +
  'stable .order(...) and .range(lo, hi). Or add .limit(n) if a partial\n' +
  'read is genuinely what you want — say so in a comment.\n',
);
process.exit(1);
