# Jobwork P&L Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Split view to the existing Period P&L page that breaks net revenue, COGS, period costs, and net profit into three columns — Own Production, Job Work, Combined — with shared costs allocated by metres produced.

**Architecture:** One new SQL function `fn_period_pnl_split(p_from, p_to)` does all the math (own/jobwork/combined per line). The existing `/app/reports/pnl/page.tsx` adds a `?view=combined|split` URL param + a Combined/Split toggle. Combined mode keeps calling the existing `fn_period_pnl` unchanged. Split mode calls the new function and renders a three-column table. Combined column in Split mode is mathematically guaranteed to equal `fn_period_pnl` output because it is the sum of Own + Jobwork inside the SQL.

**Tech Stack:** Postgres (Supabase), Next.js 15 App Router, TypeScript strict, Tailwind. SQL function deployed via `supabase mcp apply_migration`. Page changes deployed via `git push origin main` → Vercel.

**Spec:** `docs/superpowers/specs/2026-06-08-jobwork-pnl-split-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `app/db/migrations/138_period_pnl_split_fn.sql` | Defines `fn_period_pnl_split(date, date)` returning one row with `*_own`, `*_jobwork`, `*_combined` columns. |
| Modify | `app/app/app/reports/pnl/page.tsx` | Read `?view=`. Branch to combined (existing) or split (new) loader + render. Add toggle UI. Add allocation footnote. |

No new components, no new client files, no new utility modules. Everything fits in the two files above so the change stays reviewable in one pass.

---

## Task 1: Write migration 138 — `fn_period_pnl_split`

**Files:**
- Create: `app/db/migrations/138_period_pnl_split_fn.sql`

- [ ] **Step 1.1: Create the migration file with the function definition**

Write the file with these contents (exact bytes — do not paraphrase the comments):

```sql
-- 138_period_pnl_split_fn.sql
-- fn_period_pnl_split(p_from, p_to) → single-row P&L split into three columns:
--   *_own       — own-production P&L
--   *_jobwork   — jobwork P&L
--   *_combined  — sum of own + jobwork (matches fn_period_pnl line-by-line)
--
-- Allocation rule: shared period costs (wages, factory_expenses,
-- bank_expenses) are split between own and jobwork by the metre share:
--   own_metres     = SUM(production_batch.produced_m)        in window
--   jobwork_metres = SUM(jobwork_order.delivered_metres)     in window
--   own_share      = own_metres / (own_metres + jobwork_metres)
--   jw_share       = jobwork_metres / (own_metres + jobwork_metres)
-- If total metres = 0, fall back to own_share=1, jw_share=0 so any
-- standalone invoices/expenses still classify cleanly.
--
-- Revenue:
--   own revenue     = invoices doc_type IN ('tax_invoice','yarn_sale','general_sale')
--   jobwork revenue = invoices doc_type IN ('jobwork_invoice','weaving_bill')
-- Credit notes stay on the own side (consistent with fn_period_pnl).
-- COGS is own-only (jobwork uses customer's yarn).
-- Bank income stays on the own side (interest received etc.).

CREATE OR REPLACE FUNCTION public.fn_period_pnl_split(p_from date, p_to date)
RETURNS TABLE (
  period_from date,
  period_to   date,
  own_metres            numeric,
  jobwork_metres        numeric,
  total_metres          numeric,
  own_share             numeric,
  jw_share              numeric,

  revenue_own           numeric,
  revenue_jobwork       numeric,
  revenue_combined      numeric,

  credit_notes_own      numeric,
  credit_notes_jobwork  numeric,
  credit_notes_combined numeric,

  cogs_own              numeric,
  cogs_jobwork          numeric,
  cogs_combined         numeric,

  gross_profit_own      numeric,
  gross_profit_jobwork  numeric,
  gross_profit_combined numeric,

  wages_own             numeric,
  wages_jobwork         numeric,
  wages_combined        numeric,

  factory_expenses_own      numeric,
  factory_expenses_jobwork  numeric,
  factory_expenses_combined numeric,

  bank_expenses_own         numeric,
  bank_expenses_jobwork     numeric,
  bank_expenses_combined    numeric,

  bank_income_own           numeric,
  bank_income_jobwork       numeric,
  bank_income_combined      numeric,

  period_costs_own          numeric,
  period_costs_jobwork      numeric,
  period_costs_combined     numeric,

  net_profit_own            numeric,
  net_profit_jobwork        numeric,
  net_profit_combined       numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH
  metres AS (
    SELECT
      COALESCE((
        SELECT SUM(produced_m) FROM public.production_batch
        WHERE end_date BETWEEN p_from AND p_to
      ), 0)::numeric AS own_m,
      COALESCE((
        SELECT SUM(delivered_metres) FROM public.jobwork_order
        WHERE delivered_date BETWEEN p_from AND p_to
      ), 0)::numeric AS jw_m
  ),
  shares AS (
    SELECT
      own_m,
      jw_m,
      (own_m + jw_m)                                        AS total_m,
      CASE WHEN (own_m + jw_m) > 0 THEN own_m / (own_m + jw_m) ELSE 1 END AS own_s,
      CASE WHEN (own_m + jw_m) > 0 THEN jw_m  / (own_m + jw_m) ELSE 0 END AS jw_s
    FROM metres
  ),
  rev_own AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type IN ('tax_invoice', 'yarn_sale', 'general_sale')
  ),
  rev_jw AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type IN ('jobwork_invoice', 'weaving_bill')
  ),
  cn AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type = 'credit_note'
  ),
  cogs_cte AS (
    SELECT COALESCE(SUM(produced_m * COALESCE(actual_true_cost_per_m, 0)), 0)::numeric AS amount
    FROM public.production_batch
    WHERE end_date BETWEEN p_from AND p_to
  ),
  wages_cte AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.wage_entry
    WHERE pay_date BETWEEN p_from AND p_to
  ),
  exp_cte AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.expense_entry
    WHERE pay_date BETWEEN p_from AND p_to
  ),
  bank_exp AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS amount
    FROM public.bank_entry be
    JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status = 'active' AND be.direction = 'out'
      AND bc.pl_treatment = 'expense'
      AND be.entry_date BETWEEN p_from AND p_to
  ),
  bank_inc AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS amount
    FROM public.bank_entry be
    JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status = 'active' AND be.direction = 'in'
      AND bc.pl_treatment = 'income'
      AND be.entry_date BETWEEN p_from AND p_to
  )
SELECT
  p_from, p_to,
  s.own_m, s.jw_m, s.total_m, s.own_s, s.jw_s,

  -- Revenue (own / jobwork / combined)
  rev_own.amount,
  rev_jw.amount,
  (rev_own.amount + rev_jw.amount)::numeric,

  -- Credit notes (own only — combined = own)
  cn.amount,
  0::numeric,
  cn.amount,

  -- COGS (own only)
  cogs_cte.amount,
  0::numeric,
  cogs_cte.amount,

  -- Gross Profit
  (rev_own.amount - cn.amount - cogs_cte.amount)::numeric,
  (rev_jw.amount)::numeric,
  (rev_own.amount + rev_jw.amount - cn.amount - cogs_cte.amount)::numeric,

  -- Wages
  (wages_cte.amount * s.own_s)::numeric,
  (wages_cte.amount * s.jw_s)::numeric,
  wages_cte.amount,

  -- Factory Expenses
  (exp_cte.amount * s.own_s)::numeric,
  (exp_cte.amount * s.jw_s)::numeric,
  exp_cte.amount,

  -- Bank Expenses
  (bank_exp.amount * s.own_s)::numeric,
  (bank_exp.amount * s.jw_s)::numeric,
  bank_exp.amount,

  -- Bank Income (own only)
  bank_inc.amount,
  0::numeric,
  bank_inc.amount,

  -- Period Costs
  (wages_cte.amount * s.own_s + exp_cte.amount * s.own_s + bank_exp.amount * s.own_s)::numeric,
  (wages_cte.amount * s.jw_s  + exp_cte.amount * s.jw_s  + bank_exp.amount * s.jw_s )::numeric,
  (wages_cte.amount + exp_cte.amount + bank_exp.amount)::numeric,

  -- Net Profit
  (rev_own.amount - cn.amount - cogs_cte.amount + bank_inc.amount
     - wages_cte.amount * s.own_s - exp_cte.amount * s.own_s - bank_exp.amount * s.own_s)::numeric,
  (rev_jw.amount
     - wages_cte.amount * s.jw_s - exp_cte.amount * s.jw_s - bank_exp.amount * s.jw_s)::numeric,
  (rev_own.amount + rev_jw.amount - cn.amount - cogs_cte.amount + bank_inc.amount
     - wages_cte.amount - exp_cte.amount - bank_exp.amount)::numeric
FROM shares s, rev_own, rev_jw, cn, cogs_cte, wages_cte, exp_cte, bank_exp, bank_inc;
$$;

COMMENT ON FUNCTION public.fn_period_pnl_split(date, date) IS
  'Period P&L split into Own / Jobwork / Combined columns. Shared period costs allocated by metre share. Combined column equals fn_period_pnl line-by-line.';
```

- [ ] **Step 1.2: Apply migration to Supabase via MCP**

Use the Supabase MCP `apply_migration` tool:

```
project_id: cqyfbiecramujnzhgieg
name: 138_period_pnl_split_fn
query: <the SQL body from Step 1.1, no markdown fences>
```

Expected: `{"success": true}`.

- [ ] **Step 1.3: Verify the function exists and runs**

Use Supabase MCP `execute_sql`:

```sql
SELECT * FROM public.fn_period_pnl_split('2026-04-01'::date, '2026-06-08'::date);
```

Expected: One row returned with all 38 columns populated (numeric values, can be zero). No error.

- [ ] **Step 1.4: Verify combined columns match `fn_period_pnl`**

Use Supabase MCP `execute_sql`:

```sql
WITH s AS (
  SELECT * FROM public.fn_period_pnl_split('2026-04-01', '2026-06-08')
), c AS (
  SELECT * FROM public.fn_period_pnl('2026-04-01', '2026-06-08')
)
SELECT
  ABS(s.revenue_combined          - c.revenue)         AS d_rev,
  ABS(s.credit_notes_combined     - c.credit_notes)    AS d_cn,
  ABS(s.cogs_combined             - c.cogs)            AS d_cogs,
  ABS(s.gross_profit_combined     - c.gross_profit)    AS d_gp,
  ABS(s.wages_combined            - c.wages)           AS d_wages,
  ABS(s.factory_expenses_combined - c.factory_expenses) AS d_fx,
  ABS(s.bank_expenses_combined    - c.bank_expenses)   AS d_bx,
  ABS(s.bank_income_combined      - c.bank_income)     AS d_bi,
  ABS(s.period_costs_combined     - c.period_costs)    AS d_pc,
  ABS(s.net_profit_combined       - c.net_profit)      AS d_np
FROM s, c;
```

Expected: every column < 0.01. If any diff is non-trivial, the new function disagrees with the existing one — fix the SQL before continuing.

- [ ] **Step 1.5: Verify own + jobwork ≡ combined for every line**

Use Supabase MCP `execute_sql`:

```sql
WITH s AS (SELECT * FROM public.fn_period_pnl_split('2026-04-01', '2026-06-08'))
SELECT
  ABS((revenue_own          + revenue_jobwork)          - revenue_combined)          AS d_rev,
  ABS((credit_notes_own     + credit_notes_jobwork)     - credit_notes_combined)     AS d_cn,
  ABS((cogs_own             + cogs_jobwork)             - cogs_combined)             AS d_cogs,
  ABS((gross_profit_own     + gross_profit_jobwork)     - gross_profit_combined)     AS d_gp,
  ABS((wages_own            + wages_jobwork)            - wages_combined)            AS d_wages,
  ABS((factory_expenses_own + factory_expenses_jobwork) - factory_expenses_combined) AS d_fx,
  ABS((bank_expenses_own    + bank_expenses_jobwork)    - bank_expenses_combined)    AS d_bx,
  ABS((bank_income_own      + bank_income_jobwork)      - bank_income_combined)      AS d_bi,
  ABS((period_costs_own     + period_costs_jobwork)     - period_costs_combined)     AS d_pc,
  ABS((net_profit_own       + net_profit_jobwork)       - net_profit_combined)       AS d_np
FROM s;
```

Expected: every column < 0.01.

- [ ] **Step 1.6: Commit the migration file**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add 'app/db/migrations/138_period_pnl_split_fn.sql'
git commit -m "feat(pnl): migration 138 — fn_period_pnl_split

Three-column (own / jobwork / combined) P&L function.
Shared period costs allocated by metre share. Combined
column equals fn_period_pnl line-by-line by construction."
```

Do NOT push yet — the page changes come next.

---

## Task 2: Read existing PnL page (orient before editing)

**Files:**
- Read: `app/app/app/reports/pnl/page.tsx`

- [ ] **Step 2.1: Read the file end-to-end**

Confirm these existing pieces are still there:

- `PnlRow` interface (lines 19–32)
- `presetRange` (lines 50–76)
- `num` and `pct` helpers (lines 78–86)
- The default export `PeriodPnlPage` (line 88)
- The period picker `<form>` (lines 128–150)
- The KPI grid (lines 156–183) — keep unchanged in Combined mode, replace in Split mode
- The itemised table (lines 185–257) — same as KPI grid

The refactor strategy below assumes these stay intact in Combined mode.

---

## Task 3: Refactor — extract period resolution + add view param

**Files:**
- Modify: `app/app/app/reports/pnl/page.tsx`

- [ ] **Step 3.1: Add `view` to `PageProps`**

Change:

```typescript
interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
}
```

To:

```typescript
interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; preset?: string; view?: string }>;
}
```

- [ ] **Step 3.2: Add a shape for the split row right below `PnlRow`**

Insert directly after the `PnlRow` interface:

```typescript
interface PnlSplitRow {
  period_from: string;
  period_to: string;
  own_metres: number | string;
  jobwork_metres: number | string;
  total_metres: number | string;
  own_share: number | string;
  jw_share: number | string;

  revenue_own: number | string;          revenue_jobwork: number | string;          revenue_combined: number | string;
  credit_notes_own: number | string;     credit_notes_jobwork: number | string;     credit_notes_combined: number | string;
  cogs_own: number | string;             cogs_jobwork: number | string;             cogs_combined: number | string;
  gross_profit_own: number | string;     gross_profit_jobwork: number | string;     gross_profit_combined: number | string;
  wages_own: number | string;            wages_jobwork: number | string;            wages_combined: number | string;
  factory_expenses_own: number | string; factory_expenses_jobwork: number | string; factory_expenses_combined: number | string;
  bank_expenses_own: number | string;    bank_expenses_jobwork: number | string;    bank_expenses_combined: number | string;
  bank_income_own: number | string;      bank_income_jobwork: number | string;      bank_income_combined: number | string;
  period_costs_own: number | string;     period_costs_jobwork: number | string;     period_costs_combined: number | string;
  net_profit_own: number | string;       net_profit_jobwork: number | string;       net_profit_combined: number | string;
}
```

- [ ] **Step 3.3: Read the view param in `PeriodPnlPage`**

Right after the existing `const sp = await searchParams;` line, add:

```typescript
const view: 'combined' | 'split' = sp.view === 'split' ? 'split' : 'combined';
```

This places the toggle in URL state so links and bookmarks survive.

---

## Task 4: Add the Combined / Split toggle UI

**Files:**
- Modify: `app/app/app/reports/pnl/page.tsx`

- [ ] **Step 4.1: Helper to preserve the date params in toggle links**

Above the `return (` block of `PeriodPnlPage`, add:

```typescript
const baseParams = new URLSearchParams();
if (sp.from)   baseParams.set('from',   sp.from);
if (sp.to)     baseParams.set('to',     sp.to);
if (sp.preset) baseParams.set('preset', sp.preset);
const linkFor = (v: 'combined' | 'split'): string => {
  const qs = new URLSearchParams(baseParams);
  qs.set('view', v);
  return `/app/reports/pnl?${qs.toString()}`;
};
```

- [ ] **Step 4.2: Render the toggle above the period picker `<form>`**

Insert this block immediately after the `<PageHeader … />` element and BEFORE the existing `<form action="/app/reports/pnl" …>`:

```tsx
{/* View toggle — Combined keeps the existing single-column report.
    Split shows a three-column own / jobwork / combined view. */}
<div className="mb-3 flex items-center gap-1">
  <Link
    href={linkFor('combined')}
    className={
      'px-3 py-1.5 rounded-l-md text-xs font-semibold border border-line ' +
      (view === 'combined' ? 'bg-ink text-white border-ink' : 'bg-paper text-ink-soft hover:bg-haze')
    }
  >
    Combined
  </Link>
  <Link
    href={linkFor('split')}
    className={
      'px-3 py-1.5 rounded-r-md text-xs font-semibold border border-line -ml-px ' +
      (view === 'split' ? 'bg-ink text-white border-ink' : 'bg-paper text-ink-soft hover:bg-haze')
    }
  >
    Split (Own / Jobwork)
  </Link>
</div>
```

- [ ] **Step 4.3: Ensure the date `<form>` propagates the current view**

Inside the existing `<form>` block (between lines 128 and 150), add a hidden input so submitting the form keeps the same view:

```tsx
<input type="hidden" name="view" value={view} />
```

Place it as the first child of the `<form>`, immediately after the opening tag.

- [ ] **Step 4.4: Update the Quick preset links so they preserve the view**

Replace each of the five Quick preset `<Link>` elements (lines 140–148). For each, append `&view={view}` to the href. Example transformation:

Before:

```tsx
<Link href="/app/reports/pnl?preset=this_month" className="text-indigo-700 underline">This month</Link>
```

After:

```tsx
<Link href={`/app/reports/pnl?preset=this_month&view=${view}`} className="text-indigo-700 underline">This month</Link>
```

Apply the same change for `last_month`, `this_quarter`, `fy_to_date`, `last_30d`.

---

## Task 5: Wire the split data fetch + branch the render

**Files:**
- Modify: `app/app/app/reports/pnl/page.tsx`

- [ ] **Step 5.1: Fetch the split data only when view='split'**

Replace the existing single fetch block:

```typescript
const supabase = await createClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const { data: rows, error } = await sb.rpc('fn_period_pnl', { p_from: from, p_to: to });
const row: PnlRow | null = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
```

With:

```typescript
const supabase = await createClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

// Combined view always loads the existing function so today's output
// is unchanged. Split view also loads it so we can fall back to a
// single-column render if the new function errors.
const { data: rows, error } = await sb.rpc('fn_period_pnl', { p_from: from, p_to: to });
const row: PnlRow | null = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);

let splitRow: PnlSplitRow | null = null;
let splitError: { message: string } | null = null;
if (view === 'split') {
  const res = await sb.rpc('fn_period_pnl_split', { p_from: from, p_to: to });
  splitRow = Array.isArray(res.data) ? (res.data[0] ?? null) : (res.data ?? null);
  splitError = res.error ?? null;
}
```

- [ ] **Step 5.2: Surface the split fetch error**

Right under the existing error card render:

```tsx
{error && (
  <div className="card p-3 mb-4 text-err text-sm">Could not load P&L: {error.message}</div>
)}
```

Add a sibling error card for the split fetch:

```tsx
{view === 'split' && splitError && (
  <div className="card p-3 mb-4 text-err text-sm">Could not load Split P&L: {splitError.message}</div>
)}
```

---

## Task 6: Render the Split view (three-column table + KPIs)

**Files:**
- Modify: `app/app/app/reports/pnl/page.tsx`

- [ ] **Step 6.1: Wrap the existing KPI grid + itemised table in a Combined-only branch**

Locate the existing `{/* Header KPIs */}` block (around line 157) through the closing tag of the itemised `</div>` after the `</table>` (around line 257), AND the footer `<p>` after it (around line 259). Wrap them in `{view === 'combined' && ( … )}`:

```tsx
{view === 'combined' && (
  <>
    {/* Header KPIs */}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {/* …existing KPI cards… */}
    </div>

    {/* Itemised P&L */}
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        {/* …existing thead + tbody… */}
      </table>
    </div>

    <p className="text-[11px] text-ink-mute mt-4">
      Period: <strong>{from}</strong> to <strong>{to}</strong>.
      COGS uses each batch&apos;s <em>frozen</em> true cost (computed at the time the batch was finished),
      so historical profit doesn&apos;t shift when overhead is re-calibrated today.
      Balance-sheet items (cash withdrawals, loan principal, GST payment, loan disbursement, cash deposit) are excluded.
    </p>
  </>
)}
```

Do NOT change anything inside this block — wrap it as-is.

- [ ] **Step 6.2: Add the Split render right below**

Immediately after the closing `)}` of the Combined block, insert:

```tsx
{view === 'split' && (
  <>
    {/* Split P&L — three columns: Own / Jobwork / Combined */}
    {(() => {
      const ownMetres = num(splitRow?.own_metres);
      const jwMetres  = num(splitRow?.jobwork_metres);
      const totalMetres = ownMetres + jwMetres;
      const ownShare = num(splitRow?.own_share);
      const jwShare  = num(splitRow?.jw_share);

      const revOwn = num(splitRow?.revenue_own);
      const revJw  = num(splitRow?.revenue_jobwork);
      const revCom = num(splitRow?.revenue_combined);
      const cnOwn  = num(splitRow?.credit_notes_own);
      const cnCom  = num(splitRow?.credit_notes_combined);
      const cogsOwn = num(splitRow?.cogs_own);
      const cogsCom = num(splitRow?.cogs_combined);
      const gpOwn  = num(splitRow?.gross_profit_own);
      const gpJw   = num(splitRow?.gross_profit_jobwork);
      const gpCom  = num(splitRow?.gross_profit_combined);
      const wagesOwn = num(splitRow?.wages_own);
      const wagesJw  = num(splitRow?.wages_jobwork);
      const wagesCom = num(splitRow?.wages_combined);
      const fxOwn = num(splitRow?.factory_expenses_own);
      const fxJw  = num(splitRow?.factory_expenses_jobwork);
      const fxCom = num(splitRow?.factory_expenses_combined);
      const bxOwn = num(splitRow?.bank_expenses_own);
      const bxJw  = num(splitRow?.bank_expenses_jobwork);
      const bxCom = num(splitRow?.bank_expenses_combined);
      const biOwn = num(splitRow?.bank_income_own);
      const biCom = num(splitRow?.bank_income_combined);
      const pcOwn = num(splitRow?.period_costs_own);
      const pcJw  = num(splitRow?.period_costs_jobwork);
      const pcCom = num(splitRow?.period_costs_combined);
      const npOwn = num(splitRow?.net_profit_own);
      const npJw  = num(splitRow?.net_profit_jobwork);
      const npCom = num(splitRow?.net_profit_combined);

      const netRevOwn = revOwn - cnOwn;
      const netRevJw  = revJw;
      const netRevCom = revCom - cnCom;

      const fmt = (n: number): string => formatRupee(n, { decimals: 0 });
      const cls = (n: number): string => (n >= 0 ? 'text-emerald-700' : 'text-rose-700');

      return (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="card p-3 border-emerald-200">
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Own Production · Net Profit</div>
              <div className={'num text-xl font-extrabold ' + cls(npOwn)}>{fmt(npOwn)}</div>
              <div className="text-[10px] text-ink-mute">Margin: {pct(npOwn, netRevOwn)}</div>
            </div>
            <div className="card p-3 border-amber-200">
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Job Work · Net Profit</div>
              <div className={'num text-xl font-extrabold ' + cls(npJw)}>{fmt(npJw)}</div>
              <div className="text-[10px] text-ink-mute">Margin: {pct(npJw, netRevJw)}</div>
            </div>
            <div className="card p-3 border-2 border-indigo-300">
              <div className="text-[11px] uppercase tracking-wide text-indigo-700 font-semibold">Combined · Net Profit</div>
              <div className={'num text-2xl font-extrabold ' + cls(npCom)}>{fmt(npCom)}</div>
              <div className="text-[10px] text-ink-mute">Margin: {pct(npCom, netRevCom)}</div>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left  px-3 py-3">Line</th>
                  <th className="text-right px-3 py-3">Own Production</th>
                  <th className="text-right px-3 py-3">Job Work</th>
                  <th className="text-right px-3 py-3">Combined</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line/40">
                  <td className="px-3 py-2 font-semibold">Revenue</td>
                  <td className={'px-3 py-2 text-right num font-semibold ' + cls(revOwn)}>{fmt(revOwn)}</td>
                  <td className={'px-3 py-2 text-right num font-semibold ' + cls(revJw)}>{fmt(revJw)}</td>
                  <td className={'px-3 py-2 text-right num font-semibold ' + cls(revCom)}>{fmt(revCom)}</td>
                </tr>
                {cnCom > 0 && (
                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2 pl-6 text-ink-soft">Less: Credit Notes</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cnOwn)}</td>
                    <td className="px-3 py-2 text-right num text-ink-mute">—</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cnCom)}</td>
                  </tr>
                )}
                <tr className="border-t border-line/40 bg-cloud/30 font-semibold">
                  <td className="px-3 py-2">Net Revenue</td>
                  <td className="px-3 py-2 text-right num">{fmt(netRevOwn)}</td>
                  <td className="px-3 py-2 text-right num">{fmt(netRevJw)}</td>
                  <td className="px-3 py-2 text-right num">{fmt(netRevCom)}</td>
                </tr>

                <tr className="border-t border-line/40">
                  <td className="px-3 py-2">COGS (Cost of Goods Sold)</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cogsOwn)}</td>
                  <td className="px-3 py-2 text-right num text-ink-mute">— <span className="text-[10px]">(customer&apos;s yarn)</span></td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cogsCom)}</td>
                </tr>
                <tr className="border-t-2 border-line/60 bg-emerald-50/30 font-semibold">
                  <td className="px-3 py-2">Gross Profit</td>
                  <td className={'px-3 py-2 text-right num ' + cls(gpOwn)}>{fmt(gpOwn)}</td>
                  <td className={'px-3 py-2 text-right num ' + cls(gpJw)}>{fmt(gpJw)}</td>
                  <td className={'px-3 py-2 text-right num ' + cls(gpCom)}>{fmt(gpCom)}</td>
                </tr>

                <tr className="border-t border-line/40">
                  <td className="px-3 py-2">Wages</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(wagesOwn)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(wagesJw)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(wagesCom)}</td>
                </tr>
                <tr className="border-t border-line/40">
                  <td className="px-3 py-2">Factory Expenses</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(fxOwn)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(fxJw)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(fxCom)}</td>
                </tr>
                <tr className="border-t border-line/40">
                  <td className="px-3 py-2">Bank Entries (expense)</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(bxOwn)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(bxJw)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(bxCom)}</td>
                </tr>
                <tr className="border-t border-line/40">
                  <td className="px-3 py-2">Other Income (Interest Received)</td>
                  <td className="px-3 py-2 text-right num text-emerald-700">+ {fmt(biOwn)}</td>
                  <td className="px-3 py-2 text-right num text-ink-mute">—</td>
                  <td className="px-3 py-2 text-right num text-emerald-700">+ {fmt(biCom)}</td>
                </tr>

                <tr className="border-t border-line/40 bg-cloud/30 font-semibold">
                  <td className="px-3 py-2">Period Costs</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(pcOwn)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(pcJw)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(pcCom)}</td>
                </tr>

                <tr className="border-t-2 border-indigo-300 bg-indigo-50/40 font-bold text-base">
                  <td className="px-3 py-3">Net Profit</td>
                  <td className={'px-3 py-3 text-right num ' + cls(npOwn)}>{fmt(npOwn)}</td>
                  <td className={'px-3 py-3 text-right num ' + cls(npJw)}>{fmt(npJw)}</td>
                  <td className={'px-3 py-3 text-right num ' + cls(npCom)}>{fmt(npCom)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Allocation footnote */}
          <div className="card p-3 mt-3 bg-amber-50/50 border-amber-200 text-[12px] text-ink-soft leading-relaxed">
            <div className="font-semibold text-ink mb-1">Allocation basis</div>
            Period metres: own <strong>{ownMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</strong>
            {' '}+ jobwork <strong>{jwMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</strong>
            {' '}= <strong>{totalMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</strong>.{' '}
            Shared period costs (Wages, Factory Expenses, Bank Expenses) allocated by metre ratio:
            {' '}own <strong>{(ownShare * 100).toFixed(1)}%</strong>
            {' '}/ jobwork <strong>{(jwShare * 100).toFixed(1)}%</strong>.
            {totalMetres <= 0 && (
              <div className="text-amber-800 mt-2 font-medium">
                ⚠ No production this period — period costs allocated 100% to own-production.
              </div>
            )}
          </div>

          <p className="text-[11px] text-ink-mute mt-4">
            Period: <strong>{from}</strong> to <strong>{to}</strong>.
            COGS uses each batch&apos;s <em>frozen</em> true cost. Jobwork uses customer-owned yarn so jobwork COGS is zero.
            Bank Income and Credit Notes stay on the own side.
            Combined column equals the single-column &ldquo;Combined&rdquo; report by construction.
          </p>
        </>
      );
    })()}
  </>
)}
```

---

## Task 7: Manual verification on the deployed app

**Files:**
- (none)

- [ ] **Step 7.1: Push and wait for Vercel deploy**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add 'app/app/app/reports/pnl/page.tsx'
git commit -m "feat(pnl): Split view (Own / Job Work / Combined)

Adds ?view=combined|split URL param + pill toggle on the
existing P&L page. Combined view unchanged. Split view
calls fn_period_pnl_split and renders three columns with
an allocation footnote showing metre shares."
git push origin main
```

Wait for Vercel build to go green.

- [ ] **Step 7.2: Open `/app/reports/pnl?preset=this_month`**

Confirm:
- Combined pill is highlighted.
- Page renders identically to before this change (single-column).
- Numbers match `fn_period_pnl(period_from, period_to)`.

- [ ] **Step 7.3: Click "Split (Own / Jobwork)"**

URL becomes `/app/reports/pnl?preset=this_month&view=split`. Confirm:
- Three KPI cards at top (Own / Job Work / Combined).
- Three-column table with Revenue → Net Profit lines.
- Allocation footnote shows metre values and percentage shares.
- Switching preset (e.g. Last month) keeps the Split view.

- [ ] **Step 7.4: Spot-check the math**

For the displayed period:
- Own.NetProfit + Jobwork.NetProfit ≈ Combined.NetProfit (eyeball within ₹1).
- Combined column matches the numbers shown in Combined mode.
- If period has zero jobwork metres, jobwork column shows zero/dash entries and the allocation footnote shows 100% own.

If any check fails, do NOT continue — debug the SQL or the renderer.

- [ ] **Step 7.5: Mark plan complete**

All checkboxes ticked. Spec acceptance criteria met (own-production P&L, job-work P&L, combined P&L; allocation by metres-produced per the design doc).

---

## Self-Review Notes

- **Spec coverage:** Goal, Constraints, Decisions, Allocation Math (all 10 lines), Edge Cases (zero metres handled in SQL CASE + UI banner), UI (toggle + footnote), Implementation files (138 + page.tsx) — all mapped to tasks above.
- **No placeholders:** every code step shows the actual code to type. No "TBD" or "similar to above".
- **Type consistency:** `PnlSplitRow` field names match the SQL function's RETURNS TABLE column names one-for-one. The `view` union `'combined' | 'split'` is used everywhere.
- **Verification gates:** Steps 1.4 and 1.5 prove math correctness before any page changes go live. Step 7.4 re-verifies in the browser.
